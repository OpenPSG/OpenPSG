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

import type { Measurement } from "@/lib/drivers/generic-hr";

const calculateRMSSD = (rr: number[]): number | undefined => {
  if (rr.length < 2) return undefined;
  const diffsSquared = [];
  for (let i = 1; i < rr.length; i++) {
    const diff = rr[i] - rr[i - 1];
    diffsSquared.push(diff * diff);
  }
  const meanSq =
    diffsSquared.reduce((sum, val) => sum + val, 0) / diffsSquared.length;
  return Math.sqrt(meanSq);
};

export interface MeasurementWithHRV extends Measurement {
  hrv?: number;
}

export async function* deriveHRV(
  stream: AsyncIterable<Measurement>,
  window: number = 30,
): AsyncIterable<MeasurementWithHRV> {
  const rrBuffer: number[] = [];

  for await (const m of stream) {
    if (m.rrIntervals?.length) {
      for (const rr of m.rrIntervals) {
        const rrMs = Math.round(rr * 1000);
        if (rrMs < 300 || rrMs > 2000) continue;
        const prev = rrBuffer[rrBuffer.length - 1];
        if (prev !== undefined && Math.abs(rrMs - prev) > 250) continue;
        if (rrBuffer.length >= window) rrBuffer.shift();
        rrBuffer.push(rrMs);
      }
    }

    const hrv = calculateRMSSD(rrBuffer);

    yield {
      ...m,
      hrv: hrv ?? undefined,
    };
  }
}
