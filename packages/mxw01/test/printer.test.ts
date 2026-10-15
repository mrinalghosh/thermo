import { describe, expect, it, vi } from "vitest";
import { Command, MXW01Printer, PrinterError } from "../src/index.js";
import { FakePrinter } from "./fake-printer.js";

const options = { chunkDelayMs: 0, responseTimeoutMs: 200, statusPollMs: 5 };

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

    expect(fake.sentCommands.slice(0, 6)).toEqual([
      Command.GetVersion,
      Command.GetStatus,
      Command.GetStatus,
      Command.SetIntensity,
      Command.Print,
      Command.PrintDataFlush,
    ]);
    // Then status requests until the printer is done.
    expect(fake.sentCommands.slice(6).every((command) => command === Command.GetStatus)).toBe(true);
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
    expect(fake.sentCommands).toContain(Command.PrintDataFlush);
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

  it("asks for status until the printer has printed and returned to standby", async () => {
    // Like the real MXW01: silent after the data, "printing" while asked, then standby.
    const fake = new FakePrinter({ quietFlush: true, busyPolls: 3 });
    const printer = await connected(fake);
    const logs: string[] = [];
    printer.on("log", (message) => logs.push(message));
    await printer.print({ mode: "1bpp", data: new Uint8Array(48 * 90) });

    const afterData = fake.sentCommands.slice(fake.sentCommands.indexOf(Command.PrintDataFlush) + 1);
    expect(afterData).toEqual(Array(4).fill(Command.GetStatus));
    expect(logs).toContainEqual(expect.stringMatching(/Printer state: printing$/));
    expect(logs.at(-1)).toMatch(/Print finished \(printer reported standby\)$/);
  });

  it("cancels promptly while waiting for the printer to finish", async () => {
    const fake = new FakePrinter({ quietFlush: true, busyPolls: 1000 });
    const printer = new MXW01Printer(fake, { ...options, statusPollMs: 50 });
    await printer.connect();
    const controller = new AbortController();
    const result = printer.print({ mode: "1bpp", data: new Uint8Array(48 * 90) }, { signal: controller.signal });
    await vi.waitFor(() => expect(fake.sentCommands).toContain(Command.PrintDataFlush));

    const abortedAt = performance.now();
    controller.abort();
    await expect(result).rejects.toMatchObject({ reason: "aborted" });
    expect(performance.now() - abortedAt).toBeLessThan(40);
    expect(fake.sentCommands.at(-1)).toBe(Command.CancelPrint);
    expect(printer.printing).toBe(false);
  });

  it("stops sending when a status reply mid-transfer reports a problem", async () => {
    const fake = new FakePrinter({ failAfterWrites: 5 });
    const printer = await connected(fake);
    // About 1.5 s of transfer: long enough for a status probe to see the problem.
    const job = printer.print({ mode: "1bpp", data: new Uint8Array(48 * 100) }, { chunkDelayMs: 15 });
    await expect(job).rejects.toMatchObject({ reason: "no-paper" });
    expect(fake.sentBytes).toBeLessThan(48 * 100);
    expect(fake.sentCommands.at(-1)).toBe(Command.CancelPrint);
  });

  it("measures status round trips during long transfers", async () => {
    const fake = new FakePrinter();
    const printer = await connected(fake);
    const logs: string[] = [];
    printer.on("log", (message) => logs.push(message));
    // About 1.5 s of transfer: long enough for one probe.
    await printer.print({ mode: "1bpp", data: new Uint8Array(48 * 100) }, { chunkDelayMs: 15 });

    expect(logs).toContainEqual(expect.stringMatching(/^\+\d+\.\d\d s Status reply in \d+ ms \(standby\)$/));
    expect(fake.sentBytes).toBe(48 * 100);
  });

  it("logs the timing of each phase of a job", async () => {
    const fake = new FakePrinter({ pauseAfterWrites: 3 });
    const printer = await connected(fake);
    const logs: string[] = [];
    printer.on("log", (message) => logs.push(message));
    await printer.print({ mode: "1bpp", data: new Uint8Array(48 * 90) }, { chunkSize: 96, chunkDelayMs: 0 });

    const stamped = (text: string) => new RegExp(String.raw`^\+\d+\.\d\d s ${text}`);
    expect(logs[0]).toMatch(/^Printing 90 lines .* 4320 B as 96 B writes every 0 ms$/);
    expect(logs).toContainEqual(expect.stringMatching(stamped("Printer accepted the job$")));
    expect(logs).toContainEqual(expect.stringMatching(stamped(String.raw`Flow control: resume after \d+\.\d\d s$`)));
    expect(logs).toContainEqual(expect.stringMatching(stamped(String.raw`Sent 4320 B in .*a write every .* ms; write calls took`)));
    expect(logs).toContainEqual(expect.stringMatching(stamped("Printer state: printing$")));
    expect(logs.at(-1)).toMatch(stamped(String.raw`Print finished \(printer reported standby\)$`));
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
