/** GATT service exposed by the MXW01. Some hosts (notably macOS) report it as 0xAF30. */
export const SERVICE_UUID = 0xae30;
export const SERVICE_UUID_ALT = 0xaf30;

/** Control commands (write without response). */
export const CONTROL_CHAR_UUID = 0xae01;
/** Status, acknowledgements and flow control (notify). */
export const NOTIFY_CHAR_UUID = 0xae02;
/** Bulk raster data (write without response). */
export const DATA_CHAR_UUID = 0xae03;

/** Every packet starts with this preamble. */
export const PREAMBLE = [0x22, 0x21] as const;

/** Print head width in dots (48 mm at 203 dpi). */
export const PRINT_WIDTH = 384;
export const DPI = 203;

/** Bytes per raster row for each print mode. */
export const BYTES_PER_LINE = {
  "1bpp": PRINT_WIDTH / 8,
  "4bpp": PRINT_WIDTH / 2,
} as const;

/** Short jobs are padded to this many lines; shorter jobs have been reported to misbehave. */
export const MIN_LINES = 90;

export const Command = {
  GetStatus: 0xa1,
  SetIntensity: 0xa2,
  FeedPaper: 0xa3,
  RetractPaper: 0xa4,
  QueryCount: 0xa7,
  Print: 0xa9,
  PrintComplete: 0xaa,
  BatteryLevel: 0xab,
  CancelPrint: 0xac,
  PrintDataFlush: 0xad,
  GetPrintType: 0xb0,
  GetVersion: 0xb1,
  /** Printer-initiated; asks the host to poll status. */
  StatusPollRequest: 0xb2,
  /** Printer-initiated signing challenge; the host must answer (see sign.ts). */
  SignChallenge: 0xb3,
} as const;
export type CommandId = (typeof Command)[keyof typeof Command];

export type PrintMode = keyof typeof BYTES_PER_LINE;

/** Mode byte of the A9 print request. */
export const PRINT_MODE_BYTE: Record<PrintMode, number> = {
  "1bpp": 0x00,
  "4bpp": 0x02,
};

/**
 * Darkness levels 1-5 as used by the vendor app. The byte values are not linear and
 * differ between monochrome and grayscale jobs (values from TiMini-Print).
 */
export const INTENSITY_BY_LEVEL: Record<PrintMode, readonly number[]> = {
  "1bpp": [0x58, 0x5a, 0x5d, 0x5f, 0x62],
  "4bpp": [0x4b, 0x50, 0x55, 0x5a, 0x62],
};

/**
 * Data stream pacing: one 1bpp row per write, as in the known-working desktop and Web
 * Bluetooth implementations. The vendor app's 123-byte/4 ms pacing relies on a large
 * MTU; where the host negotiates less, oversized writes lose bytes and, because 123
 * doesn't divide a row, every later row shifts. Keep custom sizes a divisor of 48.
 */
export const DEFAULT_CHUNK_SIZE = 48;
export const DEFAULT_CHUNK_DELAY_MS = 15;
