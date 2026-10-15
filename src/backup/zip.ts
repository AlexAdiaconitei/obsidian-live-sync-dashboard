import { ServiceError } from "../contracts.ts";

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function header(size: number, fields: Array<[number, number, number]>): Uint8Array {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (const [offset, value, width] of fields) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return bytes;
}

export interface ZipEntry {
  name: string;
  content: AsyncIterable<string | Uint8Array>;
  modified?: Date;
}

// MS-DOS date and time fields; ZIP cannot express dates outside 1980–2107.
function dosTime(date = new Date(1980, 0, 1)): [number, number] {
  if (date.getFullYear() < 1980 || date.getFullYear() > 2107) date = new Date(1980, 0, 1);
  return [
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  ];
}

// Stored ZIP entries with data descriptors let large vaults stream without a temporary plaintext file.
export async function* zipArchive(
  entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>,
  maxBytes = 1024 ** 3,
): AsyncGenerator<Uint8Array> {
  const directory: Uint8Array[] = [];
  let offset = 0;
  for await (const entry of entries) {
    // Without ZIP64 the end record counts at most 65535 entries.
    if (directory.length === 0xffff) throw new ServiceError("vault_export_too_large", 413);
    const segments = entry.name.split("/");
    if (
      segments.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          Array.from(part).some((char) => char < " " || char === "\x7f" || "\\:".includes(char)),
      )
    )
      throw new Error("invalid_zip_path");
    const name = encoder.encode(entry.name);
    if (name.length > 0xffff) throw new Error("invalid_zip_path");
    const [time, day] = dosTime(entry.modified);
    const start = offset;
    const local = header(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [6, 0x808, 2],
      [10, time, 2],
      [12, day, 2],
      [26, name.length, 2],
    ]);
    yield local;
    yield name;
    offset += local.length + name.length;
    let size = 0;
    let crc = 0xffffffff;
    for await (const value of entry.content) {
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      size += bytes.length;
      if (offset + bytes.length > maxBytes) throw new ServiceError("vault_export_too_large", 413);
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      offset += bytes.length;
      yield bytes;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = header(16, [
      [0, 0x08074b50, 4],
      [4, crc, 4],
      [8, size, 4],
      [12, size, 4],
    ]);
    yield descriptor;
    offset += descriptor.length;
    const central = header(46 + name.length, [
      [0, 0x02014b50, 4],
      [4, 20, 2],
      [6, 20, 2],
      [8, 0x808, 2],
      [12, time, 2],
      [14, day, 2],
      [16, crc, 4],
      [20, size, 4],
      [24, size, 4],
      [28, name.length, 2],
      [42, start, 4],
    ]);
    central.set(name, 46);
    directory.push(central);
  }
  const start = offset;
  for (const bytes of directory) {
    yield bytes;
    offset += bytes.length;
  }
  yield header(22, [
    [0, 0x06054b50, 4],
    [8, directory.length, 2],
    [10, directory.length, 2],
    [12, offset - start, 4],
    [16, start, 4],
  ]);
}
