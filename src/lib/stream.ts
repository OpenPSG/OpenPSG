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

export const MemoryWritableStream = (): {
  writer: WritableStreamDefaultWriter<Uint8Array> & {
    seek: (position: number) => Promise<void>;
  };
  getBuffer: () => Promise<Uint8Array>;
} => {
  let buffer = new Uint8Array(1024);
  let position = 0;
  let maxWritten = 0;

  const ensureCapacity = (requiredLength: number) => {
    if (buffer.length >= requiredLength) return;

    let newLength = buffer.length;
    while (newLength < requiredLength) {
      newLength *= 2;
    }

    const newBuffer = new Uint8Array(newLength);
    newBuffer.set(buffer);
    buffer = newBuffer;
  };

  const stream = new WritableStream<Uint8Array>({
    async write(chunk) {
      const requiredLength = position + chunk.length;
      ensureCapacity(requiredLength);

      buffer.set(chunk, position);
      position += chunk.length;
      maxWritten = Math.max(maxWritten, position);
    },
    close() {
      // no-op
    },
  });

  const writer =
    stream.getWriter() as WritableStreamDefaultWriter<Uint8Array> & {
      seek: (position: number) => Promise<void>;
    };

  writer.seek = async (newPosition: number) => {
    if (newPosition < 0) {
      throw new RangeError();
    }
    position = newPosition;
  };

  return {
    writer,
    async getBuffer() {
      return buffer.slice(0, maxWritten);
    },
  };
};
