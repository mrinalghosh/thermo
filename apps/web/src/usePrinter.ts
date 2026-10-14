import {
  MXW01Printer,
  WebBluetoothTransport,
  type PrintJob,
  type PrintOptions,
  type PrinterInfo,
  type PrinterStatus,
} from "@thermo/mxw01";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LogEntry {
  time: Date;
  message: string;
  error?: boolean;
}

export interface TransferSettings {
  chunkSize: number;
  chunkDelayMs: number;
}

const STATUS_POLL_MS = 30_000;

export function usePrinter(transfer: TransferSettings) {
  const printerRef = useRef<MXW01Printer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [info, setInfo] = useState<PrinterInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const log = useCallback((message: string, error = false) => {
    setLogs((entries) => [...entries.slice(-199), { time: new Date(), message, error }]);
  }, []);

  const fail = useCallback((error: unknown) => log((error as Error).message ?? String(error), true), [log]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      let printer = printerRef.current;
      if (!printer) {
        const transport = await WebBluetoothTransport.request();
        printer = new MXW01Printer(transport, transfer);
        printer.on("status", setStatus);
        printer.on("info", setInfo);
        printer.on("log", (message) => log(message));
        printer.on("disconnect", () => setConnected(false));
        printerRef.current = printer;
      }
      await printer.connect();
      setConnected(true);
    } catch (error) {
      // Closing the device chooser is not an error worth reporting.
      if ((error as Error).name !== "NotFoundError") fail(error);
    } finally {
      setConnecting(false);
    }
  }, [transfer, log, fail]);

  const disconnect = useCallback(async () => {
    await printerRef.current?.disconnect().catch(fail);
    setConnected(false);
  }, [fail]);

  /** Choose a different printer next time. */
  const forget = useCallback(async () => {
    await disconnect();
    printerRef.current = null;
    setInfo(null);
    setStatus(null);
  }, [disconnect]);

  const print = useCallback(
    async (job: PrintJob, options: PrintOptions) => {
      const printer = printerRef.current;
      if (!printer) return;
      abortRef.current = new AbortController();
      setProgress(0);
      try {
        await printer.print(job, {
          ...options,
          signal: abortRef.current.signal,
          onProgress: (sent, total) => setProgress(sent / total),
        });
      } catch (error) {
        fail(error);
      } finally {
        setProgress(null);
        abortRef.current = null;
      }
    },
    [fail],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const run = useCallback(
    (action: (printer: MXW01Printer) => Promise<unknown>): Promise<unknown> => {
      const printer = printerRef.current;
      return printer ? action(printer).catch(fail) : Promise.resolve();
    },
    [fail],
  );

  // Keep battery and temperature fresh while idle.
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      const printer = printerRef.current;
      if (printer && !printer.printing) printer.getStatus().catch(() => {});
    }, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [connected]);

  return {
    connected,
    connecting,
    status,
    info,
    deviceName: printerRef.current?.transport.name,
    progress,
    logs,
    connect,
    disconnect,
    forget,
    print,
    cancel,
    refreshStatus: () => run((p) => p.getStatus()),
    feed: (lines: number) => run((p) => p.feed(lines)),
    retract: (lines: number) => run((p) => p.retract(lines)),
  };
}
