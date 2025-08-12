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

class DownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Sample rate of the audio rendering context
    this.fs = sampleRate;

    // Default to 500 Hz; allow override via processorOptions or port
    this.targetRate =
      (options &&
        options.processorOptions &&
        options.processorOptions.targetRate) ??
      500;

    this.nextOutSample = 0;
    this.prevSample = 0;
    this.havePrev = false;

    this._recomputeStepAndChunk(false);

    // Robust cross-browser configuration: accept targetRate via port
    this.port.onmessage = (e) => {
      const { targetRate } = e.data || {};
      if (typeof targetRate === "number" && targetRate > 0) {
        this.targetRate = targetRate;
        this._recomputeStepAndChunk(true);
      }
    };
  }

  _recomputeStepAndChunk(preserveState = true) {
    this.step = this.fs / this.targetRate;
    const newChunk = Math.max(1, Math.round(this.targetRate * 0.1)); // ~100 ms
    if (!preserveState || newChunk !== this.SAMPLES_PER_CHUNK) {
      this.SAMPLES_PER_CHUNK = newChunk;
      this.buf = new Float32Array(this.SAMPLES_PER_CHUNK);
      this.bufLen = 0;
      this.firstOutTime = 0;
    }
  }

  flushChunk() {
    // must be exactly one 100 ms chunk
    if (this.bufLen !== this.SAMPLES_PER_CHUNK) return;
    const out = this.buf.slice(0, this.bufLen);
    this.port.postMessage({ audioTime0: this.firstOutTime, values: out }, [
      out.buffer,
    ]);
    this.bufLen = 0;
  }

  enqueue(value, audioTime) {
    if (this.bufLen === 0) this.firstOutTime = audioTime;
    this.buf[this.bufLen++] = value;
    if (this.bufLen === this.SAMPLES_PER_CHUNK) this.flushChunk();
  }

  process(inputs) {
    const input = inputs?.[0];
    if (!input || input.length === 0) return true;

    const ch = input[0];
    const frames = ch.length;
    if (frames === 0) return true;

    const blockStart = currentFrame;

    if (!this.havePrev) {
      this.havePrev = true;
      this.nextOutSample = blockStart;
      this.prevSample = ch[0] ?? 0;
    }

    for (let i = 0; i < frames; i++) {
      const globalIndex = blockStart + i;
      const s1 = ch[i];

      while (this.nextOutSample <= globalIndex) {
        const leftIndex = globalIndex - 1;
        const s0 = i > 0 ? ch[i - 1] : this.prevSample;
        const frac = Math.min(1, Math.max(0, this.nextOutSample - leftIndex));
        const value = s0 + (s1 - s0) * frac;
        const audioTime = this.nextOutSample / this.fs;

        this.enqueue(value, audioTime);
        this.nextOutSample += this.step;
      }
    }

    this.prevSample = ch[frames - 1];
    return true; // no end-of-block flush; keeps 100 ms chunking exact
  }
}

registerProcessor("downsample", DownsampleProcessor);
