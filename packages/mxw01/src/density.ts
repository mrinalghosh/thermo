// Darkness levels and heat protection. The lookup tables mirror the vendor app's
// behaviour as captured by TiMini-Print (Apache-2.0); see THIRD_PARTY_NOTICES.md.

import { INTENSITY_BY_LEVEL, type PrintMode } from "./constants.js";
import type { HeadType } from "./status.js";

export type DarknessLevel = 1 | 2 | 3 | 4 | 5;

export function intensityForLevel(level: DarknessLevel, mode: PrintMode): number {
  return INTENSITY_BY_LEVEL[mode][level - 1]!;
}

/** Fraction of black dots in a 1bpp raster, used to back off intensity on dense jobs. */
export function coverageRatio(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let black = 0;
  for (const byte of data) {
    let b = byte;
    while (b) {
      black += b & 1;
      b >>= 1;
    }
  }
  return black / (data.length * 8);
}

export interface HeatContext {
  mode: PrintMode;
  temperatureC: number;
  headType: HeadType;
  coverage: number;
}

/** Never raises intensity; lowers it when the head is hot. */
export function limitIntensityForHeat(intensity: number, ctx: HeatContext): number {
  const target = ctx.mode === "4bpp" ? grayTarget(intensity, ctx) : dotTarget(intensity, ctx);
  return Math.max(0, Math.min(intensity, target));
}

/** Settle time before the print request; dense jobs on high-voltage heads need longer. */
export function startDelayMs(ctx: HeatContext, intensityChanged: boolean): number {
  if (ctx.headType === "high-voltage" && ctx.coverage > 0.4) return 200;
  return intensityChanged ? 60 : 0;
}

function grayTarget(intensity: number, { temperatureC, headType }: HeatContext) {
  const thresholds: [number, number][] =
    headType === "high-voltage"
      ? [[70, 56], [65, 65], [60, 75], [55, 80], [50, 85]]
      : [[70, 56], [65, 60], [60, 65], [55, 75], [50, 80]];
  for (const [threshold, value] of thresholds) {
    if (temperatureC >= threshold) return Math.min(intensity, value);
  }
  return intensity;
}

function dotTarget(intensity: number, { temperatureC, headType, coverage }: HeatContext) {
  if (temperatureC <= 60) return intensity;
  const band = coverage <= 0.4 ? 0 : coverage < 0.5 ? 1 : coverage < 0.7 ? 2 : 3;
  let values: number[];
  if (headType === "high-voltage") {
    values = temperatureC < 65 ? [48, 15, 15, 10] : temperatureC < 70 ? [36, 9, 5, 5] : [22, 5, 3, 3];
  } else {
    values = temperatureC <= 65 ? [60, 50, 50, 30] : temperatureC <= 70 ? [50, 40, 40, 20] : [40, 30, 30, 10];
  }
  return Math.min(intensity, values[band]!);
}
