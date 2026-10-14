import { describe, expect, it } from "vitest";
import { DITHER_METHODS, adjustTone, pack, quantize, rasterize, toGray, type GrayImage } from "../src/index.js";

const flat = (width: number, height: number, value: number): GrayImage => ({
  width,
  height,
  data: new Uint8Array(width * height).fill(value),
});

describe("toGray", () => {
  it("composites transparent pixels onto white", () => {
    const rgba = { width: 2, height: 1, data: Uint8ClampedArray.of(0, 0, 0, 255, 0, 0, 0, 0) };
    expect(Array.from(toGray(rgba).data)).toEqual([0, 255]);
  });
});

describe("adjustTone", () => {
  it("inverts", () => {
    expect(Array.from(adjustTone(flat(1, 1, 0), { invert: true }).data)).toEqual([255]);
  });
});

describe("quantize", () => {
  it.each(DITHER_METHODS)("%s maps white to paper and black to full ink", (method) => {
    expect(quantize(flat(16, 16, 255), 2, method).every((v) => v === 0)).toBe(true);
    expect(quantize(flat(16, 16, 0), 2, method).every((v) => v === 1)).toBe(true);
    expect(quantize(flat(16, 16, 0), 16, method).every((v) => v === 15)).toBe(true);
  });

  it.each(["floyd-steinberg", "bayer"] as const)("%s renders mid-gray as roughly half ink", (method) => {
    const ink = quantize(flat(64, 64, 128), 2, method);
    const ratio = ink.reduce((sum, v) => sum + v, 0) / ink.length;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });
});

describe("pack", () => {
  it("1bpp puts the leftmost pixel in the least significant bit", () => {
    const ink = new Uint8Array(8);
    ink[0] = 1;
    ink[7] = 1;
    expect(Array.from(pack({ mode: "1bpp", width: 8, height: 1, ink }))).toEqual([0b1000_0001]);
    ink[7] = 0;
    expect(Array.from(pack({ mode: "1bpp", width: 8, height: 1, ink }))).toEqual([0b0000_0001]);
  });

  it("4bpp puts the leftmost pixel in the high nibble", () => {
    const ink = Uint8Array.of(15, 0, 3, 12);
    expect(Array.from(pack({ mode: "4bpp", width: 4, height: 1, ink }))).toEqual([0xf0, 0x3c]);
  });

  it("produces one printer line per row", () => {
    const raster = rasterize(flat(384, 10, 200), { mode: "1bpp", dither: "atkinson" });
    expect(pack(raster).length).toBe(48 * 10);
    const gray = rasterize(flat(384, 10, 200), { mode: "4bpp", dither: "floyd-steinberg" });
    expect(pack(gray).length).toBe(192 * 10);
  });

  it("rotates 180°", () => {
    const image: GrayImage = { width: 2, height: 1, data: Uint8Array.of(0, 255) };
    const raster = rasterize(image, { mode: "1bpp", dither: "threshold", rotate: true });
    expect(Array.from(raster.ink)).toEqual([0, 1]);
  });
});
