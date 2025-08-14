/* Originally from: https://github.com/markert/fili.js
 *
 * Copyright (c) 2014 Florian Markert
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { table, tiTable } from "./tables";

// IIR filter design parameters
export interface FilterParams {
  // Sampling frequency in Hz
  Fs: number;
  // Cutoff frequency in Hz (center frequency for band filters)
  Fc: number;
  // Quality factor: controls bandwidth for bandpass/bandstop filters
  Q?: number;
  // Optional bandwidth for filters where BW is used instead of Q
  BW?: number;
  // Optional gain in dB, used in peaking/shelving filters
  gain?: number;
  // Optional flag to indicate gain adjustment at coefficient level
  preGain?: boolean;
  // Optional analog coefficient 'a' for MZ transform (used in lowpassMZ)
  as?: number;
  // Optional analog coefficient 'b' for MZ transform (used in lowpassMZ)
  bs?: number;
}

// IIR filter coefficients
export interface FilterCoeffs {
  // Denominator coefficients (a1, a2, ...) of the IIR filter
  a: number[];
  // Numerator coefficients (b0, b1, b2, ...) of the IIR filter
  b: number[];
  // Delay buffer/state for biquad processing (typically length 2)
  z: number[];
  // Optional normalization factor for the filter denominator
  a0?: number;
  // Optional gain factor applied to the filter output
  k?: number;
}

function preCalc(params: FilterParams, coeffs: FilterCoeffs) {
  if (!params.Q && !params.BW) {
    throw new Error("Either Q or BW parameter is required");
  }

  const { Q, Fc, Fs, BW } = params;
  const w = (2 * Math.PI * Fc) / Fs;
  const alpha = BW
    ? Math.sin(w) * Math.sinh(((Math.log(2) / 2) * BW * w) / Math.sin(w))
    : Math.sin(w) / (2 * Q!);
  const cw = Math.cos(w);
  const a0 = 1 + alpha;

  coeffs.a0 = a0;
  coeffs.a.push((-2 * cw) / a0, (1 - alpha) / a0);
  coeffs.k = 1;

  return { alpha, cw, a0 };
}

function preCalcGain(params: FilterParams) {
  if (!params.Q) {
    throw new Error("Q parameter is required for preCalcGain");
  }

  const { Q, Fc, Fs, gain = 0 } = params;
  const w = (2 * Math.PI * Fc) / Fs;
  const alpha = Math.sin(w) / (2 * Q);
  const cw = Math.cos(w);
  const A = Math.pow(10, gain / 40);
  return { alpha, cw, A };
}

function initCoeffs(): FilterCoeffs {
  return {
    a: [],
    b: [],
    z: [0, 0],
  };
}

export class IIRCoeffs {
  // lowpass matched-z transform: H(s) = 1/(1+a's/w_c+b's^2/w_c)
  static lowpassMZ(params: FilterParams): FilterCoeffs {
    if (!params.as || !params.bs) {
      throw new Error("as and bs parameters are required for lowpassMZ");
    }

    const coeffs = initCoeffs();
    coeffs.a0 = 1;

    const { as, bs, Fc, Fs, preGain } = params;
    const w = (2 * Math.PI * Fc) / Fs;
    const s = -(as / (2 * bs));
    const omegaTerm =
      -w *
      Math.sqrt(Math.abs(Math.pow(as, 2) / (4 * Math.pow(bs, 2)) - 1 / bs));

    const expSW = Math.pow(Math.E, s * w);
    const exp2SW = Math.pow(Math.E, 2 * s * w);

    coeffs.a.push(-2 * expSW * Math.cos(omegaTerm));
    coeffs.a.push(exp2SW);

    if (!preGain) {
      coeffs.b.push(coeffs.a0 + coeffs.a[0] + coeffs.a[1]);
      coeffs.k = 1;
    } else {
      coeffs.b.push(1);
      coeffs.k = coeffs.a0 + coeffs.a[0] + coeffs.a[1];
    }

    coeffs.b.push(0, 0);
    return coeffs;
  }

  // Bessel-Thomson: H(s) = 3/(s^2+3*s+3)
  static lowpassBT(params: FilterParams): FilterCoeffs {
    const coeffs = initCoeffs();
    const Fc = params.Fc;
    const Fs = params.Fs;

    coeffs.k = 1;
    const wp = Math.tan((2 * Math.PI * Fc) / (2 * Fs));
    const wp2 = wp * wp;

    const Q = 1;
    const a0 = 3 * wp + 3 * wp2 + 1;

    coeffs.a0 = a0;
    const b0 = (3 * wp2 * Q) / a0;

    coeffs.b.push(b0, 2 * b0, b0);
    coeffs.a.push((6 * wp2 - 2) / a0, (3 * wp2 - 3 * wp + 1) / a0);

    return coeffs;
  }

  static highpassBT(params: FilterParams): FilterCoeffs {
    const coeffs = initCoeffs();
    const Fc = params.Fc;
    const Fs = params.Fs;

    coeffs.k = 1;
    const wp = Math.tan((2 * Math.PI * Fc) / (2 * Fs));
    const wp2 = wp * wp;

    const Q = 1;
    const a0 = wp + wp2 + 3;

    coeffs.a0 = a0;
    const b0 = (3 * Q) / a0;

    coeffs.b.push(b0, 2 * b0, b0);
    coeffs.a.push((2 * wp2 - 6) / a0, (wp2 - wp + 3) / a0);

    return coeffs;
  }

  /*
   * Formulas from http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
   */

  // H(s) = 1 / (s^2 + s/Q + 1)
  static lowpass(params: FilterParams): FilterCoeffs {
    if (params.BW) delete params.BW;
    const coeffs = initCoeffs();
    const p = preCalc(params, coeffs);
    coeffs.k = params.preGain ? (1 - p.cw) * 0.5 : 1;
    const base = params.preGain ? 1 / p.a0 : (1 - p.cw) / (2 * p.a0);
    coeffs.b.push(base, 2 * base, base);
    return coeffs;
  }

  // H(s) = s^2 / (s^2 + s/Q + 1)
  static highpass(params: FilterParams): FilterCoeffs {
    if (params.BW) delete params.BW;
    const coeffs = initCoeffs();
    const p = preCalc(params, coeffs);
    coeffs.k = params.preGain ? (1 + p.cw) * 0.5 : 1;
    const base = params.preGain ? 1 / p.a0 : (1 + p.cw) / (2 * p.a0);
    coeffs.b.push(base, -2 * base, base);
    return coeffs;
  }

  // H(s) = (s^2 - s/Q + 1) / (s^2 + s/Q + 1)
  static allpass(params: FilterParams): FilterCoeffs {
    const coeffs = initCoeffs();
    const p = preCalc(params, coeffs);
    coeffs.k = 1;
    coeffs.b.push(
      (1 - p.alpha) / p.a0,
      (-2 * p.cw) / p.a0,
      (1 + p.alpha) / p.a0,
    );
    return coeffs;
  }

  // H(s) = s / (s^2 + s/Q + 1)
  static bandpassQ(params: FilterParams): FilterCoeffs {
    if (!params.Q) {
      throw new Error("Q parameter is required for bandpassQ");
    }

    const coeffs = initCoeffs();
    const p = preCalc(params, coeffs);
    coeffs.k = 1;
    const base = (p.alpha * params.Q) / p.a0;
    coeffs.b.push(base, 0, -base);
    return coeffs;
  }

  // H(s) = (s/Q) / (s^2 + s/Q + 1)
  static bandpass(params: FilterParams): FilterCoeffs {
    const coeffs = initCoeffs();
    const p = preCalc(params, coeffs);
    coeffs.k = 1;
    const base = p.alpha / p.a0;
    coeffs.b.push(base, 0, -base);
    return coeffs;
  }

  // H(s) = (s^2 + 1) / (s^2 + s/Q + 1)
  static bandstop(params: FilterParams): FilterCoeffs {
    const coeffs = initCoeffs();
    const p = preCalc(params, coeffs);
    coeffs.k = 1;
    const base = 1 / p.a0;
    coeffs.b.push(base, (-2 * p.cw) / p.a0, base);
    return coeffs;
  }

  // H(s) = (s^2 + s*(A/Q) + 1) / (s^2 + s/(A*Q) + 1)
  static peak(params: FilterParams): FilterCoeffs {
    const coeffs = initCoeffs();
    const p = preCalcGain(params);
    coeffs.k = 1;
    coeffs.a0 = 1 + p.alpha / p.A;
    coeffs.a.push((-2 * p.cw) / coeffs.a0, (1 - p.alpha / p.A) / coeffs.a0);
    coeffs.b.push(
      (1 + p.alpha * p.A) / coeffs.a0,
      (-2 * p.cw) / coeffs.a0,
      (1 - p.alpha * p.A) / coeffs.a0,
    );
    return coeffs;
  }

  // H(s) = A * (s^2 + (sqrt(A)/Q)*s + A)/(A*s^2 + (sqrt(A)/Q)*s + 1)
  static lowshelf(params: FilterParams): FilterCoeffs {
    if (params.BW) delete params.BW;
    const coeffs = initCoeffs();
    const p = preCalcGain(params);
    coeffs.k = 1;
    const sa = 2 * Math.sqrt(p.A) * p.alpha;
    coeffs.a0 = p.A + 1 + (p.A - 1) * p.cw + sa;
    coeffs.a.push(
      (-2 * (p.A - 1 + (p.A + 1) * p.cw)) / coeffs.a0,
      (p.A + 1 + (p.A - 1) * p.cw - sa) / coeffs.a0,
    );
    coeffs.b.push(
      (p.A * (p.A + 1 - (p.A - 1) * p.cw + sa)) / coeffs.a0,
      (2 * p.A * (p.A - 1 - (p.A + 1) * p.cw)) / coeffs.a0,
      (p.A * (p.A + 1 - (p.A - 1) * p.cw - sa)) / coeffs.a0,
    );
    return coeffs;
  }

  // H(s) = A * (A*s^2 + (sqrt(A)/Q)*s + 1)/(s^2 + (sqrt(A)/Q)*s + A)
  static highshelf(params: FilterParams): FilterCoeffs {
    if (params.BW) delete params.BW;
    const coeffs = initCoeffs();
    const p = preCalcGain(params);
    coeffs.k = 1;
    const sa = 2 * Math.sqrt(p.A) * p.alpha;
    coeffs.a0 = p.A + 1 - (p.A - 1) * p.cw + sa;
    coeffs.a.push(
      (2 * (p.A - 1 - (p.A + 1) * p.cw)) / coeffs.a0,
      (p.A + 1 - (p.A - 1) * p.cw - sa) / coeffs.a0,
    );
    coeffs.b.push(
      (p.A * (p.A + 1 + (p.A - 1) * p.cw + sa)) / coeffs.a0,
      (-2 * p.A * (p.A - 1 + (p.A + 1) * p.cw)) / coeffs.a0,
      (p.A * (p.A + 1 + (p.A - 1) * p.cw - sa)) / coeffs.a0,
    );
    return coeffs;
  }
}

export type FilterBehavior =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "bandstop"
  | "allpass"
  | "peak"
  | "lowshelf"
  | "highshelf"
  | "lowpassMZ"
  | "highpassBT"
  | "lowpassBT";

export type FilterCharacteristic =
  | "butterworth"
  | "bessel"
  | "tschebyscheff05"
  | "tschebyscheff1"
  | "tschebyscheff2"
  | "tschebyscheff3"
  | "allpass";

interface CascadeParams extends FilterParams {
  order?: number;
  transform?: "matchedZ" | "bilinear";
  behavior: FilterBehavior;
  characteristic?: FilterCharacteristic;
  oneDb?: boolean;
}

// This function calculates the coefficients for a cascade of IIR biquad filters
// based on the provided parameters.
export function calcCoeffs(params: CascadeParams): FilterCoeffs[] {
  const filters: FilterCoeffs[] = [];

  const order = Math.min(params.order ?? 0, 12);

  for (let i = 0; i < order; i++) {
    let q: number;
    let f: number;
    let fd: number;

    if (params.transform === "matchedZ") {
      const filterParams: FilterParams = {
        Fs: params.Fs,
        Fc: params.Fc,
        preGain: params.preGain ?? false,
        as: tiTable[params.characteristic!].as[order - 1][i],
        bs: tiTable[params.characteristic!].bs[order - 1][i],
      };

      filters.push(IIRCoeffs.lowpassMZ(filterParams));
    } else {
      if (!params.characteristic) {
        throw new Error("Characteristic is required");
      }

      if (params.characteristic === "butterworth") {
        q = 0.5 / Math.sin((Math.PI / (order * 2)) * (i + 0.5));
        f = 1;
      } else {
        const characteristic = params.characteristic as keyof typeof table;
        q = table[characteristic].q[order - 1][i];
        f = params.oneDb
          ? table[characteristic].f1dB[order - 1][i]
          : table[characteristic].f3dB[order - 1][i];
      }

      fd = params.behavior === "highpass" ? params.Fc / f : params.Fc * f;

      if (
        (params.behavior === "bandpass" || params.behavior === "bandstop") &&
        params.characteristic === "bessel"
      ) {
        fd = (Math.sqrt(order) * fd) / order;
      }

      const filterParams: FilterParams = {
        Fs: params.Fs,
        Fc: fd,
        Q: q,
        BW: params.BW ?? 0,
        gain: params.gain ?? 0,
        preGain: params.preGain ?? false,
      };

      switch (params.behavior) {
        case "lowpass":
          filters.push(IIRCoeffs.lowpass(filterParams));
          break;
        case "highpass":
          filters.push(IIRCoeffs.highpass(filterParams));
          break;
        case "bandpass":
          filters.push(IIRCoeffs.bandpass(filterParams));
          break;
        case "bandstop":
          filters.push(IIRCoeffs.bandstop(filterParams));
          break;
        case "allpass":
          filters.push(IIRCoeffs.allpass(filterParams));
          break;
        case "peak":
          filters.push(IIRCoeffs.peak(filterParams));
          break;
        case "lowshelf":
          filters.push(IIRCoeffs.lowshelf(filterParams));
          break;
        case "highshelf":
          filters.push(IIRCoeffs.highshelf(filterParams));
          break;
        case "lowpassMZ":
          filters.push(IIRCoeffs.lowpassMZ(filterParams));
          break;
        case "highpassBT":
          filters.push(IIRCoeffs.highpassBT(filterParams));
          break;
        case "lowpassBT":
          filters.push(IIRCoeffs.lowpassBT(filterParams));
          break;
        default:
          throw new Error(`Unknown filter behavior: ${params.behavior}`);
      }
    }
  }

  return filters;
}
