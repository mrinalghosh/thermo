/** CRC-8 with polynomial 0x07, init 0x00, no reflection, no final XOR. */
const TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    table[i] = crc;
  }
  return table;
})();

export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) crc = TABLE[crc ^ byte]!;
  return crc;
}
