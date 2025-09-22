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
import { GenericHRDriver } from "./generic-hr";
import { GenericTemperatureDriver } from "./generic-temp";
import { WitMotionIMUDriver } from "./witmotion";
import { wait, nextBackoffMs } from "@/lib/utils";

type DriverConstructor = {
  new (service: BluetoothRemoteGATTService): Driver;
  uuid: string;
  scanFilters: BluetoothLEScanFilter[];
};

const drivers: DriverConstructor[] = [
  GenericHRDriver,
  GenericTemperatureDriver,
  WitMotionIMUDriver,
];

export const DriverRegistry = {
  async scanForSupportedDevice(): Promise<BluetoothRemoteGATTService> {
    console.debug("[DriverRegistry] Starting BLE scan…");
    const filters = drivers.flatMap((D) => D.scanFilters);

    const device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: drivers.map((D) => D.uuid),
    });
    if (!device) throw new Error("No device selected");
    console.debug(
      "[DriverRegistry] Device selected:",
      device.name ?? "(unnamed)",
    );

    const server = await device.gatt?.connect();
    if (!server) throw new Error("Failed to connect to GATT server");
    console.debug("[DriverRegistry] GATT server connected for", device.name);

    const services = await server.getPrimaryServices();
    console.debug(
      "[DriverRegistry] Primary services discovered:",
      services.map((s) => s.uuid),
    );

    const supported = services.find((s) =>
      drivers.some((D) => D.uuid === s.uuid),
    );
    if (!supported) throw new Error("No supported service found on the device");

    console.debug("[DriverRegistry] Using supported service:", supported.uuid);
    return supported;
  },

  createDriverForService(service: BluetoothRemoteGATTService): Driver {
    console.debug(
      "[DriverRegistry] Creating driver for service:",
      service.uuid,
    );
    const Ctor = drivers.find((D) => D.uuid === service.uuid);
    if (!Ctor)
      throw new Error(`No driver registered for UUID: ${service.uuid}`);

    const driver = new Ctor(service);
    this.attachAutoReconnect(driver, Ctor.uuid, service.device);
    return driver;
  },

  attachAutoReconnect(
    driver: Driver,
    primaryServiceUuid: string,
    device: BluetoothDevice,
  ) {
    console.debug(
      "[DriverRegistry] Auto-reconnect enabled for",
      device.name ?? "(unnamed)",
    );
    let reconnecting = false;
    let closed = false;
    const abort = new AbortController();

    const onDisconnect = async () => {
      if (closed || reconnecting) return;
      reconnecting = true;
      console.debug("[DriverRegistry] Device disconnected:", device.name);
      try {
        let attempt = 0;
        while (!closed && !abort.signal.aborted) {
          try {
            console.debug(
              `[DriverRegistry] Reconnect attempt #${attempt + 1} to`,
              device.name,
            );
            const server = await device.gatt?.connect();
            if (!server || !server.connected)
              throw new Error("GATT connect failed");

            const freshService =
              await server.getPrimaryService(primaryServiceUuid);
            console.debug(
              "[DriverRegistry] Reconnected and got fresh service:",
              freshService.uuid,
            );

            await driver.onReconnect?.(freshService);
            console.debug("[DriverRegistry] Driver onReconnect complete");
            break;
          } catch (err) {
            const delay = nextBackoffMs(attempt++, {
              baseMs: 1000,
              maxMs: 30000,
            });
            console.debug(
              `[DriverRegistry] Reconnect failed (${(err as Error).message}), retrying in ${delay} ms`,
            );
            await wait(delay);
          }
        }
      } finally {
        reconnecting = false;
      }
    };

    device.addEventListener("gattserverdisconnected", onDisconnect, {
      passive: true,
    });

    // Ensure driver.close() also disables reconnects and cleans up
    const originalClose = driver.close.bind(driver);
    driver.close = async () => {
      console.debug(
        "[DriverRegistry] Closing driver and cancelling auto-reconnect for",
        device.name,
      );
      closed = true;
      abort.abort();
      try {
        device.removeEventListener(
          "gattserverdisconnected",
          onDisconnect as EventListener,
        );
      } catch {
        /* ignore */
      }
      try {
        device.gatt?.disconnect();
      } catch {
        /* ignore */
      }
      await originalClose();
    };
  },
};
