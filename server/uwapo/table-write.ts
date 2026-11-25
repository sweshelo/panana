// Ported from lanai-custom-stages web/table-write.ts (99304a5); the uwapo there is kept in parallel.
// Repacking a GS archive the way Panana does (src/archive/gsarc.ts rebuildArchive), for a stage archive whose tables
// were renumbered (renumber.ts).
import { zipSync } from 'fflate';
import { unpackEntry, type Archive } from './panana-zip';

const r32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const w32 = (b: Uint8Array, o: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint32(o, v >>> 0, true);

/** LZ10 with literals only: valid for every reader, about 1/8 larger than the body. */
export function lz10Literal(body: Uint8Array): Uint8Array {
  if (body.length >= 1 << 24) throw new Error('LZ10: 16 MB 以上は圧縮できません');
  const out = new Uint8Array(4 + body.length + Math.ceil(body.length / 8));
  out[0] = 0x10;
  out[1] = body.length & 0xff;
  out[2] = (body.length >> 8) & 0xff;
  out[3] = (body.length >> 16) & 0xff;
  let o = 4;
  for (let i = 0; i < body.length; i += 8) {
    out[o++] = 0;
    const n = Math.min(8, body.length - i);
    out.set(body.subarray(i, i + n), o);
    o += n;
  }
  return out;
}

/** Same as Panana's rebuildArchive: replaced entries (by index) are packed again like they were, others copied. */
export function rebuildArchive(arc: Archive, replacements: Map<number, Uint8Array>): Uint8Array {
  const head = arc.version === 10 ? 0x18 : 0x0c;
  const hdr = new Uint8Array(head + 28 * arc.entries.length);
  hdr.set(arc.data.subarray(0, head));
  const blobs: Uint8Array[] = [];
  let pos = hdr.length;
  arc.entries.forEach((e, i) => {
    const rep = replacements.get(i);
    const o = head + i * 28;
    let blob: Uint8Array;
    let raw: number;
    if (rep) {
      if (e.comp === 1) {
        const name = unpackEntry(arc, e).name;
        blob = name ? zipSync({ [name]: [rep, { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0) }] }) : zipSync({});
      } else blob = e.comp === 6 ? lz10Literal(rep) : rep;
      raw = rep.length;
    } else {
      blob = arc.data.subarray(e.offset, e.offset + e.size);
      raw = r32(arc.data, head + i * 28 + 24);
    }
    w32(hdr, o, e.hash);
    w32(hdr, o + 4, e.type);
    w32(hdr, o + 8, blob.length);
    w32(hdr, o + 12, pos);
    w32(hdr, o + 16, e.comp);
    w32(hdr, o + 20, r32(arc.data, head + i * 28 + 20));
    w32(hdr, o + 24, raw);
    blobs.push(blob);
    pos += blob.length;
  });
  const out = new Uint8Array(pos);
  out.set(hdr);
  let p = hdr.length;
  for (const b of blobs) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
