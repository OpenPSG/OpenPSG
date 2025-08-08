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

function createMockDriver(values: Value[][]): Driver {
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
  let valuesRef: React.RefObject<Values[]>;
  let mockDriver: Driver;

  beforeEach(() => {
    valuesRef = { current: [] };
  });

  it("streams and stores values", async () => {
    const timestamp = Date.now();
    mockDriver = createMockDriver([
      [
        { timestamp, value: 1 },
        { timestamp, value: 2 },
      ],
      [
        { timestamp: timestamp + 100, value: 3 },
        { timestamp: timestamp + 100, value: 4 },
      ],
    ]);

    startStreaming(mockDriver, 0, valuesRef, 1000);

    await new Promise((r) => setTimeout(r, 50)); // let streaming run

    expect(valuesRef.current.length).toBe(2);
    expect(valuesRef.current[0].values).toEqual([1, 3]);
    expect(valuesRef.current[1].values).toEqual([2, 4]);
  });

  it("handles stream errors", async () => {
    const mockError = new Error("unexpected error");
    const errorDriver: Driver = {
      ...mockDriver,
      // eslint-disable-next-line require-yield
      values: async function* () {
        throw mockError;
      },
    };

    const onError = vi.fn();
    startStreaming(errorDriver, 0, valuesRef, 1000, onError);
    await new Promise((r) => setTimeout(r, 10));

    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it("ignores closed stream errors", async () => {
    const errorDriver: Driver = {
      ...mockDriver,
      // eslint-disable-next-line require-yield
      values: async function* () {
        throw new Error("stream closed");
      },
    };

    const onError = vi.fn();
    startStreaming(errorDriver, 0, valuesRef, 1000, onError);
    await new Promise((r) => setTimeout(r, 10));

    expect(onError).not.toHaveBeenCalled();
  });
});

describe("startEDFWriterLoop", () => {
  let valuesRef: React.RefObject<Values[]>;
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
    valuesRef = {
      current: [
        {
          timestamps: [Date.now() - 1000, Date.now()],
          values: [1, 2],
        },
        {
          timestamps: [Date.now()],
          values: [3],
        },
      ],
    };

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
    expect(writeRecord.mock.calls[0][0].length).toBe(2); // 2 signals
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
    valuesRef = {
      current: [
        { timestamps: [], values: [] },
        { timestamps: [], values: [] },
      ],
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
      [0, 0], // first signal zeros
      [0, 0], // second signal zeros
    ]);
  });
});
