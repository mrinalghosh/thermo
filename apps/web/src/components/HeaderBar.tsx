import { WebBluetoothTransport } from "@thermo/mxw01";
import type { usePrinter } from "../usePrinter.js";

export type DrawerKind = "settings" | "log";

const STATE_LABELS = {
  standby: "ready",
  printing: "printing",
  feeding: "feeding",
  retracting: "retracting",
  unknown: "busy",
};

const ERROR_LABELS = {
  "no-paper": "out of paper",
  overheated: "overheated",
  "low-battery": "battery low",
  unknown: "printer error",
};

/** Top chrome: brand, live printer readout, connection and drawer toggles. */
export function HeaderBar({
  printer,
  drawer,
  onToggleDrawer,
}: {
  printer: ReturnType<typeof usePrinter>;
  drawer: DrawerKind | null;
  onToggleDrawer: (drawer: DrawerKind) => void;
}) {
  const { connected, connecting, status, deviceName } = printer;

  return (
    <header className="hbar">
      <span className="brand">
        thermo<span>/mxw01</span>
      </span>

      <span className="readout">
        {connected ? (
          <>
            <b>{deviceName ?? "printer"}</b>
            {status && (
              <>
                {" · "}
                {status.ok ? (
                  STATE_LABELS[status.state]
                ) : (
                  <span className="warn">{ERROR_LABELS[status.error ?? "unknown"]}</span>
                )}
                <span className="readout-extra">
                  {" · "}
                  <span title="battery (approximate)">{status.batteryLevel}%</span>
                  {" · "}
                  <span title="print head temperature">{status.temperatureC}°c</span>
                </span>
              </>
            )}
          </>
        ) : (
          "no printer"
        )}
      </span>

      {connected ? (
        <button className="hbtn" onClick={printer.disconnect}>
          disconnect
        </button>
      ) : (
        <button className="hbtn on" disabled={connecting || !WebBluetoothTransport.isSupported()} onClick={printer.connect}>
          {connecting ? "connecting…" : deviceName ? "reconnect" : "connect"}
        </button>
      )}
      <button
        className={drawer === "log" ? "hbtn on" : "hbtn"}
        aria-pressed={drawer === "log"}
        onClick={() => onToggleDrawer("log")}
      >
        log
      </button>
      <button
        className={drawer === "settings" ? "hbtn on" : "hbtn"}
        aria-pressed={drawer === "settings"}
        title="settings"
        onClick={() => onToggleDrawer("settings")}
      >
        ⚙
      </button>
    </header>
  );
}
