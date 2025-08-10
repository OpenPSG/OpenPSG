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
import { deriveBodyPosition } from "./body-position";
import type { Measurement } from "@/lib/drivers/witmotion";

// Helper to create a fake stream of measurements
async function* makeMeasurementStream(measurements: Measurement[]) {
  for (const m of measurements) {
    yield m;
  }
}

describe("deriveBodyPosition", () => {
  it("computes correct roll and inclination for flat position", async () => {
    const measurement: Measurement = {
      timestamp: new Date(1000),
      acceleration: [0, 0, 1],
      angularVelocity: [0, 0, 0],
      angle: [0, 0, 45], // flat orientation but yaw 45°
    };

    const stream = deriveBodyPosition(makeMeasurementStream([measurement]));
    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.timestamp).toBe(measurement.timestamp);
    expect(result.value.roll).toBeCloseTo(0, 1); // No roll
    expect(result.value.inclination).toBeCloseTo(0, 1); // Lying flat
  });

  it("computes roll when rotated along Y", async () => {
    const measurement: Measurement = {
      timestamp: new Date(2000),
      acceleration: [0, 0, 1],
      angularVelocity: [0, 0, 0],
      angle: [0, 45, 0], // roll 45°
    };

    const stream = deriveBodyPosition(makeMeasurementStream([measurement]));
    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.roll).toBeCloseTo(45, 1);
    expect(result.value.inclination).toBeCloseTo(0, 1);
  });

  it("computes inclination when standing upright", async () => {
    const measurement: Measurement = {
      timestamp: new Date(3000),
      acceleration: [0, 0, 1],
      angularVelocity: [0, 0, 0],
      angle: [90, 0, 0], // pitch 90° (standing up)
    };

    const stream = deriveBodyPosition(makeMeasurementStream([measurement]));
    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.roll).toBeCloseTo(0, 1);
    expect(result.value.inclination).toBeCloseTo(90, 1);
  });

  it("doesn't gimbal lock", async () => {
    const measurement: Measurement = {
      timestamp: new Date(4000),
      acceleration: [0, 0, 1],
      angularVelocity: [0, 0, 0],
      angle: [-180, -45, 0], // roll -135° (upside down)
    };
    const stream = deriveBodyPosition(makeMeasurementStream([measurement]));
    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.value.roll).toBeCloseTo(-135, 1);
  });
});
