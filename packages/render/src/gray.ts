/** 8-bit grayscale image, row-major. 0 = black, 255 = white. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Structurally compatible with the DOM's ImageData. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Convert RGBA to grayscale, compositing transparent pixels onto white paper. */
export function toGray(image: RGBAImage): GrayImage {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const alpha = data[p + 3]! / 255;
    const luma = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    out[i] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return { width, height, data: out };
}

export interface ToneOptions {
  /** -100..100 */
  brightness?: number;
  /** -100..100 */
  contrast?: number;
  /** >0, 1 = unchanged. Values above 1 lighten midtones. */
  gamma?: number;
  invert?: boolean;
}

export function adjustTone(image: GrayImage, { brightness = 0, contrast = 0, gamma = 1, invert = false }: ToneOptions): GrayImage {
  if (!brightness && !contrast && gamma === 1 && !invert) return image;
  const factor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let x = factor * (v - 128) + 128 + brightness * 2.55;
    x = 255 * Math.pow(clamp(x) / 255, 1 / gamma);
    lut[v] = Math.round(invert ? 255 - clamp(x) : clamp(x));
  }
  return { ...image, data: image.data.map((v) => lut[v]!) };
}

export function rotate180(image: GrayImage): GrayImage {
  return { ...image, data: image.data.slice().reverse() };
}

export function clamp(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
