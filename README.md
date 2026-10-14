# thermo

Web interface for the **MXW01** thermal dot matrix printer: the cheap Bluetooth "cat
printer". An open-source replacement for the vendor app, with no account and no cloud.
Everything runs in your browser.

> **Status: early.** It has had a first run on one MXW01, and print reliability is still
> being tuned. Please report what happens with yours; the **Test pattern** tab makes
> problems easy to describe.

## What works

- Connect to an MXW01 straight from the browser (Web Bluetooth)
- Print text (font, size, alignment, bold) and images (drop, paste or pick a file)
- Black & white, or 16-level grayscale for photos
- Floyd–Steinberg, Atkinson, ordered (Bayer) dithering, or a plain threshold
- Darkness (1–5) with the vendor app's heat protection, plus brightness and contrast
- A preview that shows exactly the dots that will print
- Printer status (paper, battery, temperature), hold-to-move paper feed/retract, and cancelling a print
- A calibration test pattern for checking alignment and orientation

## Quick start

Requires Node 22.12 or newer.

```sh
git clone https://github.com/mrinalghosh/thermo.git
cd thermo
npm install
npm run dev        # open the printed URL in Chrome or Edge
```

```sh
npm test           # unit tests, including a simulated printer
npm run typecheck
npm run build      # static site in apps/web/dist, deployable anywhere with HTTPS
```

### Browser support

Web Bluetooth works in **Chrome, Edge and Opera on desktop and Android**. It does not
work in Safari, Firefox, or any browser on iOS. Pages must be served over HTTPS or from
`localhost`. On Linux you may need to enable `chrome://flags/#enable-experimental-web-platform-features`.

## Layout

```
packages/mxw01    Printer driver: framing, commands, status, flow control, signing.
                  Runtime-agnostic; talks to the printer through a Transport interface.
packages/render   Image → printer raster: grayscale, tone, dithering, 1bpp/4bpp packing.
                  Pure functions, no DOM; runs in the browser and Node.
apps/web          The web app (Vite + React).
docs/PROTOCOL.md  Everything known about the MXW01 protocol.
```

The driver doesn't know which runtime it's in. The web app plugs in
`WebBluetoothTransport`. A Node transport can drive the same `MXW01Printer` class from a
server.

```ts
import { MXW01Printer, WebBluetoothTransport } from "@thermo/mxw01";
import { pack, rasterize, toGray } from "@thermo/render";

const printer = new MXW01Printer(await WebBluetoothTransport.request());
await printer.connect();

const raster = rasterize(toGray(imageData), { mode: "1bpp", dither: "atkinson" });
await printer.print({ mode: raster.mode, data: pack(raster) }, { darkness: 3 });
```

## Roadmap

1. **Hardware validation.** Confirm the timing, print orientation, the 90-line minimum and the battery scale on real printers.
2. **Composer.** Combine text, images, QR codes, barcodes and Markdown in one layout, and save templates.
3. **Queue and history.** Queue multiple jobs, reprint past ones, keep the app offline-capable and installable (PWA).
4. **Bridge (`apps/bridge`).** A Node service on a Raspberry Pi or Mac next to the printer
   (noble transport) with a REST API, webhooks, scheduled prints and AirPrint/IPP, so you
   can print from anywhere, including iOS.
5. **Integrations.** Home Assistant, email-to-print, daily briefings.

## Credits

The protocol work stands on [jeremy46231/MXW01-catprinter](https://github.com/jeremy46231/MXW01-catprinter),
[MaikelChan/CatPrinterBLE](https://github.com/MaikelChan/CatPrinterBLE) and
[Dejniel/TiMini-Print](https://github.com/Dejniel/TiMini-Print). Some driver logic is
ported from TiMini-Print under Apache-2.0; see
[packages/mxw01/THIRD_PARTY_NOTICES.md](packages/mxw01/THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
