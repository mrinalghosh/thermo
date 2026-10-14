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
}

export interface PrinterOptions {
  chunkSize?: number;
  chunkDelayMs?: number;
  responseTimeoutMs?: number;
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

/** Quiet period after which an in-flight print is assumed finished. */
const COMPLETION_QUIET_MS = 3000;
const FLOW_RESUME_TIMEOUT_MS = 30_000;

export class MXW01Printer {
  status: PrinterStatus | null = null;
  info: PrinterInfo = { firmware: null, headType: "unknown" };

  private readonly chunkSize: number;
  private readonly chunkDelayMs: number;
  private readonly responseTimeoutMs: number;
  private listeners = new Map<keyof Events, Set<(value: never) => void>>();
  private waiters = new Set<Waiter>();
  private unsubscribe: (() => void)[] = [];
  private paused = false;
  private resumeWaiters: (() => void)[] = [];
  private busy = false;
  private lastIntensity: number | null = null;

  constructor(
    readonly transport: Transport,
    options: PrinterOptions = {},
  ) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 5000;
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
    this.unsubscribe.push(
      this.transport.onNotify(this.handleNotification),
      this.transport.onDisconnect(this.handleDisconnect),
    );
    await this.transport.connect();
    this.log(`Connected to ${this.transport.name ?? "printer"}`);
    // The vendor app waits briefly, then asks for the firmware version.
    await sleep(200);
    const version = this.waitFor([Command.GetVersion], 1000, false);
    await this.transport.writeControl(commands.getVersion());
    await version;
    await this.getStatus().catch((error) => this.log(`Status unavailable: ${error.message}`));
  }

  async disconnect() {
    for (const off of this.unsubscribe.splice(0)) off();
    await this.transport.disconnect();
    this.rejectWaiters(new PrinterError("Disconnected", "disconnected"));
  }

  async getStatus(): Promise<PrinterStatus> {
    const reply = this.waitFor([Command.GetStatus], this.responseTimeoutMs);
    await this.transport.writeControl(commands.getStatus());
    const packet = await reply;
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

    this.log(`Printing ${lines} lines (${mode}, intensity 0x${intensity.toString(16)})`);
    const accepted = this.waitFor([Command.Print], this.responseTimeoutMs);
    await this.transport.writeControl(commands.printRequest(lines, mode));
    const ack = await accepted;
    // Some firmwares acknowledge with a bare `22 21 A9 00 00 00`, i.e. no status byte.
    if (!ack || (ack.payload[0] ?? 0x00) !== 0x00) {
      throw new PrinterError(`Printer rejected the job (${ack ? toHex(ack.payload) : "no reply"})`, "rejected");
    }

    for (let offset = 0; offset < data.length; offset += this.chunkSize) {
      if (options.signal?.aborted) {
        await this.transport.writeControl(commands.cancel()).catch(() => {});
        throw new PrinterError("Print cancelled", "aborted");
      }
      if (this.paused) await this.waitForResume();
      await this.transport.writeData(data.subarray(offset, offset + this.chunkSize));
      options.onProgress?.(Math.min(offset + this.chunkSize, data.length), data.length);
      if (this.chunkDelayMs) await sleep(this.chunkDelayMs);
    }
    await this.transport.writeControl(commands.flush());
    await this.waitForCompletion(lines);
    this.log("Print finished");
  }

  /**
   * The printer keeps printing for a while after the last byte arrives and streams A1
   * status frames meanwhile. Done = it reports standby, or it goes quiet.
   */
  private async waitForCompletion(lines: number) {
    const deadline = Date.now() + 15_000 + (lines / 10) * 1000;
    while (Date.now() < deadline) {
      const packet = await this.waitFor([Command.GetStatus, Command.PrintComplete], COMPLETION_QUIET_MS, false);
      if (!packet) return;
      if (packet.command !== Command.GetStatus) continue;
      const status = parseStatus(packet.payload);
      if (status && !status.ok) {
        throw new PrinterError(describeError(status.error), status.error ?? "unknown");
      }
      if (status?.state === "standby") return;
    }
    this.log("Timed out waiting for the printer to finish");
  }

  private waitForResume() {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new PrinterError("Printer did not resume after pausing", "timeout")),
        FLOW_RESUME_TIMEOUT_MS,
      );
      this.resumeWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
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
      this.log(`Flow control: ${flow}`);
      if (!this.paused) for (const resume of this.resumeWaiters.splice(0)) resume();
      return;
    }

    const packet = decodePacket(data);
    if (!packet) {
      this.log(`Unrecognized notification: ${toHex(data)}`);
      return;
    }
    const { command, payload } = packet;

    switch (command) {
      case Command.GetStatus: {
        const status = parseStatus(payload);
        if (status) {
          this.status = status;
          this.emit("status", status);
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
    this.lastIntensity = null;
    this.rejectWaiters(new PrinterError("Printer disconnected", "disconnected"));
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
