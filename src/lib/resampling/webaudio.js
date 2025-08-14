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

// ResampleProcessor — rational-ratio SRC via polyphase windowed-sinc FIR.
// Flow:
// 1) r = targetRate / fs → approximate as L/M (continued fractions) for drift-free streaming.
// 2) Design prototype LPF: Kaiser-windowed sinc, cutoff = 0.5 / max(L, M) (normalized to input fs).
// 3) Reverse taps for causal (present-first) convolution; split into L polyphase branches.
// 4) For output n: u=n*M; q=floor(u/L); p=u−q*L; y[n]=dot(h_p, {x[q], x[q-1], ...}).
// 5) Batch ~100 ms; timestamps compensate group delay ( (N−1)/2 input samples ).
//
// Notes:
// - DC gain normalized to 1 so constant in → constant out.
// - actualRate = fs*L/M; output time t = n/actualRate − groupDelay/fs.
class ResampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Rates
    this.fs = sampleRate;

    const targetRate = options?.processorOptions?.targetRate;
    if (typeof targetRate !== "number" || targetRate <= 0) {
      throw new Error("targetRate is required");
    }
    this.targetRate = targetRate;

    // L/M ratio (continued-fraction approx)
    const r = this.targetRate / this.fs;
    const { num: Lraw, den: Mraw } = rationalApprox(r, 1024, 1024, 1e-10);
    this.L = Math.max(1, Lraw | 0);
    this.M = Math.max(1, Mraw | 0);
    this.actualRate = (this.fs * this.L) / this.M;

    // Kaiser windowed sinc filter design
    const tapsPerPhase = Math.max(
      8,
      Math.floor(options?.processorOptions?.tapsPerPhase ?? 24),
    );
    // Total taps; odd length preferred for symmetric linear-phase center
    const N0 = tapsPerPhase * this.L;
    this.N = N0 % 2 === 0 ? N0 + 1 : N0;

    const atten = options?.processorOptions?.attenuationDb ?? 80;
    const beta = kaiserBetaFromAttenuation(atten);

    // Cutoff normalized to input fs: enforce worst-case Nyquist after up/downsampling.
    const fc = 0.5 / Math.max(this.L, this.M);

    // Design prototype taps h[0..N-1]
    const h = designLowpassKaiser(this.N, fc, beta); // Float64Array
    normalizeUnityDC(h);

    // Reverse taps: present-first convolution order (x[q], x[q-1], ...)
    const hr = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++) hr[i] = h[this.N - 1 - i];

    // Polyphase decomp w.r.t. L: phase p has hr[p], hr[p+L], ...
    this.phases = [];
    this.phaseLenMax = 0;
    for (let p = 0; p < this.L; p++) {
      const arr = [];
      for (let k = p; k < this.N; k += this.L) arr.push(hr[k]);
      const hp = new Float64Array(arr);
      this.phases.push(hp);
      if (hp.length > this.phaseLenMax) this.phaseLenMax = hp.length;
    }

    // Ring buffer over input samples (enough to cover max phase length + margin)
    this.bufCap = Math.max(2048, this.phaseLenMax + 1024);
    this.buf = new Float32Array(this.bufCap);
    this.writePtr = 0; // points to next write slot
    this.writeAbs = 0; // absolute index of next write
    this.groupDelay = (this.N - 1) / 2; // in input-sample units

    // Output sample counter
    this.nOut = 0;

    // Output batching
    this.SAMPLES_PER_CHUNK = Math.max(1, Math.round(this.targetRate / 10)); // ~100 ms
    this.outBuf = new Float32Array(this.SAMPLES_PER_CHUNK);
    this.outLen = 0;
    this.firstOutTime = 0;
  }

  appendSample(x) {
    this.buf[this.writePtr] = x;
    this.writePtr++;
    if (this.writePtr === this.bufCap) this.writePtr = 0;
    this.writeAbs++;
  }

  // Check if we have a sample at absIdx.
  hasSample(absIdx) {
    if (absIdx < 0) return false;
    const oldest = this.writeAbs - this.bufCap; // retained: [oldest .. writeAbs-1]
    return absIdx >= oldest && absIdx <= this.writeAbs - 1;
  }

  // Get x[absIdx]; returns 0 before stream start or beyond retention.
  getSample(absIdx) {
    if (absIdx < 0) return 0;
    // we retain indices in [writeAbs - bufCap, writeAbs - 1]
    const oldest = this.writeAbs - this.bufCap;
    if (absIdx < oldest) return 0;
    const offset = absIdx - oldest; // 0..bufCap-1 where 0 is oldest
    const startPtr = this.writePtr; // corresponds to writeAbs (one past newest)
    let pos = startPtr + offset;
    pos %= this.bufCap;
    return this.buf[pos];
  }

  flushChunk() {
    if (this.outLen === 0) return;
    const out = this.outBuf.slice(0, this.outLen);
    this.port.postMessage({ audioTime0: this.firstOutTime, values: out }, [
      out.buffer,
    ]);
    this.outLen = 0;
  }

  enqueue(value, audioTime) {
    if (this.outLen === 0) this.firstOutTime = audioTime;
    this.outBuf[this.outLen++] = value;
    if (this.outLen === this.SAMPLES_PER_CHUNK) this.flushChunk();
  }

  // Compute outputs allowed by current input.
  produceOutputsIfPossible() {
    // Need input up to q = floor(n*M/L); history obtained via getSample()
    while (true) {
      const n = this.nOut;
      const u = n * this.M; // upsampled index
      const q = Math.floor(u / this.L); // newest input index needed
      if (q > this.writeAbs - 1) break; // don't overrun latest input

      const p = u - q * this.L; // phase = (n*M) % L
      const hp = this.phases[p];

      // Accumulate only over taps that hit real samples; renormalize by their sum.
      let acc = 0.0;
      let sumH = 0.0;
      for (let k = 0; k < hp.length; k++) {
        const idx = q - k; // input index this tap needs
        if (this.hasSample(idx)) {
          // true during warm-up for subset of taps
          const x = this.getSample(idx);
          const h = hp[k];
          acc += h * x;
          sumH += h;
        }
        // else: tap lands on implicit padding; exclude it from sum
      }

      // Renormalize to preserve DC gain during warm-up; no-op in steady state.
      const y = sumH > 1e-12 ? acc / sumH : 0.0;

      // Timestamp: ideal output time minus FIR group delay in input-sample units
      const t = n / this.actualRate - this.groupDelay / this.fs;
      this.enqueue(y, t);
      this.nOut++;
    }
  }

  process(inputs) {
    const ch = inputs?.[0]?.[0];
    if (!ch || ch.length === 0) {
      // still allow pending chunk to flush later
      return true;
    }

    // Ingest and interleave production for low latency
    for (let i = 0; i < ch.length; i++) {
      this.appendSample(ch[i] || 0);
      this.produceOutputsIfPossible();
    }

    // Cover long blocks
    this.produceOutputsIfPossible();
    return true;
  }
}

// Continued fraction approximation of a positive real `x` by a fraction `num/den`.
// Bounds on numerator and denominator prevent explosive L/M values for irrational ratios.
function rationalApprox(x, maxNum = 1024, maxDen = 1024, eps = 1e-12) {
  if (!isFinite(x) || x <= 0) return { num: 1, den: 1 };
  let a0 = Math.floor(x);
  let p0 = 1,
    q0 = 0;
  let p1 = a0,
    q1 = 1;
  let frac = x - a0;

  while (Math.abs(p1 / q1 - x) > eps) {
    if (frac === 0) break;
    const a = Math.floor(1 / frac);
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (p2 > maxNum || q2 > maxDen) break;
    p0 = p1;
    q0 = q1;
    p1 = p2;
    q1 = q2;
    frac = 1 / frac - a;
  }
  // Reduce fraction
  const g = gcd(p1, q1);
  return {
    num: Math.max(1, Math.floor(p1 / g)),
    den: Math.max(1, Math.floor(q1 / g)),
  };
}

// Euclidean greatest-common-divisor for integers.
function gcd(a, b) {
  a = Math.abs(a | 0);
  b = Math.abs(b | 0);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

// Kaiser-windowed sinc low-pass FIR.
// N: taps (odd preferred). fc: cycles/sample (0..0.5). beta: Kaiser shape.
function designLowpassKaiser(N, fc, beta) {
  // fc: normalized to input fs cycles/sample in (0..0.5)
  const M = N - 1;
  const taps = new Float64Array(N);
  const denom = i0(beta);
  for (let n = 0; n < N; n++) {
    const m = n - M / 2;
    const w = i0(beta * Math.sqrt(1 - Math.pow((2 * n) / M - 1, 2))) / denom;
    const s = sinc(2 * Math.PI * fc * m);
    taps[n] = 2 * fc * s * w;
  }
  return taps;
}

// Normalize FIR taps so Σ taps = 1 (unity DC gain).
function normalizeUnityDC(taps) {
  let sum = 0.0;
  for (let i = 0; i < taps.length; i++) sum += taps[i];
  const g = sum !== 0 ? 1.0 / sum : 1.0;
  for (let i = 0; i < taps.length; i++) taps[i] *= g;
}

// Unnormalized sinc: sin(x)/x with safe x≈0 handling.
function sinc(x) {
  if (Math.abs(x) < 1e-8) return 1.0;
  return Math.sin(x) / x;
}

// I0(x): modified Bessel of the first kind, order 0.
// Piecewise poly/asymptotic approx commonly used for Kaiser windows.
function i0(x) {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const t = x / 3.75;
    const t2 = t * t;
    return (
      1.0 +
      t2 *
        (3.5156229 +
          t2 *
            (3.0899424 +
              t2 *
                (1.2067492 +
                  t2 * (0.2659732 + t2 * (0.0360768 + t2 * 0.0045813)))))
    );
  } else {
    const t = 3.75 / ax;
    return (
      (Math.exp(ax) / Math.sqrt(ax)) *
      (0.39894228 +
        t *
          (0.01328592 +
            t *
              (0.00225319 +
                t *
                  (-0.00157565 +
                    t *
                      (0.00916281 +
                        t *
                          (-0.02057706 +
                            t *
                              (0.02635537 +
                                t * (-0.01647633 + t * 0.00392377))))))))
    );
  }
}

// Map stopband attenuation (dB) → Kaiser beta (empirical formula).
function kaiserBetaFromAttenuation(A) {
  if (A > 50) return 0.1102 * (A - 8.7);
  if (A >= 21) return 0.5842 * Math.pow(A - 21, 0.4) + 0.07886 * (A - 21);
  return 0.0;
}

registerProcessor("resample", ResampleProcessor);
