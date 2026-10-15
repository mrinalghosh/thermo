# MXW01 protocol notes

This is what `@thermo/mxw01` implements, with where each piece comes from. The vendor
app calls this protocol family "V5X". Nothing here is official. It comes from
reverse engineering by [jeremy46231/MXW01-catprinter][jeremy] (MIT),
[MaikelChan/CatPrinterBLE][maikel] (MIT) and [Dejniel/TiMini-Print][timini] (Apache-2.0).

If your printer behaves differently, please open an issue with the activity log.

## GATT

| UUID     | Role                                                  | Type                    |
| -------- | ----------------------------------------------------- | ----------------------- |
| `0xAE30` | Service (some hosts, notably macOS, report `0xAF30`)  |                         |
| `0xAE01` | Control commands                                      | write without response  |
| `0xAE02` | Replies, status and flow control                      | notify                  |
| `0xAE03` | Bulk raster data                                      | write without response  |

## Framing

```
22 21 | cmd | 00 | len_lo len_hi | payload… | crc8(payload) | FF
```

- CRC-8 uses polynomial `0x07`, init `0x00`, no reflection and no final XOR. It covers the payload only.
- Notifications use the same layout. Some arrive truncated (no CRC or footer), so parse leniently.
- Packets captured from the vendor app sometimes end in `00` instead of `FF`, and the A9
  request ends in `00 00` instead of a CRC. The printer accepts the standard framing above
  too: both MIT implementations use it.

## Commands

| ID   | Direction | Payload                         | Meaning                                              |
| ---- | --------- | ------------------------------- | ---------------------------------------------------- |
| `A1` | ⇄         | `00` / status (below)           | Get status. Also sent unprompted while printing       |
| `A2` | →         | intensity byte                  | Print darkness                                        |
| `A3` | →         | lines (LE16)                    | Feed paper. Moves paper, so don't use it to poll      |
| `A4` | →         | lines (LE16)                    | Retract paper                                         |
| `A7` | ⇄         | — / serial                      | Query serial / count                                  |
| `A9` | ⇄         | lines (LE16), `30`, mode        | Start print. Reply byte 0 is `00` if accepted (some firmwares send no byte at all, which also means OK) |
| `AA` | ←         |                                 | Ready for next page / print complete                  |
| `AB` | ⇄         | `00` / level                    | Battery level                                         |
| `AC` | →         | `00`                            | Cancel print                                          |
| `AD` | →         | `00`                            | End of raster data                                    |
| `B0` | ⇄         | `00` / type                     | Print head type: `01` high-voltage, `FF` unknown, else low |
| `B1` | ⇄         | `00` / ASCII firmware           | Version. The last char gives the head type: `2` high, `1` low |
| `B2` | ←         |                                 | Printer asks the host to poll. The app replies with `A3 00 00` after ~700 ms |
| `B3` | ⇄         | 10-byte challenge / 34-byte reply | Signing challenge (below)                          |

Print modes (4th byte of the A9 payload): `00` = 1 bit per pixel, `01` = label/tag
paper (untested), `02` = 4-bit grayscale.

## Status (A1 payload)

| Offset | Meaning                                                           |
| ------ | ----------------------------------------------------------------- |
| 0      | State: 0 standby, 1 printing, 2 feeding, 3 retracting             |
| 3      | Battery (approximate, scale unconfirmed)                          |
| 4      | Temperature, °C                                                   |
| 6      | Error flag (0 = OK)                                               |
| 7      | Error code: 1 or 9 no paper, 4 overheated, 8 low battery          |

jeremy46231's `PROTOCOL.md` lists these as 6/9/10/12/13. Those are offsets into the whole
packet, not the payload.

## Printing sequence

1. Connect, subscribe to `AE02`, wait ~200 ms, send `B1` and read the firmware
2. `A1`: refuse to print if the error flag is set
3. `A2` intensity (only when it changed)
4. `A9` with the line count and mode, then wait for the `A9` reply and check that byte 0 is `00`
5. Stream raster bytes to `AE03`, one 48-byte row per write with ~15 ms gaps. The vendor
   app uses 123-byte writes with 4 ms gaps, but that needs a large MTU. On macOS Chrome it
   produced sheared, garbled output, because lost bytes shift every following row
6. `AD`
7. Wait until the printer is done. Disconnecting earlier truncates the print. Firmware
   1.9.3.1.2 sends no status on its own, so waiting for 3 s of silence ends too early. Ask
   for `A1` every ~0.5 s instead. It answers printing, then feeding (its own end-of-job
   feed, about 0.7 s), then sends `AA` (payload `00 66 66`) unprompted and reports standby.
   Treat either `AA` or standby-after-printing as done, and fall back to ~3 s without a
   reply

Timeline of a 280-line 1bpp job at intensity `0x5D` on firmware 1.9.3.1.2, sending one
row every 16.7 ms (60 lines/s):

| Time     | Event                                                                   |
| -------- | ----------------------------------------------------------------------- |
| +0.45 s  | `A9` accepted                                                           |
| ~+2 s    | Starts printing, with 61–124 lines received (status polled each second) |
| +5.12 s  | Last byte sent                                                          |
| +9.72 s  | Feeding                                                                 |
| +10.44 s | `AA 00 66 66`                                                           |
| +10.47 s | Standby                                                                 |

That's 34–39 lines/s (4–5 mm/s) of printing, slower than the data arrives. So once the
printer starts, the transfer isn't what limits it.

Jobs shorter than 90 lines are padded to 90. Shorter jobs were reported to misbehave,
though this is unconfirmed.

## Raster encoding

- Width is 384 dots, rows top to bottom.
- **1bpp:** 48 bytes per row. The leftmost pixel is in the **least** significant bit, and 1 means black.
- **4bpp:** 192 bytes per row. The leftmost pixel is in the **high** nibble, and 15 means black.

## Flow control

While receiving data, the printer can send a pause marker and later a resume marker.
Stop writing to `AE03` until it resumes. Known markers:

| Pause                 | Resume                |
| --------------------- | --------------------- |
| `2221AE0101001070FF`  | `2221AE0101000000FF`  |
| `2221A800010020E0FF`  | `2221A80001003090FF`  |
| `2221AE0001000000`    | `2221AE0001001000`    |
| `AA01`                | `AA00`                |
| `5178AE0101001070FF`  | `5178AE0101000000FF`  |

## Signing challenge (B3)

Some firmwares send a 10-byte challenge and expect the vendor app's HMAC-SHA256 reply.
See `packages/mxw01/src/sign.ts`. It's verified against TiMini-Print's test vectors.

## Darkness and heat

The vendor app's 1–5 darkness scale maps to these A2 bytes:

| Level | 1bpp | 4bpp |
| ----- | ---- | ---- |
| 1     | 0x58 | 0x4B |
| 2     | 0x5A | 0x50 |
| 3     | 0x5D | 0x55 |
| 4     | 0x5F | 0x5A |
| 5     | 0x62 | 0x62 |

Above about 60 °C the app lowers intensity sharply, and more for dense images. See
`packages/mxw01/src/density.ts`.

## Open questions

- Which way up does a strip read? jeremy46231's tool rotates jobs 180° by default and
  MaikelChan's doesn't. The web app has a toggle.
- Is the 90-line minimum real?
- What makes the printer start: an amount of buffered data, or a fixed delay? If it's
  data, sending the first rows faster would start every print sooner.
- Does darkness change print speed? Longer heating per line could slow the motor.
- How fast can raster data go? `AE03` offers write-without-response only, and Chrome on
  macOS returns from each write in under a millisecond, so nothing slows the sender down.
  One 48-byte row every ~16.7 ms (2.9 kB/s) prints cleanly. Two rows every ~9 ms lost whole
  writes
- What scale does the battery byte use?
- What does `A7` return, and is the serial needed for anything?
- How should label mode (`01`) behave on continuous paper? The printer has no gap sensor.

[jeremy]: https://github.com/jeremy46231/MXW01-catprinter
[maikel]: https://github.com/MaikelChan/CatPrinterBLE
[timini]: https://github.com/Dejniel/TiMini-Print
