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
import { EPOCH_DURATION } from "@/lib/constants";
import SensorConfigDialog from "@/components/SensorConfigDialog";
import { EDFWriter } from "@/lib/edf/edfwriter";
import {
  checkWebBluetoothSupport,
  uniqueFilename,
  triggerDownload,
} from "@/lib/utils";
import FullPageSpinner from "@/components/FullPageSpinner";
import { resample } from "@/lib/resampling/resample";
import { MemoryWritableStream } from "@/lib/stream";

const VALUE_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

export default function Record() {
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [signals, setSignals] = useState<EDFSignal[]>([]);
  const [recording, setRecording] = useState<boolean>(false);
  const [configureSensorDialogOpen, setConfigureSensorDialogOpen] =
    useState(false);
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [activeDriver, setActiveDriver] = useState<Driver | undefined>(
    undefined,
  );
  const [edfWriter, setEdfWriter] = useState<EDFWriter | undefined>(undefined);
  const bufferGetterRef =
    useRef<() => Promise<Uint8Array> | undefined>(undefined);

  const sensorDrivers = useRef<Driver[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | undefined>(undefined);
  const valuesRef = useRef<Values[]>([]);

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

  // EDF Record writing loop using interval
  useEffect(() => {
    if (!recording || !edfWriter || signals.length === 0) return;

    const interval = setInterval(async () => {
      if (!edfWriter || !recording || !valuesRef.current.length) return;

      const now = Date.now();
      const epochMs = EPOCH_DURATION * 1000;

      const samplesPerRecordList = signals.map((s) => s.samplesPerRecord);
      const currentValues = valuesRef.current;

      const recentValues: Values[] = currentValues.map((v) => {
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
        const { values: resampledVals } = resample(v, samples);
        return resampledVals;
      });

      try {
        await edfWriter.writeRecord(resampled);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setError("Failed to write EDF record: " + errMsg);
      }
    }, EPOCH_DURATION * 1000);

    return () => clearInterval(interval);
  }, [edfWriter, recording, signals]);

  const handleSensorConfigComplete = useCallback(
    async (
      submitted: boolean,
      data?: Record<string, ConfigValue>,
      driverOverride?: Driver,
    ) => {
      const driverToUse = driverOverride ?? activeDriver;
      if (!driverToUse) return;

      if (!submitted) {
        await driverToUse.close();
        setConfigureSensorDialogOpen(false);
        return;
      }

      driverToUse.configure?.(data ?? {});
      const newSignals: EDFSignal[] = driverToUse.signals(EPOCH_DURATION);
      const startIndex = signals.length;

      setSignals((prev) => [...prev, ...newSignals]);
      setStartTime((prev) => prev ?? new Date());
      valuesRef.current = [
        ...valuesRef.current,
        ...newSignals.map(() => ({ timestamps: [], values: [] })),
      ];
      setConfigureSensorDialogOpen(false);

      (async () => {
        try {
          for await (const next of driverToUse.values()) {
            const updated = valuesRef.current;
            const now = Date.now();

            for (let i = 0; i < next.length; i++) {
              const signalIndex = startIndex + i;
              if (!updated[signalIndex]) {
                updated[signalIndex] = { timestamps: [], values: [] };
              }

              updated[signalIndex].timestamps.push(next[i].timestamp);
              updated[signalIndex].values.push(next[i].value);

              const ts = updated[signalIndex].timestamps;
              const vs = updated[signalIndex].values;

              while (ts.length > 0 && ts[0] < now - VALUE_RETENTION_MS) {
                ts.shift();
                vs.shift();
              }
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (!errMsg.includes("closed")) {
            console.error("Streaming error", err);
          }
        }
      })();
    },
    [activeDriver, signals],
  );

  const handleAddSensor = async () => {
    try {
      checkWebBluetoothSupport();
      setIsConnecting(true);

      const service = await DriverRegistry.scanForSupportedDevice();
      const driver = DriverRegistry.createDriverForService(service);

      sensorDrivers.current.push(driver);
      setActiveDriver(driver);

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

  const handleToggleRecording = useCallback(async () => {
    if (recording) {
      try {
        await edfWriter?.close();

        if (bufferGetterRef.current) {
          const buffer = await bufferGetterRef.current();
          if (!buffer) {
            throw new Error("No buffer available for download.");
          }

          const blob = new Blob([buffer], { type: "application/octet-stream" });
          triggerDownload(blob, uniqueFilename("edf"));
        } else {
          console.warn("EDF buffer not available for download.");
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setError("Failed to close EDF writer: " + errMsg);
      } finally {
        setEdfWriter(undefined);
        setRecording(false);
      }

      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch (err) {
          console.warn("Failed to release wake lock:", err);
        } finally {
          wakeLockRef.current = undefined;
        }
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
        recordDuration: EPOCH_DURATION,
        signalCount: signals.length,
        signals,
      };

      await writer.writeHeader(header);
      setEdfWriter(writer);
      setRecording(true);

      if ("wakeLock" in navigator && !wakeLockRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lock = await (navigator as any).wakeLock.request("screen");
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

    const interval = setInterval(() => {
      setRevision((r) => r + 1);
    }, 1000);

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
        activeDriver={activeDriver}
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
          startTime={startTime}
          signals={signals}
          values={valuesRef.current}
          followMode={true}
          revision={revision}
        />
      </Card>
    </>
  );
}
