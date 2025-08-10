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

// Circular buffer implementation with a fixed capacity.
export class CircularBuffer<T> implements Iterable<T> {
  private readonly capacity_: number;
  private readonly data: (T | undefined)[];
  private head: number = 0; // index of the oldest element
  private size_: number = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity_ = capacity;
    this.data = new Array<T | undefined>(capacity);
  }

  // Current number of elements in the buffer.
  get size(): number {
    return this.size_;
  }

  // Maximum number of elements the buffer can hold.
  get capacity(): number {
    return this.capacity_;
  }

  // Whether the buffer currently holds zero elements.
  get isEmpty(): boolean {
    return this.size_ === 0;
  }

  // Whether the buffer is at capacity.
  get isFull(): boolean {
    return this.size_ === this.capacity_;
  }

  // Remove all elements.
  clear(): void {
    // Do not reallocate; just drop references to help GC.
    for (let i = 0; i < this.size_; i++) {
      const idx = (this.head + i) % this.capacity_;
      this.data[idx] = undefined;
    }
    this.head = 0;
    this.size_ = 0;
  }

  // Push a value, overwriting the oldest element if the buffer is full.
  // Returns the overwritten element (if any).
  push(value: T): T | undefined {
    if (this.size_ < this.capacity_) {
      const tail = (this.head + this.size_) % this.capacity_;
      this.data[tail] = value;
      this.size_++;
      return undefined;
    } else {
      // Overwrite at head, then advance head
      const overwritten = this.data[this.head];
      this.data[this.head] = value;
      this.head = (this.head + 1) % this.capacity_;
      return overwritten;
    }
  }

  // Try to push a value. If the buffer is full, returns false and does not modify the buffer.
  // Otherwise stores the value and returns true.
  tryPush(value: T): boolean {
    if (this.isFull) return false;
    const tail = (this.head + this.size_) % this.capacity_;
    this.data[tail] = value;
    this.size_++;
    return true;
  }

  // Remove and return the oldest element. Returns undefined if empty.
  dequeue(): T | undefined {
    if (this.size_ === 0) return undefined;
    const value = this.data[this.head];
    // Help GC
    this.data[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity_;
    this.size_--;
    return value as T; // may be undefined only if T includes undefined
  }

  // Look at the oldest element without removing it. Returns undefined if empty.
  peek(): T | undefined {
    if (this.size_ === 0) return undefined;
    return this.data[this.head];
  }

  // Random access relative to the oldest element (0..size-1). Throws on out-of-range.
  at(i: number): T {
    if (!Number.isInteger(i)) throw new Error("index must be an integer");
    if (i < 0 || i >= this.size_) throw new Error("index out of range");
    const idx = (this.head + i) % this.capacity_;
    return this.data[idx] as T;
  }

  // Convert to a plain array ordered from oldest to newest.
  toArray(): T[] {
    const out = new Array<T>(this.size_);
    for (let i = 0; i < this.size_; i++) {
      const idx = (this.head + i) % this.capacity_;
      out[i] = this.data[idx] as T;
    }
    return out;
  }

  // Iterator: yields elements from oldest to newest.
  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.size_; i++) {
      const idx = (this.head + i) % this.capacity_;
      yield this.data[idx] as T;
    }
  }

  // Efficiently fill from an iterable. If more than capacity values are provided,
  // onthely the newest `capacity` values remain (oldest are dropped), matching `push` semantics.
  fillFrom(iterable: Iterable<T>): void {
    for (const v of iterable) this.push(v);
  }
}
