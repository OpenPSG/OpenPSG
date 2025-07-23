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

export class EDFWriter {
  private textEncoder = new TextEncoder();
  private header: EDFHeader;
  private values: number[][];
  private annotations?: EDFAnnotation[];

  constructor(
    header: EDFHeader,
    values: number[][],
    annotations?: EDFAnnotation[],
  ) {
    this.header = header;
    this.values = values;
    this.annotations = annotations;
    this.configureAnnotationSignal();
  }

  write(): ArrayBuffer {
    const { header, values } = this;
    const signalCount = header.signalCount;
    const records = header.dataRecords;

    if (values.length !== signalCount) {
      throw new Error("Too few signal values provided");
    }

    for (let i = 0; i < signalCount; i++) {
      const signal = header.signals[i];
      const expectedSamples = signal.samplesPerRecord * records;
      const currentSamples = values[i].length;

      if (currentSamples < expectedSamples) {
        const padAmount = expectedSamples - currentSamples;
        values[i] = values[i].concat(Array(padAmount).fill(0));
      }
    }

    let bytesPerRecord = 0;
    for (const signal of header.signals) {
      bytesPerRecord += signal.samplesPerRecord * 2;
    }

    if (bytesPerRecord > 61440) {
      // Use a smaller number of samples per record to avoid exceeding the limit.
      console.error(
        `Each data record is ${bytesPerRecord} bytes, exceeding the recommended maximum of 61440 bytes (EDF spec).`,
      );
    }

    const headerString = this.buildHeader();
    const headerBytes = this.textEncoder.encode(headerString);
    const dataBytes: number[] = [];

    const annSignalIndex = header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );
    const hasAnnotations = annSignalIndex !== -1;

    for (let recordNumber = 0; recordNumber < records; recordNumber++) {
      for (let s = 0; s < signalCount; s++) {
        const signal = header.signals[s];
        const start = recordNumber * signal.samplesPerRecord;
        const end = start + signal.samplesPerRecord;

        if (hasAnnotations && s === annSignalIndex) {
          const annText = this.generateAnnotationBlock(recordNumber);
          const encodedAnn = this.encodeAnnotationSignal(
            annText,
            signal.samplesPerRecord * 2,
          );
          dataBytes.push(...encodedAnn);
        } else {
          for (const sample of values[s].slice(start, end)) {
            const raw = this.physicalToDigital(sample, signal);
            dataBytes.push(raw & 0xff, (raw >> 8) & 0xff);
          }
        }
      }
    }

    const fullBuffer = new Uint8Array(headerBytes.length + dataBytes.length);
    fullBuffer.set(headerBytes);
    fullBuffer.set(dataBytes, headerBytes.length);

    return fullBuffer.buffer;
  }

  // Constructs an EDF+ patient ID string based on the provided parameters.
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
        .toLocaleString("en-US", {
          month: "short",
        })
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

  // Construct an EDF+ recording ID string based on the provided parameters.
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
        .toLocaleString("en-US", {
          month: "short",
        })
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

  private configureAnnotationSignal(): void {
    if (!this.annotations || this.annotations.length === 0) return;

    let annotationIndex = this.header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );

    if (annotationIndex === -1) {
      const annotationSignal: EDFSignal = {
        label: "EDF Annotations",
        transducerType: "",
        physicalDimension: "",
        physicalMin: -32768,
        physicalMax: 32767,
        digitalMin: -32768,
        digitalMax: 32767,
        prefiltering: "",
        samplesPerRecord: 0,
      };

      this.header.signals.push(annotationSignal);
      this.header.signalCount += 1;
      this.header.headerBytes = 256 + 256 * this.header.signalCount;

      annotationIndex = this.header.signals.length - 1;
    }

    const samplesPerRecord = this.calculateMinimumAnnotationSamplesPerRecord(
      this.annotations,
    );
    this.header.signals[annotationIndex].samplesPerRecord = samplesPerRecord;

    const totalSamples = samplesPerRecord * this.header.dataRecords;

    while (this.values.length <= annotationIndex) {
      this.values.push([]);
    }

    const signal = this.values[annotationIndex];
    if (signal.length === 0) {
      this.values[annotationIndex] = Array(totalSamples).fill(0);
    } else if (signal.length < totalSamples) {
      this.values[annotationIndex] = signal.concat(
        Array(totalSamples - signal.length).fill(0),
      );
    } else if (signal.length > totalSamples) {
      throw new Error(
        "Annotation values too long for configured samplesPerRecord",
      );
    }
  }

  private calculateMinimumAnnotationSamplesPerRecord(
    annotations: EDFAnnotation[],
  ): number {
    if (!annotations.length) return 1;

    let maxBytesPerRecord = 0;

    const recordCount = this.header.dataRecords;
    for (let record = 0; record < recordCount; record++) {
      const text = this.generateAnnotationBlock(record);
      const bytes = new TextEncoder().encode(text);
      maxBytesPerRecord = Math.max(maxBytesPerRecord, bytes.length);
    }

    return Math.ceil(maxBytesPerRecord / 2);
  }

  private buildHeader(): string {
    const { header } = this;
    const field = (val: string, length: number): string =>
      val.padEnd(length).substring(0, length);

    const startTime = header.startTime;
    const dateStr = format(startTime, "dd.MM.yy");
    const timeStr = format(startTime, "HH.mm.ss");

    const headerBytes = 256 + 256 * header.signalCount;

    let text = "";
    text += field(header.version ?? "0", 8);
    text += field(header.patientId, 80);
    text += field(header.recordingId, 80);
    text += field(dateStr, 8);
    text += field(timeStr, 8);
    text += field(String(headerBytes), 8);

    // Mark the file as EDF+ if it has annotations, otherwise use plain EDF.
    const hasAnnotations = this.annotations && this.annotations.length > 0;
    const reserved = hasAnnotations ? "EDF+C" : "";
    text += field(reserved, 44);

    text += field(String(header.dataRecords), 8);
    text += field(header.recordDuration.toFixed(6), 8);
    text += field(String(header.signalCount), 4);

    const signals = header.signals;
    const collect = (cb: (s: EDFSignal) => string, len: number) =>
      signals
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

  private encodeAnnotationSignal(text: string, byteLength: number): number[] {
    const encoded = new TextEncoder().encode(text);
    const buf = new Uint8Array(byteLength);
    buf.set(encoded.slice(0, byteLength));
    return Array.from(buf);
  }

  private generateAnnotationBlock(recordNumber: number): string {
    if (!this.annotations) return "";

    const startTime = recordNumber * this.header.recordDuration;
    const endTime = startTime + this.header.recordDuration;

    // Grab annotations that fall within this record's time window
    const anns = this.annotations.filter(
      (a) => a.onset >= startTime && a.onset < endTime,
    );

    let text = "";

    // Timekeeping TAL (required, even if no annotations)
    text += `+${startTime.toFixed(3)}\u0014\u0014\u0000`;

    // One valid TAL per annotation
    for (const ann of anns) {
      text += `+${ann.onset.toFixed(3)}`;
      if (ann.duration !== undefined) {
        text += `\u0015${ann.duration.toFixed(3)}`;
      }
      text += `\u0014${ann.annotation}\u0014\u0000`;
    }

    return text;
  }
}
