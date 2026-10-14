export type PrinterState = "standby" | "printing" | "feeding" | "retracting" | "unknown";
export type PrinterErrorKind = "no-paper" | "overheated" | "low-battery" | "unknown";

export interface PrinterStatus {
  state: PrinterState;
  /** Raw state byte, useful when `state` is "unknown". */
  stateCode: number;
  /** Approximate; the scale is not documented. */
  batteryLevel: number;
  temperatureC: number;
  ok: boolean;
  error: PrinterErrorKind | null;
  errorCode: number;
}

const STATES: Record<number, PrinterState> = {
  0x00: "standby",
  0x01: "printing",
  0x02: "feeding",
  0x03: "retracting",
};

const ERRORS: Record<number, PrinterErrorKind> = {
  0x01: "no-paper",
  0x09: "no-paper",
  0x04: "overheated",
  0x08: "low-battery",
};

/**
 * Parse the payload of an A1 status notification.
 * Offsets: [0] state, [3] battery, [4] temperature, [6] error flag, [7] error code.
 */
export function parseStatus(payload: Uint8Array): PrinterStatus | null {
  if (payload.length < 7) return null;
  const stateCode = payload[0]!;
  const errorFlag = payload[6]!;
  const errorCode = payload[7] ?? 0;
  const ok = errorFlag === 0;
  return {
    state: STATES[stateCode] ?? "unknown",
    stateCode,
    batteryLevel: payload[3]!,
    temperatureC: payload[4]!,
    ok,
    error: ok ? null : (ERRORS[errorCode] ?? "unknown"),
    errorCode,
  };
}

export type HeadType = "high-voltage" | "low-voltage" | "unknown";

/** The last character of the firmware string encodes the print head type. */
export function headTypeFromFirmware(firmware: string): HeadType {
  const marker = firmware.trim().slice(-1);
  if (marker === "2") return "high-voltage";
  if (marker === "1") return "low-voltage";
  return "unknown";
}
