import { describe, expect, it } from "vitest";
import { Command, MXW01Printer, PrinterError } from "../src/index.js";
import { FakePrinter } from "./fake-printer.js";

const options = { chunkDelayMs: 0, responseTimeoutMs: 200 };

async function connected(fake: FakePrinter) {
  const printer = new MXW01Printer(fake, options);
  await printer.connect();
  return printer;
}

describe("MXW01Printer", () => {
  it("reads firmware and status on connect", async () => {
    const printer = await connected(new FakePrinter({ firmware: "1.9.3.1.1" }));
    expect(printer.info).toEqual({ firmware: "1.9.3.1.1", headType: "low-voltage" });
    expect(printer.status).toMatchObject({ state: "standby", batteryLevel: 90, ok: true });
  });

  it("runs the full print sequence", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    const progress: number[] = [];

    await printer.print(
      { mode: "1bpp", data: new Uint8Array(48 * 200).fill(0x0f) },
      { darkness: 3, onProgress: (sent) => progress.push(sent) },
    );

    expect(fake.sentCommands).toEqual([
      Command.GetVersion,
      Command.GetStatus,
      Command.GetStatus,
      Command.SetIntensity,
      Command.Print,
      Command.PrintDataFlush,
    ]);
    expect(fake.sentBytes).toBe(48 * 200);
    // One row per write: a lost or truncated write can't shift later rows.
    expect(fake.data.every((chunk) => chunk.length === 48)).toBe(true);
    expect(progress.at(-1)).toBe(48 * 200);
    expect(printer.printing).toBe(false);
  });

  it("pads short jobs to 90 lines and declares the padded line count", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    await printer.print({ mode: "4bpp", data: new Uint8Array(192 * 10) });

    const request = fake.control.find((packet) => packet[2] === Command.Print)!;
    expect(request[6]! | (request[7]! << 8)).toBe(90);
    expect(request[9]).toBe(0x02);
    expect(fake.sentBytes).toBe(192 * 90);
  });

  it("only resends intensity when it changes", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    const job = { mode: "1bpp" as const, data: new Uint8Array(48 * 90) };
    await printer.print(job, { darkness: 3 });
    await printer.print(job, { darkness: 3 });
    await printer.print(job, { darkness: 5 });
    expect(fake.sentCommands.filter((c) => c === Command.SetIntensity)).toHaveLength(2);
  });

  it("refuses to print when the printer reports an error", async () => {
    const fake = new FakePrinter({ status: [0, 0, 0, 90, 30, 0, 1, 9] });
    const printer = await connected(fake);
    const result = printer.print({ mode: "1bpp", data: new Uint8Array(48) });
    await expect(result).rejects.toMatchObject({ reason: "no-paper" });
    expect(fake.sentBytes).toBe(0);
  });

  it("surfaces a rejected print request", async () => {
    const printer = await connected(new FakePrinter({ printAck: [1] }));
    await expect(printer.print({ mode: "1bpp", data: new Uint8Array(48) })).rejects.toBeInstanceOf(PrinterError);
  });

  it("accepts the short print acknowledgement without a status byte", async () => {
    const fake = new FakePrinter({ printAck: [] });
    const printer = await connected(fake);
    await printer.print({ mode: "1bpp", data: new Uint8Array(48) });
    expect(fake.sentCommands.at(-1)).toBe(Command.PrintDataFlush);
  });

  it("reports running out of paper mid-print", async () => {
    const fake = new FakePrinter({ statusWhilePrinting: [1, 0, 0, 90, 30, 0, 1, 1] });
    const printer = await connected(fake);
    await expect(printer.print({ mode: "1bpp", data: new Uint8Array(48 * 100) })).rejects.toMatchObject({
      reason: "no-paper",
    });
  });

  it("waits while the printer asks to pause the data stream", async () => {
    const fake = new FakePrinter({ pauseAfterWrites: 3 });
    const printer = await connected(fake);
    const sentWhenResumed: number[] = [];
    // The fake resumes 20 ms after pausing; nothing more may be sent in between.
    const result = printer.print(
      { mode: "1bpp", data: new Uint8Array(48 * 100) },
      { onProgress: (sent) => sent === 48 * 3 && setTimeout(() => sentWhenResumed.push(fake.sentBytes), 10) },
    );
    await result;
    expect(sentWhenResumed).toEqual([48 * 3]);
    expect(fake.sentBytes).toBe(48 * 100);
  });

  it("applies per-print transfer pacing", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    await printer.print({ mode: "1bpp", data: new Uint8Array(48 * 100) }, { chunkSize: 24, chunkDelayMs: 0 });
    expect(fake.data.every((chunk) => chunk.length === 24)).toBe(true);
  });

  // Both act 20 ms after the printer pauses the stream, while the driver is waiting on it.
  const atPause = (action: () => void) => (sent: number) => sent === 48 * 3 && setTimeout(action, 20);

  it("cancels promptly while the printer has paused the stream", async () => {
    const fake = new FakePrinter({ pauseAfterWrites: 3, neverResume: true });
    const printer = await connected(fake);
    const controller = new AbortController();
    const started = Date.now();
    const result = printer.print(
      { mode: "1bpp", data: new Uint8Array(48 * 100) },
      { signal: controller.signal, onProgress: atPause(() => controller.abort()) },
    );
    await expect(result).rejects.toMatchObject({ reason: "aborted" });
    expect(fake.sentBytes).toBe(48 * 3);
    expect(fake.sentCommands).toContain(Command.CancelPrint);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("fails promptly if the printer disconnects while paused", async () => {
    const fake = new FakePrinter({ pauseAfterWrites: 3, neverResume: true });
    const printer = await connected(fake);
    const started = Date.now();
    const result = printer.print({ mode: "1bpp", data: new Uint8Array(48 * 100) }, { onProgress: atPause(() => fake.drop()) });
    await expect(result).rejects.toMatchObject({ reason: "disconnected" });
    expect(fake.sentBytes).toBe(48 * 3);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("resends intensity after reconnecting", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    const job = { mode: "1bpp" as const, data: new Uint8Array(48 * 90) };
    await printer.print(job, { darkness: 3 });
    await printer.disconnect();
    await printer.connect();
    await printer.print(job, { darkness: 3 });
    expect(fake.sentCommands.filter((c) => c === Command.SetIntensity)).toHaveLength(2);
  });

  it("cancels when aborted", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    const controller = new AbortController();
    const result = printer.print(
      { mode: "1bpp", data: new Uint8Array(48 * 1000) },
      { signal: controller.signal, onProgress: (sent) => sent > 1000 && controller.abort() },
    );
    await expect(result).rejects.toMatchObject({ reason: "aborted" });
    expect(fake.sentCommands).toContain(Command.CancelPrint);
    expect(fake.sentBytes).toBeLessThan(48 * 1000);
  });

  it("refuses to move paper while printing", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    const job = printer.print({ mode: "1bpp", data: new Uint8Array(48 * 100) });
    await expect(printer.retract(8)).rejects.toMatchObject({ reason: "busy" });
    await job;
    await printer.retract(8);
    expect(fake.sentCommands.at(-1)).toBe(Command.RetractPaper);
  });

  it("rejects malformed rasters", async () => {
    const printer = await connected(new FakePrinter());
    await expect(printer.print({ mode: "1bpp", data: new Uint8Array(47) })).rejects.toThrow(RangeError);
  });
});
