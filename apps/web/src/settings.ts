import { DEFAULT_CHUNK_DELAY_MS, DEFAULT_CHUNK_SIZE, type DarknessLevel, type PrintMode } from "@thermo/mxw01";
import type { DitherMethod } from "@thermo/render";

export type SourceKind = "text" | "image" | "test";

export interface Settings {
  mode: PrintMode;
  /** Text prints crisper with a plain threshold; photos need dithering. */
  dither: Record<SourceKind, DitherMethod>;
  darkness: DarknessLevel;
  brightness: number;
  contrast: number;
  rotate: boolean;
  chunkSize: number;
  chunkDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "1bpp",
  dither: { text: "threshold", image: "floyd-steinberg", test: "floyd-steinberg" },
  darkness: 3,
  brightness: 0,
  contrast: 0,
  rotate: false,
  chunkSize: DEFAULT_CHUNK_SIZE,
  chunkDelayMs: DEFAULT_CHUNK_DELAY_MS,
};

export const SOURCE_LABELS: Record<SourceKind, string> = {
  text: "Text",
  image: "Image",
  test: "Test pattern",
};

export const DITHER_LABELS: Record<DitherMethod, string> = {
  "floyd-steinberg": "Floyd–Steinberg",
  atkinson: "Atkinson",
  bayer: "Ordered (Bayer)",
  threshold: "None (threshold)",
};
