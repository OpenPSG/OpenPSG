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
import Plot from "@/components/plot/Plot";
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
import { EPOCH_DURATION_MS } from "@/lib/constants";
import SensorConfigDialog from "./SensorConfigDialog";
import { EDFWriter } from "@/lib/edf/edfwriter";
import {
  acquireWakeLock,
  releaseWakeLock,
  checkWebBluetoothSupport,
  uniqueFilename,
  triggerDownload,
} from "@/lib/utils";
import FullPageSpinner from "@/components/FullPageSpinner";
import { MemoryWritableStream } from "@/lib/stream";
import { startStreaming, startEDFWriterLoop } from "./utils";

const VALUE_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

export default function Record() {
  const sensorsRef = useRef<Driver[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | undefined>(undefined);
  const valuesRef = useRef<Values[]>([]);
  const [configureSensorDialogOpen, setConfigureSensorDialogOpen] =
    useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [activeSensor, setActiveSensor] = useState<Driver | undefined>(
    undefined,
  );
  const [signals, setSignals] = useState<EDFSignal[]>([]);
  const [edfWriter, setEdfWriter] = useState<EDFWriter | undefined>(undefined);

  // Cleanup drivers/wakelock on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        releaseWakeLock(wakeLockRef.current);
      }

      sensorsRef.current?.forEach((driver) => {
        driver.close().catch((err) => {
          console.warn("Failed to close driver:", err);
        });
      });
      sensorsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!recording || !edfWriter || signals.length === 0) return;
    return startEDFWriterLoop({
      edfWriter,
      signals,
      valuesRef,
      onError: (err) => setError("Failed to write EDF record: " + err.message),
    });
  }, [edfWriter, recording, signals]);

  const handleSensorConfigComplete = useCallback(
    async (
      submitted: boolean,
      data?: Record<string, ConfigValue>,
      driverOverride?: Driver,
    ) => {
      const driverToUse = driverOverride ?? activeSensor;
      if (!driverToUse) return;

      setActiveSensor(undefined);

      if (!submitted) {
        await driverToUse.close();
        setConfigureSensorDialogOpen(false);
        sensorsRef.current = sensorsRef.current.filter(
          (d) => d !== driverToUse,
        );
        return;
      }

      try {
        driverToUse.configure?.(data ?? {});
      } catch (err) {
        setError("Failed to configure sensor: " + (err as Error).message);
        return;
      }

      const newSignals: EDFSignal[] = driverToUse.signals(
        EPOCH_DURATION_MS / 1000,
      );
      const startIndex = signals.length;

      setSignals((prev) => [...prev, ...newSignals]);
      valuesRef.current = [
        ...valuesRef.current,
        ...newSignals.map(() => ({ timestamps: [], values: [] })),
      ];
      setConfigureSensorDialogOpen(false);

      startStreaming(
        driverToUse,
        startIndex,
        valuesRef,
        VALUE_RETENTION_MS,
        (err) => setError("Failed to read values from sensor: " + err.message),
      );
    },
    [activeSensor, signals],
  );

  const handleAddSensor = async () => {
    try {
      checkWebBluetoothSupport();
      setIsConnecting(true);

      const service = await DriverRegistry.scanForSupportedDevice();
      const driver = DriverRegistry.createDriverForService(service);

      sensorsRef.current.push(driver);
      setActiveSensor(driver);

      if (!driver.configSchema || driver.configSchema.length === 0) {
        await handleSensorConfigComplete(true, undefined, driver);
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

  const bufferGetterRef =
    useRef<() => Promise<Uint8Array> | undefined>(undefined);
  const handleToggleRecording = useCallback(async () => {
    if (recording) {
      try {
        await edfWriter?.close();
        if (bufferGetterRef.current) {
          const buffer = await bufferGetterRef.current();
          if (!buffer) throw new Error("No buffer available for download.");
          const blob = new Blob([buffer], { type: "application/octet-stream" });
          triggerDownload(blob, uniqueFilename("edf"));
        } else {
          console.warn("EDF buffer not available for download.");
        }
      } catch (err) {
        setError("Failed to close EDF writer: " + (err as Error).message);
      } finally {
        setEdfWriter(undefined);
        setRecording(false);
        await releaseWakeLock(wakeLockRef.current);
        wakeLockRef.current = undefined;
      }
      return;
    }

    if (!signals.length) {
      setError("At least one sensor must be configured before recording.");
      return;
    }

    try {
      // I would love to use showSaveFilePicker/showOpenFilePicker here but I've
      // found a lot of android bugs, and it's a very new API.
      const { writer: writable, getBuffer } = MemoryWritableStream();
      bufferGetterRef.current = getBuffer;
      const writer = new EDFWriter(writable);
      const now = new Date();

      const header = {
        patientId: EDFWriter.patientId({}),
        recordingId: EDFWriter.recordingId({ startDate: now }),
        startTime: now,
        dataRecords: -1,
        recordDuration: EPOCH_DURATION_MS / 1000,
        signalCount: signals.length,
        signals,
      };

      await writer.writeHeader(header);
      setEdfWriter(writer);
      setRecording(true);

      const lock = await acquireWakeLock();
      if (lock) {
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          wakeLockRef.current = undefined;
        });
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Unable to open file for recording.");
    }
  }, [recording, signals, edfWriter]);

  // Trigger a plot update every second, this is necessary as we are using a
  // ref for the values array.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!signals.length) return;
    const interval = setInterval(() => setRevision((r) => r + 1), 1000);
    return () => clearInterval(interval);
  }, [signals]);

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
        activeDriver={activeSensor}
        onComplete={handleSensorConfigComplete}
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
            disabled={!signals.length}
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
          signals={signals}
          values={valuesRef.current}
          followMode={true}
          revision={revision}
        />
      </Card>
    </>
  );
}
