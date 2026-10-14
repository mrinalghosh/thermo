import { describe, expect, it } from "vitest";
import {
  buildSignResponse,
  commands,
  crc8,
  decodePacket,
  encodePacket,
  flowControlSignal,
  headTypeFromFirmware,
  limitIntensityForHeat,
  parseStatus,
} from "../src/index.js";

const hex = (data: Uint8Array) => Buffer.from(data).toString("hex");
const bytes = (value: string) => new Uint8Array(Buffer.from(value, "hex"));

describe("crc8", () => {
  it("matches the CRC-8 (poly 0x07) check value", () => {
    expect(crc8(new TextEncoder().encode("123456789"))).toBe(0xf4);
  });
});

describe("packets", () => {
  it("frames commands with preamble, LE length, CRC and footer", () => {
    expect(hex(commands.getStatus())).toBe("2221a10001000000ff");
    expect(hex(commands.getVersion())).toBe("2221b10001000000ff");
    expect(hex(commands.setIntensity(0x5d))).toBe(`2221a20001005d${hex(Uint8Array.of(crc8(Uint8Array.of(0x5d))))}ff`);
  });

  it("encodes the print request with line count, 0x30 and mode", () => {
    const packet = commands.printRequest(300, "4bpp");
    expect(hex(packet.subarray(0, 10))).toBe("2221a90004002c013002");
  });

  it("round-trips through decodePacket", () => {
    const packet = encodePacket(0xa1, [1, 2, 3]);
    const decoded = decodePacket(packet);
    expect(decoded?.command).toBe(0xa1);
    expect(Array.from(decoded!.payload)).toEqual([1, 2, 3]);
  });

  it("tolerates truncated notifications", () => {
    expect(decodePacket(bytes("2221aa0000"))?.command).toBe(0xaa);
    expect(decodePacket(bytes("2221a9000100"))?.payload.length).toBe(0);
    expect(decodePacket(bytes("5178a1"))).toBeNull();
  });

  it("recognizes flow-control markers", () => {
    expect(flowControlSignal(bytes("2221ae0101001070ff"))).toBe("pause");
    expect(flowControlSignal(bytes("2221ae0101000000ff"))).toBe("resume");
    expect(flowControlSignal(bytes("aa01"))).toBe("pause");
    expect(flowControlSignal(commands.getStatus())).toBeNull();
  });
});

describe("status", () => {
  it("parses state, battery, temperature and errors", () => {
    expect(parseStatus(Uint8Array.of(0, 0, 0, 80, 35, 0, 0, 0))).toMatchObject({
      state: "standby",
      batteryLevel: 80,
      temperatureC: 35,
      ok: true,
      error: null,
    });
    expect(parseStatus(Uint8Array.of(0, 0, 0, 80, 35, 0, 1, 9))?.error).toBe("no-paper");
    expect(parseStatus(Uint8Array.of(0, 0, 0, 80, 35, 0, 1, 4))?.error).toBe("overheated");
    expect(parseStatus(Uint8Array.of(0, 0))).toBeNull();
  });

  it("derives the head type from the firmware string", () => {
    expect(headTypeFromFirmware("1.9.3.1.2")).toBe("high-voltage");
    expect(headTypeFromFirmware("1.9.3.1.1")).toBe("low-voltage");
    expect(headTypeFromFirmware("")).toBe("unknown");
  });
});

describe("heat protection", () => {
  const base = { mode: "1bpp" as const, headType: "high-voltage" as const, coverage: 0.1 };

  it("leaves intensity alone when the head is cool", () => {
    expect(limitIntensityForHeat(0x5d, { ...base, temperatureC: 40 })).toBe(0x5d);
  });

  it("backs off when the head is hot, more for dense jobs", () => {
    expect(limitIntensityForHeat(0x5d, { ...base, temperatureC: 66 })).toBe(36);
    expect(limitIntensityForHeat(0x5d, { ...base, temperatureC: 66, coverage: 0.8 })).toBe(5);
  });
});

describe("signing challenge", () => {
  // Vectors from TiMini-Print's test suite.
  const vectors: [string, number, string][] = [
    ["00010203040506070809", 1788900001234, "2221B30022003B22C352E178212E225C191E5C441639603246B9E4377164905DEF6B707D0CFE50F400FF"],
    ["ffffffffffffffffffff", 1788900009999, "2221B3002200E263E07B9B4E157BFF9942971CAC51756C8DAEAB6A447F09368DA434E17763CA557900FF"],
    ["00112233445566778899", 1788900000001, "2221B3002200550149BF2A721C04E648DE9461373076EA30C1B23621F1454941948D3E4D00BCA89D00FF"],
  ];

  it.each(vectors)("answers challenge %s", async (challenge, timestamp, expected) => {
    expect(hex(await buildSignResponse(bytes(challenge), timestamp))).toBe(expected.toLowerCase());
  });

  it("rejects challenges of the wrong length", async () => {
    await expect(buildSignResponse(new Uint8Array(9), 0)).rejects.toThrow(RangeError);
  });
});
