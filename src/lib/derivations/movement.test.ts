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
import { deriveMovement } from "./movement";
import type { Measurement } from "@/lib/drivers/witmotion";

// Helper to collect async iterable output into an array
async function collectAsyncIterable<T>(
  iterable: AsyncIterable<T>,
): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

describe("deriveMovement", () => {
  it("filters input and calculates movement magnitude", async () => {
    // Sample data: constant acceleration in Z, small spike in X
    const sampleMeasurements: Measurement[] = [
      {
        timestamp: 1000,
        acceleration: [0, 0, 1],
        angularVelocity: [0, 0, 0],
        angle: [0, 0, 0],
      },
      {
        timestamp: 1010,
        acceleration: [0, 0, 1],
        angularVelocity: [0, 0, 0],
        angle: [0, 0, 0],
      },
      {
        timestamp: 1020,
        acceleration: [0.5, 0, 1],
        angularVelocity: [0, 0, 0],
        angle: [0, 0, 0],
      },
      {
        timestamp: 1030,
        acceleration: [0, 0, 1],
        angularVelocity: [0, 0, 0],
        angle: [0, 0, 0],
      },
    ];

    const stream = (async function* () {
      for (const m of sampleMeasurements) yield m;
    })();

    const result = await collectAsyncIterable(deriveMovement(stream, 100)); // 100 Hz sample rate

    expect(result.length).toBe(4);

    // The magnitude should spike at the time of the injected X movement
    const mags = result.map((m) => m.magnitude);
    const maxMag = Math.max(...mags);
    expect(maxMag).toBeGreaterThan(0); // filtered value should reflect the movement
  });
});
