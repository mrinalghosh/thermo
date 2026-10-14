import { clamp, type GrayImage } from "./gray.js";

export type DitherMethod = "threshold" | "floyd-steinberg" | "atkinson" | "bayer";

export const DITHER_METHODS: readonly DitherMethod[] = ["floyd-steinberg", "atkinson", "bayer", "threshold"];

/**
 * Quantize to `levels` evenly spaced output values. Returns "ink" per pixel:
 * 0 = paper, levels-1 = full black.
 */
export function quantize(image: GrayImage, levels: number, method: DitherMethod): Uint8Array {
  switch (method) {
    case "threshold":
      return errorDiffusion(image, levels, []);
    case "floyd-steinberg":
      return errorDiffusion(image, levels, FLOYD_STEINBERG);
    case "atkinson":
      return errorDiffusion(image, levels, ATKINSON);
    case "bayer":
      return ordered(image, levels);
  }
}

type Kernel = [dx: number, dy: number, weight: number][];

const FLOYD_STEINBERG: Kernel = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];

// Atkinson only diffuses 6/8 of the error, which keeps highlights clean on thermal paper.
const ATKINSON: Kernel = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8],
];

function errorDiffusion({ width, height, data }: GrayImage, levels: number, kernel: Kernel) {
  const buffer = Float32Array.from(data);
  const ink = new Uint8Array(width * height);
  const step = 255 / (levels - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = clamp(buffer[i]!);
      const level = Math.round(value / step);
      ink[i] = levels - 1 - level;
      const error = value - level * step;
      for (const [dx, dy, weight] of kernel) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) buffer[ny * width + nx]! += error * weight;
      }
    }
  }
  return ink;
}

const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
  54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];

function ordered({ width, height, data }: GrayImage, levels: number) {
  const ink = new Uint8Array(width * height);
  const step = 255 / (levels - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const offset = (BAYER_8[(y & 7) * 8 + (x & 7)]! + 0.5) / 64 - 0.5;
      const level = Math.max(0, Math.min(levels - 1, Math.round(data[i]! / step + offset)));
      ink[i] = levels - 1 - level;
    }
  }
  return ink;
}
