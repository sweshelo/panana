// RomFS root archive (docs/analysis.md "RomFS", tools/gsarc.py).
//   0x00 u32 version (=5), 0x04 u32 archive hash, 0x08 u32 count,
//   0x0C count x {u32 hash, u32 type, u32 size, u32 offset, u32 comp, u32 unk (-1), u32 raw size}
//   comp 1 = single-file ZIP, 6 = LZ10, otherwise stored.
// Version 10 (RPG FREE!, naauao lanai/analysis.md §1.2) has a 0x18-byte header: the count is at +0x10, and +0x08..+0x0F
// (the Update's version for the archives it replaced) and +0x14 are kept as they are when the archive is rebuilt.
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

/** Size of the header before the entries (0x18 for version 10, else 0x0C). */
export const archiveHeaderSize = (version: number): number => (version === 10 ? 0x18 : 12);

export function parseArchive(data: Uint8Array): Archive {
  const version = u32(data, 0);
  const hash = u32(data, 4);
  const head = archiveHeaderSize(version);
  const n = u32(data, version === 10 ? 0x10 : 8);
  if (head + n * 28 > data.length) throw new Error('アーカイブのヘッダーが不正です');
  const entries: ArcEntry[] = [];
  for (let i = 0; i < n; i++) {
    const o = head + i * 28;
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

/** A file to add to an archive: packed like `like` (an entry of the archive: type, compression, unk). */
export interface NewEntry {
  hash: number;
  name: string;
  body: Uint8Array;
  like: ArcEntry;
}

/**
 * Same as gsarc.rebuild: replaced entries are re-packed, others are copied verbatim. `added` entries go where their
 * hash sorts when the archive's entries are in hash order (so a lookup that bisects still finds them), else last.
 */
export function rebuildArchive(arc: Archive, replacements: Map<number, Uint8Array>, added: NewEntry[] = []): Uint8Array {
  const sorted = arc.entries.every((e, i) => i === 0 || arc.entries[i - 1]!.hash < e.hash);
  const list: { e: ArcEntry; add?: NewEntry }[] = arc.entries.map((e) => ({ e }));
  for (const a of added) {
    if (arc.entries.some((e) => e.hash === a.hash)) throw new Error(`アーカイブにはハッシュ ${a.hash.toString(16)} のエントリがすでにあります`);
    const at = sorted ? list.findIndex((x) => x.e.hash > a.hash) : -1;
    const item = { e: { ...a.like, hash: a.hash }, add: a };
    if (at < 0) list.push(item);
    else list.splice(at, 0, item);
  }
  const n = list.length;
  const blobs: Uint8Array[] = [];
  const head = archiveHeaderSize(arc.version);
  const hdr = new Uint8Array(head + 28 * n);
  hdr.set(arc.data.subarray(0, head));
  w32(hdr, 0, arc.version);
  w32(hdr, 4, arc.hash);
  w32(hdr, arc.version === 10 ? 0x10 : 8, n);
  let pos = hdr.length;
  for (const [i, { e, add }] of list.entries()) {
    let blob: Uint8Array;
    let raw: number;
    const rep = add?.body ?? replacements.get(e.index);
    if (rep) {
      const name = add ? add.name : e.comp === 1 ? unpackEntry(arc, e).name : null;
      blob = packEntry(e, name, rep);
      raw = rep.length;
    } else {
      blob = entryBlob(arc, e);
      raw = e.raw;
    }
    const o = head + i * 28;
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
