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

import { useState } from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Monitor } from "lucide-react";
import { EDFReader } from "@/lib/edf/edfreader";
import Plot from "@/components/plot/Plot";
import FullPageSpinner from "@/components/FullPageSpinner";
import clsx from "clsx";
import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Values } from "@/lib/types";

export default function View() {
  const [error, setError] = useState<string | undefined>(undefined);
  const [signals, setSignals] = useState<EDFSignal[] | undefined>(undefined);
  const [values, setValues] = useState<Values[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(undefined);
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      try {
        const reader = new EDFReader(new Uint8Array(buffer));
        const header = reader.readHeader();

        const values: Values[] = header.signals.map((signal) => {
          const sampleRate = signal.samplesPerRecord / header.recordDuration;
          const raw = reader.readValues(signal.label);

          return raw.map((value, i) => ({
            timestamp: new Date(
              header.startTime.getTime() + i * (1000 / sampleRate),
            ),
            value,
          }));
        });

        setSignals(header.signals);
        setValues(values);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to load the uploaded data: ${message}`);
        setSignals(undefined);
        setValues([]);
      } finally {
        setLoading(false);
      }
    };

    reader.readAsArrayBuffer(file);
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

              <Input type="file" accept=".edf" onChange={handleFileChange} />
            </CardContent>
          </>
        ) : (
          <Plot signals={signals} values={values} />
        )}
      </Card>
    </>
  );
}
