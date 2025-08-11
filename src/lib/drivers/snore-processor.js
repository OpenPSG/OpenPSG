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

const EPS = 1e-12;
const FLOOR_DB = -120;

class SnoreProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const {
      outputRate = 10,
      smoothMsAttack = 200,
      smoothMsRelease = 200,
    } = (options && options.processorOptions) || {};

    // Public-ish params
    this.outputRate = Math.max(1, Number(outputRate) || 10);
    this.smoothMsAttack = Math.max(0, Number(smoothMsAttack) || 0);
    this.smoothMsRelease = Math.max(0, Number(smoothMsRelease) || 0);

    // Accumulators for windowed RMS
    this.acc = 0; // sum of mean-of-squares across frames
    this.count = 0; // frames accumulated
    this.targetFrames = Math.max(1, Math.round(sampleRate / this.outputRate));

    // Smoothed mean-square state (linear power). Initialized on first emit.
    this.msSmooth = undefined;
  }

  /**
   * Process a render quantum. We integrate power until targetFrames, then
   * emit one envelope sample with smoothing and a midpoint timestamp.
   */
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const numCh = input.length;
      const len = input[0].length;

      // Accumulate mean-of-squares across channels (per-sample power averaged over channels)
      let s = 0;
      for (let i = 0; i < len; i++) {
        let p = 0;
        for (let ch = 0; ch < numCh; ch++) {
          const v = input[ch][i];
          p += v * v;
        }
        p /= numCh; // mean power across channels
        s += p;
      }

      this.acc += s;
      this.count += len;

      if (this.count >= this.targetFrames) {
        // Mean-square over the accumulation window
        const meanSquare = this.acc / this.count;

        // --- Exponential smoothing in linear domain (attack/release) ---
        // Convert the emitted step duration to seconds to derive coefficients.
        const dt = this.count / sampleRate;

        // alpha = exp(-dt/tau). Smaller tau -> smaller alpha -> faster reaction.
        const aUp =
          this.smoothMsAttack > 0
            ? Math.exp(-dt / (this.smoothMsAttack / 1000))
            : 0; // 0 => no smoothing on attack (instant)
        const aDn =
          this.smoothMsRelease > 0
            ? Math.exp(-dt / (this.smoothMsRelease / 1000))
            : 0; // 0 => no smoothing on release (instant)

        if (this.msSmooth === undefined) {
          // Seed with first measurement to avoid an initial jump.
          this.msSmooth = meanSquare;
        } else {
          const rising = meanSquare > this.msSmooth;
          const a = rising ? aUp : aDn;
          this.msSmooth = a * this.msSmooth + (1 - a) * meanSquare;
        }

        // Convert to dBFS with floor
        const rms = Math.sqrt(Math.max(this.msSmooth, 0));
        const dbfs = 20 * Math.log10(Math.max(rms, EPS));

        // Timestamp at midpoint of the emitted window in AudioContext time
        const midTime = currentTime - (this.count / sampleRate) * 0.5;

        this.port.postMessage({
          audioTime: midTime,
          dbfs: Math.max(dbfs, FLOOR_DB),
        });

        // Reset accumulators for next window
        this.acc = 0;
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor("snore", SnoreProcessor);
