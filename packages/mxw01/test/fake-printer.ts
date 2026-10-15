import { Command, decodePacket, encodePacket, type Transport } from "../src/index.js";

export interface FakePrinterOptions {
  /** A1 status payload returned on request. */
  status?: number[];
  /** A9 reply payload; a non-zero first byte means rejected. Default [0]. */
  printAck?: number[];
  /** A1 payload reported while printing, e.g. to simulate running out of paper. */
  statusWhilePrinting?: number[];
  firmware?: string;
  /** Send a pause marker after this many data writes, then resume shortly after. */
  pauseAfterWrites?: number;
  /** With `pauseAfterWrites`: never send the resume marker. */
  neverResume?: boolean;
  /** Send nothing unprompted after the end-of-data command, like the real MXW01. */
  quietFlush?: boolean;
  /** After the end-of-data command, answer this many status requests with "printing". */
  busyPolls?: number;
  /** Report "out of paper" to status requests once this many data writes have arrived. */
  failAfterWrites?: number;
  /** Report "printing" once this many data writes have arrived, like the real printer starting early. */
  printingAfterWrites?: number;
  /** Announce the print is done (AA) this long after the end-of-data command. */
  doneAfterMs?: number;
}

/** In-memory MXW01 that answers like the real printer. */
export class FakePrinter implements Transport {
  readonly name = "MXW01";
  connected = false;
  control: Uint8Array[] = [];
  data: Uint8Array[] = [];
  private notifyListeners = new Set<(data: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();
  private busyPollsLeft = 0;

  constructor(private options: FakePrinterOptions = {}) {}

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.drop();
  }

  /** The link drops on its own (out of range, powered off). */
  drop() {
    this.connected = false;
    for (const listener of this.disconnectListeners) listener();
  }

  async writeControl(packet: Uint8Array) {
    this.assertConnected();
    this.control.push(packet);
    const command = decodePacket(packet)?.command;
    const status = this.options.status ?? [0, 0, 0, 90, 30, 0, 0, 0];
    switch (command) {
      case Command.GetStatus:
        if (this.options.failAfterWrites !== undefined && this.data.length >= this.options.failAfterWrites) {
          this.reply(Command.GetStatus, [1, 0, 0, 90, 30, 0, 1, 1]);
        } else if (this.options.printingAfterWrites !== undefined && this.data.length >= this.options.printingAfterWrites) {
          this.reply(Command.GetStatus, [1, ...status.slice(1)]);
        } else if (this.busyPollsLeft > 0) {
          this.busyPollsLeft--;
          this.reply(Command.GetStatus, [1, ...status.slice(1)]);
        } else {
          this.reply(Command.GetStatus, status);
        }
        break;
      case Command.GetVersion:
        this.reply(Command.GetVersion, [...new TextEncoder().encode(this.options.firmware ?? "1.9.3.1.2")]);
        break;
      case Command.Print:
        this.reply(Command.Print, this.options.printAck ?? [0]);
        break;
      case Command.PrintDataFlush:
        this.busyPollsLeft = this.options.busyPolls ?? 0;
        if (this.options.doneAfterMs !== undefined) {
          setTimeout(() => this.reply(Command.PrintComplete, [0x00, 0x66, 0x66]), this.options.doneAfterMs);
        }
        if (this.options.quietFlush) break;
        this.reply(Command.GetStatus, this.options.statusWhilePrinting ?? [1, ...status.slice(1)]);
        setTimeout(() => {
          this.reply(Command.PrintComplete, [0]);
          this.reply(Command.GetStatus, [0, ...status.slice(1)]);
        }, 5);
        break;
    }
  }

  async writeData(chunk: Uint8Array) {
    this.assertConnected();
    this.data.push(chunk.slice());
    if (this.data.length === this.options.pauseAfterWrites) {
      // Delivered before the write resolves, so the very next chunk sees the pause.
      this.deliver(Uint8Array.of(0x22, 0x21, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff));
      if (!this.options.neverResume) {
        setTimeout(() => this.emit(Uint8Array.of(0x22, 0x21, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff)), 20);
      }
    }
  }

  onNotify(listener: (data: Uint8Array) => void) {
    this.notifyListeners.add(listener);
    return () => this.notifyListeners.delete(listener);
  }

  onDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  get sentCommands() {
    return this.control.map((packet) => decodePacket(packet)!.command);
  }

  get sentBytes() {
    return this.data.reduce((total, chunk) => total + chunk.length, 0);
  }

  emit(data: Uint8Array) {
    setTimeout(() => this.deliver(data), 1);
  }

  private deliver(data: Uint8Array) {
    for (const listener of this.notifyListeners) listener(data);
  }

  private assertConnected() {
    if (!this.connected) throw new Error("Printer is not connected");
  }

  private reply(command: number, payload: number[]) {
    this.emit(encodePacket(command, payload));
  }
}
