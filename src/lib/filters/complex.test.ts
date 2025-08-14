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
import { Complex } from "./complex";

const EPS = 1e-12;
const close = (a: number, b: number, eps = EPS) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

// Normalize angle to (-π, π]
const normalizeAngle = (x: number) => {
  const TWO_PI = 2 * Math.PI;
  x = (((x + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI; // [0, 2π)
  return x - Math.PI; // (-π, π]
};

describe("Complex", () => {
  it("constructs with default imaginary part 0", () => {
    const z = new Complex(3);
    expect(z.re).toBe(3);
    expect(z.im).toBe(0);
  });

  it("fromPolar creates the expected cartesian components", () => {
    const r = 5;
    const theta = Math.PI / 3;
    const z = Complex.fromPolar(r, theta);
    close(z.re, r * Math.cos(theta));
    close(z.im, r * Math.sin(theta));
  });

  it("add, sub work as expected", () => {
    const a = new Complex(1, 2);
    const b = new Complex(3, -4);
    const sum = a.add(b);
    const diff = a.sub(b);

    expect(sum.re).toBe(4);
    expect(sum.im).toBe(-2);

    expect(diff.re).toBe(-2);
    expect(diff.im).toBe(6);
  });

  it("mul handles general case and i*i = -1", () => {
    const a = new Complex(1, 2);
    const b = new Complex(3, 4);
    const prod = a.mul(b);
    expect(prod.re).toBe(-5); // 1*3 - 2*4
    expect(prod.im).toBe(10); // 1*4 + 2*3

    const i = new Complex(0, 1);
    const ii = i.mul(i);
    expect(ii.re).toBe(-1);
    expect(ii.im).toBe(0);
  });

  it("div matches analytic result for nonzero denominator", () => {
    const a = new Complex(1, 2);
    const b = new Complex(3, 4);
    const q = a.div(b);
    close(q.re, 11 / 25); // 0.44
    close(q.im, 2 / 25); // 0.08
  });

  it("conj negates the imaginary part", () => {
    const a = new Complex(7, -9);
    const c = a.conj();
    expect(c.re).toBe(7);
    expect(c.im).toBe(9);
  });

  it("magnitude is hypot(re, im)", () => {
    const a = new Complex(3, 4);
    expect(a.magnitude()).toBe(5);
  });

  it("phase uses atan2(im, re) with expected quadrants", () => {
    close(new Complex(1, 0).phase(), 0);
    close(new Complex(0, 1).phase(), Math.PI / 2);
    close(new Complex(-1, 0).phase(), Math.PI);
    close(new Complex(0, -1).phase(), -Math.PI / 2);
  });

  it("fromPolar round-trips magnitude and angle (mod 2π)", () => {
    const r = 2.5;
    const theta = -2.2; // some arbitrary angle
    const z = Complex.fromPolar(r, theta);

    close(z.magnitude(), r);

    const delta = normalizeAngle(z.phase() - theta);
    close(delta, 0, 1e-10);
  });

  it("toString formats with explicit sign on imaginary part", () => {
    expect(new Complex(3, 4).toString()).toBe("3 + 4i");
    expect(new Complex(3, -4).toString()).toBe("3 - 4i");
    expect(new Complex(-1.5, 0).toString()).toBe("-1.5 + 0i");
  });

  it("methods are immutable (do not mutate operands)", () => {
    const a = new Complex(1, 2);
    const b = new Complex(3, 4);

    const aCopy = new Complex(a.re, a.im);
    const bCopy = new Complex(b.re, b.im);

    // Call a bunch of methods
    a.add(b);
    a.sub(b);
    a.mul(b);
    a.div(b);
    a.conj();

    // Originals unchanged
    expect(a.re).toBe(aCopy.re);
    expect(a.im).toBe(aCopy.im);
    expect(b.re).toBe(bCopy.re);
    expect(b.im).toBe(bCopy.im);
  });

  it("respects algebraic distributivity: (a+b)*c = a*c + b*c", () => {
    const a = new Complex(1.2, -0.7);
    const b = new Complex(-2.3, 4.1);
    const c = new Complex(0.5, -3.2);

    const left = a.add(b).mul(c);
    const right = a.mul(c).add(b.mul(c));

    close(left.re, right.re, 1e-12);
    close(left.im, right.im, 1e-12);
  });
});
