import { commands } from "./commands.js";
import {
  BYTES_PER_LINE,
  Command,
  DEFAULT_CHUNK_DELAY_MS,
  DEFAULT_CHUNK_SIZE,
  MIN_LINES,
  type PrintMode,
} from "./constants.js";
import {
  coverageRatio,
  intensityForLevel,
  limitIntensityForHeat,
  startDelayMs,
  type DarknessLevel,
} from "./density.js";
import { decodePacket, flowControlSignal, toHex } from "./packet.js";
import { buildSignResponse } from "./sign.js";
import {
  headTypeFromFirmware,
  parseStatus,
  type HeadType,
  type PrinterErrorKind,
  type PrinterStatus,
} from "./status.js";
import type { Transport } from "./transport.js";

export interface PrintJob {
  mode: PrintMode;
  /** Packed raster rows: 48 bytes per line in 1bpp mode, 192 in 4bpp mode. */
  data: Uint8Array;
}

export interface PrintOptions {
  /** Darkness on the vendor app's 1-5 scale. Ignored when `intensity` is set. Default 3. */
  darkness?: DarknessLevel;
  /** Raw intensity byte (0-255). */
  intensity?: number;
  /** Lower the intensity when the head is hot, like the vendor app. Default true. */
  heatProtection?: boolean;
  signal?: AbortSignal;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Override the printer's default transfer pacing for this job. */
  chunkSize?: number;
  chunkDelayMs?: number;
}

export interface PrinterOptions {
  chunkSize?: number;
  chunkDelayMs?: number;
  responseTimeoutMs?: number;
  /** How often to ask for status while waiting for a print to finish. Default 500 ms. */
  statusPollMs?: number;
}

export interface PrinterInfo {
  firmware: string | null;
  headType: HeadType;
}

export type PrinterErrorReason =
  | PrinterErrorKind
  | "busy"
  | "rejected"
  | "timeout"
  | "disconnected"
  | "aborted";

export class PrinterError extends Error {
  constructor(
    message: string,
    readonly reason: PrinterErrorReason,
  ) {
    super(message);
    this.name = "PrinterError";
  }
}

interface Events {
  status: PrinterStatus;
  info: PrinterInfo;
  log: string;
  disconnect: void;
}

interface Waiter {
  commands: number[];
  resolve: (packet: { command: number; payload: Uint8Array } | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A printer that stops answering status requests for this long is assumed finished. */
const COMPLETION_QUIET_MS = 3000;
/** Stop waiting if the printer still hasn't reported printing this long after the data. */
const COMPLETION_START_MS = 5000;
const STATUS_REPLY_TIMEOUT_MS = 1000;
/** How often to measure a status round trip during the transfer. */
const PROBE_INTERVAL_MS = 1000;
const FLOW_RESUME_TIMEOUT_MS = 30_000;

export class MXW01Printer {
  status: PrinterStatus | null = null;
  info: PrinterInfo = { firmware: null, headType: "unknown" };

  private readonly chunkSize: number;
  private readonly chunkDelayMs: number;
  private readonly responseTimeoutMs: number;
  private readonly statusPollMs: number;
  private listeners = new Map<keyof Events, Set<(value: never) => void>>();
  private waiters = new Set<Waiter>();
  private unsubscribe: (() => void)[] = [];
  private paused = false;
  private resumeWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private busy = false;
  private lastIntensity: number | null = null;
  // Timing for the activity log, so slow prints can be traced to a phase.
  private jobStartedAt = 0;
  private jobState: PrinterStatus["state"] | null = null;
  private pausedAt: number | null = null;

  constructor(
    readonly transport: Transport,
    options: PrinterOptions = {},
  ) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 5000;
    this.statusPollMs = options.statusPollMs ?? 500;
  }

  get connected() {
    return this.transport.connected;
  }

  get printing() {
    return this.busy;
  }

  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Safe to call again after a disconnect to reconnect the same device. */
  async connect() {
    for (const off of this.unsubscribe.splice(0)) off();
    // The printer may have been power-cycled since we last talked: resend intensity.
    this.paused = false;
    this.pausedAt = null;
    this.lastIntensity = null;
    this.unsubscribe.push(
      this.transport.onNotify(this.handleNotification),
      this.transport.onDisconnect(this.handleDisconnect),
    );
    await this.transport.connect();
    this.log(`Connected to ${this.transport.name ?? "printer"}`);
    if (this.transport.details) this.log(this.transport.details);
    // The vendor app waits briefly, then asks for the firmware version.
    await sleep(200);
    await this.request(commands.getVersion(), Command.GetVersion, 1000, false);
    await this.getStatus().catch((error) => this.log(`Status unavailable: ${error.message}`));
  }

  async disconnect() {
    for (const off of this.unsubscribe.splice(0)) off();
    await this.transport.disconnect();
    this.rejectWaiters(new PrinterError("Disconnected", "disconnected"));
  }

  async getStatus(): Promise<PrinterStatus> {
    const packet = await this.request(commands.getStatus(), Command.GetStatus, this.responseTimeoutMs);
    const status = packet && parseStatus(packet.payload);
    if (!status) throw new PrinterError("Malformed status response", "timeout");
    return status;
  }

  async feed(lines: number) {
    this.assertIdle();
    await this.transport.writeControl(commands.feed(lines));
  }

  async retract(lines: number) {
    this.assertIdle();
    await this.transport.writeControl(commands.retract(lines));
  }

  private assertIdle() {
    if (this.busy) throw new PrinterError("Can't move paper while printing", "busy");
  }

  async print(job: PrintJob, options: PrintOptions = {}) {
    if (this.busy) throw new PrinterError("A print job is already running", "busy");
    this.busy = true;
    this.jobStartedAt = performance.now();
    this.jobState = null;
    try {
      await this.runJob(job, options);
    } finally {
      this.busy = false;
    }
  }

  private async runJob(job: PrintJob, options: PrintOptions) {
    const { mode } = job;
    const bytesPerLine = BYTES_PER_LINE[mode];
    if (job.data.length === 0 || job.data.length % bytesPerLine !== 0) {
      throw new RangeError(`Raster length must be a positive multiple of ${bytesPerLine} bytes`);
    }
    const data = padLines(job.data, bytesPerLine, MIN_LINES);
    const lines = data.length / bytesPerLine;
    if (lines > 0xffff) throw new RangeError("Job is too long (max 65535 lines)");

    const status = await this.getStatus();
    if (!status.ok) {
      throw new PrinterError(describeError(status.error), status.error ?? "unknown");
    }

    const heat = {
      mode,
      temperatureC: status.temperatureC,
      headType: this.info.headType,
      coverage: mode === "1bpp" ? coverageRatio(job.data) : 0,
    };
    let intensity = options.intensity ?? intensityForLevel(options.darkness ?? 3, mode);
    if (options.heatProtection !== false) intensity = limitIntensityForHeat(intensity, heat);
    const intensityChanged = intensity !== this.lastIntensity;
    if (intensityChanged) {
      await this.transport.writeControl(commands.setIntensity(intensity));
      this.lastIntensity = intensity;
    }
    const delay = startDelayMs(heat, intensityChanged);
    if (delay) await sleep(delay);

    const chunkSize = options.chunkSize ?? this.chunkSize;
    const chunkDelayMs = options.chunkDelayMs ?? this.chunkDelayMs;
    this.log(
      `Printing ${lines} lines (${mode}, intensity 0x${intensity.toString(16)}) · ` +
        `${data.length} B as ${chunkSize} B writes every ${chunkDelayMs} ms`,
    );
    const ack = await this.request(commands.printRequest(lines, mode), Command.Print, this.responseTimeoutMs);
    // Some firmwares acknowledge with a bare `22 21 A9 00 00 00`, i.e. no status byte.
    if (!ack || (ack.payload[0] ?? 0x00) !== 0x00) {
      throw new PrinterError(`Printer rejected the job (${ack ? toHex(ack.payload) : "no reply"})`, "rejected");
    }
    this.log(`${this.elapsed()} Printer accepted the job`);

    const sendStartedAt = performance.now();
    let writes = 0;
    let writeMs = 0;
    let slowestWriteMs = 0;
    let probe: Promise<void> | null = null;
    let nextProbeAt = sendStartedAt + PROBE_INTERVAL_MS;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      if (this.paused) await this.waitForResume(options.signal);
      if (options.signal?.aborted) throw await this.cancelJob();
      // Status replies to the probes below can report a problem mid-transfer.
      if (this.status && !this.status.ok) {
        await this.cancelJob();
        throw new PrinterError(describeError(this.status.error), this.status.error ?? "unknown");
      }
      const writeStartedAt = performance.now();
      await this.transport.writeData(data.subarray(offset, offset + chunkSize));
      // A write that returns instantly at any rate means the host applies no backpressure.
      const took = performance.now() - writeStartedAt;
      writes++;
      writeMs += took;
      slowestWriteMs = Math.max(slowestWriteMs, took);
      options.onProgress?.(Math.min(offset + chunkSize, data.length), data.length);
      if (!probe && performance.now() >= nextProbeAt) {
        probe = this.probeStatus().finally(() => {
          probe = null;
          nextProbeAt = performance.now() + PROBE_INTERVAL_MS;
        });
      }
      if (chunkDelayMs) await sleep(chunkDelayMs);
    }
    const sendMs = Math.max(performance.now() - sendStartedAt, 0.001);
    this.log(
      `${this.elapsed()} Sent ${data.length} B in ${seconds(sendMs)} ` +
        `(${(data.length / sendMs).toFixed(1)} kB/s, a write every ${(sendMs / writes).toFixed(1)} ms; ` +
        `write calls took ${(writeMs / writes).toFixed(1)} ms avg, ${slowestWriteMs.toFixed(1)} ms max)`,
    );
    await this.transport.writeControl(commands.flush());
    const how = await this.waitForCompletion(lines, options.signal);
    this.log(`${this.elapsed()} Print finished (${how})`);
  }

  /**
   * The printer keeps printing long after the last byte arrives, and some firmwares send
   * nothing meanwhile, so ask. Done = it has reported printing and then standby. If it stops
   * answering, assume it's done once it has been quiet for a while.
   */
  private async waitForCompletion(lines: number, signal?: AbortSignal) {
    const deadline = Date.now() + 15_000 + (lines / 10) * 1000;
    const startedAt = performance.now();
    let lastReplyAt = startedAt;
    let started = false;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw await this.cancelJob();
      const packet = await this.request(commands.getStatus(), Command.GetStatus, STATUS_REPLY_TIMEOUT_MS, false);
      if (signal?.aborted) throw await this.cancelJob();
      const status = packet && parseStatus(packet.payload);
      const now = performance.now();
      if (status) {
        lastReplyAt = now;
        if (!status.ok) throw new PrinterError(describeError(status.error), status.error ?? "unknown");
        if (status.state !== "standby") started = true;
        else if (started) return "printer reported standby";
        else if (now - startedAt >= COMPLETION_START_MS) return "printer never reported printing";
      } else if (now - lastReplyAt >= COMPLETION_QUIET_MS) {
        return `no status for ${seconds(now - lastReplyAt)}`;
      }
      await sleep(this.statusPollMs, signal);
    }
    return "timed out waiting for the printer";
  }

  /** Tells the printer to drop the job; returns the error to throw. */
  private async cancelJob() {
    await this.transport.writeControl(commands.cancel()).catch(() => {});
    return new PrinterError("Print cancelled", "aborted");
  }

  /**
   * Asks for status mid-transfer and logs the round trip. The request queues behind the data
   * already written, so a slow reply means data is backing up on its way to the printer.
   */
  private async probeStatus() {
    const sentAt = performance.now();
    try {
      const packet = await this.request(commands.getStatus(), Command.GetStatus, STATUS_REPLY_TIMEOUT_MS, false);
      if (!this.busy) return; // the job ended (cancelled or failed) while waiting
      const status = packet && parseStatus(packet.payload);
      this.log(
        status
          ? `${this.elapsed()} Status reply in ${(performance.now() - sentAt).toFixed(0)} ms (${status.state})`
          : `${this.elapsed()} No status reply within ${seconds(STATUS_REPLY_TIMEOUT_MS)}`,
      );
    } catch {
      // A disconnect or cancel is reported by the transfer itself.
    }
  }

  /** Resolves when the printer resumes or the job is cancelled; rejects on timeout or disconnect. */
  private waitForResume(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return resolve();
      const settle = (error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.resumeWaiters = this.resumeWaiters.filter((w) => w !== waiter);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => settle();
      const waiter = { resolve: () => settle(), reject: (error: Error) => settle(error) };
      const timer = setTimeout(
        () => settle(new PrinterError("Printer did not resume after pausing", "timeout")),
        FLOW_RESUME_TIMEOUT_MS,
      );
      signal?.addEventListener("abort", onAbort);
      this.resumeWaiters.push(waiter);
    });
  }

  /** Sends a control packet and waits for the reply, listening before sending so a fast reply isn't missed. */
  private async request(packet: Uint8Array, reply: number, timeoutMs: number, required = true) {
    const replied = this.waitFor([reply], timeoutMs, required);
    try {
      await this.transport.writeControl(packet);
    } catch (error) {
      replied.catch(() => {}); // a disconnect may still reject the abandoned waiter
      throw error;
    }
    return replied;
  }

  private waitFor(commands: number[], timeoutMs: number, required = true) {
    return new Promise<{ command: number; payload: Uint8Array } | null>((resolve, reject) => {
      const waiter: Waiter = {
        commands,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          if (required) {
            reject(new PrinterError(`Timed out waiting for 0x${commands[0]!.toString(16)}`, "timeout"));
          } else {
            resolve(null);
          }
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private handleNotification = (data: Uint8Array) => {
    const flow = flowControlSignal(data);
    if (flow) {
      this.paused = flow === "pause";
      let pausedFor = "";
      if (this.paused) {
        this.pausedAt ??= performance.now();
      } else if (this.pausedAt !== null) {
        pausedFor = ` after ${seconds(performance.now() - this.pausedAt)}`;
        this.pausedAt = null;
      }
      this.log(`${this.busy ? `${this.elapsed()} ` : ""}Flow control: ${flow}${pausedFor}`);
      if (!this.paused) for (const waiter of [...this.resumeWaiters]) waiter.resolve();
      return;
    }

    const packet = decodePacket(data);
    if (!packet) {
      this.log(`Unrecognized notification: ${toHex(data)}`);
      return;
    }
    const { command, payload } = packet;
    // Anything else the printer volunteers during a job may be how it signals progress.
    if (this.busy && command !== Command.GetStatus && command !== Command.Print) {
      this.log(`${this.elapsed()} Printer sent 0x${command.toString(16)}: ${toHex(payload) || "(no payload)"}`);
    }

    switch (command) {
      case Command.GetStatus: {
        const status = parseStatus(payload);
        if (status) {
          this.status = status;
          this.emit("status", status);
          if (this.busy) {
            // The first frame of a job is the pre-print check; log changes after that.
            if (this.jobState !== null && status.state !== this.jobState) {
              this.log(`${this.elapsed()} Printer state: ${status.state}`);
            }
            this.jobState = status.state;
          }
        }
        break;
      }
      case Command.GetVersion: {
        const firmware = new TextDecoder().decode(payload).replace(/\0+$/, "").trim();
        if (firmware) {
          this.info = { firmware, headType: headTypeFromFirmware(firmware) };
          this.emit("info", this.info);
          this.log(`Firmware ${firmware}`);
        }
        break;
      }
      case Command.SignChallenge:
        void this.answerSignChallenge(payload);
        break;
      case Command.StatusPollRequest:
        // The vendor app answers with a zero-length paper move, which elicits status.
        setTimeout(() => void this.transport.writeControl(commands.feed(0)).catch(() => {}), 700);
        break;
    }

    for (const waiter of this.waiters) {
      if (!waiter.commands.includes(command)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(packet);
    }
  };

  private async answerSignChallenge(payload: Uint8Array) {
    if (payload.length < 10) {
      this.log("Ignoring malformed signing challenge");
      return;
    }
    try {
      await this.transport.writeControl(await buildSignResponse(payload.subarray(0, 10)));
      this.log("Answered signing challenge");
    } catch (error) {
      this.log(`Signing reply failed: ${(error as Error).message}`);
    }
  }

  private handleDisconnect = () => {
    this.paused = false;
    this.pausedAt = null;
    this.lastIntensity = null;
    const error = new PrinterError("Printer disconnected", "disconnected");
    this.rejectWaiters(error);
    for (const waiter of [...this.resumeWaiters]) waiter.reject(error);
    this.log("Disconnected");
    this.emit("disconnect", undefined);
  };

  private rejectWaiters(error: Error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as (value: Events[K]) => void)(value);
  }

  private log(message: string) {
    this.emit("log", message);
  }

  /** Time since the current job started, e.g. "+1.25 s". */
  private elapsed() {
    return `+${seconds(performance.now() - this.jobStartedAt)}`;
  }
}

function padLines(data: Uint8Array, bytesPerLine: number, minLines: number) {
  const minBytes = bytesPerLine * minLines;
  if (data.length >= minBytes) return data;
  const padded = new Uint8Array(minBytes);
  padded.set(data);
  return padded;
}

function describeError(error: PrinterErrorKind | null) {
  switch (error) {
    case "no-paper":
      return "The printer is out of paper (or the lid is open)";
    case "overheated":
      return "The print head is overheated; let it cool down";
    case "low-battery":
      return "The printer battery is too low";
    default:
      return "The printer reported an error";
  }
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}
