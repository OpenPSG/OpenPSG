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
import { calcCoeffs, IIRCoeffs, type FilterParams } from "./iir-coeffs";
import { IIRFilter } from "./iir-filter";

const closeTo = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

describe("IIRCoeffs", () => {
  it("lowpass requires Q or BW and produces symmetric b and two a's", () => {
    const params: FilterParams = { Fs: 48_000, Fc: 1_000, Q: Math.SQRT1_2 };
    const c = IIRCoeffs.lowpass({ ...params });

    expect(c.a).toHaveLength(2);
    expect(c.b).toHaveLength(3);
    expect(c.z).toEqual([0, 0]);

    // symmetry for lowpass
    expect(closeTo(c.b[0], c.b[2], 1e-12)).toBe(true);

    // default gain behavior
    expect(c.k).toBe(1);
    expect(c.a0).toBeDefined();
    expect(c.a0! > 0).toBe(true);
  });

  it("highpass produces anti-symmetric b1 and symmetric extremes", () => {
    const c = IIRCoeffs.highpass({ Fs: 48_000, Fc: 5_000, Q: 0.7071 });
    expect(c.b).toHaveLength(3);
    expect(closeTo(c.b[0], c.b[2], 1e-12)).toBe(true);
    expect(Math.sign(c.b[1])).toBe(-1);
  });

  it("bandpass requires either Q or BW; bandpassQ throws without Q", () => {
    // bandpass (with Q) works
    expect(() =>
      IIRCoeffs.bandpass({ Fs: 48_000, Fc: 2_000, Q: 2 }),
    ).not.toThrow();

    // bandpassQ without Q should throw
    expect(() => IIRCoeffs.bandpassQ({ Fs: 48_000, Fc: 2_000 })).toThrow(
      /Q parameter is required/i,
    );
  });

  it("bandstop shapes look right", () => {
    const c = IIRCoeffs.bandstop({ Fs: 48_000, Fc: 2_000, Q: 2 });
    expect(c.a).toHaveLength(2);
    expect(c.b).toHaveLength(3);
    // b0 == b2 for bandstop
    expect(closeTo(c.b[0], c.b[2], 1e-12)).toBe(true);
  });

  it("peak uses gain and keeps k=1", () => {
    const c = IIRCoeffs.peak({ Fs: 48_000, Fc: 2_000, Q: 1, gain: 6 });
    expect(c.k).toBe(1);
    expect(c.a0).toBeDefined();
  });

  it("lowshelf / highshelf accept gain and keep k=1", () => {
    const lo = IIRCoeffs.lowshelf({ Fs: 48_000, Fc: 500, Q: 0.7071, gain: 9 });
    const hi = IIRCoeffs.highshelf({
      Fs: 48_000,
      Fc: 5_000,
      Q: 0.7071,
      gain: -6,
    });
    expect(lo.k).toBe(1);
    expect(hi.k).toBe(1);
    expect(lo.a0! > 0).toBe(true);
    expect(hi.a0! > 0).toBe(true);
  });

  it("lowpassMZ requires as and bs and respects preGain switch", () => {
    const base = { Fs: 48_000, Fc: 1_000, as: 3, bs: 3 };

    const c1 = IIRCoeffs.lowpassMZ({ ...base, preGain: false });
    // When preGain=false, b0 equals (a0 + a1 + a2), k=1 and b1=b2=0
    const sum = (c1.a0 ?? 0) + c1.a[0] + c1.a[1];
    expect(closeTo(c1.b[0], sum, 1e-12)).toBe(true);
    expect(c1.b[1]).toBe(0);
    expect(c1.b[2]).toBe(0);
    expect(c1.k).toBe(1);

    const c2 = IIRCoeffs.lowpassMZ({ ...base, preGain: true });
    // When preGain=true, b0=1 and k equals the same sum
    expect(closeTo(c2.b[0], 1, 1e-12)).toBe(true);
    const sum2 = (c2.a0 ?? 0) + c2.a[0] + c2.a[1];
    expect(closeTo(c2.k ?? 0, sum2, 1e-12)).toBe(true);

    // Missing params should throw
    expect(() => IIRCoeffs.lowpassMZ({ Fs: 48_000, Fc: 1_000, as: 3 })).toThrow(
      /as and bs/i,
    );
  });

  it("preCalc guards: lowpass without Q/BW throws", () => {
    expect(() => IIRCoeffs.lowpass({ Fs: 48_000, Fc: 1_000 })).toThrow(
      /Q or BW/i,
    );
  });
});

describe("calcCoeffs", () => {
  it("throws if characteristic is missing for non-matchedZ", () => {
    expect(() =>
      calcCoeffs({
        Fs: 48_000,
        Fc: 1_000,
        behavior: "lowpass",
        // characteristic omitted
        order: 2,
      }),
    ).toThrow(/Characteristic is required/i);
  });

  it("caps order at 12", () => {
    const coeffs = calcCoeffs({
      Fs: 48_000,
      Fc: 1_000,
      behavior: "lowpass",
      characteristic: "butterworth",
      order: 40, // will be clamped
    });
    expect(coeffs).toHaveLength(12);
  });

  it("produces valid biquads for a butterworth lowpass/highpass cascade", () => {
    const low = calcCoeffs({
      Fs: 48_000,
      Fc: 1_000,
      behavior: "lowpass",
      characteristic: "butterworth",
      order: 4,
    });

    const high = calcCoeffs({
      Fs: 48_000,
      Fc: 1_000,
      behavior: "highpass",
      characteristic: "butterworth",
      order: 3,
    });

    // Shape checks
    expect(low).toHaveLength(4);
    expect(high).toHaveLength(3);

    for (const stage of [...low, ...high]) {
      expect(stage.a).toHaveLength(2);
      expect(stage.b).toHaveLength(3);
      expect(stage.z).toEqual([0, 0]);
      expect(Number.isFinite(stage.k ?? 1)).toBe(true);
    }

    // Basic functional check: lowpass cascade should pass DC better than highpass cascade
    const fLow = new IIRFilter(low);
    const fHigh = new IIRFilter(high);

    const rLowDC = fLow.responsePoint({ Fs: 48_000, Fr: 0 }).magnitude!;
    const rHighDC = fHigh.responsePoint({ Fs: 48_000, Fr: 0 }).magnitude!;

    expect(rLowDC).toBeGreaterThan(0.5);
    expect(rHighDC).toBeLessThan(0.5);
  });

  it("matchedZ path compiles when transform is 'matchedZ'", () => {
    const coeffs = calcCoeffs({
      Fs: 48_000,
      Fc: 1_000,
      behavior: "lowpassMZ",
      transform: "matchedZ",
      characteristic: "butterworth", // used to index tiTable mock
      order: 2,
      preGain: true,
    });
    expect(coeffs).toHaveLength(2);
  });

  it("bandpass bessel special-case adjusts frequency (no throw)", () => {
    const coeffs = calcCoeffs({
      Fs: 48_000,
      Fc: 2_000,
      behavior: "bandpass",
      characteristic: "bessel",
      order: 2,
      Q: 1,
    });
    expect(coeffs).toHaveLength(2);
  });
});
