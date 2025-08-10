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
import { deriveHRV } from "./hrv";
import type { MeasurementWithHRV } from "./hrv";

async function* makeMeasurementStream(measurements: MeasurementWithHRV[]) {
  for (const m of measurements) {
    yield m;
  }
}

describe("deriveHRV", () => {
  it("yields a single result with HRV from valid RR intervals", async () => {
    const stream = makeMeasurementStream([
      {
        timestamp: new Date(0),
        heartRate: 75,
        rrIntervals: [0.8, 0.82, 0.81], // Valid RR values in seconds
      },
    ]);

    const iterator = deriveHRV(stream)[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value.hrv).toBeGreaterThan(0);
  });

  it("ignores RR intervals that are too short or too long", async () => {
    const stream = makeMeasurementStream([
      {
        timestamp: new Date(0),
        heartRate: 75,
        rrIntervals: [0.1, 2.5, 0.8], // Only 0.8s is valid
      },
    ]);

    const iterator = deriveHRV(stream)[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.hrv).toBeUndefined(); // Only 1 valid interval, need at least 2
  });

  it("ignores RR intervals with sudden jumps >250ms", async () => {
    const stream = makeMeasurementStream([
      {
        timestamp: new Date(0),
        heartRate: 75,
        rrIntervals: [0.8, 1.2], // 400ms jump
      },
    ]);

    const iterator = deriveHRV(stream)[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.hrv).toBeUndefined(); // Only 1 RR accepted
  });

  it("accumulates and computes HRV across multiple measurements", async () => {
    const stream = makeMeasurementStream([
      { timestamp: new Date(0), heartRate: 75, rrIntervals: [0.8] },
      { timestamp: new Date(1000), heartRate: 75, rrIntervals: [0.81] },
      { timestamp: new Date(2000), heartRate: 75, rrIntervals: [0.82] },
    ]);

    const iterator = deriveHRV(stream)[Symbol.asyncIterator]();
    const r1 = await iterator.next();
    const r2 = await iterator.next();
    const r3 = await iterator.next();

    expect(r1.value.hrv).toBeUndefined(); // only 1 RR
    expect(typeof r2.value.hrv).toBe("number"); // now have 2 RR values
    expect(typeof r3.value.hrv).toBe("number");
  });

  it("yields measurements even without RR intervals", async () => {
    const stream = makeMeasurementStream([
      { timestamp: new Date(0), heartRate: 75, rrIntervals: [] },
    ]);

    const iterator = deriveHRV(stream)[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.heartRate).toBe(75);
    expect(result.value.hrv).toBeUndefined();
  });

  it("handles empty stream without crashing", async () => {
    const stream = makeMeasurementStream([]);
    const iterator = deriveHRV(stream)[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.done).toBe(true);
  });
});
