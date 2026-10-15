import type { DarknessLevel } from "@thermo/mxw01";
import { DITHER_METHODS } from "@thermo/render";
import type { TextLayout } from "../compose.js";
import { DITHER_LABELS, SOURCE_LABELS, type Settings, type SourceKind } from "../settings.js";
import { ImageEditor } from "./ImageEditor.js";
import { TextEditor } from "./TextEditor.js";
import { Field, Segmented, Slider, Toggle } from "./ui.js";

/** Right column: what to print, then how to print it. */
export function Composer({
  source,
  textLayout,
  onTextLayout,
  image,
  onImage,
  settings,
  onSettings,
}: {
  source: SourceKind;
  textLayout: TextLayout;
  onTextLayout: (layout: TextLayout) => void;
  image: ImageBitmap | null;
  onImage: (image: ImageBitmap | null) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
}) {
  const update = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

  return (
    <section className="compose">
      <div className="shead">
        <span>{SOURCE_LABELS[source]} · compose</span>
      </div>
      <div className="cbody">
        {source === "text" && <TextEditor layout={textLayout} onChange={onTextLayout} />}
        {source === "image" && <ImageEditor image={image} onChange={onImage} />}
        {source === "test" && (
          <p className="note">
            A calibration strip. The border should come out unbroken and the vertical lines straight. If they lean, or
            the print turns to noise partway down, data is being lost in transfer: try a longer delay or a smaller
            chunk under ⚙. The edge labels show which way up the strip reads.
          </p>
        )}

        <div className="ssub">print</div>

        <div className="frow">
          <Field label="mode">
            <Segmented
              options={["1bpp", "4bpp"] as const}
              labels={{ "1bpp": "1-bit", "4bpp": "4-bit gray" }}
              value={settings.mode}
              onChange={(mode) => update({ mode })}
            />
          </Field>
          <Field label="darkness">
            <Segmented
              options={[1, 2, 3, 4, 5] as const}
              value={settings.darkness}
              onChange={(darkness: DarknessLevel) => update({ darkness })}
            />
          </Field>
        </div>
        <Field label="dither">
          <Segmented
            options={DITHER_METHODS}
            labels={DITHER_LABELS}
            value={settings.dither[source]}
            onChange={(method) => update({ dither: { ...settings.dither, [source]: method } })}
          />
        </Field>
        <div className="frow">
          <Field label="brightness">
            <Slider min={-100} max={100} value={settings.brightness} onChange={(brightness) => update({ brightness })} format={signed} />
          </Field>
          <Field label="contrast">
            <Slider min={-100} max={100} value={settings.contrast} onChange={(contrast) => update({ contrast })} format={signed} />
          </Field>
        </div>
        <Field label="rotate 180°" hint="if strips read upside down">
          <Toggle on={settings.rotate} onChange={(rotate) => update({ rotate })} />
        </Field>
      </div>
    </section>
  );
}
