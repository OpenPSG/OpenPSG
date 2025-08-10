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

import {
  describe,
  it,
  vi,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { startEDFWriterLoop, startStreaming } from "./utils";
import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Value, Values } from "@/lib/types";
import { EPOCH_DURATION_MS } from "@/lib/constants";
import type { Driver } from "@/lib/drivers/driver";
import { CircularBuffer } from "@/lib/containers/circular-buffer";

function createMockDriver(values: Values[]): Driver {
  return {
    close: vi.fn(),
    signals: vi.fn(),
    values: async function* () {
      for (const batch of values) {
        await new Promise((r) => setTimeout(r, 10)); // simulate delay
        yield batch;
      }
    },
  };
}

describe("startStreaming", () => {
  let valuesRef: React.RefObject<CircularBuffer<Value>[]>;
  let mockDriver: Driver;

  beforeEach(() => {
    // Pre-create buffers for two signals; startStreaming skips uninitialized ones.
    valuesRef = {
      current: [new CircularBuffer<Value>(8), new CircularBuffer<Value>(8)],
    };
  });

  it("streams and stores values in circular buffers", async () => {
    const timestamp = new Date();
    mockDriver = createMockDriver([
      [
        { timestamp, value: 1 },
        { timestamp, value: 2 },
      ],
      [
        { timestamp: new Date(timestamp.getTime() + 100), value: 3 },
        { timestamp: new Date(timestamp.getTime() + 100), value: 4 },
      ],
    ]);

    // NOTE: signature is (driver, startIndex, valuesRef, onError?)
    startStreaming(mockDriver, 0, valuesRef);

    await new Promise((r) => setTimeout(r, 60)); // let streaming run

    expect(valuesRef.current.length).toBe(2);
    expect(valuesRef.current[0].toArray()).toEqual([
      { timestamp, value: 1 },
      { timestamp: new Date(timestamp.getTime() + 100), value: 3 },
    ]);
    expect(valuesRef.current[1].toArray()).toEqual([
      { timestamp, value: 2 },
      { timestamp: new Date(timestamp.getTime() + 100), value: 4 },
    ]);
  });

  it("handles stream errors", async () => {
    const mockError = new Error("unexpected error");
    const errorDriver: Driver = {
      ...mockDriver!,
      // eslint-disable-next-line require-yield
      values: async function* () {
        throw mockError;
      },
    };

    const onError = vi.fn();
    startStreaming(errorDriver, 0, valuesRef, onError);
    await new Promise((r) => setTimeout(r, 10));

    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it("ignores closed stream errors", async () => {
    const errorDriver: Driver = {
      ...mockDriver!,
      // eslint-disable-next-line require-yield
      values: async function* () {
        throw new Error("stream closed");
      },
    };

    const onError = vi.fn();
    startStreaming(errorDriver, 0, valuesRef, onError);
    await new Promise((r) => setTimeout(r, 10));

    expect(onError).not.toHaveBeenCalled();
  });

  it("overwrites oldest entries when full", async () => {
    const ts = new Date();
    valuesRef.current = [new CircularBuffer<Value>(2)];
    valuesRef.current.push(new CircularBuffer<Value>(2)); // ensure two signals
    const drv = createMockDriver([
      [
        { timestamp: ts, value: 1 },
        { timestamp: ts, value: 10 },
      ],
      [
        { timestamp: new Date(+ts + 1), value: 2 },
        { timestamp: new Date(+ts + 1), value: 20 },
      ],
      [
        { timestamp: new Date(+ts + 2), value: 3 },
        { timestamp: new Date(+ts + 2), value: 30 },
      ],
    ]);

    startStreaming(drv, 0, valuesRef);
    await new Promise((r) => setTimeout(r, 50));

    // First signal buffer capacity=2, should contain last two values: 2,3
    expect(valuesRef.current[0].toArray()).toEqual([
      { timestamp: new Date(+ts + 1), value: 2 },
      { timestamp: new Date(+ts + 2), value: 3 },
    ]);
    // Second signal buffer capacity=2, should contain 20,30
    expect(valuesRef.current[1].toArray()).toEqual([
      { timestamp: new Date(+ts + 1), value: 20 },
      { timestamp: new Date(+ts + 2), value: 30 },
    ]);
  });
});

describe("startEDFWriterLoop", () => {
  let valuesRef: React.RefObject<CircularBuffer<Value>[]>;
  let writeRecord: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let edfWriter: any;
  let signals: EDFSignal[];
  let onError: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    // Build two buffers and prefill with values
    const buf0 = new CircularBuffer<Value>(8);
    const buf1 = new CircularBuffer<Value>(8);

    buf0.push({ timestamp: new Date(Date.now() - 1000), value: 1 });
    buf0.push({ timestamp: new Date(), value: 2 });

    buf1.push({ timestamp: new Date(), value: 3 });

    valuesRef = { current: [buf0, buf1] };

    writeRecord = vi.fn().mockResolvedValue(undefined);
    edfWriter = { writeRecord };
    signals = [
      { samplesPerRecord: 2 } as EDFSignal,
      { samplesPerRecord: 2 } as EDFSignal,
    ];

    onError = vi.fn();
  });

  afterEach(() => {
    stop?.();
  });

  it("writes resampled records periodically", async () => {
    stop = startEDFWriterLoop({
      edfWriter,
      signals,
      valuesRef,
      onError,
    });

    vi.advanceTimersByTime(EPOCH_DURATION_MS + 5);
    await Promise.resolve();

    expect(writeRecord).toHaveBeenCalledTimes(1);
    // 2 signals
    expect(writeRecord.mock.calls[0][0].length).toBe(2);
  });

  it("handles write errors", async () => {
    writeRecord.mockRejectedValueOnce(new Error("write failed"));

    stop = startEDFWriterLoop({
      edfWriter,
      signals,
      valuesRef,
      onError,
    });

    vi.advanceTimersByTime(EPOCH_DURATION_MS + 5);
    await Promise.resolve();

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toBe("write failed");
  });

  it("stops interval when stop is called", () => {
    stop = startEDFWriterLoop({
      edfWriter,
      signals,
      valuesRef,
      onError,
    });

    stop();
    vi.advanceTimersByTime(EPOCH_DURATION_MS * 2);

    expect(writeRecord).toHaveBeenCalledTimes(0);
  });

  it("writes zero-filled records when no values are present", async () => {
    // Two empty buffers still present (not missing)
    valuesRef = {
      current: [new CircularBuffer<Value>(4), new CircularBuffer<Value>(4)],
    };

    stop = startEDFWriterLoop({
      edfWriter,
      signals,
      valuesRef,
      onError,
    });

    vi.advanceTimersByTime(EPOCH_DURATION_MS + 5);
    await Promise.resolve();

    expect(writeRecord).toHaveBeenCalledTimes(1);
    expect(writeRecord.mock.calls[0][0]).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});
