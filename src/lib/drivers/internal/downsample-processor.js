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

// AudioWorkletProcessor that downsamples a mono input stream to `targetRate`
// (e.g., 400 sps). Assumes the main thread has anti-aliased the input
// (e.g., LP @ 200 Hz) before this node.
// It uses precise, time-based linear interpolation to place sample times
// on the AudioContext clock.

class DownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.fs = sampleRate; // AudioWorklet global
    this.targetRate = options?.processorOptions?.targetRate || 400;

    // Next output time (in source-sample units since context start)
    this.nextOutSample = 0;

    // Last sample for cross-block interpolation
    this.prevSample = 0;
    this.havePrev = false;

    // Step between output samples in source-sample units
    this.step = this.fs / this.targetRate;
  }

  process(inputs) {
    const input = inputs?.[0];
    if (!input || input.length === 0) return true;

    const ch = input[0]; // mono
    const frames = ch.length;
    if (frames === 0) return true;

    const blockStart = currentFrame; // absolute sample index of first frame

    // Initialize on first block so we emit at t=0
    if (!this.havePrev) {
      this.havePrev = true;
      this.nextOutSample = blockStart; // start emitting immediately
      this.prevSample = ch[0] ?? 0;
    }

    for (let i = 0; i < frames; i++) {
      const globalIndex = blockStart + i;
      const s1 = ch[i];

      // Emit any scheduled outputs that fall in (globalIndex-1, globalIndex]
      while (this.nextOutSample <= globalIndex) {
        const leftIndex = globalIndex - 1;
        const s0 = i > 0 ? ch[i - 1] : this.prevSample;

        // Fractional position of nextOutSample within [leftIndex, globalIndex]
        const frac = Math.min(1, Math.max(0, this.nextOutSample - leftIndex));
        const value = s0 + (s1 - s0) * frac;

        const audioTime = this.nextOutSample / this.fs;

        this.port.postMessage({ audioTime, value });

        this.nextOutSample += this.step;
      }
    }

    // Save tail for next block interpolation
    this.prevSample = ch[frames - 1];

    // Pass-through silent dummy output
    return true;
  }
}

registerProcessor("downsample", DownsampleProcessor);
