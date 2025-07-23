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

import type { Driver } from "./driver";
import { WT9011Driver } from "./wt9011";
import { GenericHRDriver } from "./generic-hr";

type DriverConstructor = {
  new (service: BluetoothRemoteGATTService): Driver;
  uuid: string;
  label?: string;
};

const drivers: DriverConstructor[] = [WT9011Driver, GenericHRDriver];

export const DriverRegistry = {
  getSupportedUUIDs(): string[] {
    return drivers.map((D) => D.uuid);
  },

  async scanForSupportedDevice(): Promise<BluetoothRemoteGATTService> {
    const filters = drivers.map((D) => ({
      services: [D.uuid],
    }));

    const device = await navigator.bluetooth.requestDevice({ filters });
    if (!device) throw new Error("No device selected");

    const server = await device.gatt?.connect();
    if (!server) throw new Error("Failed to connect to GATT server");

    const services = await server.getPrimaryServices();
    const supported = services.find((s) =>
      drivers.some((D) => D.uuid === s.uuid),
    );

    if (!supported) throw new Error("No supported service found on the device");
    return supported;
  },

  createDriverForService(service: BluetoothRemoteGATTService): Driver {
    const Ctor = drivers.find((D) => D.uuid === service.uuid);
    if (!Ctor)
      throw new Error(`No driver registered for UUID: ${service.uuid}`);
    return new Ctor(service);
  },

  listDrivers(): { uuid: string; label: string }[] {
    return drivers.map((D) => ({
      uuid: D.uuid,
      label: D.label ?? D.name,
    }));
  },
};
