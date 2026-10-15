import { BYTES_PER_LINE, DPI, MIN_LINES, WebBluetoothTransport } from "@thermo/mxw01";
import { previewRGBA, type DitherMethod, type Raster } from "@thermo/render";
import { useEffect, useRef, useState } from "react";
import { DITHER_NAMES } from "../settings.js";
import type { usePrinter } from "../usePrinter.js";
import { HoldButton } from "./HoldButton.js";

/** Paper moved per step while feed/retract is held (8 lines = 1 mm). */
const HOLD_STEP_LINES = 8;

const PAPER = [255, 255, 255];
const INK = [20, 20, 20];

const mm = (dots: number) => ((dots / DPI) * 25.4).toFixed(0);

/** Left column: the strip exactly as it will print, its vital numbers, and the print controls. */
export function Stage({
  raster,
  notice,
  dither,
  printer,
  onPrint,
}: {
  raster: Raster | null;
  /** Shown instead of the preview when there's no raster to show. */
  notice?: string;
  dither: DitherMethod;
  printer: ReturnType<typeof usePrinter>;
  onPrint: () => void;
}) {
  const [zoom, setZoom] = useState<1 | 2>(1);
  const printing = printer.progress !== null;
  const lines = raster ? Math.max(raster.height, MIN_LINES) : 0;

  return (
    <section className="stage">
      <div className="shead">
        <span>preview · dot for dot</span>
        <div className="vtog">
          {([1, 2] as const).map((z) => (
            <button key={z} className={zoom === z ? "vbtn on" : "vbtn"} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </div>
      </div>

      <div className="cwrap">
        <span className="tick tl" />
        <span className="tick tr" />
        <span className="tick bl" />
        <span className="tick br" />
        <div className="scroller">
          {raster ? (
            <Paper raster={raster} zoom={zoom} />
          ) : (
            <div className={notice ? "empty warn" : "empty"}>{notice ?? "nothing to print yet"}</div>
          )}
        </div>
      </div>

      <div className="detail">
        <Row label="size" value={raster ? `${raster.width} × ${raster.height} dots` : "—"} />
        <Row label="paper" value={raster ? `${mm(raster.width)} × ${mm(lines)} mm` : "—"} />
        <Row
          label="mode"
          value={raster ? `${raster.mode === "1bpp" ? "1-bit" : "4-bit gray"} · ${DITHER_NAMES[dither]}` : "—"}
        />
        <Row label="data" value={raster ? formatBytes(lines * BYTES_PER_LINE[raster.mode]) : "—"} />

        <div className="dact">
          {printing ? (
            <>
              <div className="btn progress" role="progressbar" aria-valuenow={Math.round(printer.progress! * 100)}>
                <span className="fill" style={{ width: `${printer.progress! * 100}%` }} />
                {/* Progress counts bytes sent; the printer is still at work after the last one. */}
                <span className="plabel">
                  {printer.progress! < 1 ? `sending ${Math.floor(printer.progress! * 100)}%` : "printing…"}
                </span>
              </div>
              <button className="btn ghost" onClick={printer.cancel}>
                cancel
              </button>
            </>
          ) : printer.connected ? (
            <>
              <button className="btn" disabled={!raster} onClick={onPrint} title="⌘↵">
                print
              </button>
              <HoldButton className="btn ghost" onStep={() => printer.feed(HOLD_STEP_LINES)}>
                feed
              </HoldButton>
              <HoldButton className="btn ghost" onStep={() => printer.retract(HOLD_STEP_LINES)}>
                retract
              </HoldButton>
            </>
          ) : (
            <button className="btn" disabled={printer.connecting || !WebBluetoothTransport.isSupported()} onClick={printer.connect}>
              {printer.connecting ? "connecting…" : "connect printer"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Paper({ raster, zoom }: { raster: Raster; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = raster.width;
    canvas.height = raster.height;
    const pixels = new ImageData(previewRGBA(raster, PAPER, INK) as Uint8ClampedArray<ArrayBuffer>, raster.width, raster.height);
    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
  }, [raster]);

  return <canvas ref={canvasRef} className={zoom === 2 ? "paper zoom" : "paper"} style={{ width: raster.width * zoom }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="drow">
      <span className="dk">{label}</span>
      <span className="dv">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}
