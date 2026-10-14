# Third-party notices

## TiMini-Print

Parts of this package are TypeScript ports of logic from
[TiMini-Print](https://github.com/Dejniel/TiMini-Print):

- `src/sign.ts`: the B3 signing-challenge response (`build_sign_response`)
- `src/density.ts`: the darkness tables and heat-protection lookup tables (`v5x_density.py`)
- `src/packet.ts`: the flow-control pause/resume markers
- `src/constants.ts`: `INTENSITY_BY_LEVEL`

They were rewritten in TypeScript and adapted to this package's API.

```
TiMini-Print
Copyright 2026 Daniel Banecki

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## Protocol documentation

The packet format, command IDs, status layout and raster encoding follow the
reverse-engineering work in these MIT-licensed projects:

- [jeremy46231/MXW01-catprinter](https://github.com/jeremy46231/MXW01-catprinter)
  (`PROTOCOL.md`), a fork of rbaron/catprinter, Copyright (c) 2021 rbaron
- [MaikelChan/CatPrinterBLE](https://github.com/MaikelChan/CatPrinterBLE), Copyright (c) 2025 MaikelChan
