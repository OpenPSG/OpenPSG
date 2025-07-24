import { useState } from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Monitor, FolderOpen } from "lucide-react";
import { EDFReader } from "@/lib/edf/edfreader";
import Plot from "@/components/plot/Plot";
import FullPageSpinner from "@/components/FullPageSpinner";
import clsx from "clsx";
import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Values } from "@/lib/types";

export default function View() {
  const [error, setError] = useState<string | undefined>(undefined);
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [signals, setSignals] = useState<EDFSignal[] | undefined>(undefined);
  const [values, setValues] = useState<Values[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const handleOpenFile = async () => {
    setError(undefined);

    try {
      setLoading(true);

      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: "EDF+ File",
            accept: { "application/octet-stream": [".edf"] },
          },
        ],
        excludeAcceptAllOption: true,
        multiple: false,
      });

      // Ensure read permission is granted
      let permission = await fileHandle.queryPermission({ mode: "read" });
      if (permission === "prompt") {
        permission = await fileHandle.requestPermission({ mode: "read" });
      }

      if (permission !== "granted") {
        throw new Error("Permission to read file was denied.");
      }

      const file = await fileHandle.getFile();

      const buffer = await file.arrayBuffer();
      const reader = new EDFReader(new Uint8Array(buffer));
      const header = reader.readHeader();

      const extractedValues: Values[] = header.signals.map((signal) => {
        const sampleRate = signal.samplesPerRecord / header.recordDuration;
        const raw = reader.readValues(signal.label);

        const timestamps = raw.map(
          (_, i) => header.startTime.getTime() + i * (1000 / sampleRate),
        );

        return {
          timestamps,
          values: raw,
        };
      });

      setStartTime(header.startTime);
      setSignals(header.signals);
      setValues(extractedValues);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to open EDF file: ${message}`);
      setStartTime(new Date());
      setSignals(undefined);
      setValues([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {loading && <FullPageSpinner message="Loading ..." />}

      <Card
        className={clsx(
          "flex flex-col flex-grow mx-auto shadow-xl",
          !signals ? "max-w-lg" : "w-full h-full",
        )}
      >
        {!signals ? (
          <>
            <CardHeader className="flex items-center gap-2">
              <Monitor className="w-6 h-6" />
              <CardTitle className="text-xl">View</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={handleOpenFile} variant="default">
                <FolderOpen className="w-4 h-4 mr-2" />
                Open EDF File
              </Button>
            </CardContent>
          </>
        ) : (
          <Plot startTime={startTime} signals={signals} values={values} />
        )}
      </Card>
    </>
  );
}
