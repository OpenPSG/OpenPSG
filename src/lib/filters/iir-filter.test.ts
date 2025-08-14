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
import { calcCoeffs, IIRCoeffs } from "./iir-coeffs";
import { IIRFilter } from "./iir-filter";

describe("IIRFilter", () => {
  const Fs = 48_000;
  const Fc = 1_000;
  const biquad = IIRCoeffs.lowpass({ Fs, Fc, Q: Math.SQRT1_2 });

  it("singleStep / multiStep produce finite numbers", () => {
    const f = new IIRFilter([biquad]);
    const y1 = f.singleStep(1);
    expect(Number.isFinite(y1)).toBe(true);

    const input = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0)); // impulse
    const out = f.multiStep(input);
    expect(out).toHaveLength(input.length);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it("responsePoint: lowpass ~unity at DC, attenuated at high freq", () => {
    const f = new IIRFilter([biquad]);

    const rDC = f.responsePoint({ Fs, Fr: 0 });
    expect(rDC.magnitude!).toBeGreaterThan(0.9);

    const rHF = f.responsePoint({ Fs, Fr: Fs / 2 - 1 });
    expect(rHF.magnitude!).toBeLessThan(0.2);
  });

  it("stepResponse settles positive and does not explode", () => {
    const f = new IIRFilter([biquad]);
    const resp = f.stepResponse(256);
    const last = resp.out.at(-1)!;

    // Basic sanity: bounded and positive final value for a lowpass
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(2);
  });

  it("polesZeros: poles stay inside the unit circle (stability)", () => {
    const f = new IIRFilter([biquad]);
    const pz = f.polesZeros();

    // Check each stage
    for (const stage of pz) {
      for (const p of stage.p) {
        const radius = Math.hypot(p.re, p.im);
        expect(radius).toBeLessThan(1 + 1e-9);
      }
    }
  });

  it("filtfilt runs and returns same-length output", () => {
    const f = new IIRFilter([biquad]);
    const x = Array.from({ length: 200 }, (_, n) =>
      Math.sin((2 * Math.PI * 1000 * n) / Fs),
    );
    const y = f.filtfilt(x);
    expect(y).toHaveLength(x.length);
    expect(y.every(Number.isFinite)).toBe(true);
  });

  it("reinit resets internal delay state", () => {
    const f = new IIRFilter([biquad]);
    const out1 = f.singleStep(1);
    f.reinit();
    const out2 = f.singleStep(1);
    // After reinit with same input, first output should match
    expect(Math.abs(out1 - out2)).toBeLessThan(1e-12);
  });

  it("attenuates a hi-freq tone with a lowpass cascade", () => {
    const Fs = 48_000;
    const coeffs = calcCoeffs({
      Fs,
      Fc: 1_000,
      behavior: "lowpass",
      characteristic: "butterworth",
      order: 2,
    });

    const f = new IIRFilter(coeffs);
    const N = 4096;
    const toneHi = Array.from({ length: N }, (_, n) =>
      Math.sin((2 * Math.PI * 8_000 * n) / Fs),
    );
    const toneLo = Array.from({ length: N }, (_, n) =>
      Math.sin((2 * Math.PI * 200 * n) / Fs),
    );

    const yHi = f.simulate(toneHi);
    f.reinit();
    const yLo = f.simulate(toneLo);

    const rms = (arr: number[]) =>
      Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);

    expect(rms(yHi)).toBeLessThan(rms(yLo));
  });
});
