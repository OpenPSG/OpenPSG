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

import Quaternion from "quaternion";
import { degToRad, radToDeg, wrapAngle } from "@/lib/trig";
import type { Measurement } from "@/lib/drivers/witmotion";

const bodyRoll = (q: Quaternion): number => {
  // Rotate gravity vector [0, 0, 1] into body frame
  const gravityInBody = q.rotateVector([0, 0, 1]);

  const gx = gravityInBody[0]; // left-right direction
  const gz = gravityInBody[2]; // chest-outward direction

  const rollRad = Math.atan2(gx, gz);
  return wrapAngle(radToDeg(rollRad));
};

const bodyInclination = (q: Quaternion): number => {
  // Rotate gravity vector into body frame
  const gravityInBody = q.rotateVector([0, 0, 1]);

  const gx = gravityInBody[0]; // left-right direction
  const gy = gravityInBody[1]; // head-foot direction
  const gz = gravityInBody[2]; // chest-outward direction

  // Roll invariant inclination
  const inclinationRad = Math.atan2(gy, Math.sqrt(gx * gx + gz * gz));
  return Math.abs(radToDeg(inclinationRad)); // 0° lying flat, 90° standing
};

export interface BodyPosition {
  timestamp: number; // ms since epoch
  roll: number; // degrees
  inclination: number; // degrees
}

export async function* deriveBodyPosition(
  stream: AsyncIterable<Measurement>,
): AsyncIterable<BodyPosition> {
  for await (const measurement of stream) {
    const quaternion = Quaternion.fromEuler(
      degToRad(measurement.angle[0]),
      degToRad(measurement.angle[1]),
      degToRad(measurement.angle[2]),
      "XYZ",
    );
    const roll = bodyRoll(quaternion);
    const inclination = bodyInclination(quaternion);
    yield {
      timestamp: measurement.timestamp,
      roll,
      inclination,
    };
  }
}
