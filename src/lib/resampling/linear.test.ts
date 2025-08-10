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
import { resample } from "./linear";
import type { Values } from "@/lib/types";

function expectValuesClose(a: Values, b: Values, precision = 10) {
  expect(a.length).toBe(b.length);
  a.forEach((val, i) => {
    expect(val.timestamp.getTime()).toBeCloseTo(
      b[i].timestamp.getTime(),
      precision,
    );
    expect(val.value).toBeCloseTo(b[i].value, precision);
  });
}

function makeValueSeries(
  values: number[],
  startMs = 0,
  intervalMs = 1000,
): Values {
  const timestamps = values.map((_, i) => startMs + i * intervalMs);
  return timestamps.map((timestamp, i) => ({
    timestamp: new Date(timestamp),
    value: values[i],
  }));
}

function interpolateValueSeries(
  values: number[],
  startMs: number,
  endMs: number,
): Values {
  const n = values.length;
  const step = (endMs - startMs) / (n - 1);
  const timestamps = values.map((_, i) => startMs + i * step);
  return timestamps.map((timestamp, i) => ({
    timestamp: new Date(timestamp),
    value: values[i],
  }));
}

describe("linear", () => {
  it("correctly downsamples", () => {
    const input = makeValueSeries([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const expected = interpolateValueSeries([0, 25, 50, 75, 100], 0, 10000);
    const result = resample(input, 5);
    expectValuesClose(result, expected);
  });

  it("returns evenly spaced interpolated values", () => {
    const input = makeValueSeries([0, 100]); // spans 0–1000ms
    const expected = interpolateValueSeries([0, 25, 50, 75, 100], 0, 1000);
    const result = resample(input, 5);
    expectValuesClose(result, expected);
  });

  it("handles floating point steps correctly", () => {
    const input = makeValueSeries([0, 2, 4, 6, 8, 10]); // 0–5000ms
    const expected = interpolateValueSeries([0, 3.333, 6.666, 10], 0, 5000);
    const result = resample(input, 4);
    expectValuesClose(result, expected, 2);
  });

  it("works with only one output sample", () => {
    const input = makeValueSeries([5, 10, 15, 20]); // midpoint is at index 1
    const expected = makeValueSeries([10], 1000);
    const result = resample(input, 1);
    expectValuesClose(result, expected);
  });

  it("returns first and last elements at boundaries", () => {
    const input = makeValueSeries([3, 6, 9, 12, 15]); // 0–4000ms
    const result = resample(input, 3);
    expect(result[0].value).toBeCloseTo(3);
    expect(result[2].value).toBeCloseTo(15);
    expect(result[0].timestamp.getTime()).toBeCloseTo(0);
    expect(result[2].timestamp.getTime()).toBeCloseTo(4000);
  });

  it("handles repeated values correctly", () => {
    const input = makeValueSeries([5, 5, 5, 5]); // 0–3000ms
    const expected = interpolateValueSeries([5, 5, 5], 0, 3000);
    const result = resample(input, 3);
    expectValuesClose(result, expected);
  });

  it("interpolates with negative values", () => {
    const input = makeValueSeries([-100, 0, 100]); // 0–2000ms
    const expected = interpolateValueSeries([-100, -50, 0, 50, 100], 0, 2000);
    const result = resample(input, 5);
    expectValuesClose(result, expected);
  });

  it("handles short input upsampling", () => {
    const input = makeValueSeries([10, 20]); // 0–1000ms
    const expected = interpolateValueSeries([10, 12.5, 15, 17.5, 20], 0, 1000);
    const result = resample(input, 5);
    expectValuesClose(result, expected);
  });

  it("returns empty arrays when input is empty", () => {
    const result = resample([], 5);
    expect(result).toEqual([]);
  });

  it("returns empty arrays when n is 0", () => {
    const input = makeValueSeries([1, 2, 3]);
    const result = resample(input, 0);
    expect(result).toEqual([]);
  });
});
