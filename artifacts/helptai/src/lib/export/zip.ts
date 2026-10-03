import { concatBytes, crc32, u16, u32, utf8 } from './bytes';

export type ZipEntry = { name: string; content: string | Uint8Array };

// Minimal "store" (no compression) zip writer. Office files are zips; the page images are
// already JPEG-compressed, so storing is fine and keeps this dependency-free.
export function zip(entries: ZipEntry[]) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, a valid DOS date

  for (const entry of entries) {
    const name = utf8(entry.name);
    const data = typeof entry.content === 'string' ? utf8(entry.content) : entry.content;
    const checksum = crc32(data);

    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    locals.push(local);

    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(checksum), u32(data.length), u32(data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }

  const centralBytes = concatBytes(central);
  const localBytes = concatBytes(locals);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(localBytes.length), u16(0),
  ]);
  return concatBytes([localBytes, centralBytes, end]);
}
