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

import { INT16_MIN, INT16_MAX } from "@/lib/constants";
import type { Driver, ConfigField, ConfigValue } from "./driver";
import type { EDFSignal } from "@/lib/edf/edftypes";
import Channel from "@/lib/sync/channel";
import { deriveBodyPosition } from "@/lib/derivations/body-position";
import { deriveMovement } from "@/lib/derivations/movement";
import type { Value } from "@/lib/types";

const Register = {
  /** Save the current configuration */
  Save: 0x00,
  /** Calibration */
  CalSW: 0x01,
  /** Return data rate */
  Rate: 0x03,
  /** Serial port baud rate */
  Baud: 0x04,
  /** X-axis acceleration zero bias */
  AXOffset: 0x05,
  /** Y-axis acceleration zero bias */
  AYOffset: 0x06,
  /** Z-axis acceleration zero bias */
  AZOffset: 0x07,
  /** X-axis angular velocity zero bias */
  GXOffset: 0x08,
  /** Y-axis angular velocity zero bias */
  GYOffset: 0x09,
  /** Z-axis angular velocity zero bias */
  GZOffset: 0x0a,
  /** X-axis magnetic field bias */
  HXOffset: 0x0b,
  /** Y-axis magnetic field bias */
  HYOffset: 0x0c,
  /** Z-axis magnetic field bias */
  HZOffset: 0x0d,
  /** D0 Mode */
  D0Mode: 0x0e,
  /** D1 Mode */
  D1Mode: 0x0f,
  /** D2 Mode */
  D2Mode: 0x10,
  /** D3 Mode */
  D3Mode: 0x11,
  /** Version Number */
  Version1: 0x2e,
  /** Version branch/hardware version */
  Version2: 0x2f,
  /** Year and month */
  YYMM: 0x30,
  /** Day and hour */
  DDH: 0x31,
  /** Minute and second */
  MMSS: 0x32,
  /** Millisecond */
  MS: 0x33,
  /** X-axis acceleration */
  AX: 0x34,
  /** Y-axis acceleration */
  AY: 0x35,
  /** Z-axis acceleration */
  AZ: 0x36,
  /** X-axis angular velocity */
  GX: 0x37,
  /** Y-axis angular velocity */
  GY: 0x38,
  /** Z-axis angular velocity */
  GZ: 0x39,
  /** X-axis magnetic field */
  HX: 0x3a,
  /** Y-axis magnetic field */
  HY: 0x3b,
  /** Z-axis magnetic field */
  HZ: 0x3c,
  /** Roll X-axis angle */
  Roll: 0x3d,
  /** Pitch Y-axis angle */
  Pitch: 0x3e,
  /** Yaw Z-axis angle */
  Yaw: 0x3f,
  /** Module temperature */
  Temp: 0x40,
  /** Four Elements Q0 */
  Q0: 0x51,
  /** Four Elements Q1 */
  Q1: 0x52,
  /** Four Elements Q2 */
  Q2: 0x53,
  /** Four Elements Q3 */
  Q3: 0x54,
  /** Power supply voltage */
  Power: 0x64,
  /** Unlock the device for modification */
  Unlock: 0x69,
  /** Output data format selection */
  AGPVSEL: 0x96,
} as const;

const RateMap: Record<number, number> = {
  0.2: 0x01,
  0.5: 0x02,
  1: 0x03,
  2: 0x04,
  5: 0x05,
  10: 0x06,
  20: 0x07,
  50: 0x08,
  100: 0x09,
  200: 0x0b,
};

export interface Measurement {
  timestamp: number; // ms since epoch
  acceleration: [number, number, number];
  angularVelocity: [number, number, number];
  angle: [number, number, number];
}

// WitMotion WT9011 IMU Driver
export class WT9011Driver implements Driver {
  private service: BluetoothRemoteGATTService;
  private writeChar?: BluetoothRemoteGATTCharacteristic;
  private notifyChar?: BluetoothRemoteGATTCharacteristic;
  private measurementQueue?: Channel<Measurement>;

  private name = "Body";
  private mode: "movement" | "position" | "raw" = "position";
  private sampleRate: number = 10;

  static uuid = "0000ffe5-0000-1000-8000-00805f9a34fb";

  configSchema: ConfigField[] = [
    {
      name: "name",
      label: "Name",
      type: "text",
      defaultValue: "Body",
      required: true,
      maxLength: 16,
    },
    {
      name: "mode",
      label: "Mode",
      type: "select",
      defaultValue: "position",
      required: true,
      options: [
        { value: "movement", label: "Movement" },
        { value: "position", label: "Position" },
        { value: "raw", label: "Raw (Advanced)" },
      ],
      description:
        "Movement mode is for detecting movement (eg. limbs), position mode is for tracking position (eg. torso), raw mode is for accessing raw sensor data.",
    },
    {
      name: "sampleRate",
      label: "Sample Rate",
      type: "select",
      defaultValue: "10",
      required: true,
      options: [
        { value: "1", label: "1 Hz" },
        { value: "2", label: "2 Hz" },
        { value: "5", label: "5 Hz" },
        { value: "10", label: "10 Hz" },
      ],
    },
  ] as const;

  constructor(service: BluetoothRemoteGATTService) {
    this.service = service;
    this.measurementQueue = new Channel<Measurement>();
  }

  async configure(config: Record<string, ConfigValue>) {
    this.name = String(config.name ?? "Body");
    this.mode = config.mode as "movement" | "position" | "raw";
    this.sampleRate = Number(config.sampleRate ?? 10);

    this.writeChar = await this.service.getCharacteristic(
      "0000ffe9-0000-1000-8000-00805f9a34fb",
    );
    this.notifyChar = await this.service.getCharacteristic(
      "0000ffe4-0000-1000-8000-00805f9a34fb",
    );

    await this.notifyChar.startNotifications();
    this.notifyChar.addEventListener(
      "characteristicvaluechanged",
      this.handleNotification.bind(this),
    );

    await this.unlock();
    await this.writeRegister(Register.Rate, RateMap[this.sampleRate] ?? 0x06);
    await this.save();
  }

  async close() {
    try {
      await this.notifyChar?.stopNotifications();
    } catch (err) {
      console.warn("Failed to stop notifications:", err);
    }
    this.service.device.gatt?.disconnect();
    this.measurementQueue?.close();
  }

  signals(recordDuration: number): EDFSignal[] {
    const samplesPerRecord = Math.floor(this.sampleRate * recordDuration);

    if (this.mode === "movement") {
      return [
        {
          label: `${this.name}`,
          transducerType: "MEMS IMU",
          physicalDimension: "g",
          physicalMin: 0,
          physicalMax: 16,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "HP:0.05Hz",
          samplesPerRecord,
        },
      ];
    } else if (this.mode === "position") {
      return [
        {
          label: `${this.name} Roll`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg",
          physicalMin: -180,
          physicalMax: 180,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Incl`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg",
          physicalMin: 0,
          physicalMax: 90,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
      ];
    } else {
      return [
        {
          label: `${this.name} Accel X`,
          transducerType: "MEMS IMU",
          physicalDimension: "g",
          physicalMin: -16,
          physicalMax: 16,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Accel Y`,
          transducerType: "MEMS IMU",
          physicalDimension: "g",
          physicalMin: -16,
          physicalMax: 16,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Accel Z`,
          transducerType: "MEMS IMU",
          physicalDimension: "g",
          physicalMin: -16,
          physicalMax: 16,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Gyro X`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg/s",
          physicalMin: -2000,
          physicalMax: 2000,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Gyro Y`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg/s",
          physicalMin: -2000,
          physicalMax: 2000,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Gyro Z`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg/s",
          physicalMin: -2000,
          physicalMax: 2000,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Angle X`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg",
          physicalMin: -180,
          physicalMax: 180,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Angle Y`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg",
          physicalMin: -180,
          physicalMax: 180,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
        {
          label: `${this.name} Angle Z`,
          transducerType: "MEMS IMU",
          physicalDimension: "deg",
          physicalMin: -180,
          physicalMax: 180,
          digitalMin: INT16_MIN,
          digitalMax: INT16_MAX,
          prefiltering: "",
          samplesPerRecord,
        },
      ];
    }
  }

  async *values(): AsyncIterable<Value[]> {
    if (!this.measurementQueue) {
      throw new Error("Measurement queue is not initialized");
    }

    if (this.mode === "movement") {
      for await (const { timestamp, magnitude } of deriveMovement(
        this.measurementQueue,
        this.sampleRate,
      )) {
        yield [{ timestamp, value: magnitude }];
      }
    } else if (this.mode === "position") {
      for await (const { timestamp, roll, inclination } of deriveBodyPosition(
        this.measurementQueue,
      )) {
        yield [
          { timestamp, value: roll },
          { timestamp, value: inclination },
        ];
      }
    } else {
      for await (const {
        timestamp,
        acceleration,
        angularVelocity,
        angle,
      } of this.measurementQueue) {
        yield [
          { timestamp, value: acceleration[0] },
          { timestamp, value: acceleration[1] },
          { timestamp, value: acceleration[2] },
          { timestamp, value: angularVelocity[0] },
          { timestamp, value: angularVelocity[1] },
          { timestamp, value: angularVelocity[2] },
          { timestamp, value: angle[0] },
          { timestamp, value: angle[1] },
          { timestamp, value: angle[2] },
        ];
      }
    }
  }

  private async writeRegister(reg: number, value: number): Promise<void> {
    await this.unlock();

    const cmd = new Uint8Array([0xff, 0xaa, reg, 0x00, 0x00]);
    cmd[3] = value & 0xff;
    cmd[4] = (value >> 8) & 0xff;

    await this.writeChar?.writeValue(cmd);
    await this.delay(100);

    await this.save();
  }

  private async unlock(): Promise<void> {
    const cmd = new Uint8Array([0xff, 0xaa, Register.Unlock, 0x88, 0xb5]);
    await this.writeChar?.writeValue(cmd);
    await this.delay(100);
  }

  private async save(): Promise<void> {
    const cmd = new Uint8Array([0xff, 0xaa, Register.Save, 0x00, 0x00]);
    await this.writeChar?.writeValue(cmd);
    await this.delay(100);
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private handleNotification(event: Event) {
    const round = (value: number, decimals: number) =>
      Number(value.toFixed(decimals));

    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const data = new Uint8Array(char.value!.buffer);
    if (data.length !== 20 || data[0] !== 0x55 || data[1] !== 0x61) return;

    const view = new DataView(data.buffer);
    const measurement: Measurement = {
      timestamp: Date.now(),
      acceleration: [
        round((view.getInt16(2, true) / 32768) * 16, 4),
        round((view.getInt16(4, true) / 32768) * 16, 4),
        round((view.getInt16(6, true) / 32768) * 16, 4),
      ],
      angularVelocity: [
        round((view.getInt16(8, true) / 32768) * 2000, 2),
        round((view.getInt16(10, true) / 32768) * 2000, 2),
        round((view.getInt16(12, true) / 32768) * 2000, 2),
      ],
      angle: [
        round((view.getInt16(14, true) / 32768) * 180, 3),
        round((view.getInt16(16, true) / 32768) * 180, 3),
        round((view.getInt16(18, true) / 32768) * 180, 3),
      ],
    };

    this.measurementQueue?.push(measurement);
  }
}
