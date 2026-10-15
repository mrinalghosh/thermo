/**
 * The byte pipe between the driver and a printer. Implementations exist per runtime:
 * Web Bluetooth in the browser; a Node BLE (noble) transport is planned for the bridge.
 */
export interface Transport {
  /** Human-readable device name, if known. */
  readonly name: string | undefined;
  readonly connected: boolean;
  /** Optional one-line description of the link, logged after connecting. */
  readonly details?: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Write to the control characteristic (0xAE01). */
  writeControl(data: Uint8Array): Promise<void>;
  /** Write to the bulk data characteristic (0xAE03). */
  writeData(data: Uint8Array): Promise<void>;
  /** Subscribe to notifications (0xAE02). Returns an unsubscribe function. */
  onNotify(listener: (data: Uint8Array) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}
