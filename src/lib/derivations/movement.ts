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

import type { Measurement } from "@/lib/drivers/witmotion";
import { IIRFilter } from "@/lib/filters/filter";
import { calcCoeffs } from "@/lib/filters/cascade";

export interface Movement {
  timestamp: number; // ms since epoch
  magnitude: number; // g
}

export async function* deriveMovement(
  stream: AsyncIterable<Measurement>,
  sampleRate: number,
): AsyncIterable<Movement> {
  // Remove the constant gravity component
  const coeffs = calcCoeffs({
    Fs: sampleRate,
    Fc: 0.05,
    behavior: "highpass",
    characteristic: "butterworth",
    order: 1,
  });

  const filterX = new IIRFilter(coeffs);
  const filterY = new IIRFilter(coeffs);
  const filterZ = new IIRFilter(coeffs);

  for await (const measurement of stream) {
    const rawX = measurement.acceleration[0];
    const rawY = measurement.acceleration[1];
    const rawZ = measurement.acceleration[2];

    const filteredX = filterX.singleStep(rawX);
    const filteredY = filterY.singleStep(rawY);
    const filteredZ = filterZ.singleStep(rawZ);

    const magnitude = Math.sqrt(
      filteredX ** 2 + filteredY ** 2 + filteredZ ** 2,
    );

    yield {
      timestamp: measurement.timestamp,
      magnitude,
    };
  }
}
