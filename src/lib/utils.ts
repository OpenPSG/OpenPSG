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

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const uniqueFilename = (ext: string, deviceName?: string): string => {
  const pad = (n: number) => n.toString().padStart(2, "0");

  const now = new Date();
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;

  const devicePart = deviceName ? `_${deviceName.replace(/\s+/g, "_")}` : "";
  return `${datePart}${devicePart}.${ext}`;
};

export const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const checkWebBluetoothSupport = () => {
  if (navigator.bluetooth === undefined) {
    throw new Error(
      "Web Bluetooth is not supported in this browser. On Linux you must enable Web Bluetooth with chrome://flags/#enable-web-bluetooth.",
    );
  }
};

export const acquireWakeLock = async (): Promise<
  WakeLockSentinel | undefined
> => {
  if ("wakeLock" in navigator) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (navigator as any).wakeLock.request("screen");
    } catch (err) {
      console.warn("Failed to acquire wake lock:", err);
    }
  }
};

export const releaseWakeLock = async (lock: WakeLockSentinel | undefined) => {
  try {
    await lock?.release();
  } catch (err) {
    console.warn("Failed to release wake lock:", err);
  }
};
