import { SOURCE_LABELS, type SourceKind } from "../settings.js";

/** What to print: one chip per source, the active one inverted. */
export function SourceBar({ source, onChange }: { source: SourceKind; onChange: (source: SourceKind) => void }) {
  const kinds = Object.keys(SOURCE_LABELS) as SourceKind[];
  return (
    <nav className="fbar" role="tablist">
      {kinds.map((kind, i) => (
        <button
          key={kind}
          role="tab"
          aria-selected={source === kind}
          className={["chip", source === kind && "on", i === kinds.length - 1 && "end"].filter(Boolean).join(" ")}
          onClick={() => onChange(kind)}
        >
          {SOURCE_LABELS[kind]}
        </button>
      ))}
    </nav>
  );
}
