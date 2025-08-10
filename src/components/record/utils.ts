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
import type { Values, Value } from "@/lib/types";
import { resample } from "@/lib/resampling/linear";
import { EPOCH_DURATION_MS } from "@/lib/constants";
import { CircularBuffer } from "@/lib/containers/circular-buffer";

export const startStreaming = (
  driver: Driver,
  startIndex: number,
  valuesRef: React.RefObject<CircularBuffer<Value>[]>,
  onError?: (err: Error) => void,
): void => {
  (async () => {
    try {
      for await (const next of driver.values()) {
        for (let i = 0; i < next.length; i++) {
          const signalIndex = startIndex + i;
          const buf = valuesRef.current[signalIndex];
          if (!buf) continue; // buffer should exist; skip if not yet initialized
          buf.push(next[i]); // overwrites oldest when full
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
  valuesRef: React.RefObject<CircularBuffer<Value>[]>;
  onError: (err: Error) => void;
}): (() => void) => {
  const interval = setInterval(async () => {
    try {
      const now = Date.now();
      const epochMs = EPOCH_DURATION_MS;
      const fromTime = now - epochMs;

      const samplesPerRecordList = signals.map((s) => s.samplesPerRecord);

      // For each signal, collect samples within the last epoch.
      // Scan buffer newest -> oldest and stop once we cross the boundary.
      const recentPerSignal: Values[] = valuesRef.current.map((buf) => {
        if (!buf || buf.size === 0) return [];
        const out: Value[] = [];
        for (let i = buf.size - 1; i >= 0; i--) {
          const v = buf.at(i);
          if (v.timestamp.getTime() >= fromTime) {
            out.push(v);
          } else {
            break;
          }
        }
        out.reverse(); // restore chronological order (oldest -> newest)
        return out;
      });

      // Resample each signal to the EDF record length, then extract numeric values
      const resampled: number[][] = recentPerSignal.map((vals, i) => {
        const samples = samplesPerRecordList[i];
        if (vals.length === 0) return new Array(samples).fill(0);
        const r = resample(vals, samples);
        return r.map((v) => v.value);
      });

      await edfWriter.writeRecord(resampled);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }, EPOCH_DURATION_MS);

  return () => clearInterval(interval);
};
