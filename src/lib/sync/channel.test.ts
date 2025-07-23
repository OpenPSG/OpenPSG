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

import { describe, it, expect } from "vitest";
import Channel from "./channel";

describe("Channel", () => {
  it("should yield pushed values in order", async () => {
    const queue = new Channel<number>();

    queue.push(1);
    queue.push(2);
    queue.push(3);

    const iter = queue[Symbol.asyncIterator]();

    expect((await iter.next()).value).toBe(1);
    expect((await iter.next()).value).toBe(2);
    expect((await iter.next()).value).toBe(3);
  });

  it("should wait for value if queue is empty", async () => {
    const queue = new Channel<string>();
    const iter = queue[Symbol.asyncIterator]();

    const promise = iter.next();

    setTimeout(() => {
      queue.push("hello");
    }, 10);

    const result = await promise;
    expect(result.value).toBe("hello");
  });

  it("should yield indefinitely", async () => {
    const queue = new Channel<boolean>();
    const iter = queue[Symbol.asyncIterator]();

    queue.push(true);
    queue.push(false);

    const values = [(await iter.next()).value, (await iter.next()).value];

    expect(values).toEqual([true, false]);
  });

  it("should support interleaved async push and read", async () => {
    const queue = new Channel<number>();
    const results: number[] = [];

    const reader = (async () => {
      for await (const value of queue) {
        results.push(value);
        if (results.length === 3) break;
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));
    queue.push(10);
    queue.push(20);

    await new Promise((resolve) => setTimeout(resolve, 5));
    queue.push(30);

    await reader;
    expect(results).toEqual([10, 20, 30]);
  });

  it("should throw if closed while waiting for value", async () => {
    const queue = new Channel<number>();
    const iter = queue[Symbol.asyncIterator]();

    const nextPromise = iter.next();
    queue.close(new Error("Queue closed"));

    await expect(nextPromise).rejects.toThrow("Queue closed");
  });

  it("should throw if iterated after being closed", async () => {
    const queue = new Channel<number>();
    const iter = queue[Symbol.asyncIterator]();

    queue.close(new Error("no more"));

    await expect(iter.next()).rejects.toThrow("no more");
  });

  it("should not allow pushing after close", () => {
    const queue = new Channel<string>();
    queue.close();

    expect(() => queue.push("x")).toThrow("Queue is closed");
  });
});
