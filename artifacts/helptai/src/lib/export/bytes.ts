const encoder = new TextEncoder();

export const utf8 = (value: string) => encoder.encode(value);

export function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function u16(value: number) {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

export function u32(value: number) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value >>> 0, true);
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeFileName(value: string) {
  return (
    (value || 'Untitled document')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'Untitled-document'
  );
}
