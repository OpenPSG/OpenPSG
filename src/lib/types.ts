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

export interface Value {
  timestamp: number; // ms since epoch
  value: number;
}

// We use this type to represent a collection of values with their timestamps
// We don't use a Value[] array here so we can reduce garbage collection overhead
export interface Values {
  timestamps: number[]; // ms since epoch
  values: number[];
}
