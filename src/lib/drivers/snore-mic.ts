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
import type { Value, Values } from "@/lib/types";
import { INT16_MIN, INT16_MAX } from "@/lib/constants";
import type { Driver, ConfigField, ConfigValue } from "./driver";
import DownsampleProcessorSource from "./internal/downsample-processor.js?raw";

export class SnoreMicDriver implements Driver {
  private ctx?: AudioContext;
  private mediaStream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private hp?: BiquadFilterNode;
  private lp?: BiquadFilterNode;
  private worklet?: AudioWorkletNode;
  private running = false;
  private queue?: Channel<Value>;

  // Output: 400 samples per second (waveform)
  private readonly outputRate = 400;

  // Front-end band limits before downsampling
  private readonly hpCut = 20; // Hz
  private readonly lpCut = 200; // Hz (Nyquist for 400 sps)
  private readonly butterQ = 0.707; // ~Butterworth

  // Timestamp mapping anchors
  private t0Audio?: number;
  private t0WallMs?: number;
  private lastWallTsMs?: number;

  configSchema: ConfigField[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  configure(_config: Record<string, ConfigValue>): void {}

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
        prefiltering: "HP:20Hz LP:200Hz",
        samplesPerRecord: Math.max(
          1,
          Math.round(this.outputRate * recordDuration),
        ),
      },
    ];
  }

  async *values(): AsyncIterable<Values> {
    if (this.running) throw new Error("SnoreMicDriver is already running");
    this.queue = new Channel<Value>();
    await this.setupAudio();

    const queue = this.queue!;
    try {
      for await (const value of queue) yield [value];
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    this.running = false;

    try {
      if (this.worklet) this.worklet.port.onmessage = null;
      this.worklet?.disconnect();
      this.lp?.disconnect();
      this.hp?.disconnect();
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
    this.hp = undefined;
    this.lp = undefined;
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

    // High-pass @ 20 Hz
    this.hp = this.ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = this.hpCut;
    this.hp.Q.value = this.butterQ;

    // Low-pass @ 200 Hz (anti-alias for 400 sps)
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

    // Use 1 dummy output for broader compatibility
    this.worklet = new AudioWorkletNode(this.ctx, "downsample", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { targetRate: this.outputRate },
    });

    // Anchor times for wallclock conversion
    this.t0Audio = this.ctx.currentTime;
    this.t0WallMs = Date.now();
    this.running = true;

    this.worklet.port.onmessage = (e: MessageEvent) => {
      if (!this.running) return;
      const { audioTime, value } = e.data as {
        audioTime: number;
        value: number;
      };
      const ts = this.wallclockFromAudioTime(audioTime);
      this.queue?.push({ timestamp: ts, value });
    };

    // Mic → HP → LP → Worklet (output is unused)
    this.source.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.worklet);
  }

  private wallclockFromAudioTime(audioTime: number): Date {
    // Map AudioContext time to wall clock, with monotonic clamp
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
