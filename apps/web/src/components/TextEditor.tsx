import type { TextLayout } from "../compose.js";

export function TextEditor({ layout, onChange }: { layout: TextLayout; onChange: (layout: TextLayout) => void }) {
  const update = (patch: Partial<TextLayout>) => onChange({ ...layout, ...patch });

  return (
    <div className="editor">
      <textarea
        rows={8}
        value={layout.text}
        placeholder="Type something to print…"
        onChange={(e) => update({ text: e.target.value })}
      />
      <div className="row">
        <label>
          Font
          <select value={layout.font} onChange={(e) => update({ font: e.target.value as TextLayout["font"] })}>
            <option value="sans-serif">Sans</option>
            <option value="serif">Serif</option>
            <option value="monospace">Mono</option>
          </select>
        </label>
        <label>
          Size
          <input
            type="number"
            min={8}
            max={200}
            value={layout.size}
            onChange={(e) => update({ size: Math.max(8, Number(e.target.value) || 8) })}
          />
        </label>
        <label>
          Align
          <select value={layout.align} onChange={(e) => update({ align: e.target.value as TextLayout["align"] })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={layout.bold} onChange={(e) => update({ bold: e.target.checked })} />
          Bold
        </label>
      </div>
    </div>
  );
}
