import type { LogEntry } from "../usePrinter.js";

/** Bottom chrome: the printer's latest word on the left, key hints on the right. */
export function StatusBar({ last, onOpenLog }: { last: LogEntry | undefined; onOpenLog: () => void }) {
  return (
    <footer className="sbar">
      <button className={last?.error ? "slast warn" : "slast"} onClick={onOpenLog} title="open the activity log">
        {last ? `${last.error ? "!" : ">"} ${last.message}` : "> connect a printer to begin"}
      </button>
      <span className="sbar-hint">⌘↵ to print · hold feed / retract to move paper</span>
    </footer>
  );
}
