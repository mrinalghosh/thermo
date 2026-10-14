import {
  CONTROL_CHAR_UUID,
  DATA_CHAR_UUID,
  NOTIFY_CHAR_UUID,
  SERVICE_UUID,
  SERVICE_UUID_ALT,
} from "./constants.js";
import type { Transport } from "./transport.js";

/** Transport over the Web Bluetooth API (Chromium browsers, HTTPS or localhost only). */
export class WebBluetoothTransport implements Transport {
  private control: BluetoothRemoteGATTCharacteristic | null = null;
  private data: BluetoothRemoteGATTCharacteristic | null = null;
  private notify: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyListeners = new Set<(data: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();
  /** Chrome rejects overlapping GATT operations, so writes are serialized. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly device: BluetoothDevice) {
    device.addEventListener("gattserverdisconnected", () => {
      this.control = this.data = this.notify = null;
      for (const listener of this.disconnectListeners) listener();
    });
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  /** Opens the browser's device chooser. Must be called from a user gesture. */
  static async request(): Promise<WebBluetoothTransport> {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: "MXW01" }, { namePrefix: "MXW01-" }, { services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID, SERVICE_UUID_ALT],
    });
    return new WebBluetoothTransport(device);
  }

  get name() {
    return this.device.name;
  }

  get connected() {
    return this.device.gatt?.connected === true && this.control !== null;
  }

  async connect() {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error("Device has no GATT server");
    const server = await gatt.connect();
    const service = await server
      .getPrimaryService(SERVICE_UUID)
      .catch(() => server.getPrimaryService(SERVICE_UUID_ALT));
    this.control = await service.getCharacteristic(CONTROL_CHAR_UUID);
    this.notify = await service.getCharacteristic(NOTIFY_CHAR_UUID);
    this.data = await service.getCharacteristic(DATA_CHAR_UUID);
    this.notify.addEventListener("characteristicvaluechanged", this.handleNotification);
    await this.notify.startNotifications();
  }

  async disconnect() {
    if (this.notify) {
      this.notify.removeEventListener("characteristicvaluechanged", this.handleNotification);
      await this.notify.stopNotifications().catch(() => {});
    }
    this.device.gatt?.disconnect();
  }

  writeControl(data: Uint8Array) {
    return this.write(() => this.control, data);
  }

  writeData(data: Uint8Array) {
    return this.write(() => this.data, data);
  }

  onNotify(listener: (data: Uint8Array) => void) {
    this.notifyListeners.add(listener);
    return () => this.notifyListeners.delete(listener);
  }

  onDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private write(target: () => BluetoothRemoteGATTCharacteristic | null, data: Uint8Array) {
    const op = this.queue.then(() => {
      const characteristic = target();
      if (!characteristic) throw new Error("Printer is not connected");
      return characteristic.writeValueWithoutResponse(data as Uint8Array<ArrayBuffer>);
    });
    this.queue = op.catch(() => {});
    return op;
  }

  private handleNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    for (const listener of this.notifyListeners) listener(bytes);
  };
}
