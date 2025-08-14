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
import { FIRFilter } from "./fir-filter";
import { FIRCoeffs } from "./fir-coeffs";

const approxArray = (a: number[], b: number[], tol = 1e-9) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    const ok =
      (Number.isNaN(ai) && Number.isNaN(bi)) ||
      (ai === Infinity && bi === Infinity) ||
      (ai === -Infinity && bi === -Infinity) ||
      Math.abs(ai - bi) <= tol;
    if (!ok) {
      // give a helpful assertion diff
      expect({ index: i, a: ai, b: bi, diff: Math.abs(ai - bi) }).toEqual({
        index: i,
        a: bi,
        b: bi,
        diff: Math.abs(ai - bi),
      });
    }
  }
};

describe("FIRFilter basic streaming behavior", () => {
  it("single-tap filter [k] scales input on step/multi/simulate", () => {
    const k = 0.75;
    const f = new FIRFilter([k]);

    // singleStep should scale each sample by k
    const x = [1, -2, 3.5, 0, 4];
    const y1 = x.map((xi) => f.singleStep(xi));
    approxArray(
      y1,
      x.map((xi) => k * xi),
    );

    // multiStep with overwrite=false should continue scaling
    f.reinit();
    const y2 = f.multiStep(x, false);
    approxArray(
      y2,
      x.map((xi) => k * xi),
    );

    // simulate uses a fresh state and should match multiStep
    const y3 = f.simulate(x);
    approxArray(
      y3,
      x.map((xi) => k * xi),
    );
  });

  it("filtfilt with single-tap [k] is equivalent to applying k twice", () => {
    const k = 0.5;
    const f = new FIRFilter([k]);
    const x = [1, 2, 3, 4, 5];
    const y = f.filtfilt(x, false);
    approxArray(
      y,
      x.map((xi) => k * k * xi),
    );
  });

  it("reinit() resets state so simulate and multiStep align again", () => {
    const coeffs = FIRCoeffs.lowpass({ Fs: 1000, Fc: 120, order: 12 });
    const f = new FIRFilter(coeffs);

    const x = Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0)); // impulse

    // Disturb the internal state first
    f.singleStep(42);
    f.singleStep(-17);

    // After reinit, multiStep should match simulate on the same input
    f.reinit();
    const yMulti = f.multiStep(x, false);
    const ySim = f.simulate(x);
    approxArray(yMulti, ySim, 1e-9);
  });

  it("multiStep overwrite=true should not mutate returned array shape", () => {
    const f = new FIRFilter([1]); // identity
    const x = [1, 2, 3];
    const y = f.multiStep(x, true);
    expect(Array.isArray(y)).toBe(true);
    expect(y.length).toBe(x.length);
  });
});

describe("FIRFilter frequency response scaffolding", () => {
  it("response(resolution) returns the expected number of points", () => {
    const f = new FIRFilter([1]); // (Note: response uses f.length-1 taps per implementation note)
    const res = f.response(64);
    expect(res.length).toBe(64);
    for (const r of res) {
      // magnitude is a number; dB magnitude may be -Infinity; phase is a number (could be NaN if magnitude=0)
      expect(typeof r.magnitude).toBe("number");
      expect(typeof r.phase).toBe("number");
      expect(typeof r.dBmagnitude).toBe("number");
    }
  });

  it("responsePoint returns a well-formed ExtendedFrequencyResponse", () => {
    const f = new FIRFilter(
      FIRCoeffs.lowpass({ Fs: 1000, Fc: 100, order: 12 }),
    );
    const r = f.responsePoint({ Fs: 200, Fr: 10 });
    expect(typeof r.magnitude).toBe("number");
    expect(typeof r.phase).toBe("number");
    expect(typeof r.dBmagnitude).toBe("number");
  });
});
