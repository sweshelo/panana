// RomFS (3dbrew "RomFS"): IVFC header, then level 3 = directory / file metadata tables + file data.
import { ascii, u32, u64, align } from '../util/bytes';
import type { ByteSource } from './source';

export interface RomfsFile {
  path: string; // "/A90C8038"
  offset: number; // absolute, within the RomFS source
  size: number;
}

export async function parseRomfs(src: ByteSource): Promise<Map<string, RomfsFile>> {
  const ivfc = await src.read(0, 0x60);
  if (ascii(ivfc, 0, 4) !== 'IVFC') throw new Error('RomFS: IVFC ヘッダーがありません');
  const masterHashSize = u32(ivfc, 0x08);
  const lv3BlockLog2 = u32(ivfc, 0x4c);
  const lv3 = align(0x60 + masterHashSize, 1 << lv3BlockLog2);

  const h = await src.read(lv3, 0x28);
  const dirMetaOff = u32(h, 0x0c);
  const dirMetaSize = u32(h, 0x10);
  const fileMetaOff = u32(h, 0x1c);
  const fileMetaSize = u32(h, 0x20);
  const dataOff = u32(h, 0x24);
  const dirs = await src.read(lv3 + dirMetaOff, dirMetaSize);
  const files = await src.read(lv3 + fileMetaOff, fileMetaSize);

  const name = (b: Uint8Array, o: number, n: number): string => {
    let s = '';
    for (let i = 0; i < n; i += 2) s += String.fromCharCode(b[o + i]! | (b[o + i + 1]! << 8));
    return s;
  };
  const out = new Map<string, RomfsFile>();
  const NONE = 0xffffffff;
  const walkDir = (off: number, prefix: string): void => {
    // dir: parent, sibling, firstChild, firstFile, hashNext, nameLen, name
    let f = u32(dirs, off + 0x0c);
    while (f !== NONE) {
      // file: parent, sibling, dataOffset u64, dataSize u64, hashNext, nameLen, name
      const path = prefix + '/' + name(files, f + 0x20, u32(files, f + 0x1c));
      out.set(path, { path, offset: lv3 + dataOff + u64(files, f + 0x08), size: u64(files, f + 0x10) });
      f = u32(files, f + 0x04);
    }
    let d = u32(dirs, off + 0x08);
    while (d !== NONE) {
      walkDir(d, prefix + '/' + name(dirs, d + 0x18, u32(dirs, d + 0x14)));
      d = u32(dirs, d + 0x04);
    }
  };
  walkDir(0, '');
  return out;
}
