// RomFS root archive (docs/analysis.md "RomFS", tools/gsarc.py).
//   0x00 u32 version (=5), 0x04 u32 archive hash, 0x08 u32 count,
//   0x0C count x {u32 hash, u32 type, u32 size, u32 offset, u32 comp, u32 unk (-1), u32 raw size}
//   comp 1 = single-file ZIP, 6 = LZ10, otherwise stored.
import { u32, w32 } from '../util/bytes';
import { lz10Compress, lz10Decompress } from './lz10';
import { unzipSingle, zipSingle } from './zip';

export interface ArcEntry {
  index: number;
  hash: number;
  type: number;
  size: number;
  offset: number;
  comp: number;
  unk: number;
  raw: number;
}

export interface Archive {
  data: Uint8Array;
  version: number;
  hash: number;
  entries: ArcEntry[];
}

export function parseArchive(data: Uint8Array): Archive {
  const version = u32(data, 0);
  const hash = u32(data, 4);
  const n = u32(data, 8);
  if (12 + n * 28 > data.length) throw new Error('アーカイブのヘッダーが不正です');
  const entries: ArcEntry[] = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 28;
    entries.push({
      index: i,
      hash: u32(data, o),
      type: u32(data, o + 4),
      size: u32(data, o + 8),
      offset: u32(data, o + 12),
      comp: u32(data, o + 16),
      unk: u32(data, o + 20),
      raw: u32(data, o + 24),
    });
  }
  return { data, version, hash, entries };
}

export function entryBlob(arc: Archive, e: ArcEntry): Uint8Array {
  return arc.data.subarray(e.offset, e.offset + e.size);
}

export function unpackEntry(arc: Archive, e: ArcEntry): { name: string | null; body: Uint8Array } {
  const blob = entryBlob(arc, e);
  if (e.comp === 1) return unzipSingle(blob);
  if (e.comp === 6) return { name: null, body: lz10Decompress(blob) };
  return { name: null, body: blob };
}

export function findEntry(arc: Archive, hash: number): ArcEntry | undefined {
  return arc.entries.find((e) => e.hash === hash);
}

/** Entry by the file name stored in its ZIP (e.g. "mapParts.bin"). */
export function findByName(arc: Archive, name: string): { entry: ArcEntry; body: Uint8Array } | undefined {
  for (const e of arc.entries) {
    if (e.comp !== 1) continue;
    const r = unpackEntry(arc, e);
    if (r.name === name) return { entry: e, body: r.body };
  }
  return undefined;
}

function packEntry(e: ArcEntry, name: string | null, body: Uint8Array): Uint8Array {
  if (e.comp === 1) return zipSingle(name, body);
  if (e.comp === 6) return lz10Compress(body);
  return body;
}

/** Same as gsarc.rebuild: replaced entries are re-packed, others are copied verbatim. */
export function rebuildArchive(arc: Archive, replacements: Map<number, Uint8Array>): Uint8Array {
  const n = arc.entries.length;
  const blobs: Uint8Array[] = [];
  const hdr = new Uint8Array(12 + 28 * n);
  w32(hdr, 0, arc.version);
  w32(hdr, 4, arc.hash);
  w32(hdr, 8, n);
  let pos = hdr.length;
  for (const e of arc.entries) {
    let blob: Uint8Array;
    let raw: number;
    const rep = replacements.get(e.index);
    if (rep) {
      const name = e.comp === 1 ? unpackEntry(arc, e).name : null;
      blob = packEntry(e, name, rep);
      raw = rep.length;
    } else {
      blob = entryBlob(arc, e);
      raw = e.raw;
    }
    const o = 12 + e.index * 28;
    w32(hdr, o, e.hash);
    w32(hdr, o + 4, e.type);
    w32(hdr, o + 8, blob.length);
    w32(hdr, o + 12, pos);
    w32(hdr, o + 16, e.comp);
    w32(hdr, o + 20, e.unk);
    w32(hdr, o + 24, raw);
    blobs.push(blob);
    pos += blob.length;
  }
  const out = new Uint8Array(pos);
  out.set(hdr);
  let p = hdr.length;
  for (const b of blobs) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
