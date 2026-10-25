// darc: the archive of a layout (blyt/, anim/, timg/), little-endian. Header: "darc", BOM, header size, version, file
// size, +0x10 table offset, +0x14 table size, +0x18 data offset. The table: 12-byte nodes {u32 name offset (bit 24 =
// a folder), u32 offset (a folder: its parent), u32 size (a folder: the node after its last child)}, node 0 the root
// (its size = the number of nodes), then the names (UTF-16LE, NUL-ended).
import { u32 } from '../util/bytes';

/** The files of a darc: their paths ("timg/pier_btm_bg.bclim", no leading "/" or ".") -> bytes. */
export function readDarc(b: Uint8Array): Map<string, Uint8Array> {
  if (String.fromCharCode(...b.subarray(0, 4)) !== 'darc') throw new Error('darc ではありません');
  const table = u32(b, 0x10);
  const count = u32(b, table + 8);
  const names = table + count * 12;
  const name = (o: number): string => {
    let s = '';
    for (let p = names + o; p + 1 < b.length; p += 2) {
      const c = b[p]! | (b[p + 1]! << 8);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const out = new Map<string, Uint8Array>();
  // folders by the node after their last child: the path of a node is the folders still open
  const open: { end: number; name: string }[] = [];
  for (let i = 1; i < count; i++) {
    while (open.length && open.at(-1)!.end <= i) open.pop();
    const n = table + i * 12;
    const w = u32(b, n);
    const nm = name(w & 0xffffff);
    if (w & 0x1000000) {
      open.push({ end: u32(b, n + 8), name: nm });
      continue;
    }
    const path = [...open.map((f) => f.name), nm].filter((s) => s && s !== '.').join('/');
    const off = u32(b, n + 4);
    out.set(path, b.subarray(off, off + u32(b, n + 8)));
  }
  return out;
}
