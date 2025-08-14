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

import { describe, it, expect } from "vitest";
import { FIRCoeffs } from "./fir-coeffs";

const approx = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;
const isSymmetric = (h: number[], tol = 1e-9) => {
  for (let i = 0; i < Math.floor(h.length / 2); i++) {
    if (Math.abs(h[i] - h[h.length - 1 - i]) > tol) return false;
  }
  return true;
};

describe("FIRCoeffs.lowpass()", () => {
  it("returns order+1 taps, symmetric, DC gain ~ 1", () => {
    const order = 32;
    const h = FIRCoeffs.lowpass({ Fs: 1000, Fc: 100, order });

    expect(h.length).toBe(order + 1);
    expect(isSymmetric(h)).toBe(true);

    // lowpass implementation normalizes DC gain to 1 (sum of taps)
    const sum = h.reduce((a, b) => a + b, 0);
    expect(approx(sum, 1, 1e-6)).toBe(true);

    // center index should be the largest (typical of windowed-sinc LPF)
    const mid = (h.length - 1) / 2;
    expect(h[mid]).toBeGreaterThan(0);
    expect(h[mid]).toBeGreaterThan(h[0]);
  });
});

describe("FIRCoeffs.highpass()", () => {
  it("returns order+1 taps, symmetric, DC gain ~ 0 (spectral inversion)", () => {
    const order = 40;
    const h = FIRCoeffs.highpass({ Fs: 1000, Fc: 100, order });

    expect(h.length).toBe(order + 1);
    expect(isSymmetric(h)).toBe(true);

    // DC ~ 0 for HPF after spectral inversion
    const sum = h.reduce((a, b) => a + b, 0);
    expect(approx(sum, 0, 1e-6)).toBe(true);

    // center tap should be around 1 - lp_center
    const lp = FIRCoeffs.lowpass({ Fs: 1000, Fc: 100, order });
    const mid = (h.length - 1) / 2;
    expect(approx(h[mid] + lp[mid], 1, 1e-9)).toBe(true);
  });
});

describe("FIRCoeffs.bandstop() / bandpass()", () => {
  it("bandstop is symmetric, DC ~ 1; bandpass is symmetric, DC ~ 0", () => {
    const order = 48;
    const Fs = 2000;
    const F1 = 200;
    const F2 = 400;

    const bs = FIRCoeffs.bandstop({ Fs, order, F1, F2 });
    expect(bs.length).toBe(order + 1);
    expect(isSymmetric(bs)).toBe(true);
    const sumBS = bs.reduce((a, b) => a + b, 0);
    expect(approx(sumBS, 1, 1e-3)).toBe(true);

    const bp = FIRCoeffs.bandpass({ Fs, order, F1, F2 });
    expect(bp.length).toBe(order + 1);
    expect(isSymmetric(bp)).toBe(true);
    const sumBP = bp.reduce((a, b) => a + b, 0);
    expect(approx(sumBP, 0, 1e-3)).toBe(true);
  });
});

describe("FIRCoeffs.kbFilter()", () => {
  it("forces odd length (odd order), symmetric taps", () => {
    const Fs = 48000;
    const Fa = 2000;
    const Fb = 6000;

    // Give an even order; implementation bumps to next odd
    const hEven = FIRCoeffs.kbFilter({ Fs, Fa, Fb, order: 50, Att: 80 });
    expect(hEven.length % 2).toBe(1);
    expect(isSymmetric(hEven, 1e-9)).toBe(true);

    // Default order=51 in code, already odd
    const hDefault = FIRCoeffs.kbFilter({ Fs, Fa, Fb });
    expect(hDefault.length).toBe(51);
    expect(isSymmetric(hDefault, 1e-9)).toBe(true);
  });
});
