import type { ReactNode } from "react";

/** A labelled group of controls. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="sfield">
      <div className="slabel">
        {label}
        {hint && <span className="shint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Pick-one control: a row of joined buttons, the active one inverted. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={option === value}
          className={option === value ? "segbtn on" : "segbtn"}
          onClick={() => onChange(option)}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}

/** Range slider with a live readout. */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  format,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="srange">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="sval">{format ? format(value) : value}</span>
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className={on ? "toggle on" : "toggle"} aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="knob" />
      <span className="tlabel">{on ? "on" : "off"}</span>
    </button>
  );
}
