// ---------- native Bluetooth (Capacitor, for iOS) ----------
// iOS Safari/WebKit has no Web Bluetooth support at all, so the app's normal
// navigator.bluetooth calls silently don't work there. When Trbo is running
// inside the native Capacitor shell (iPhone app, not the web PWA), we route
// Bluetooth through @capacitor-community/bluetooth-le instead, which talks
// to iOS's real CoreBluetooth stack. Web/Android Chrome users are unaffected
// and keep using navigator.bluetooth as before.
//
// This module exposes a small helper set that mirrors the handful of
// Web Bluetooth calls useTrainer()/useHeartRate() need (scan+connect,
// subscribe to notifications, write a value, disconnect) so those hooks can
// branch on isNativePlatform() without duplicating their state logic.

import { Capacitor } from '@capacitor/core';

let blePromise = null;
async function getBle() {
  if (!blePromise) {
    blePromise = import('@capacitor-community/bluetooth-le').then(async (m) => {
      const { BleClient } = m;
      await BleClient.initialize();
      return BleClient;
    });
  }
  return blePromise;
}

export const isNative = Capacitor.isNativePlatform();

// Scans for the first device advertising `serviceUuid`, connects, and
// resolves with the deviceId. Mirrors navigator.bluetooth.requestDevice +
// device.gatt.connect() combined, since capacitor-community/bluetooth-le
// splits scanning and connecting into separate steps.
export async function nativeRequestAndConnect(serviceUuid, onDisconnect) {
  const BleClient = await getBle();
  // Accepts either a single service UUID or an array of candidate UUIDs.
  // The plugin's scan filter matches a device advertising ANY of the given
  // services, which is what lets us look for a trainer's preferred service
  // (FTMS) and a fallback (Cycling Power Service) in one scan.
  const services = Array.isArray(serviceUuid) ? serviceUuid : [serviceUuid];
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      BleClient.stopLEScan().catch(() => {});
      reject(new Error('No matching Bluetooth device found nearby.'));
    }, 15000);

    BleClient.requestLEScan({ services }, async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      await BleClient.stopLEScan().catch(() => {});
      try {
        const deviceId = result.device.deviceId;
        await BleClient.connect(deviceId, () => onDisconnect && onDisconnect());
        resolve({ deviceId, name: result.device.name || result.localName || null });
      } catch (e) {
        reject(e);
      }
    }).catch((e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(e);
    });
  });
}

export async function nativeStartNotifications(deviceId, serviceUuid, characteristicUuid, onValue) {
  const BleClient = await getBle();
  await BleClient.startNotifications(deviceId, serviceUuid, characteristicUuid, (value) => {
    // value is a DataView, same shape the Web Bluetooth handlers already expect
    onValue(value);
  });
}

export async function nativeWrite(deviceId, serviceUuid, characteristicUuid, dataViewOrBuffer) {
  const BleClient = await getBle();
  const dv = dataViewOrBuffer instanceof DataView
    ? dataViewOrBuffer
    : new DataView(dataViewOrBuffer instanceof ArrayBuffer ? dataViewOrBuffer : dataViewOrBuffer.buffer);
  await BleClient.write(deviceId, serviceUuid, characteristicUuid, dv);
}

export async function nativeDisconnect(deviceId) {
  if (!deviceId) return;
  const BleClient = await getBle();
  await BleClient.disconnect(deviceId).catch(() => {});
}

// 16-bit BLE SIG service/characteristic numbers need to be expanded to full
// 128-bit UUID strings for this plugin.
export function uuid16(short) {
  const hex = short.toString(16).padStart(4, '0');
  return `0000${hex}-0000-1000-8000-00805f9b34fb`;
}
