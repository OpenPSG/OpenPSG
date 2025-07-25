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
      releaseWakeLock(wakeLock);

      drivers?.forEach((driver) => {
        driver.close().catch((err) => {
          console.error("Failed to close driver:", err);
        });
      });
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

      startStreaming(
        driverToUse,
        startIndex,
        valuesRef,
        VALUE_RETENTION_MS,
        (err) => setError("Failed to read values from sensor: " + err.message),
      );
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
        recordDuration: EPOCH_DURATION,
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
