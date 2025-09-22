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
import type { Values } from "@/lib/types";
import { INT16_MIN, INT16_MAX } from "@/lib/constants";
import type { Driver, ConfigField, ConfigValue } from "./driver";

interface Measurement {
  timestamp: Date;
  temperature: number; // degrees Celsius
}

const STALE_MS = 60_000; // 60 seconds

export class GenericTemperatureDriver implements Driver {
  private service: BluetoothRemoteGATTService;
  private tempChar?: BluetoothRemoteGATTCharacteristic;
  private measurementQueue?: Channel<Measurement>;
  private lastTemp?: number;
  private lastSampleAt?: number; // ms since epoch of last real sensor sample

  private name = "Temp";

  static uuid = "0000181a-0000-1000-8000-00805f9b34fb"; // Environmental Sensing

  static scanFilters: BluetoothLEScanFilter[] = [
    { services: [GenericTemperatureDriver.uuid] },
  ];

  configSchema: ConfigField[] = [
    {
      name: "name",
      label: "Name",
      type: "text",
      defaultValue: "Temp",
      required: true,
      maxLength: 16,
    },
  ];

  constructor(service: BluetoothRemoteGATTService) {
    this.service = service;
    this.measurementQueue = new Channel<Measurement>();
  }

  async configure(config: Record<string, ConfigValue>): Promise<void> {
    this.name = String(config.name ?? "Temp");
    await this.bindAndSubscribe(this.service);
  }

  async onReconnect(service: BluetoothRemoteGATTService): Promise<void> {
    this.service = service;
    await this.bindAndSubscribe(service);
  }

  async close(): Promise<void> {
    try {
      await this.tempChar?.stopNotifications();
    } catch {
      /* ignore */
    }
    this.measurementQueue?.close();
    this.lastTemp = undefined;
    this.lastSampleAt = undefined;
  }

  signals(recordDuration: number): EDFSignal[] {
    return [
      {
        label: `${this.name}`,
        transducerType: "THERM",
        physicalDimension: "degC",
        physicalMin: -50,
        physicalMax: 150,
        digitalMin: INT16_MIN,
        digitalMax: INT16_MAX,
        prefiltering: "",
        samplesPerRecord: recordDuration, // 1 Hz
      },
    ];
  }

  async *values(): AsyncIterable<Values> {
    if (!this.measurementQueue) {
      throw new Error("Measurement queue is not initialized");
    }

    const it = this.measurementQueue[Symbol.asyncIterator]();

    while (true) {
      // Race: next BLE sample vs. sample timeout
      const nextItem = it.next().then((r) => (r.done ? undefined : r.value));
      const timeout = new Promise<Measurement | undefined>((resolve) =>
        setTimeout(() => resolve(undefined), 1000),
      );

      const measurement = await Promise.race([nextItem, timeout]);

      if (measurement) {
        this.lastTemp = measurement.temperature;
        this.lastSampleAt = measurement.timestamp.getTime();
        yield [
          { timestamp: measurement.timestamp, value: measurement.temperature },
        ];
      } else {
        // Only emit a keep-alive sample if it's not stale (>60s old)
        if (
          this.lastTemp != null &&
          this.lastSampleAt != null &&
          Date.now() - this.lastSampleAt <= STALE_MS
        ) {
          yield [{ timestamp: new Date(), value: this.lastTemp }];
        }
        // Otherwise, suppress output until a fresh sample arrives.
      }
    }
  }

  private async bindAndSubscribe(service: BluetoothRemoteGATTService) {
    // Temperature (0x2A6E)
    this.tempChar = await service.getCharacteristic(
      "00002a6e-0000-1000-8000-00805f9b34fb",
    );
    if (!this.tempChar) {
      throw new Error("Temperature characteristic not found");
    }

    // Ensure we don't double-register the listener
    this.tempChar.removeEventListener(
      "characteristicvaluechanged",
      this.handleNotification as EventListener,
    );

    await this.tempChar.startNotifications();

    this.tempChar.addEventListener(
      "characteristicvaluechanged",
      this.handleNotification as EventListener,
    );

    // Prime with an immediate read
    try {
      const dv = await this.tempChar.readValue?.();
      if (dv instanceof DataView) {
        const temperature = this.decodeTemperature(dv);
        this.lastTemp = temperature;
        this.lastSampleAt = Date.now();
        this.measurementQueue?.push({
          timestamp: new Date(),
          temperature,
        });
      } else {
        // Some stacks don't support readValue while notifications are active; non-fatal.
      }
    } catch {
      // Non-fatal: notifications will deliver data soon.
    }
  }

  private handleNotification = (event: Event): void => {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = char.value;
    if (!dv) return;

    const temperature = this.decodeTemperature(dv);

    this.lastTemp = temperature;
    this.lastSampleAt = Date.now();
    this.measurementQueue?.push({
      timestamp: new Date(),
      temperature,
    });
  };

  // ESS Temperature (0x2A6E): sint16, little-endian, resolution 0.01 °C
  private decodeTemperature(dv: DataView): number {
    const raw = dv.getInt16(0, true);
    return raw / 100;
  }
}
