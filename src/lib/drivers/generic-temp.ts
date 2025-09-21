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

export class GenericTemperatureDriver implements Driver {
  private service: BluetoothRemoteGATTService;
  private tempChar?: BluetoothRemoteGATTCharacteristic;
  private measurementQueue?: Channel<Measurement>;
  private lastTemp?: number;

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

    // Temperature (0x2A6E)
    this.tempChar = await this.service.getCharacteristic(
      "00002a6e-0000-1000-8000-00805f9b34fb",
    );
    if (!this.tempChar) {
      throw new Error("Temperature characteristic not found");
    }

    await this.tempChar.startNotifications();
    this.tempChar.addEventListener(
      "characteristicvaluechanged",
      this.handleNotification.bind(this),
    );

    // Immediately perform a read so we don't have to wait for the first notification
    try {
      const dv = await this.tempChar.readValue?.();
      if (dv instanceof DataView) {
        const temperature = this.decodeTemperature(dv);
        this.lastTemp = temperature;
        this.measurementQueue?.push({
          timestamp: new Date(),
          temperature,
        });
      } else {
        console.warn("readValue() not available or returned unexpected type");
      }
    } catch (e) {
      console.warn("Initial read failed (continuing with notifications)", e);
    }
  }

  async close(): Promise<void> {
    try {
      await this.tempChar?.stopNotifications();
    } catch {
      /* ignore */
    }
    this.service.device.gatt?.disconnect();
    this.measurementQueue?.close();
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
        samplesPerRecord: recordDuration, // 1Hz
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
        yield [
          { timestamp: measurement.timestamp, value: measurement.temperature },
        ];
      } else if (this.lastTemp != null) {
        // Ensure at least one sample per record duration, even if no new data arrived
        yield [{ timestamp: new Date(), value: this.lastTemp }];
      }
      // If we have no lastTemp yet and we timed out, just loop again until first sample arrives.
    }
  }

  private handleNotification(event: Event): void {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = char.value;
    if (!dv) return;

    const temperature = this.decodeTemperature(dv);

    this.lastTemp = temperature;
    this.measurementQueue?.push({
      timestamp: new Date(),
      temperature,
    });
  }

  // ESS Temperature (0x2A6E): sint16, little-endian, resolution 0.01 °C
  private decodeTemperature(dv: DataView): number {
    const raw = dv.getInt16(0, true);
    return raw / 100;
  }
}
