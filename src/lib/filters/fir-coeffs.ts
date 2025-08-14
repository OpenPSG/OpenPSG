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

export interface LowpassParams {
  Fs: number; // sample rate
  Fc: number; // cutoff
  order: number; // filter order (number of taps - 1), length = order + 1
}

export interface BandParams {
  Fs: number;
  order: number;
  F1: number; // lower cutoff
  F2: number; // upper cutoff
}

export interface KaiserBandParams {
  Fs: number;
  Fa: number; // lower band edge
  Fb: number; // upper band edge
  order?: number; // defaults to 51 (and will be made odd internally)
  Att?: number; // desired attenuation in dB (default 100)
}

export class FIRCoeffs {
  // --- Private static helpers ---

  private static calcKImpulseResponse(params: KaiserBandParams): number[] {
    const { Fs, Fa, Fb, Att: alpha = 100 } = params;
    let order = params.order ?? 51;

    const ino = (val: number): number => {
      let d = 0;
      let ds = 1;
      let s = 1;
      while (ds > s * 1e-6) {
        d += 2;
        ds *= (val * val) / (d * d);
        s += ds;
      }
      return s;
    };

    // ensure odd order
    if (order / 2 - Math.floor(order / 2) === 0) {
      order++;
    }

    const Np = (order - 1) / 2;
    const A: number[] = [];
    let beta = 0;

    A[0] = (2 * (Fb - Fa)) / Fs;
    for (let cnt = 1; cnt <= Np; cnt++) {
      A[cnt] =
        (Math.sin((2 * cnt * Math.PI * Fb) / Fs) -
          Math.sin((2 * cnt * Math.PI * Fa) / Fs)) /
        (cnt * Math.PI);
    }

    if (alpha < 21) {
      beta = 0;
    } else if (alpha > 50) {
      beta = 0.1102 * (alpha - 8.7);
    } else {
      beta = 0.5842 * Math.pow(alpha - 21, 0.4) + 0.07886 * (alpha - 21);
    }

    const inoBeta = ino(beta);
    const ret: number[] = new Array(order);

    for (let cnt = 0; cnt <= Np; cnt++) {
      const taper =
        ino(beta * Math.sqrt(1 - (cnt * cnt) / (Np * Np))) / inoBeta;
      ret[Np + cnt] = A[cnt] * taper;
    }
    for (let cnt = 0; cnt < Np; cnt++) {
      ret[cnt] = ret[order - 1 - cnt];
    }

    return ret;
  }

  private static calcImpulseResponse(params: LowpassParams): number[] {
    const { Fs, Fc, order } = params;
    const omega = (2 * Math.PI * Fc) / Fs;

    const ret: number[] = new Array(order + 1);
    let dc = 0;

    for (let n = 0; n <= order; n++) {
      const k = n - order / 2;
      if (k === 0) {
        ret[n] = omega;
      } else {
        ret[n] = Math.sin(omega * k) / k;
        ret[n] *= 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / order);
      }
      dc += ret[n];
    }

    for (let n = 0; n <= order; n++) {
      ret[n] /= dc;
    }
    return ret;
  }

  private static invert(h: number[]): number[] {
    const out = h.slice();
    for (let i = 0; i < out.length; i++) out[i] = -out[i];
    out[(out.length - 1) / 2] += 1;
    return out;
  }

  private static bs(params: BandParams): number[] {
    const lp = FIRCoeffs.calcImpulseResponse({
      order: params.order,
      Fs: params.Fs,
      Fc: params.F2,
    });
    const hp = FIRCoeffs.invert(
      FIRCoeffs.calcImpulseResponse({
        order: params.order,
        Fs: params.Fs,
        Fc: params.F1,
      }),
    );
    const out: number[] = new Array(lp.length);
    for (let i = 0; i < lp.length; i++) out[i] = lp[i] + hp[i];
    return out;
  }

  public static lowpass(params: LowpassParams): number[] {
    return FIRCoeffs.calcImpulseResponse(params);
  }

  public static highpass(params: LowpassParams): number[] {
    return FIRCoeffs.invert(FIRCoeffs.calcImpulseResponse(params));
  }

  public static bandstop(params: BandParams): number[] {
    return FIRCoeffs.bs(params);
  }

  public static bandpass(params: BandParams): number[] {
    return FIRCoeffs.invert(FIRCoeffs.bs(params));
  }

  public static kbFilter(params: KaiserBandParams): number[] {
    return FIRCoeffs.calcKImpulseResponse(params);
  }
}
