import { Command, PRINT_MODE_BYTE, type PrintMode } from "./constants.js";
import { encodePacket } from "./packet.js";

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

export const commands = {
  getStatus: () => encodePacket(Command.GetStatus, [0x00]),
  getVersion: () => encodePacket(Command.GetVersion, [0x00]),
  getPrintType: () => encodePacket(Command.GetPrintType, [0x00]),
  getBattery: () => encodePacket(Command.BatteryLevel, [0x00]),
  setIntensity: (value: number) => encodePacket(Command.SetIntensity, [clampByte(value)]),
  /** Payload: line count (LE16), fixed 0x30, mode byte. */
  printRequest: (lines: number, mode: PrintMode) =>
    encodePacket(Command.Print, [...u16(lines), 0x30, PRINT_MODE_BYTE[mode]]),
  /** Sent after the last raster chunk. */
  flush: () => encodePacket(Command.PrintDataFlush, [0x00]),
  cancel: () => encodePacket(Command.CancelPrint, [0x00]),
  feed: (lines: number) => encodePacket(Command.FeedPaper, u16(lines)),
  retract: (lines: number) => encodePacket(Command.RetractPaper, u16(lines)),
};

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
