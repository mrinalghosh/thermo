import type { usePrinter } from "../usePrinter.js";

const STATE_LABELS = {
  standby: "Ready",
  printing: "Printing",
  feeding: "Feeding",
  retracting: "Retracting",
  unknown: "Unknown state",
};

const ERROR_LABELS = {
  "no-paper": "Out of paper",
  overheated: "Overheated",
  "low-battery": "Battery low",
  unknown: "Printer error",
};

export function ConnectionBar({ printer }: { printer: ReturnType<typeof usePrinter> }) {
  const { connected, connecting, status, info, deviceName } = printer;

  return (
    <header className="topbar">
      <h1>
        thermo <small>for MXW01</small>
      </h1>
      <div className="status">
        {connected && status && (
          <>
            <span className={status.ok ? "chip" : "chip error"}>
              {status.ok ? STATE_LABELS[status.state] : ERROR_LABELS[status.error ?? "unknown"]}
            </span>
            <span className="chip" title="Approximate">
              Battery {status.batteryLevel}%
            </span>
            <span className="chip">{status.temperatureC}°C</span>
          </>
        )}
        {connected && (
          <span className="device" title={info?.firmware ? `Firmware ${info.firmware}` : undefined}>
            {deviceName ?? "Printer"}
          </span>
        )}
        {connected ? (
          <>
            <button onClick={printer.refreshStatus}>Refresh</button>
            <button onClick={printer.disconnect}>Disconnect</button>
          </>
        ) : (
          <>
            {deviceName && (
              <button className="link" onClick={printer.forget}>
                Choose another printer
              </button>
            )}
            <button className="primary" disabled={connecting} onClick={printer.connect}>
              {connecting ? "Connecting…" : deviceName ? `Reconnect ${deviceName}` : "Connect printer"}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
