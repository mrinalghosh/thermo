import { quantize, type DitherMethod } from "./dither.js";
import { adjustTone, rotate180, type GrayImage, type ToneOptions } from "./gray.js";

export type RasterMode = "1bpp" | "4bpp";

export interface Raster {
  mode: RasterMode;
  width: number;
  height: number;
  /** Ink per pixel: 0 = paper; 1 (1bpp) or 15 (4bpp) = full black. */
  ink: Uint8Array;
}

export interface RasterOptions extends ToneOptions {
  mode: RasterMode;
  dither: DitherMethod;
  /** Rotate 180° so the job reads upright as it leaves the printer. */
  rotate?: boolean;
}

export const MAX_INK: Record<RasterMode, number> = { "1bpp": 1, "4bpp": 15 };

export function rasterize(image: GrayImage, options: RasterOptions): Raster {
  let gray = adjustTone(image, options);
  if (options.rotate) gray = rotate180(gray);
  const ink = quantize(gray, MAX_INK[options.mode] + 1, options.dither);
  return { mode: options.mode, width: gray.width, height: gray.height, ink };
}

/**
 * Pack for the MXW01.
 * 1bpp: 8 pixels per byte, leftmost pixel in the least significant bit, 1 = black.
 * 4bpp: 2 pixels per byte, leftmost pixel in the high nibble, 15 = black.
 */
export function pack(raster: Raster): Uint8Array {
  const { width, height, ink, mode } = raster;
  if (mode === "1bpp") {
    if (width % 8) throw new RangeError("1bpp width must be a multiple of 8");
    const out = new Uint8Array((width / 8) * height);
    for (let i = 0; i < ink.length; i++) {
      if (ink[i]) out[i >> 3]! |= 1 << (i & 7);
    }
    return out;
  }
  if (width % 2) throw new RangeError("4bpp width must be even");
  const out = new Uint8Array((width / 2) * height);
  for (let i = 0; i < ink.length; i += 2) {
    out[i >> 1] = (ink[i]! << 4) | ink[i + 1]!;
  }
  return out;
}

/** RGBA pixels showing what the paper will look like, for an on-screen preview. */
export function previewRGBA(raster: Raster, paper = [255, 255, 255], inkColor = [24, 24, 32]): Uint8ClampedArray {
  const max = MAX_INK[raster.mode];
  const out = new Uint8ClampedArray(raster.ink.length * 4);
  for (let i = 0; i < raster.ink.length; i++) {
    const t = raster.ink[i]! / max;
    const p = i * 4;
    out[p] = paper[0]! + (inkColor[0]! - paper[0]!) * t;
    out[p + 1] = paper[1]! + (inkColor[1]! - paper[1]!) * t;
    out[p + 2] = paper[2]! + (inkColor[2]! - paper[2]!) * t;
    out[p + 3] = 255;
  }
  return out;
}
