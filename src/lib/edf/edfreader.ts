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

import type {
  EDFHeader,
  EDFSignal,
  EDFAnnotation,
  EDFVersion,
} from "./edftypes";
import _ from "lodash";

export class EDFReader {
  private view: DataView;
  private textDecoder: TextDecoder;
  private byteArray: Uint8Array;
  private header?: EDFHeader;

  constructor(byteArray: Uint8Array) {
    this.textDecoder = new TextDecoder("ascii");
    this.view = new DataView(byteArray.buffer, byteArray.byteOffset);
    this.byteArray = byteArray;
  }

  readHeader(): EDFHeader {
    if (this.header) return this.header;

    const headerText = this.textDecoder.decode(this.byteArray.subarray(0, 256));
    const version = headerText.substring(0, 8).trim() as EDFVersion;
    const patientId = headerText.substring(8, 88).trim();
    const recordingId = headerText.substring(88, 168).trim();
    const startDateStr = headerText.substring(168, 176).trim();
    const startTimeStr = headerText.substring(176, 184).trim();
    const headerBytes = parseInt(headerText.substring(184, 192).trim());
    const reserved = headerText.substring(192, 236).trim();
    const dataRecords = parseInt(headerText.substring(236, 244).trim());
    const recordDuration = parseFloat(headerText.substring(244, 252).trim());
    const signalCount = parseInt(headerText.substring(252, 256).trim());

    // Clamp the date to deal with Y2K issues
    const [day, month, year] = startDateStr.split(".").map(Number);
    const fullYear = year >= 85 ? 1900 + year : 2000 + year;
    const [hour, minute, second] = startTimeStr.split(".").map(Number);
    const startTime = new Date(fullYear, month - 1, day, hour, minute, second);

    const signals: EDFSignal[] = [];

    for (let i = 0; i < signalCount; i++) {
      const signal: Partial<EDFSignal> = {};
      signal.label = this.readFieldText(signalCount, 0, 16, i).trim();
      signal.transducerType = this.readFieldText(signalCount, 16, 96, i).trim();
      signal.physicalDimension = this.readFieldText(
        signalCount,
        96,
        104,
        i,
      ).trim();
      signal.physicalMin = parseFloat(
        this.readFieldText(signalCount, 104, 112, i),
      );
      signal.physicalMax = parseFloat(
        this.readFieldText(signalCount, 112, 120, i),
      );
      signal.digitalMin = parseInt(
        this.readFieldText(signalCount, 120, 128, i),
      );
      signal.digitalMax = parseInt(
        this.readFieldText(signalCount, 128, 136, i),
      );
      signal.prefiltering = this.readFieldText(signalCount, 136, 216, i).trim();
      signal.samplesPerRecord = parseInt(
        this.readFieldText(signalCount, 216, 224, i),
      );
      signal.reserved = this.readFieldText(signalCount, 224, 256, i).trim();
      signals.push(signal as EDFSignal);
    }

    this.header = {
      version,
      patientId,
      recordingId,
      startTime,
      headerBytes,
      reserved,
      dataRecords,
      recordDuration,
      signalCount,
      signals,
    };

    const clonedHeader = _.cloneDeep(this.header);
    clonedHeader.headerBytes = undefined;

    // Hide the annotations "meta" signal from the consumer, it's not a real signal.
    const annSignalIndex = clonedHeader.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );
    if (annSignalIndex !== -1) {
      clonedHeader.signals.splice(annSignalIndex, 1);
      clonedHeader.signalCount = clonedHeader.signals.length;
    }

    return clonedHeader;
  }

  readValues(signalLabel: string, recordNumber?: number): number[] {
    const header = this.header ?? this.readHeader();
    const signalIndex = header.signals.findIndex(
      (s) => s.label.trim() === signalLabel.trim(),
    );
    if (signalIndex === -1) {
      throw new Error(`Signal with label "${signalLabel}" not found.`);
    }

    const signal = header.signals[signalIndex];
    const samplesPerRecord = signal.samplesPerRecord;
    const values: number[] = [];

    const offset = header.headerBytes!;
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0,
    );

    const startRecord = recordNumber ?? 0;
    const endRecord =
      recordNumber !== undefined ? recordNumber + 1 : header.dataRecords;

    const signalByteOffset = header.signals
      .slice(0, signalIndex)
      .reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);

    for (let rec = startRecord; rec < endRecord; rec++) {
      const recOffset = offset + rec * recordSize;

      for (let j = 0; j < samplesPerRecord; j++) {
        const sampleOffset = recOffset + signalByteOffset + j * 2;
        const raw = this.view.getInt16(sampleOffset, true);
        const physical = this.digitalToPhysical(raw, signal);
        values.push(physical);
      }
    }

    return values;
  }

  readAnnotations(recordNumber?: number): EDFAnnotation[] {
    const header = this.header ?? this.readHeader();
    const annSignalIndex = header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );
    if (annSignalIndex === -1) return [];

    const annotations: EDFAnnotation[] = [];
    const offset = header.headerBytes!;
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0,
    );

    const startRecord = recordNumber ?? 0;
    const endRecord =
      recordNumber !== undefined ? recordNumber + 1 : header.dataRecords;

    const signalByteOffset = header.signals
      .slice(0, annSignalIndex)
      .reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);

    const annSignal = header.signals[annSignalIndex];
    const bytes = annSignal.samplesPerRecord * 2;

    for (let rec = startRecord; rec < endRecord; rec++) {
      const recOffset = offset + rec * recordSize;
      const start = recOffset + signalByteOffset;
      const end = start + bytes;
      const slice = this.byteArray.subarray(start, end);
      const text = this.textDecoder.decode(slice);

      const TALs = text.split("\u0000").filter((s) => s.trim().length > 0);

      for (const tal of TALs) {
        const talAnnotations = EDFReader.parseTal(tal);

        // Filter out any timekeeping TALs.
        annotations.push(
          ...talAnnotations.filter((a) => a.annotation.length > 0),
        );
      }
    }

    return annotations;
  }

  // Returns the time associated with the start of the record.
  getRecordtime(recordNumber: number): number {
    const header = this.readHeader();

    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0,
    );

    const annSignalIndex = header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );

    if (annSignalIndex === -1) {
      // Fallback to a continuous timekeeping scheme.
      return recordNumber * header.recordDuration;
    }

    const signalByteOffset = header.signals
      .slice(0, annSignalIndex)
      .reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);

    const bytes = header.signals[annSignalIndex].samplesPerRecord * 2;
    const recOffset = header.headerBytes! + recordNumber * recordSize;
    const start = recOffset + signalByteOffset;
    const end = start + bytes;
    const slice = this.byteArray.subarray(start, end);
    const text = this.textDecoder.decode(slice).replace(/\0/g, "");

    const TALs = text.split("\u0000").filter((s) => s.trim().length > 0);

    const annotations: EDFAnnotation[] = [];

    for (const tal of TALs) {
      const talAnnotations = EDFReader.parseTal(tal);

      annotations.push(...talAnnotations);
    }

    if (annotations.length === 0) {
      return recordNumber * header.recordDuration;
    }

    // Sort annotations by onset time
    annotations.sort((a, b) => a.onset - b.onset);

    // Get the earliest annotation
    const earliestAnnotation = annotations[0];
    if (earliestAnnotation.onset !== 0) {
      return earliestAnnotation.onset;
    } else if (earliestAnnotation.onset === 0 && recordNumber !== 0) {
      // Are any of the annotations non-zero?
      // I've seen a number of files in the wild with zeroed timekeeping TALs.
      const nonZeroAnnotations = annotations.filter((a) => a.onset !== 0);

      if (nonZeroAnnotations.length > 0) {
        return nonZeroAnnotations[0].onset;
      }
    }

    // Fallback to a continuous timekeeping scheme.
    return recordNumber * header.recordDuration;
  }

  static parseTal(tal: string): EDFAnnotation[] {
    const SEPARATOR = String.fromCharCode(0x14);
    const DURATION_MARKER = String.fromCharCode(0x15);

    const annotations: EDFAnnotation[] = [];
    const parts = tal.split(SEPARATOR);
    if (parts.length === 0) return [];

    const onsetDurationPart = parts[0];

    // Parse onset and optional duration
    let onsetStr = "";
    let durationStr: string | undefined = undefined;

    const durationMarkerIndex = onsetDurationPart.indexOf(DURATION_MARKER);
    if (durationMarkerIndex >= 0) {
      onsetStr = onsetDurationPart.slice(0, durationMarkerIndex);
      durationStr = onsetDurationPart.slice(durationMarkerIndex + 1);
    } else {
      onsetStr = onsetDurationPart;
    }

    const onset = parseFloat(onsetStr);
    const duration = durationStr ? parseFloat(durationStr) : undefined;

    // Then its just a list of annotations
    for (const annotation of parts.slice(1)) {
      annotations.push({
        onset,
        duration,
        annotation,
      });
    }

    return annotations;
  }

  private readFieldText(
    signalCount: number,
    start: number,
    end: number,
    signalIndex: number,
  ): string {
    const offset = 256 + start * signalCount + (end - start) * signalIndex;
    return this.textDecoder.decode(
      this.byteArray.subarray(offset, offset + (end - start)),
    );
  }

  private digitalToPhysical(digital: number, signal: EDFSignal): number {
    const { digitalMin, digitalMax, physicalMin, physicalMax } = signal;
    if (digitalMax === digitalMin) return 0;
    return (
      physicalMin +
      ((digital - digitalMin) * (physicalMax - physicalMin)) /
        (digitalMax - digitalMin)
    );
  }
}
