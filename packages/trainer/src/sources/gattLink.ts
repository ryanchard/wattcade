import type { ControlPointTransport } from '../ftms/controlPointWriter.js';
import type { Unsubscribe } from '../types.js';
import {
  BATTERY_SERVICE,
  CYCLING_POWER_SERVICE,
  CYCLING_SPEED_CADENCE_SERVICE,
  DEVICE_INFORMATION_SERVICE,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
} from '../ftms/uuids.js';

export interface GattLink {
  deviceName: string | null;
  startNotifications(): Promise<void>;
  onIndoorBikeData(fn: (view: DataView) => void): Unsubscribe;
  controlPoint: ControlPointTransport | null;
  onDisconnect(fn: () => void): Unsubscribe;
  disconnect(): Promise<void>;
}

export type GattConnector = () => Promise<GattLink>;

export const OPTIONAL_SERVICES = [
  CYCLING_POWER_SERVICE,
  CYCLING_SPEED_CADENCE_SERVICE,
  HEART_RATE_SERVICE,
  DEVICE_INFORMATION_SERVICE,
  BATTERY_SERVICE,
];

/**
 * The only code in the project that touches navigator.bluetooth.
 * Must be invoked from a user gesture.
 */
export function createWebBluetoothConnector(): GattConnector {
  return async () => {
    if (!('bluetooth' in navigator)) {
      throw new Error(
        'Web Bluetooth is not available. Use Chrome or Edge on desktop or Android.',
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FITNESS_MACHINE_SERVICE] }],
      optionalServices: OPTIONAL_SERVICES,
    });

    const server = await device.gatt!.connect();
    const ftms = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);
    const bikeData = await ftms.getCharacteristic(INDOOR_BIKE_DATA);

    let control: ControlPointTransport | null = null;
    try {
      const cp = await ftms.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT);
      await cp.startNotifications();
      control = {
        async write(data) {
          // Re-wrap: TS's DOM lib requires BufferSource to be backed by a
          // concrete ArrayBuffer, while ControlPointTransport's Uint8Array
          // is typed over the wider ArrayBufferLike.
          await cp.writeValueWithResponse(new Uint8Array(data));
        },
        onIndication(fn) {
          const h = (e: Event) => {
            const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
            if (v) fn(v);
          };
          cp.addEventListener('characteristicvaluechanged', h);
          return () => cp.removeEventListener('characteristicvaluechanged', h);
        },
      };
    } catch {
      control = null; // Trainer exposes no control point; read-only is fine.
    }

    return {
      deviceName: device.name ?? null,
      async startNotifications() {
        await bikeData.startNotifications();
      },
      onIndoorBikeData(fn) {
        const h = (e: Event) => {
          const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (v) fn(v);
        };
        bikeData.addEventListener('characteristicvaluechanged', h);
        return () =>
          bikeData.removeEventListener('characteristicvaluechanged', h);
      },
      controlPoint: control,
      onDisconnect(fn) {
        device.addEventListener('gattserverdisconnected', fn);
        return () => device.removeEventListener('gattserverdisconnected', fn);
      },
      async disconnect() {
        if (device.gatt?.connected) device.gatt.disconnect();
      },
    };
  };
}
