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
import { CircularBuffer } from "./circular-buffer";

function range(n: number, start = 0): number[] {
  return Array.from({ length: n }, (_, i) => start + i);
}

describe("CircularBuffer", () => {
  describe("constructor & invariants", () => {
    it("throws on non-positive or non-integer capacity", () => {
      expect(() => new CircularBuffer(0)).toThrow();
      expect(() => new CircularBuffer(-1)).toThrow();
      expect(() => new CircularBuffer(1.5)).toThrow();
      expect(() => new CircularBuffer(NaN)).toThrow();
      expect(() => new CircularBuffer(1)).not.toThrow();
    });

    it("exposes capacity, starts empty, not full", () => {
      const buf = new CircularBuffer<number>(3);
      expect(buf.capacity).toBe(3);
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
      expect(buf.isFull).toBe(false);
      expect(buf.peek()).toBeUndefined();
      expect(buf.dequeue()).toBeUndefined();
    });
  });

  describe("push & overwrite semantics", () => {
    it("push fills up to capacity and returns undefined until full", () => {
      const buf = new CircularBuffer<number>(3);
      expect(buf.push(1)).toBeUndefined();
      expect(buf.push(2)).toBeUndefined();
      expect(buf.push(3)).toBeUndefined();
      expect(buf.size).toBe(3);
      expect(buf.isFull).toBe(true);
      expect(buf.toArray()).toEqual([1, 2, 3]);
    });

    it("push on a full buffer overwrites the oldest and returns it", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2, 3]); // full
      const overwritten = buf.push(4);
      expect(overwritten).toBe(1); // oldest removed
      expect(buf.size).toBe(3);
      expect(buf.toArray()).toEqual([2, 3, 4]); // order from oldest->newest

      // Overwrite multiple times
      expect(buf.push(5)).toBe(2);
      expect(buf.toArray()).toEqual([3, 4, 5]);
      expect(buf.push(6)).toBe(3);
      expect(buf.toArray()).toEqual([4, 5, 6]);

      // Dequeue now yields the current oldest (4)
      expect(buf.dequeue()).toBe(4);
      expect(buf.toArray()).toEqual([5, 6]);
    });

    it("tryPush refuses when full and does not mutate", () => {
      const buf = new CircularBuffer<string>(2);
      expect(buf.tryPush("a")).toBe(true);
      expect(buf.tryPush("b")).toBe(true);
      const before = buf.toArray();
      expect(buf.isFull).toBe(true);
      expect(buf.tryPush("c")).toBe(false);
      expect(buf.toArray()).toEqual(before); // unchanged
      expect(buf.size).toBe(2);
    });
  });

  describe("dequeue & peek", () => {
    it("dequeues in FIFO order and updates size/emptiness", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([10, 20, 30]);
      expect(buf.peek()).toBe(10);
      expect(buf.dequeue()).toBe(10);
      expect(buf.size).toBe(2);
      expect(buf.peek()).toBe(20);
      expect(buf.dequeue()).toBe(20);
      expect(buf.dequeue()).toBe(30);
      expect(buf.dequeue()).toBeUndefined();
      expect(buf.isEmpty).toBe(true);
    });

    it("wrap-around still keeps correct FIFO behavior", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2, 3]); // full
      expect(buf.dequeue()).toBe(1); // head moves
      buf.push(4); // tail wraps to index 0
      expect(buf.toArray()).toEqual([2, 3, 4]);
      expect(buf.dequeue()).toBe(2);
      expect(buf.dequeue()).toBe(3);
      expect(buf.dequeue()).toBe(4);
      expect(buf.dequeue()).toBeUndefined();
    });
  });

  describe("random access via at()", () => {
    it("throws on non-integer index", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2]);
      expect(() => buf.at(1.1)).toThrow(/integer/);
    });

    it("throws on out-of-range index", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2]);
      expect(() => buf.at(-1)).toThrow(/range/);
      expect(() => buf.at(2)).toThrow(/range/); // valid indices: 0..size-1
    });

    it("returns correct elements relative to oldest", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2, 3]); // [1,2,3]
      expect(buf.at(0)).toBe(1);
      expect(buf.at(1)).toBe(2);
      expect(buf.at(2)).toBe(3);

      // overwrite & wrap
      buf.push(4); // [2,3,4]
      expect(buf.at(0)).toBe(2);
      expect(buf.at(buf.size - 1)).toBe(4);
    });
  });

  describe("toArray & iteration", () => {
    it("toArray returns elements oldest->newest and is independent of internal storage", () => {
      const buf = new CircularBuffer<number>(4);
      buf.fillFrom([7, 8, 9]);
      const arr = buf.toArray();
      expect(arr).toEqual([7, 8, 9]);

      // mutate buffer later; prior snapshot should not change
      buf.push(10);
      buf.push(11); // overwrites 7
      expect(buf.toArray()).toEqual([8, 9, 10, 11].slice(0, buf.size));
      expect(arr).toEqual([7, 8, 9]); // unchanged snapshot
    });

    it("iterator yields same sequence as toArray", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2, 3]);
      expect([...buf]).toEqual(buf.toArray());

      buf.push(4); // [2,3,4]
      expect([...buf]).toEqual([2, 3, 4]);
    });
  });

  describe("clear()", () => {
    it("resets size/state and drops references in the logical range", () => {
      const buf = new CircularBuffer<object>(3);
      const objs = [{ id: 1 }, { id: 2 }, { id: 3 }];
      buf.fillFrom(objs);
      expect(buf.size).toBe(3);
      buf.clear();
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
      expect(buf.peek()).toBeUndefined();
      expect(buf.dequeue()).toBeUndefined();

      // Reuse after clear behaves as fresh
      expect(buf.tryPush({ id: 4 })).toBe(true);
      expect(buf.toArray()).toEqual([{ id: 4 }]);
    });
  });

  describe("fillFrom()", () => {
    it("fills from any iterable and only keeps the newest up to capacity", () => {
      const buf = new CircularBuffer<number>(5);
      // longer than capacity
      buf.fillFrom(range(10, 0)); // 0..9
      expect(buf.size).toBe(5);
      expect(buf.toArray()).toEqual([5, 6, 7, 8, 9]);

      // works with generator iterable too
      function* gen() {
        yield* [100, 101, 102];
      }
      buf.clear();
      buf.fillFrom(gen());
      expect(buf.toArray()).toEqual([100, 101, 102]);
    });

    it("composes with subsequent pushes/dequeues correctly", () => {
      const buf = new CircularBuffer<number>(3);
      buf.fillFrom([1, 2, 3]); // full
      expect(buf.push(4)).toBe(1); // overwrite oldest
      expect(buf.toArray()).toEqual([2, 3, 4]);
      expect(buf.dequeue()).toBe(2);
      expect(buf.tryPush(5)).toBe(true);
      expect(buf.toArray()).toEqual([3, 4, 5]);
    });
  });
});
