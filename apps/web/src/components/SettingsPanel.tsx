import type { DarknessLevel } from "@thermo/mxw01";
import { DITHER_METHODS, type DitherMethod } from "@thermo/render";
import { DITHER_LABELS, type Settings, type SourceKind } from "../settings.js";

export function SettingsPanel({
  settings,
  source,
  onChange,
}: {
  settings: Settings;
  source: SourceKind;
  onChange: (settings: Settings) => void;
}) {
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <div className="settings">
      <div className="row">
        <label>
          Mode
          <select value={settings.mode} onChange={(e) => update({ mode: e.target.value as Settings["mode"] })}>
            <option value="1bpp">Black &amp; white</option>
            <option value="4bpp">Grayscale (16 levels, slower)</option>
          </select>
        </label>
        <label>
          Dithering
          <select
            value={settings.dither[source]}
            onChange={(e) => update({ dither: { ...settings.dither, [source]: e.target.value as DitherMethod } })}
          >
            {DITHER_METHODS.map((method) => (
              <option key={method} value={method}>
                {DITHER_LABELS[method]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Slider label="Darkness" min={1} max={5} value={settings.darkness} onChange={(v) => update({ darkness: v as DarknessLevel })} />
      <Slider label="Brightness" min={-100} max={100} value={settings.brightness} onChange={(v) => update({ brightness: v })} />
      <Slider label="Contrast" min={-100} max={100} value={settings.contrast} onChange={(v) => update({ contrast: v })} />

      <label className="check">
        <input type="checkbox" checked={settings.rotate} onChange={(e) => update({ rotate: e.target.checked })} />
        Rotate 180° (if prints come out upside down)
      </label>

      <details>
        <summary>Advanced: Bluetooth transfer</summary>
        <p className="hint">Applies the next time you connect. Keep the chunk size a divisor of 48 (48, 24, 16…) so rows stay aligned. If prints come out skewed, try a longer delay.</p>
        <div className="row">
          <label>
            Chunk size (bytes)
            <input
              type="number"
              min={8}
              max={192}
              value={settings.chunkSize}
              onChange={(e) => update({ chunkSize: Math.max(8, Number(e.target.value) || 48) })}
            />
          </label>
          <label>
            Delay between chunks (ms)
            <input
              type="number"
              min={0}
              max={100}
              value={settings.chunkDelayMs}
              onChange={(e) => update({ chunkDelayMs: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {label} <output>{value}</output>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
