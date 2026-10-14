import { WebBluetoothTransport } from "@thermo/mxw01";
import { pack, rasterize, toGray } from "@thermo/render";
import { useMemo, useState } from "react";
import { canvasPixels, renderImage, renderTestPattern, renderText, type TextLayout } from "./compose.js";
import { ConnectionBar } from "./components/ConnectionBar.js";
import { HoldButton } from "./components/HoldButton.js";
import { ImageEditor } from "./components/ImageEditor.js";
import { LogPanel } from "./components/LogPanel.js";
import { Preview } from "./components/Preview.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { TextEditor } from "./components/TextEditor.js";
import { DEFAULT_SETTINGS, SOURCE_LABELS, type SourceKind } from "./settings.js";
import { usePrinter } from "./usePrinter.js";
import { useStoredState } from "./useStoredState.js";

/** Paper moved per step while Feed/Retract is held (8 lines = 1 mm). */
const HOLD_STEP_LINES = 8;

const DEFAULT_TEXT: TextLayout = {
  text: "Hello from thermo!",
  font: "sans-serif",
  size: 32,
  bold: false,
  align: "left",
};

export function App() {
  // v2: transfer defaults changed; stored v1 values would keep the broken 123-byte writes.
  const [settings, setSettings] = useStoredState("settings.v2", DEFAULT_SETTINGS);
  const [textLayout, setTextLayout] = useStoredState("text", DEFAULT_TEXT);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [source, setSource] = useState<SourceKind>("text");
  const transfer = useMemo(
    () => ({ chunkSize: settings.chunkSize, chunkDelayMs: settings.chunkDelayMs }),
    [settings.chunkSize, settings.chunkDelayMs],
  );
  const printer = usePrinter(transfer);

  const canvas = useMemo(() => {
    if (source === "test") return renderTestPattern();
    if (source === "image") return image ? renderImage(image) : null;
    return textLayout.text.trim() ? renderText(textLayout) : null;
  }, [source, image, textLayout]);

  // The preview shows the raster upright; rotation is applied only to what is sent.
  const raster = useMemo(
    () =>
      canvas &&
      rasterize(toGray(canvasPixels(canvas)), {
        mode: settings.mode,
        dither: settings.dither[source],
        brightness: settings.brightness,
        contrast: settings.contrast,
      }),
    [canvas, source, settings.mode, settings.dither, settings.brightness, settings.contrast],
  );

  const handlePrint = () => {
    if (!raster) return;
    const ink = settings.rotate ? raster.ink.slice().reverse() : raster.ink;
    void printer.print({ mode: raster.mode, data: pack({ ...raster, ink }) }, { darkness: settings.darkness });
  };

  return (
    <div className="app">
      <ConnectionBar printer={printer} />

      {!WebBluetoothTransport.isSupported() && (
        <p className="banner">
          This browser can’t talk to Bluetooth printers. Use Chrome or Edge on desktop or Android (Safari, Firefox and
          iOS don’t support Web Bluetooth).
        </p>
      )}

      <main className="layout">
        <section className="panel">
          <div className="tabs" role="tablist">
            {(Object.keys(SOURCE_LABELS) as SourceKind[]).map((kind) => (
              <button
                key={kind}
                role="tab"
                aria-selected={source === kind}
                className={source === kind ? "tab active" : "tab"}
                onClick={() => setSource(kind)}
              >
                {SOURCE_LABELS[kind]}
              </button>
            ))}
          </div>
          {source === "text" && <TextEditor layout={textLayout} onChange={setTextLayout} />}
          {source === "image" && <ImageEditor image={image} onChange={setImage} />}
          {source === "test" && (
            <p className="hint">
              A calibration strip. The border should be unbroken and the vertical lines straight; if they lean or
              the print turns to noise partway down, data is being lost in transfer, so try a longer delay or a
              smaller chunk size under Advanced. Use the edge labels to check orientation.
            </p>
          )}
          <SettingsPanel settings={settings} source={source} onChange={setSettings} />
        </section>

        <section className="panel preview-panel">
          <Preview raster={raster} />
          <div className="actions">
            {printer.progress === null ? (
              <button className="primary" disabled={!printer.connected || !raster} onClick={handlePrint}>
                Print
              </button>
            ) : (
              <>
                <progress value={printer.progress} max={1} />
                <button onClick={printer.cancel}>Cancel</button>
              </>
            )}
          </div>
          <div className="paper-controls">
            <span>Paper</span>
            <HoldButton disabled={!printer.connected || printer.progress !== null} onStep={() => printer.feed(HOLD_STEP_LINES)}>
              Feed
            </HoldButton>
            <HoldButton disabled={!printer.connected || printer.progress !== null} onStep={() => printer.retract(HOLD_STEP_LINES)}>
              Retract
            </HoldButton>
            <span className="hint">hold to move</span>
          </div>
          <LogPanel logs={printer.logs} />
        </section>
      </main>
    </div>
  );
}
