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
import { lttb } from "./lttb";
import type { Values } from "@/lib/types";

describe("lttb", () => {
  const generateLinearSeries = (length: number): Values => {
    return {
      timestamps: Array.from({ length }, (_, i) => i * 1000),
      values: Array.from({ length }, (_, i) => i),
    };
  };

  it("should return the same values if n >= length", () => {
    const values = generateLinearSeries(10);
    const result = lttb(values, 10);
    expect(result).toEqual(values);
  });

  it("should return the same values if n < 3", () => {
    const values = generateLinearSeries(10);
    const result = lttb(values, 2);
    expect(result).toEqual(values);
  });

  it("should reduce the number of points to n", () => {
    const values = generateLinearSeries(100);
    const n = 10;
    const result = lttb(values, n);
    expect(result.timestamps).toHaveLength(n);
    expect(result.values).toHaveLength(n);
  });

  it("should always include the first and last point", () => {
    const values = generateLinearSeries(50);
    const result = lttb(values, 5);
    expect(result.timestamps[0]).toBe(values.timestamps[0]);
    expect(result.timestamps[result.timestamps.length - 1]).toBe(
      values.timestamps[values.timestamps.length - 1],
    );
  });

  it("should preserve shape — detect peak", () => {
    const values: Values = {
      timestamps: [0, 1, 2, 3, 4, 5],
      values: [0, 1, 10, 1, 0, -1], // Peak at index 2
    };
    const result = lttb(values, 4);
    expect(result.values).toContain(10); // peak must be preserved
  });

  it("should preserve shape — detect valley", () => {
    const values: Values = {
      timestamps: [0, 1, 2, 3, 4, 5],
      values: [10, 9, 0, 9, 10, 11], // Valley at index 2
    };
    const result = lttb(values, 4);
    expect(result.values).toContain(0); // valley must be preserved
  });

  it("should return increasing timestamps", () => {
    const values = generateLinearSeries(30);
    const result = lttb(values, 10);
    const sorted = [...result.timestamps].sort((a, b) => a - b);
    expect(result.timestamps).toEqual(sorted); // timestamps should stay sorted
  });
});
