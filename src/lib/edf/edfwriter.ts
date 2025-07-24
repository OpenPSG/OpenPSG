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

import type { EDFHeader, EDFSignal, EDFAnnotation } from "./edftypes";
import { format } from "date-fns";

const ANNOTATION_RECORD_LENGTH = 64; // Number of samples for annotation signal (128 bytes)

export class EDFWriter {
  private textEncoder = new TextEncoder();
  private stream:
    | WritableStreamDefaultWriter<Uint8Array>
    | FileSystemWritableFileStream;
  private header?: EDFHeader;
  private headerWritten = false;

  private annSignalIndex = -1;
  private bytesPerRecord = 0;
  private currentRecord = 0;
  private recordsWritten = 0;

  constructor(
    stream:
      | WritableStreamDefaultWriter<Uint8Array>
      | FileSystemWritableFileStream,
  ) {
    this.stream = stream;
  }

  async writeHeader(header: EDFHeader): Promise<void> {
    if (this.headerWritten) {
      throw new Error("Header has already been written");
    }

    // Clone the header to avoid mutating the original
    this.header = {
      ...header,
      signals: [...header.signals.map((s) => ({ ...s }))],
    };

    this.configureAnnotationSignal();
    this.calculateBytesPerRecord();

    const headerBytes = this.textEncoder.encode(this.buildHeader());
    await this.stream.write(headerBytes);
    this.headerWritten = true;
  }

  async writeRecord(
    values: number[][],
    annotations?: EDFAnnotation[],
  ): Promise<void> {
    if (!this.headerWritten || !this.header) {
      throw new Error("Header must be written before writing records");
    }

    const { signals } = this.header;

    // 👇 Automatically pad missing annotation signal if needed
    if (values.length === signals.length - 1 && this.annSignalIndex !== -1) {
      values = [...values];
      values.splice(this.annSignalIndex, 0, []);
    }

    if (values.length !== signals.length) {
      throw new Error("Signal count mismatch in writeRecord()");
    }

    const chunk = new Uint8Array(this.bytesPerRecord);
    let offset = 0;

    for (let s = 0; s < signals.length; s++) {
      const signal = signals[s];
      const samples = signal.samplesPerRecord;
      const data = values[s];

      if (s === this.annSignalIndex) {
        const annText = this.generateAnnotationBlock(
          this.currentRecord,
          annotations,
        );
        const encodedAnn = this.encodeAnnotationSignal(annText, samples * 2);
        chunk.set(encodedAnn, offset);
        offset += encodedAnn.length;
      } else {
        if (data.length !== samples) {
          throw new Error(`Signal ${s} must have ${samples} samples`);
        }

        for (const sample of data) {
          const raw = this.physicalToDigital(sample, signal);
          chunk[offset++] = raw & 0xff;
          chunk[offset++] = (raw >> 8) & 0xff;
        }
      }
    }

    await this.stream.write(chunk);
    this.currentRecord += 1;
    this.recordsWritten += 1;
  }

  async close(): Promise<void> {
    if (!this.header) throw new Error("header not set");

    if ("seek" in this.stream && typeof this.stream.seek === "function") {
      // Update dataRecords in header
      this.header.dataRecords = this.recordsWritten;

      // Rebuild and write header again
      const updatedHeaderBytes = this.textEncoder.encode(this.buildHeader());
      await this.stream.seek(0);
      await this.stream.write(updatedHeaderBytes);
    }

    await this.stream.close();
  }

  private configureAnnotationSignal(): void {
    if (!this.header)
      throw new Error("Header must be set before configuration");

    let index = this.header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );

    if (index === -1) {
      const annotationSignal: EDFSignal = {
        label: "EDF Annotations",
        transducerType: "",
        physicalDimension: "",
        physicalMin: -32768,
        physicalMax: 32767,
        digitalMin: -32768,
        digitalMax: 32767,
        prefiltering: "",
        samplesPerRecord: ANNOTATION_RECORD_LENGTH,
      };

      this.header.signals.push(annotationSignal);
      this.header.signalCount += 1;
      this.header.headerBytes = 256 + 256 * this.header.signalCount;
      index = this.header.signals.length - 1;
    }

    // The user has already supplied an annotation signal.
    this.annSignalIndex = index;
  }

  private calculateBytesPerRecord(): void {
    if (!this.header)
      throw new Error("Header must be set before calculating bytes");

    this.bytesPerRecord = 0;
    for (const signal of this.header.signals) {
      this.bytesPerRecord += signal.samplesPerRecord * 2;
    }

    this.annSignalIndex = this.header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );
  }

  private generateAnnotationBlock(
    recordNumber: number,
    annotations?: EDFAnnotation[],
  ): string {
    const startTime = recordNumber * (this.header?.recordDuration ?? 1.0);
    let text = `+${startTime.toFixed(3)}\u0014\u0014\u0000`;

    if (!annotations || annotations.length === 0) return text;

    for (const ann of annotations) {
      text += `+${ann.onset.toFixed(3)}`;
      if (ann.duration !== undefined) {
        text += `\u0015${ann.duration.toFixed(3)}`;
      }
      text += `\u0014${ann.annotation}\u0014\u0000`;
    }

    return text;
  }

  private encodeAnnotationSignal(text: string, byteLength: number): number[] {
    const encoded = this.textEncoder.encode(text);
    const buf = new Uint8Array(byteLength);
    buf.set(encoded.slice(0, byteLength));
    return Array.from(buf);
  }

  private physicalToDigital(value: number, signal: EDFSignal): number {
    const { digitalMin, digitalMax, physicalMin, physicalMax } = signal;
    if (physicalMax === physicalMin) return 0;

    const digital = Math.round(
      ((value - physicalMin) * (digitalMax - digitalMin)) /
        (physicalMax - physicalMin) +
        digitalMin,
    );

    return Math.max(digitalMin, Math.min(digitalMax, digital));
  }

  private buildHeader(): string {
    const header = this.header!;
    const field = (val: string, length: number): string =>
      val.padEnd(length).substring(0, length);

    const dateStr = format(header.startTime, "dd.MM.yy");
    const timeStr = format(header.startTime, "HH.mm.ss");
    const headerBytes = 256 + 256 * header.signalCount;
    const reserved = this.annSignalIndex !== -1 ? "EDF+C" : "";

    let text = "";
    text += field(header.version ?? "0", 8);
    text += field(header.patientId, 80);
    text += field(header.recordingId, 80);
    text += field(dateStr, 8);
    text += field(timeStr, 8);
    text += field(String(headerBytes), 8);
    text += field(reserved, 44);
    text += field(String(header.dataRecords), 8);
    text += field(header.recordDuration.toFixed(6), 8);
    text += field(String(header.signalCount), 4);

    const collect = (cb: (s: EDFSignal) => string, len: number) =>
      header.signals
        .map(cb)
        .map((v) => field(v, len))
        .join("");

    text += collect((s) => s.label, 16);
    text += collect((s) => s.transducerType, 80);
    text += collect((s) => s.physicalDimension, 8);
    text += collect((s) => s.physicalMin.toString(), 8);
    text += collect((s) => s.physicalMax.toString(), 8);
    text += collect((s) => s.digitalMin.toString(), 8);
    text += collect((s) => s.digitalMax.toString(), 8);
    text += collect((s) => s.prefiltering, 80);
    text += collect((s) => s.samplesPerRecord.toString(), 8);
    text += collect((s) => s.reserved || "", 32);

    return text;
  }

  static patientId({
    hospitalCode,
    sex,
    birthdate,
    name,
  }: {
    hospitalCode?: string;
    sex?: "M" | "F";
    birthdate?: Date;
    name?: string;
  }): string {
    const formatDate = (date: Date): string =>
      `${String(date.getDate()).padStart(2, "0")}-${date
        .toLocaleString("en-US", { month: "short" })
        .toUpperCase()}-${date.getFullYear()}`;

    const safe = (val?: string): string =>
      val ? val.replace(/\s+/g, "_") : "X";

    return [
      safe(hospitalCode),
      sex ?? "X",
      birthdate ? formatDate(birthdate) : "X",
      safe(name),
    ].join(" ");
  }

  static recordingId({
    startDate,
    studyCode,
    technicianCode,
    equipmentCode,
  }: {
    startDate?: Date;
    studyCode?: string;
    technicianCode?: string;
    equipmentCode?: string;
  }): string {
    const formatDate = (date: Date): string =>
      `${String(date.getDate()).padStart(2, "0")}-${date
        .toLocaleString("en-US", { month: "short" })
        .toUpperCase()}-${date.getFullYear()}`;

    const safe = (val?: string): string =>
      val ? val.replace(/\s+/g, "_") : "X";

    return [
      "Startdate",
      startDate ? formatDate(startDate) : "X",
      safe(studyCode),
      safe(technicianCode),
      safe(equipmentCode),
    ].join(" ");
  }
}
