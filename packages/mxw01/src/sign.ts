// Answer to the printer-initiated B3 signing challenge. Some firmwares send it after
// connecting and expect the vendor app's HMAC reply. Ported from TiMini-Print
// (Apache-2.0); see THIRD_PARTY_NOTICES.md.

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export async function buildSignResponse(
  challenge: Uint8Array,
  timestampMs: number = Date.now(),
): Promise<Uint8Array> {
  if (challenge.length !== 10) throw new RangeError("signing challenge must be 10 bytes");
  const tail = timestampMs % 10000;
  const t0 = Math.floor(tail / 100);
  const t1 = tail % 100;

  const mask = [0xa9, t1, 0xd3, 0x03, 0x78, 0xb6, 0x15, t0, 0xea, 0x82];
  const message = Array.from(challenge, (b, i) => hex2(b ^ mask[i]!))
    .join("")
    .toUpperCase();
  const key = `93${hex2(t0)}e8ae5e93d79683dcaf9e${hex2(t1)}3ede35`;

  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
  );

  return Uint8Array.from([
    0x22, 0x21, 0xb3, 0x00, 0x22, 0x00,
    digest[0]!, t1, ...digest.subarray(1, 29), t0, ...digest.subarray(29),
    0x00, 0xff,
  ]);
}
