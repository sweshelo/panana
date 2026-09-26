// ExeFS (3dbrew "ExeFS"): 0x200 header with 10 file entries {name[8], offset, size}, data after the header.
import { cstr, u32 } from '../util/bytes';
import type { ByteSource } from './source';

export async function readExefsFile(exefs: ByteSource, name: string): Promise<Uint8Array> {
  const h = await exefs.read(0, 0x200);
  for (let i = 0; i < 10; i++) {
    const o = i * 16;
    const n = cstr(h.subarray(o, o + 8), 0);
    if (n === name) return exefs.read(0x200 + u32(h, o + 8), u32(h, o + 12));
  }
  throw new Error(`ExeFS: ${name} がありません`);
}
