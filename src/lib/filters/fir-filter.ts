/* Originally from: https://github.com/markert/fili.js
 *
 * Copyright (c) 2014 Florian Markert
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { runMultiFilter, runMultiFilterReverse, evaluatePhase } from "./utils";
import type { ExtendedFrequencyResponse } from "./utils";
import { Complex } from "./complex";

interface ResponseParams {
  Fs: number; // sample rate
  Fr: number; // frequency bin
}

type State = {
  buf: number[];
  pointer: number;
};

export class FIRFilter {
  private readonly f: number[]; // real FIR taps
  private readonly b: Complex[]; // same taps as Complex (im=0)
  private z: State; // rolling state buffer

  constructor(filter: number[]) {
    this.f = filter.slice();
    this.b = this.f.map((coeff) => new Complex(coeff, 0));
    this.z = this.initZero(this.f.length - 1);
  }

  private initZero(cnt: number): State {
    return { buf: Array(cnt).fill(0), pointer: 0 };
  }

  private doStep(input: number, d: State): number {
    if (d.buf.length === 0) return this.f.length ? input * this.f[0] : 0;

    d.buf[d.pointer] = input;

    let out = 0;
    const len = d.buf.length;

    // Note: matches original implementation summing f[0..len-1]
    for (let i = 0; i < len; i++) {
      out += this.f[i] * d.buf[(d.pointer + i) % len];
    }

    d.pointer = (d.pointer + 1) % len;
    return out;
  }

  // Wrapper to comply with runMultiFilter<T>(..., filter: T[], doStep: (x, T[]) => ...)
  private doStepWrapped = (input: number, stateArr: State[]): number =>
    this.doStep(input, stateArr[0]);

  private calcInputResponse(input: number[]): number[] {
    // Use a fresh zeroed state for a pure simulation
    const temp = this.initZero(this.f.length - 1);
    return runMultiFilter(input, [temp], this.doStepWrapped);
  }

  private calcResponse(params: ResponseParams): ExtendedFrequencyResponse {
    const { Fs, Fr } = params;
    // z = exp(j*theta), theta = -2*pi*Fr/Fs
    const theta = (-2 * Math.PI * Fr) / Fs;

    let h = new Complex(0, 0);

    const upTo = Math.max(0, this.f.length - 1);
    for (let i = 0; i < upTo; i++) {
      const zi = new Complex(Math.cos(theta * i), Math.sin(theta * i));
      h = h.add(this.b[i].mul(zi));
    }

    const mag = h.magnitude();
    return {
      magnitude: mag,
      phase: h.phase(),
      dBmagnitude: 20 * Math.log10(mag),
    };
  }

  public responsePoint(params: ResponseParams): ExtendedFrequencyResponse {
    return this.calcResponse(params);
  }

  public response(resolution = 100): ExtendedFrequencyResponse[] {
    const r = resolution * 2;
    const res = Array.from({ length: resolution }, (_, i) =>
      this.calcResponse({ Fs: r, Fr: i }),
    );
    evaluatePhase(res);
    return res;
  }

  public simulate(input: number[]): number[] {
    return this.calcInputResponse(input);
  }

  public singleStep(input: number): number {
    return this.doStep(input, this.z);
  }

  public multiStep(input: number[], overwrite = false): number[] {
    return runMultiFilter(input, [this.z], this.doStepWrapped, overwrite);
  }

  public filtfilt(input: number[], overwrite = false): number[] {
    const forward = runMultiFilter(
      input,
      [this.z],
      this.doStepWrapped,
      overwrite,
    );
    return runMultiFilterReverse(forward, [this.z], this.doStepWrapped, true);
  }

  public reinit(): void {
    this.z = this.initZero(this.f.length - 1);
  }
}
