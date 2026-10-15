import { PRINT_WIDTH } from "@thermo/mxw01";

export interface TextLayout {
  text: string;
  font: "sans-serif" | "serif" | "monospace";
  size: number;
  bold: boolean;
  align: "left" | "center" | "right";
}

const MARGIN = 4;

/** Lay out wrapped text on a canvas exactly as wide as the print head. */
export function renderText(layout: TextLayout): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PRINT_WIDTH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const font = `${layout.bold ? "700" : "400"} ${layout.size}px ${layout.font}`;
  ctx.font = font;
  const lines = wrap(ctx, layout.text, PRINT_WIDTH - MARGIN * 2);
  const lineHeight = Math.ceil(layout.size * 1.25);

  canvas.height = Math.max(1, lines.length * lineHeight + MARGIN * 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = font; // resizing the canvas resets context state
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.textAlign = layout.align;
  const x = layout.align === "left" ? MARGIN : layout.align === "center" ? PRINT_WIDTH / 2 : PRINT_WIDTH - MARGIN;
  lines.forEach((line, i) => ctx.fillText(line, x, MARGIN + i * lineHeight + (lineHeight - layout.size) / 2));
  return canvas;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      // A single word wider than the paper gets broken by character.
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Scale an image to the print width, preserving aspect ratio. */
export function renderImage(source: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PRINT_WIDTH;
  canvas.height = Math.max(1, Math.round((source.height * PRINT_WIDTH) / source.width));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Calibration strip. Misaligned rows show up as leaning verticals and a broken border;
 * a mirrored or rotated job shows up in the edge labels.
 */
export function renderTestPattern(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const w = PRINT_WIDTH;
  canvas.width = w;
  canvas.height = 280;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, canvas.height);
  ctx.fillStyle = "#000";

  // Border.
  ctx.fillRect(0, 0, w, 2);
  ctx.fillRect(0, canvas.height - 2, w, 2);
  ctx.fillRect(0, 0, 2, canvas.height);
  ctx.fillRect(w - 2, 0, 2, canvas.height);

  // Ruler: a tick every 8 dots (one byte), a long tick every 48.
  for (let x = 8; x < w; x += 8) ctx.fillRect(x, 2, 1, x % 48 === 0 ? 14 : 6);
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";
  for (const x of [0, 96, 192, 288, 384]) {
    ctx.textAlign = x === 0 ? "left" : x === w ? "right" : "center";
    ctx.fillText(String(x), x === 0 ? 4 : x === w ? w - 4 : x, 20);
  }

  ctx.textAlign = "center";
  ctx.font = "700 20px sans-serif";
  ctx.fillText("MXW01 test · 384 dots", w / 2, 42);

  // Straight verticals and a diagonal: shear bends or tilts them.
  for (const x of [48, 96, 192, 288, 336]) ctx.fillRect(x, 74, 2, 100);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, 172);
  ctx.lineTo(w - 4, 76);
  ctx.stroke();

  // Gradient for dithering and grayscale.
  // Inside the border, so the border stays continuous.
  for (let x = 2; x < w - 2; x++) {
    const v = Math.round(((x - 2) / (w - 5)) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 188, 1, 36);
  }

  ctx.fillStyle = "#000";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("◀ LEFT", 6, 240);
  ctx.textAlign = "right";
  ctx.fillText("RIGHT ▶", w - 6, 240);
  return canvas;
}

export function canvasPixels(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
}
