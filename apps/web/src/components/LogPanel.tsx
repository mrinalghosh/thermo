import type { LogEntry } from "../usePrinter.js";

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  const last = logs.at(-1);

  return (
    <>
      {last?.error && <p className="error-text">{last.message}</p>}
      <details className="log">
        <summary>Activity log ({logs.length})</summary>
        <ol>
          {logs.map((entry, i) => (
            <li key={i} className={entry.error ? "error-text" : undefined}>
              <time>{entry.time.toLocaleTimeString()}</time> {entry.message}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
