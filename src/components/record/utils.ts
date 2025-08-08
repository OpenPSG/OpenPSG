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

import type { Driver } from "@/lib/drivers/driver";
import type { EDFSignal } from "@/lib/edf/edftypes";
import { EDFWriter } from "@/lib/edf/edfwriter";
import type { Values } from "@/lib/types";
import { resample } from "@/lib/resampling/resample";
import { EPOCH_DURATION_MS } from "@/lib/constants";

export const startStreaming = (
  driver: Driver,
  startIndex: number,
  valuesRef: React.RefObject<Values[]>,
  windowMs: number,
  onError?: (err: Error) => void,
): void => {
  (async () => {
    try {
      for await (const next of driver.values()) {
        const now = Date.now();
        for (let i = 0; i < next.length; i++) {
          const signalIndex = startIndex + i;
          if (!valuesRef.current[signalIndex]) {
            valuesRef.current[signalIndex] = { timestamps: [], values: [] };
          }

          const v = valuesRef.current[signalIndex];
          v.timestamps.push(next[i].timestamp);
          v.values.push(next[i].value);

          while (v.timestamps.length > 0 && v.timestamps[0] < now - windowMs) {
            v.timestamps.shift();
            v.values.shift();
          }
        }
      }
    } catch (err) {
      if (
        !(err instanceof Error && err.message.includes("closed")) &&
        onError
      ) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();
};

export const startEDFWriterLoop = ({
  edfWriter,
  signals,
  valuesRef,
  onError,
}: {
  edfWriter: EDFWriter;
  signals: EDFSignal[];
  valuesRef: React.RefObject<Values[]>;
  onError: (err: Error) => void;
}): (() => void) => {
  const interval = setInterval(async () => {
    try {
      const now = Date.now();
      const epochMs = EPOCH_DURATION_MS;

      const samplesPerRecordList = signals.map((s) => s.samplesPerRecord);
      const recentValues: Values[] = valuesRef.current.map((v) => {
        const fromTime = now - epochMs;
        const timestamps: number[] = [];
        const vals: number[] = [];

        for (let i = v.timestamps.length - 1; i >= 0; i--) {
          if (v.timestamps[i] >= fromTime) {
            timestamps.unshift(v.timestamps[i]);
            vals.unshift(v.values[i]);
          } else {
            break;
          }
        }

        return { timestamps, values: vals };
      });

      const resampled: number[][] = recentValues.map((v, i) => {
        const samples = samplesPerRecordList[i];
        if (v.values.length === 0) return new Array(samples).fill(0);
        const { values: resampledValues } = resample(v, samples);
        return resampledValues;
      });

      await edfWriter.writeRecord(resampled);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }, EPOCH_DURATION_MS);

  return () => {
    clearInterval(interval);
  };
};
