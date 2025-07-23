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

import { useCallback, useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Circle, Square } from "lucide-react";
import Plot from "@/components/plot/plot";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { Driver, ConfigValue } from "@/lib/drivers/driver";
import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Values } from "@/lib/types";
import { DriverRegistry } from "@/lib/drivers/driver-registry";
import { EPOCH_DURATION } from "@/lib/constants";
import SensorConfigDialog from "@/components/SensorConfigDialog";
import { EDFWriter } from "@/lib/edf/edfwriter";
import {
  checkWebBluetoothSupport,
  triggerDownload,
  uniqueFilename,
} from "@/lib/utils";
import { resample } from "@/lib/resampling/resample";
import FullPageSpinner from "@/components/FullPageSpinner";

const writeEDFFile = (
  signals: EDFSignal[],
  values: Values[],
  startTime: Date,
) => {
  if (!signals.length || !values.length) return;

  const recordDuration = EPOCH_DURATION;
  const samplesPerRecordList = signals.map((s) => s.samplesPerRecord);

  // Filter out values before the recording start time
  const filteredValues: Values[] = values.map((val) => {
    const start = startTime.getTime();
    const filtered: Values = {
      timestamps: [],
      values: [],
    };
    for (let i = 0; i < val.timestamps.length; i++) {
      if (val.timestamps[i] >= start) {
        filtered.timestamps.push(val.timestamps[i]);
        filtered.values.push(val.values[i]);
      }
    }
    return filtered;
  });

  // Compute number of data records based on the longest signal
  const dataRecordCounts = filteredValues.map((val, i) =>
    Math.ceil(val.values.length / samplesPerRecordList[i]),
  );
  const dataRecords = Math.max(...dataRecordCounts);

  // Resample everything into a fixed time base
  const resampledValues: number[][] = filteredValues.map((val, i) => {
    const targetLength = dataRecords * samplesPerRecordList[i];
    return resample(val, targetLength).values;
  });

  const header = {
    patientId: EDFWriter.patientId({}),
    recordingId: EDFWriter.recordingId({ startDate: startTime }),
    startTime,
    dataRecords,
    recordDuration,
    signalCount: signals.length,
    signals,
  };

  const writer = new EDFWriter(header, resampledValues);
  const buffer = writer.write();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const filename = uniqueFilename("edf");

  triggerDownload(blob, filename);
};

export default function Record() {
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [signals, setSignals] = useState<EDFSignal[]>([]);
  const [values, setValues] = useState<Values[]>([]);
  const [recording, setRecording] = useState<boolean>(false);
  const [configureSensorDialogOpen, setConfigureSensorDialogOpen] =
    useState(false);
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [activeDriver, setActiveDriver] = useState<Driver | undefined>(
    undefined,
  );
  const [recordingStartTime, setRecordingStartTime] = useState<
    Date | undefined
  >(undefined);
  const sensorDrivers = useRef<Driver[]>([]);

  const wakeLockRef = useRef<WakeLockSentinel | undefined>(undefined);

  // Cleanup drivers/wakelock on unmount
  useEffect(() => {
    const wakeLock = wakeLockRef.current;
    const drivers = sensorDrivers.current;

    return () => {
      if (wakeLock) {
        wakeLock.release().catch((err) => {
          console.warn("Wake Lock release failed on unmount:", err);
        });
      }

      drivers?.forEach((driver) => {
        driver.close().catch((err) => {
          console.error("Failed to close driver:", err);
        });
      });
    };
  }, []);

  const floorToEpoch = (date: Date, epochDuration: number): Date => {
    const timestamp = date.getTime();
    const floored = Math.floor(timestamp / epochDuration) * epochDuration;
    return new Date(floored);
  };

  const onConfigureSensor = useCallback(
    async (data: Record<string, ConfigValue>, driverOverride?: Driver) => {
      const driverToUse =
        driverOverride !== undefined && driverOverride.signals !== undefined
          ? driverOverride
          : activeDriver;

      if (!driverToUse) {
        return;
      }

      driverToUse.configure?.(data);
      const newSignals: EDFSignal[] = driverToUse.signals(EPOCH_DURATION);
      const startIndex = signals.length;

      setSignals((prev) => [...prev, ...newSignals]);
      setStartTime(
        (prevTime) => prevTime ?? floorToEpoch(new Date(), EPOCH_DURATION),
      );
      setConfigureSensorDialogOpen(false);

      (async () => {
        try {
          for await (const next of driverToUse.values()) {
            setValues((prev) => {
              const updated = [...prev];
              for (let i = 0; i < next.length; i++) {
                const signalIndex = startIndex + i;
                if (!updated[signalIndex]) {
                  updated[signalIndex] = { timestamps: [], values: [] };
                }
                updated[signalIndex].timestamps.push(next[i].timestamp);
                updated[signalIndex].values.push(next[i].value);
              }
              return updated;
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (!errMsg.includes("closed")) {
            console.error("Streaming error", err);
          }
        }
      })();
    },
    [activeDriver, signals.length],
  );

  const handleAddSensor = async () => {
    try {
      checkWebBluetoothSupport();

      setIsConnecting(true);

      const service = await DriverRegistry.scanForSupportedDevice();
      const driver = DriverRegistry.createDriverForService(service);

      sensorDrivers.current?.push(driver);
      setActiveDriver(driver);

      if (!driver.configSchema || driver.configSchema.length === 0) {
        await onConfigureSensor({}, driver);
      } else {
        setConfigureSensorDialogOpen(true);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes("User cancelled")) {
        setError(errMsg);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleToggleRecording = useCallback(async () => {
    if (recording) {
      if (signals.length && values.length && recordingStartTime) {
        writeEDFFile(signals, values, recordingStartTime);
      }
      setRecordingStartTime(undefined);
      setRecording(false);

      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch (err) {
          console.warn("Failed to release wake lock:", err);
        } finally {
          wakeLockRef.current = undefined;
        }
      }
    } else {
      setRecordingStartTime(new Date());
      setRecording(true);

      try {
        if ("wakeLock" in navigator) {
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lock = await (navigator as any).wakeLock.request("screen");
          wakeLockRef.current = lock;

          lock.addEventListener("release", () => {
            wakeLockRef.current = undefined;
          });
        }
      } catch (err) {
        console.warn("Wake Lock request failed:", err);
      }
    }
  }, [recording, signals, values, recordingStartTime]);

  return (
    <>
      <AlertDialog open={!!error} onOpenChange={() => setError("")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Error</AlertDialogTitle>
            <AlertDialogDescription>{error}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SensorConfigDialog
        open={configureSensorDialogOpen}
        onOpenChange={setConfigureSensorDialogOpen}
        activeDriver={activeDriver}
        onConfigure={onConfigureSensor}
      />

      {isConnecting && <FullPageSpinner message="Connecting ..." />}

      <Card className="flex flex-col flex-grow w-full h-full mx-auto shadow-xl p-4 gap-2">
        <div className="flex justify-between items-center">
          <Button variant="outline" onClick={handleAddSensor}>
            <Plus className="w-4 h-4 mr-2" />
            Add Sensor
          </Button>

          <Button
            variant={recording ? "destructive" : "default"}
            onClick={handleToggleRecording}
          >
            {recording ? (
              <>
                <Square className="w-4 h-4 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Circle className="w-4 h-4 mr-2" />
                Start Recording
              </>
            )}
          </Button>
        </div>

        <Plot
          startTime={startTime}
          signals={signals}
          values={values}
          followMode={true}
        />
      </Card>
    </>
  );
}
