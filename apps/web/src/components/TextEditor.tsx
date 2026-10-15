import type { TextLayout } from "../compose.js";
import { Field, Segmented, Slider } from "./ui.js";

const FONT_LABELS = { "sans-serif": "sans", serif: "serif", monospace: "mono" } as const;

export function TextEditor({ layout, onChange }: { layout: TextLayout; onChange: (layout: TextLayout) => void }) {
  const update = (patch: Partial<TextLayout>) => onChange({ ...layout, ...patch });

  return (
    <>
      <Field label="text">
        <textarea
          className="tinput"
          rows={7}
          value={layout.text}
          placeholder="type something to print…"
          spellCheck={false}
          onChange={(e) => update({ text: e.target.value })}
        />
      </Field>
      <Field label="font">
        <Segmented
          options={["sans-serif", "serif", "monospace"] as const}
          labels={FONT_LABELS}
          value={layout.font}
          onChange={(font) => update({ font })}
        />
      </Field>
      <Field label="size">
        <Slider min={10} max={120} value={layout.size} onChange={(size) => update({ size })} format={(v) => `${v}px`} />
      </Field>
      <div className="frow">
        <Field label="align">
          <Segmented options={["left", "center", "right"] as const} value={layout.align} onChange={(align) => update({ align })} />
        </Field>
        <Field label="weight">
          <Segmented
            options={["regular", "bold"] as const}
            value={layout.bold ? "bold" : "regular"}
            onChange={(weight) => update({ bold: weight === "bold" })}
          />
        </Field>
      </div>
    </>
  );
}
