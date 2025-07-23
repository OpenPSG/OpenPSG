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

export type EDFVersion = "0";

export interface EDFHeader {
  version?: EDFVersion;
  patientId: string;
  recordingId: string;
  startTime: Date;
  headerBytes?: number;
  reserved?: string;
  dataRecords: number;
  recordDuration: number;
  signalCount: number;
  signals: EDFSignal[];
}

export interface EDFSignal {
  label: string;
  transducerType: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
  reserved?: string;
}

export interface EDFAnnotation {
  onset: number;
  duration?: number;
  annotation: string;
}
