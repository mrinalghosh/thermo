import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../settings.js";
import type { LogEntry, usePrinter } from "../usePrinter.js";
import type { DrawerKind } from "./HeaderBar.js";
import { Field, Segmented, Slider } from "./ui.js";

export function Drawer({
  kind,
  onClose,
  settings,
  onSettings,
  printer,
}: {
  kind: DrawerKind;
  onClose: () => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  printer: ReturnType<typeof usePrinter>;
}) {
  return (
    <aside className="panel" role="dialog" aria-label={kind}>
      <div className="phead">
        <span>{kind === "log" ? "activity log" : "settings"}</span>
        <span className="pactions">
          {kind === "log" && printer.logs.length > 0 && <CopyLog logs={printer.logs} />}
          <button className="pclose" onClick={onClose} title="close">
            ✕
          </button>
        </span>
      </div>
      {kind === "log" ? (
        <LogList logs={printer.logs} />
      ) : (
        <SettingsBody settings={settings} onSettings={onSettings} printer={printer} />
      )}
    </aside>
  );
}

function SettingsBody({
  settings,
  onSettings,
  printer,
}: {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  printer: ReturnType<typeof usePrinter>;
}) {
  const update = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });

  return (
    <div className="pbody">
      <Field label="chunk size" hint="bytes per write">
        <Segmented options={[16, 24, 48, 96] as const} value={settings.chunkSize as 16 | 24 | 48 | 96} onChange={(chunkSize) => update({ chunkSize })} />
      </Field>
      <Field label="chunk delay">
        <Slider min={0} max={50} value={settings.chunkDelayMs} onChange={(chunkDelayMs) => update({ chunkDelayMs })} format={(v) => `${v} ms`} />
      </Field>
      <p className="note">
        Bluetooth transfer pacing, applied from the next print. Sizes stay a divisor or multiple of one 48-byte row, so a
        lost write can never shift later rows.
      </p>

      {(printer.connected || printer.deviceName) && (
        <Field label="printer">
          <div className="datarow">
            {printer.connected && (
              <button className="preset" onClick={printer.refreshStatus}>
                refresh status
              </button>
            )}
            {printer.deviceName && (
              <button className="preset" disabled={printer.progress !== null} onClick={printer.forget}>
                forget {printer.deviceName}
              </button>
            )}
          </div>
        </Field>
      )}

      <button className="preset" onClick={() => onSettings(DEFAULT_SETTINGS)}>
        reset to defaults
      </button>
    </div>
  );
}

/** Copies the log oldest-first with millisecond times, for pasting into a bug report. */
function CopyLog({ logs }: { logs: LogEntry[] }) {
  const [label, setLabel] = useState<"copy" | "copied" | "copy failed">("copy");
  useEffect(() => {
    if (label === "copy") return;
    const timer = setTimeout(() => setLabel("copy"), 1500);
    return () => clearTimeout(timer);
  }, [label]);

  const copy = async () => {
    const text = logs
      .map((entry) => {
        // Naming any time field drops the defaults, so all of them are spelled out.
        const time = entry.time.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
          hour12: false,
        });
        return `${time}  ${entry.error ? "! " : ""}${entry.message}`;
      })
      .join("\n");
    await navigator.clipboard.writeText(text);
  };

  return (
    <button
      className="pclose"
      onClick={() => copy().then(() => setLabel("copied"), () => setLabel("copy failed"))}
      title="copy the log to the clipboard"
    >
      {label}
    </button>
  );
}

function LogList({ logs }: { logs: LogEntry[] }) {
  if (!logs.length) return <div className="pbody note">Nothing yet. Connect a printer to see what it says.</div>;
  return (
    <ol className="pbody log">
      {[...logs].reverse().map((entry, i) => (
        <li key={logs.length - i} className={entry.error ? "warn" : undefined}>
          <time>{entry.time.toLocaleTimeString([], { hour12: false })}</time>
          <span>{entry.message}</span>
        </li>
      ))}
    </ol>
  );
}
