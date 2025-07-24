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

import fs from "fs";
import path from "path";
import { EDFWriter } from "./edfwriter";
import { EDFReader } from "./edfreader";
import type { EDFHeader, EDFSignal, EDFAnnotation } from "./edftypes";
import { describe, expect, it } from "vitest";

function createTestHeader(signalCount = 1, records = 1): EDFHeader {
  const signals: EDFSignal[] = Array(signalCount)
    .fill(null)
    .map((_, i) => ({
      label: `Signal${i + 1}`,
      transducerType: "Transducer",
      physicalDimension: "uV",
      physicalMin: -100,
      physicalMax: 100,
      digitalMin: -32768,
      digitalMax: 32767,
      prefiltering: "",
      samplesPerRecord: 10,
    }));

  return {
    patientId: EDFWriter.patientId({ hospitalCode: "MCH 0234567" }),
    recordingId: EDFWriter.recordingId({
      startDate: new Date("2023-01-01"),
      studyCode: "Test Study",
      technicianCode: "Tech 123",
      equipmentCode: "Equipment 456",
    }),
    startTime: new Date("2023-01-01T00:00:00"),
    dataRecords: records,
    recordDuration: 1,
    signalCount,
    signals,
  };
}

function expectToBeImprecise(
  actual: number[],
  expected: number[],
  epsilon = 1e-2,
) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(epsilon);
  }
}

function createMemoryWritableStream(): {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  getBuffer: () => Promise<Uint8Array>;
} {
  const chunks: Uint8Array[] = [];
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  const writer = stream.getWriter();
  return {
    writer,
    async getBuffer() {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    },
  };
}

describe("EDFWriter", () => {
  it("writes a simple EDF file without annotations", async () => {
    const header = createTestHeader(1, 2);
    const values = [[...Array(20).keys()].map((i) => i - 10)];

    const { writer, getBuffer } = createMemoryWritableStream();
    const edfWriter = new EDFWriter(writer);
    await edfWriter.writeHeader(header);
    await edfWriter.writeRecord([values[0].slice(0, 10)]);
    await edfWriter.writeRecord([values[0].slice(10)]);
    await edfWriter.close();

    const buffer = await getBuffer();
    expect(buffer.byteLength).toBeGreaterThan(256);

    const reader = new EDFReader(buffer);
    const readHeader = reader.readHeader();
    expect(readHeader.dataRecords).toBe(2);
    expect(readHeader.recordDuration).toBe(1);
    expect(readHeader.signalCount).toBe(1);

    const readValues = reader.readValues("Signal1");
    expect(readValues.length).toBe(20);
    expectToBeImprecise(readValues, values[0]);
  });

  it("pads signal data when too short", async () => {
    const header = createTestHeader(1, 2);

    const { writer, getBuffer } = createMemoryWritableStream();
    const edfWriter = new EDFWriter(writer);
    await edfWriter.writeHeader(header);
    await edfWriter.writeRecord([[1, 2, 3, 0, 0, 0, 0, 0, 0, 0]]);
    await edfWriter.writeRecord([[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
    await edfWriter.close();

    const buffer = await getBuffer();
    expect(buffer.byteLength).toBeGreaterThan(256);
  });

  it("writes with annotations if present", async () => {
    const header = createTestHeader(1, 1);
    const values = [[...Array(10).keys()].map((i) => i - 10)];

    const annotations: EDFAnnotation[] = [
      { onset: 0, duration: 0.5, annotation: "Start" },
      { onset: 0.5, annotation: "Event A" },
    ];

    const { writer, getBuffer } = createMemoryWritableStream();
    const edfWriter = new EDFWriter(writer);
    await edfWriter.writeHeader(header);
    await edfWriter.writeRecord([values[0]], annotations);
    await edfWriter.close();

    const buffer = await getBuffer();
    expect(buffer.byteLength).toBeGreaterThan(256);

    const reader = new EDFReader(buffer);
    const readHeader = reader.readHeader();
    expect(readHeader.reserved).toBe("EDF+C");

    const readValues = reader.readValues("Signal1");
    expect(readValues.length).toBe(10);
    expectToBeImprecise(readValues, values[0]);

    const readAnnotations = reader.readAnnotations();
    expect(readAnnotations.length).toBe(2);
    expect(readAnnotations[0].annotation).toBe("Start");
    expect(readAnnotations[1].annotation).toBe("Event A");
  });

  it("writes a test signal to an EDF file", async () => {
    const recordDuration = 30;
    const records = 10;
    const sampleRate = 256;
    const totalSamples = sampleRate * recordDuration * records;
    const frequency = 10;
    const amplitude = 75;

    const sineWave = Array.from({ length: totalSamples }, (_, i) => {
      const t = i / sampleRate;
      return amplitude * Math.sin(2 * Math.PI * frequency * t);
    });

    const header = createTestHeader(1, records);
    header.signals[0] = {
      ...header.signals[0],
      label: "Sine Wave",
      transducerType: "Test Transducer",
      physicalMin: -amplitude,
      physicalMax: amplitude,
      samplesPerRecord: sampleRate * recordDuration,
    };

    const { writer, getBuffer } = createMemoryWritableStream();
    const edfWriter = new EDFWriter(writer);
    await edfWriter.writeHeader(header);

    for (let i = 0; i < records; i++) {
      const start = i * sampleRate * recordDuration;
      const chunk = sineWave.slice(start, start + sampleRate * recordDuration);
      await edfWriter.writeRecord([chunk]);
    }

    await edfWriter.close();
    const buffer = await getBuffer();

    const outPath = path.resolve(__dirname, "test_sine_wave.edf");
    fs.writeFileSync(outPath, buffer);
    expect(fs.existsSync(outPath)).toBe(true);
  });
});

describe("PatientID", () => {
  it("should build a full patient ID string", () => {
    const result = EDFWriter.patientId({
      hospitalCode: "MCH 0234567",
      sex: "F",
      birthdate: new Date("1951-08-02"),
      name: "Haagse Harry",
    });
    expect(result).toBe("MCH_0234567 F 02-AUG-1951 Haagse_Harry");
  });

  it("should fill in X for missing values", () => {
    const result = EDFWriter.patientId({});
    expect(result).toBe("X X X X");
  });
});

describe("RecordingID", () => {
  it("should build a full recording ID string", () => {
    const result = EDFWriter.recordingId({
      startDate: new Date("2002-03-02"),
      studyCode: "PSG 1234/2002",
      technicianCode: "NN",
      equipmentCode: "Telemetry 03",
    });
    expect(result).toBe("Startdate 02-MAR-2002 PSG_1234/2002 NN Telemetry_03");
  });

  it("should fill in X for missing values", () => {
    const result = EDFWriter.recordingId({});
    expect(result).toBe("Startdate X X X X");
  });
});
