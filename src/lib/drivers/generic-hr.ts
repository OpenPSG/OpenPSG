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

import Channel from "@/lib/sync/channel";
import type { EDFSignal } from "@/lib/edf/edftypes";
import type { Value } from "@/lib/types";
import { INT16_MIN, INT16_MAX } from "@/lib/constants";
import { deriveHRV } from "../derivations/hrv";
import type { Driver, ConfigField, ConfigValue } from "./driver";

export interface Measurement {
  timestamp: number; // ms since epoch
  heartRate: number;
  sensorContact?: "detected" | "not detected";
  energyExpended?: number;
  rrIntervals?: number[];
}

export class GenericHRDriver implements Driver {
  private service: BluetoothRemoteGATTService;
  private notifyChar?: BluetoothRemoteGATTCharacteristic;
  private measurementQueue?: Channel<Measurement>;

  private hrvEnabled = false;
  private hrvWindow?: number;

  static uuid = "0000180d-0000-1000-8000-00805f9b34fb";

  configSchema: ConfigField[] = [
    {
      name: "hrv",
      label: "Enable HRV",
      type: "boolean",
      defaultValue: false,
    },
    {
      name: "hrvWindow",
      label: "HRV Window Size",
      type: "number",
      defaultValue: 30,
      visibleIf: [{ conditions: [{ field: "hrv", value: true }] }],
      description: "Number of RR-intervals to use for RMSSD HRV calculation.",
    },
  ];

  constructor(service: BluetoothRemoteGATTService) {
    this.service = service;
    this.measurementQueue = new Channel<Measurement>();
  }

  async configure(config: Record<string, ConfigValue>): Promise<void> {
    if (config.hrv === true) {
      this.hrvEnabled = true;
      this.hrvWindow = Number(config.hrvWindow);
    }

    this.notifyChar = await this.service.getCharacteristic(
      "00002a37-0000-1000-8000-00805f9b34fb",
    );

    await this.notifyChar.startNotifications();
    this.notifyChar.addEventListener(
      "characteristicvaluechanged",
      this.handleNotification.bind(this),
    );
  }

  async close(): Promise<void> {
    try {
      await this.notifyChar?.stopNotifications();
    } catch (err) {
      console.warn("Failed to stop notifications:", err);
    }
    this.service.device.gatt?.disconnect();
    this.measurementQueue?.close();
  }

  signals(recordDuration: number): EDFSignal[] {
    const signals: EDFSignal[] = [
      {
        label: "HR",
        transducerType: "ECG",
        physicalDimension: "bpm",
        physicalMin: 0,
        physicalMax: 240,
        digitalMin: INT16_MIN,
        digitalMax: INT16_MAX,
        prefiltering: "",
        samplesPerRecord: recordDuration, // 1Hz
      },
    ];

    if (this.hrvEnabled) {
      signals.push({
        label: "HRV",
        transducerType: "ECG",
        physicalDimension: "ms",
        physicalMin: 0,
        physicalMax: 500,
        digitalMin: INT16_MIN,
        digitalMax: INT16_MAX,
        prefiltering: "LP:0.02Hz",
        samplesPerRecord: recordDuration,
      });
    }

    return signals;
  }

  async *values(): AsyncIterable<Value[]> {
    if (!this.measurementQueue) {
      throw new Error("Measurement queue is not initialized");
    }

    if (!this.hrvEnabled) {
      for await (const measurement of this.measurementQueue) {
        yield [
          { timestamp: measurement.timestamp, value: measurement.heartRate },
        ];
      }
    } else {
      for await (const { timestamp, heartRate, hrv } of deriveHRV(
        this.measurementQueue,
        this.hrvWindow,
      )) {
        yield [
          { timestamp, value: heartRate },
          { timestamp, value: hrv ?? 0 },
        ];
      }
    }
  }

  private handleNotification(event: Event): void {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const dataView = char.value;
    if (!dataView) return;

    const flags = dataView.getUint8(0);
    const isHeartRate16Bit = (flags & 0x01) !== 0;
    const sensorContactSupported = (flags & 0x02) !== 0;
    const sensorContactDetected = (flags & 0x04) !== 0;
    const energyExpendedPresent = (flags & 0x08) !== 0;
    const rrIntervalsPresent = (flags & 0x10) !== 0;

    let offset = 1;
    let heartRate: number;

    if (isHeartRate16Bit) {
      heartRate = dataView.getUint16(offset, true);
      offset += 2;
    } else {
      heartRate = dataView.getUint8(offset);
      offset += 1;
    }

    const sensorContact: Measurement["sensorContact"] = sensorContactSupported
      ? sensorContactDetected
        ? "detected"
        : "not detected"
      : undefined;

    let energyExpended: number | undefined;
    if (energyExpendedPresent) {
      energyExpended = dataView.getUint16(offset, true);
      offset += 2;
    }

    let rrIntervals: number[] | undefined;
    if (rrIntervalsPresent) {
      rrIntervals = [];
      while (offset + 1 < dataView.byteLength) {
        const rr = dataView.getUint16(offset, true) / 1024;
        rrIntervals.push(rr);
        offset += 2;
      }
    }

    const measurement: Measurement = {
      timestamp: Date.now(),
      heartRate,
      sensorContact,
      ...(energyExpended !== undefined && { energyExpended }),
      ...(rrIntervals && rrIntervals.length > 0 && { rrIntervals }),
    };

    this.measurementQueue?.push(measurement);
  }
}
