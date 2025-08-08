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

export default class Channel<T> {
  private queue: T[] = [];
  private resolvers: ((value: T) => void)[] = [];
  private rejecters: ((reason?: Error) => void)[] = [];
  private controller = new AbortController();
  private error: Error = new Error("Queue closed");

  push(item: T) {
    if (this.controller.signal.aborted) {
      throw new Error("Queue is closed");
    }

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      this.rejecters.shift(); // Discard rejecter
      resolve(item);
    } else {
      this.queue.push(item);
    }
  }

  close(error = new Error("Queue closed")) {
    this.error = error;
    this.controller.abort();

    // Reject all pending promises
    for (const reject of this.rejecters) {
      reject(error);
    }

    this.resolvers = [];
    this.rejecters = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const signal = this.controller.signal;

    while (true) {
      if (signal.aborted) {
        throw this.error;
      }

      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        const item = await new Promise<T>((resolve, reject) => {
          const onAbort = () => reject(this.error);

          signal.addEventListener("abort", onAbort, { once: true });

          this.resolvers.push((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          });

          this.rejecters.push((err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          });
        });

        yield item;
      }
    }
  }
}
