/*
 * Copyright (C) 2025 The OpenPSG Authors
 *
 * This file is licensed under the Functional Source License 1.1
 * with a grant of AGPLv3-or-later effective two years after publication.
 *
 * You may not use this file except in compliance with the License.
 * A copy of the license is available in the root of the repository
 * and online at: https://fsl.software
 *
 * After two years from publication, this file may also be used under
 * the GNU Affero General Public License, version 3 or (at your option) any
 * later version. See <https://www.gnu.org/licenses/agpl-3.0.html> for details.
 */

import Channel from "@/lib/sync/channel";
import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Values } from "@/lib/types";
import { INT16_MIN, INT16_MAX } from "@/lib/constants";
import type { Driver, ConfigField, ConfigValue } from "./driver";
import DownsampleProcessorSource from "./internal/downsample-processor.js?raw";

export class SnoreMicDriver implements Driver {
  private ctx?: AudioContext;
  private mediaStream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private notch?: BiquadFilterNode;
  private lp?: BiquadFilterNode;
  private worklet?: AudioWorkletNode;
  private mutedSink?: GainNode;
  private running = false;
  private queue?: Channel<Values>; // chunked output

  // Output: 500 samples per second (waveform)
  private readonly outputRate = 500; // Hz

  // Front-end band limits before downsampling
  private readonly lpCut = this.outputRate / 2; // Hz (Nyquist)
  private readonly butterQ = 0.707; // ~Butterworth

  // Notch config (can be overridden via configure)
  private notchEnabled = true;
  private mainsHz: 50 | 60 = 50;
  private notchQ = 20;

  // Timestamp mapping anchors
  private t0Audio?: number;
  private t0WallMs?: number;
  private lastWallTsMs?: number;

  configSchema: ConfigField[] = [
    {
      name: "notchEnabled",
      label: "Mains Hum Filter",
      type: "boolean",
      defaultValue: true,
      description:
        "Reduce mains hum interference."
    },
    {
      name: "mainsHz",
      label: "Mains Frequency",
      type: "select",
      options: [
        { value: 50, label: "50 Hz" },
        { value: 60, label: "60 Hz" },
      ],
      defaultValue: 50,
      visibleIf: [{ conditions: [{ field: "notchEnabled", value: true }] }],
      description:
        "Your local mains frequency (50Hz in EU, 60Hz in US).",
    },
  ];

  configure(config: Record<string, ConfigValue>): void {
    if (config.notchEnabled !== undefined)
      this.notchEnabled = !!config.notchEnabled;
    if (config.mainsHz === 50 || config.mainsHz === 60)
      this.mainsHz = config.mainsHz;
  }

  signals(recordDuration: number): EDFSignal[] {
    return [
      {
        label: "Snore",
        transducerType: "mic",
        physicalDimension: "",
        physicalMin: -1,
        physicalMax: 1,
        digitalMin: INT16_MIN,
        digitalMax: INT16_MAX,
        prefiltering: this.notchEnabled
          ? `LP:${this.lpCut}Hz N:${this.mainsHz}Hz`
          : `LP:${this.lpCut}Hz`,
        samplesPerRecord: Math.round(this.outputRate * recordDuration),
      },
    ];
  }

  async *values(): AsyncIterable<Values> {
    if (this.running) throw new Error("SnoreMicDriver is already running");
    this.queue = new Channel<Values>();
    await this.setupAudio();

    const queue = this.queue!;
    try {
      for await (const chunk of queue) {
        for (const v of chunk) {
          yield [v];
        }
      }
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    this.running = false;

    try {
      if (this.worklet) this.worklet.port.onmessage = null;
      this.worklet?.disconnect();
      this.mutedSink?.disconnect();
      this.lp?.disconnect();
      this.notch?.disconnect();
      this.source?.disconnect();
    } catch (e) {
      console.warn("Failed to disconnect audio nodes", e);
    }

    try {
      this.worklet?.port.close();
    } catch (e) {
      console.warn("Failed to close worklet port", e);
    }

    try {
      this.mediaStream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch (e) {
      console.warn("Failed to close audio context or media stream", e);
    }

    this.worklet = undefined;
    this.mutedSink = undefined;
    this.lp = undefined;
    this.notch = undefined;
    this.source = undefined;
    this.mediaStream = undefined;
    this.t0Audio = undefined;
    this.t0WallMs = undefined;
    this.lastWallTsMs = undefined;
    this.ctx = undefined;
    this.queue?.close();
    this.queue = undefined;
  }

  private async setupAudio(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: false,
        echoCancellation: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
    });

    this.ctx = new (window.AudioContext ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext)();
    await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.mediaStream);

    // Optional mains notch (band-stop)
    if (this.notchEnabled) {
      this.notch = this.ctx.createBiquadFilter();
      this.notch.type = "notch";
      this.notch.frequency.value = this.mainsHz; // 50 or 60 Hz
      this.notch.Q.value = this.notchQ; // narrow notch
    }

    // Low-pass antialiasing filter
    this.lp = this.ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = this.lpCut;
    this.lp.Q.value = this.butterQ;

    // Load worklet from imported string via Blob
    const blob = new Blob([DownsampleProcessorSource], {
      type: "application/javascript",
    });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    // Create worklet. Keep one muted output so engines reliably pull the graph.
    this.worklet = new AudioWorkletNode(this.ctx, "downsample", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { targetRate: this.outputRate },
    });

    this.worklet.port.postMessage({ targetRate: this.outputRate });

    // Anchor times for wallclock conversion
    this.t0Audio = this.ctx.currentTime;
    this.t0WallMs = Date.now();
    this.running = true;

    // Fixed step at output rate; chunking is done in the worklet (≈100 ms)
    const dtMs = 1000 / this.outputRate;

    this.worklet.port.onmessage = (e: MessageEvent) => {
      if (!this.running) return;

      const data = e.data as
        | { audioTime0: number; values: Float32Array }
        | { audioTime: number; value: number };

      if ("audioTime0" in data && "values" in data) {
        const { audioTime0, values } = data;
        const ms0 = this.wallclockFromAudioTime(audioTime0).getTime();

        const out: Values = new Array(values.length);
        for (let i = 0; i < values.length; i++) {
          out[i] = { timestamp: new Date(ms0 + i * dtMs), value: values[i] };
        }
        this.queue?.push(out);
      } else {
        const { audioTime, value } = data;
        const ts = this.wallclockFromAudioTime(audioTime);
        this.queue?.push([{ timestamp: ts, value }]);
      }
    };

    // Wire up: Mic → (Notch) → LP → Worklet → (muted) Gain → Destination
    if (this.notch) {
      this.source.connect(this.notch);
      this.notch.connect(this.lp);
    } else {
      this.source.connect(this.lp);
    }
    this.lp.connect(this.worklet);

    this.mutedSink = this.ctx.createGain();
    this.mutedSink.gain.value = 0;
    this.worklet.connect(this.mutedSink).connect(this.ctx.destination);
  }

  private wallclockFromAudioTime(audioTime: number): Date {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyCtx = this.ctx as any;
    let ms: number | undefined;

    if (anyCtx?.getOutputTimestamp) {
      try {
        const { contextTime, performanceTime } = anyCtx.getOutputTimestamp();
        const perfNow = performance.now();
        const skewMs = perfNow - performanceTime;
        ms = Date.now() - skewMs + (audioTime - contextTime) * 1000;
      } catch {
        // fall through
      }
    }

    if (
      ms === undefined &&
      this.t0Audio !== undefined &&
      this.t0WallMs !== undefined
    ) {
      ms = this.t0WallMs + (audioTime - this.t0Audio) * 1000;
    }

    if (ms === undefined) ms = Date.now();

    if (this.lastWallTsMs !== undefined && ms < this.lastWallTsMs) {
      ms = this.lastWallTsMs;
    }
    this.lastWallTsMs = ms;

    return new Date(ms);
  }
}
