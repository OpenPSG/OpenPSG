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

import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Values } from "@/lib/types";

export type ConfigValue = string | number | boolean | null;

export type FieldConditionGroup = {
  operator?: "AND" | "OR"; // default to AND
  conditions: {
    field: string;
    value: ConfigValue;
  }[];
};

export type ConfigField = {
  name: string;
  label: string;
  type: "number" | "text" | "select" | "boolean";
  defaultValue?: ConfigValue;
  options?: { value: string; label: string }[];
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  description?: string;
  visibleIf?: FieldConditionGroup[];
};

export interface Driver {
  configSchema?: readonly ConfigField[];
  configure?(config: Record<string, ConfigValue>): void;
  close(): Promise<void>;
  signals(recordDuration: number): EDFSignal[];
  values(): AsyncIterable<Values>;
}
