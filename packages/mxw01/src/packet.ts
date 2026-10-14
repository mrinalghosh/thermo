import { PREAMBLE } from "./constants.js";
import { crc8 } from "./crc8.js";

/**
 * Frame a command: 22 21 | cmd | 00 | len (LE16) | payload | crc8(payload) | FF
 */
export function encodePacket(command: number, payload: ArrayLike<number> = []): Uint8Array {
  const body = Uint8Array.from(payload);
  if (body.length > 0xffff) throw new RangeError("payload too large");
  const packet = new Uint8Array(8 + body.length);
  packet[0] = PREAMBLE[0];
  packet[1] = PREAMBLE[1];
  packet[2] = command & 0xff;
  packet[3] = 0x00;
  packet[4] = body.length & 0xff;
  packet[5] = (body.length >> 8) & 0xff;
  packet.set(body, 6);
  packet[6 + body.length] = crc8(body);
  packet[7 + body.length] = 0xff;
  return packet;
}

export interface DecodedPacket {
  command: number;
  payload: Uint8Array;
}

/**
 * Parse a notification. Lenient on purpose: the printer sometimes sends truncated
 * frames (no CRC/footer, or fewer payload bytes than declared).
 */
export function decodePacket(data: Uint8Array): DecodedPacket | null {
  if (data.length < 3 || data[0] !== PREAMBLE[0] || data[1] !== PREAMBLE[1]) return null;
  const command = data[2]!;
  if (data.length < 6) return { command, payload: new Uint8Array(0) };
  const declared = data[4]! | (data[5]! << 8);
  const end = Math.min(6 + declared, data.length);
  return { command, payload: data.slice(6, end) };
}

const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");

// Flow-control notifications captured across V5X-family firmwares (from TiMini-Print).
const FLOW_PAUSE = new Set([
  "aa01",
  "5178ae0101001070ff",
  "2221a800010020e0ff",
  "2221ae0101001070ff",
  "2221ae0001000000",
]);
const FLOW_RESUME = new Set([
  "aa00",
  "5178ae0101000000ff",
  "2221a80001003090ff",
  "2221ae0101000000ff",
  "2221ae0001001000",
]);

export function flowControlSignal(data: Uint8Array): "pause" | "resume" | null {
  const key = hex(data);
  if (FLOW_PAUSE.has(key)) return "pause";
  if (FLOW_RESUME.has(key)) return "resume";
  return null;
}

export { hex as toHex };
