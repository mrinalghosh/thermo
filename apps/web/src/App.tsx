import { WebBluetoothTransport } from "@thermo/mxw01";
import { pack, rasterize, toGray } from "@thermo/render";
import { useCallback, useEffect, useMemo, useState } from "react";
import { canvasPixels, renderImage, renderTestPattern, renderText, type TextLayout } from "./compose.js";
import { Composer } from "./components/Composer.js";
import { Drawer } from "./components/Drawer.js";
import { HeaderBar, type DrawerKind } from "./components/HeaderBar.js";
import { SourceBar } from "./components/SourceBar.js";
import { Stage } from "./components/Stage.js";
import { StatusBar } from "./components/StatusBar.js";
import { DEFAULT_SETTINGS, type SourceKind } from "./settings.js";
import { usePrinter } from "./usePrinter.js";
import { useStoredState } from "./useStoredState.js";

/**
 * Longest strip we can handle: the A9 print request counts lines in 16 bits, and Chrome
 * silently blanks canvases taller than this. About 8 m of paper.
 */
const MAX_LINES = 65_535;

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
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const printer = usePrinter();
  // Stored settings from an older version may lack a newer source's entry.
  const dither = settings.dither[source] ?? DEFAULT_SETTINGS.dither[source];

  const canvas = useMemo(() => {
    if (source === "test") return renderTestPattern();
    if (source === "image") return image ? renderImage(image) : null;
    return textLayout.text.trim() ? renderText(textLayout) : null;
  }, [source, image, textLayout]);
  const tooLong = canvas !== null && canvas.height > MAX_LINES;

  // The preview shows the raster upright; rotation is applied only to what is sent.
  const raster = useMemo(
    () =>
      canvas && !tooLong
        ? rasterize(toGray(canvasPixels(canvas)), {
            mode: settings.mode,
            dither,
            brightness: settings.brightness,
            contrast: settings.contrast,
          })
        : null,
    [canvas, tooLong, dither, settings.mode, settings.brightness, settings.contrast],
  );

  const handlePrint = useCallback(() => {
    if (!raster || !printer.connected || printer.progress !== null) return;
    const ink = settings.rotate ? raster.ink.slice().reverse() : raster.ink;
    void printer.print(
      { mode: raster.mode, data: pack({ ...raster, ink }) },
      { darkness: settings.darkness, chunkSize: settings.chunkSize, chunkDelayMs: settings.chunkDelayMs },
    );
  }, [raster, printer, settings.rotate, settings.darkness, settings.chunkSize, settings.chunkDelayMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handlePrint();
      } else if (e.key === "Escape") {
        setDrawer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlePrint]);

  // A file dropped outside the image drop zone would make the browser navigate to it,
  // throwing away whatever was being composed.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  return (
    <div className="app">
      <HeaderBar printer={printer} drawer={drawer} onToggleDrawer={(kind) => setDrawer((d) => (d === kind ? null : kind))} />

      {!WebBluetoothTransport.isSupported() && (
        <div className="notice warn">
          This browser can’t reach Bluetooth printers. Use Chrome or Edge on desktop or Android. Safari, Firefox and
          iOS don’t support Web Bluetooth.
        </div>
      )}

      <SourceBar source={source} onChange={setSource} />

      <main className="main">
        <Stage
          raster={raster}
          notice={tooLong ? "too long to print in one go (max ≈ 8 m). split it up." : undefined}
          dither={dither}
          printer={printer}
          onPrint={handlePrint}
        />
        <Composer
          source={source}
          textLayout={textLayout}
          onTextLayout={setTextLayout}
          image={image}
          onImage={setImage}
          settings={settings}
          onSettings={setSettings}
        />
      </main>

      <StatusBar last={printer.logs.at(-1)} onOpenLog={() => setDrawer("log")} />

      {drawer && (
        <Drawer kind={drawer} onClose={() => setDrawer(null)} settings={settings} onSettings={setSettings} printer={printer} />
      )}
    </div>
  );
}
