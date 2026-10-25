// Writing the sound files for a BGM ported from another game (naauao kahara/encounters.md §4):
// - cstmForKahara: a stream (CSTM) in RPG2's layout (version 2.1, with its track table). RPG3 and FREE! write 2.2
//   (no track, a region field after the stream info), the first game 2.0 (laid out as 2.1).
// - addStreamSounds: sound.bcsar (CSAR) with more stream sounds, each a copy of one of its own stream sounds that
//   plays an external file (sound/stream/…). The tables of INFO are rebuilt in place (each one is "count + references"
//   followed by its entries, the references counting from the table), STRG gets the names (the lookup tree is kept:
//   the game picks sounds by item ID, from soundData).
import { align, concat, s32, u16, u32, w16, w32 } from '../util/bytes';

const CSTM_V21 = 0x02010000;

interface Block {
  type: number;
  offset: number;
  size: number;
}

function blockTable(d: Uint8Array, magic: string): Block[] {
  if (String.fromCharCode(...d.subarray(0, 4)) !== magic) throw new Error(`${magic} ではありません`);
  return Array.from({ length: u16(d, 0x10) }, (_, i) => ({ type: u16(d, 0x14 + i * 12), offset: u32(d, 0x18 + i * 12), size: u32(d, 0x1c + i * 12) }));
}

/** A file of `blocks` (bodies with their 8-byte headers), each aligned to 0x20, after a header like `like`'s. */
function buildBlocks(like: Uint8Array, version: number, blocks: [number, Uint8Array][]): Uint8Array {
  const headerSize = u16(like, 6);
  const head = like.slice(0, headerSize);
  let at = headerSize;
  const placed = blocks.map(([type, b]) => {
    const size = align(b.length, 0x20);
    const out = { type, offset: at, size, b };
    at += size;
    return out;
  });
  const out = new Uint8Array(at);
  out.set(head);
  w32(out, 8, version);
  w32(out, 0xc, at);
  w16(out, 0x10, placed.length);
  placed.forEach((p, i) => {
    w16(out, 0x14 + i * 12, p.type);
    w32(out, 0x18 + i * 12, p.offset);
    w32(out, 0x1c + i * 12, p.size);
    out.set(p.b, p.offset);
    w32(out, p.offset + 4, p.size);
  });
  return out;
}

/** A block's bytes (header included) without its trailing zero padding. */
function trimmed(b: Uint8Array): Uint8Array {
  let end = b.length;
  while (end > 8 && !b[end - 1]) end--;
  return b.subarray(0, end);
}

/** The track info RPG2 writes: volume 127, pan 64, and the indices of every channel. */
export function trackInfo(channels: number): Uint8Array {
  const t = new Uint8Array(0x10 + align(channels, 4));
  t[0] = 0x7f;
  t[1] = 0x40;
  w16(t, 4, 0x0100);
  w32(t, 8, 0x0c);
  w32(t, 0x0c, channels);
  for (let c = 0; c < channels; c++) t[0x10 + c] = c;
  return t;
}

/** Version of a CSTM file. */
export const cstmVersion = (d: Uint8Array): number => u32(d, 8);

/**
 * The stream in RPG2's layout. Files of version 2.1 or older are returned as they are; 2.2 ones get a track table
 * (one track of every channel) where the region field was, and the version 2.1.
 */
export function cstmForKahara(d: Uint8Array): Uint8Array {
  const blocks = blockTable(d, 'CSTM');
  if (cstmVersion(d) <= CSTM_V21) return d;
  const info = blocks.find((b) => b.type === 0x4000);
  if (!info) throw new Error('CSTM に INFO がありません');
  const body = d.subarray(info.offset + 8, info.offset + info.size);
  // references: +0x00 stream info, +0x08 track table, +0x10 channel table (all from the body)
  if (u16(body, 0) !== 0x4100 || s32(body, 4) !== 0x18) throw new Error('CSTM の INFO が想定と違います (stream info)');
  if (s32(body, 0x0c) !== -1) throw new Error('CSTM の INFO が想定と違います (track がある 2.2)');
  const ct = s32(body, 0x14);
  if (u16(body, 0x10) !== 0x0101 || ct !== 0x5c) throw new Error('CSTM の INFO が想定と違います (channel table)');
  const n = u32(body, ct);
  const tableEnd = ct + 4 + n * 8;
  const track = trackInfo(n);
  const out = new Uint8Array(body.length + track.length);
  out.set(body.subarray(0, 0x50));
  // track table: one track, right after the channel table
  w16(out, 0x08, 0x0101);
  w16(out, 0x0a, 0);
  w32(out, 0x0c, 0x50);
  w32(out, 0x50, 1);
  w16(out, 0x54, 0x4101);
  w16(out, 0x56, 0);
  w32(out, 0x58, tableEnd - 0x50);
  // channel table: its references move past the track info
  out.set(body.subarray(ct, tableEnd), ct);
  for (let c = 0; c < n; c++) {
    const r = ct + 4 + c * 8;
    if (s32(body, r + 4) !== -1) w32(out, r + 4, s32(body, r + 4) + track.length);
  }
  out.set(track, tableEnd);
  out.set(body.subarray(tableEnd), tableEnd + track.length);
  const infoBlock = new Uint8Array(8 + out.length);
  infoBlock.set(d.subarray(info.offset, info.offset + 8));
  infoBlock.set(out, 8);
  return buildBlocks(d, CSTM_V21, blocks.map((b) => [b.type, b === info ? trimmed(infoBlock) : d.slice(b.offset, b.offset + b.size)]));
}

/** Channels of a CSTM file. */
export function cstmChannels(d: Uint8Array): number {
  const info = blockTable(d, 'CSTM').find((b) => b.type === 0x4000);
  if (!info) throw new Error('CSTM に INFO がありません');
  const body = info.offset + 8;
  return d[body + s32(d, body + 4) + 2]!;
}

export interface NewStreamSound {
  /** Sound name ("BGM_OAHU_BATTLE_1"). */
  name: string;
  /** File path from sound/ ("stream/BGM_OAHU_BATTLE_1.bcstm"). */
  path: string;
  /** 0-255 (the sound's own volume, 127 = as recorded). */
  volume: number;
  channels: number;
}

/** A table of INFO: its references (from the table) and the entries after them. */
interface Table {
  type: number;
  refType: number;
  refs: number[];
  /** The bytes after the references, up to the next table. */
  rest: Uint8Array;
}

function readTable(body: Uint8Array, type: number, start: number, end: number): Table {
  const n = u32(body, start);
  const refs = Array.from({ length: n }, (_, i) => s32(body, start + 8 + i * 8));
  const restAt = start + 4 + n * 8;
  for (const r of refs) if (r !== -1 && r < restAt - start) throw new Error(`INFO の表 ${type.toString(16)} の参照が想定と違います`);
  return { type, refType: n ? u16(body, start + 4) : 0, refs: refs.map((r) => (r === -1 ? -1 : r - (restAt - start))), rest: body.slice(restAt, end) };
}

function writeTable(t: Table): Uint8Array {
  const head = 4 + t.refs.length * 8;
  const out = new Uint8Array(head + t.rest.length);
  w32(out, 0, t.refs.length);
  t.refs.forEach((r, i) => {
    w16(out, 4 + i * 8, r === -1 ? 0 : t.refType);
    w32(out, 8 + i * 8, r === -1 ? -1 : r + head);
  });
  out.set(t.rest, head);
  return out;
}

/** Appends entries to a table; returns their indices. */
function append(t: Table, entries: Uint8Array[]): number[] {
  const out: number[] = [];
  let rest = t.rest;
  for (const e of entries) {
    rest = concat([rest, new Uint8Array(align(rest.length, 4) - rest.length), e]);
    out.push(t.refs.length);
    t.refs.push(rest.length - e.length);
  }
  t.rest = rest;
  return out;
}

const SOUND_TABLE = 0x2100;
const FILE_TABLE = 0x2106;

/** Sounds of a sound archive (the INFO's sound table) and their stream template. */
export function soundCount(bcsar: Uint8Array): number {
  const info = blockTable(bcsar, 'CSAR').find((b) => b.type === 0x2001)!;
  const body = info.offset + 8;
  for (let i = 0; i < 8; i++) if (u16(bcsar, body + i * 8) === SOUND_TABLE) return u32(bcsar, body + s32(bcsar, body + i * 8 + 4));
  throw new Error('CSAR に音の一覧がありません');
}

/**
 * The sound archive with `adds` as new stream sounds after its own (sound `count + i`, item ID 0x01000000 | that),
 * each a copy of stream sound `template` playing its own external file.
 */
export function addStreamSounds(bcsar: Uint8Array, template: number, adds: NewStreamSound[]): Uint8Array {
  if (!adds.length) return bcsar;
  const blocks = blockTable(bcsar, 'CSAR');
  const strg = blocks.find((b) => b.type === 0x2000);
  const infoB = blocks.find((b) => b.type === 0x2001);
  if (!strg || !infoB) throw new Error('CSAR に STRG / INFO がありません');

  // ---- STRG: the names after the others (string table: count, {0x1F01, offset, size}, then the strings)
  const sb = bcsar.subarray(strg.offset + 8, strg.offset + strg.size);
  if (u16(sb, 0) !== 0x2400 || u16(sb, 8) !== 0x2401) throw new Error('CSAR の STRG が想定と違います');
  const st = s32(sb, 4);
  const tree = s32(sb, 12);
  const nStr = u32(sb, st);
  let strEnd = st + 4 + nStr * 12;
  for (let i = 0; i < nStr; i++) strEnd = Math.max(strEnd, st + s32(sb, st + 8 + i * 12) + u32(sb, st + 12 + i * 12));
  if (tree < strEnd) throw new Error('CSAR の STRG が想定と違います (木が文字列の前にある)');
  const names = adds.map((a) => new TextEncoder().encode(`${a.name}\0`));
  const grow = adds.length * 12;
  const strings = concat([sb.subarray(st + 4 + nStr * 12, strEnd), ...names]);
  const strTable = new Uint8Array(4 + (nStr + adds.length) * 12 + strings.length);
  w32(strTable, 0, nStr + adds.length);
  for (let i = 0; i < nStr; i++) {
    w16(strTable, 4 + i * 12, 0x1f01);
    w32(strTable, 8 + i * 12, s32(sb, st + 8 + i * 12) + grow);
    w32(strTable, 12 + i * 12, u32(sb, st + 12 + i * 12));
  }
  let at = 4 + (nStr + adds.length) * 12 + (strEnd - st - 4 - nStr * 12);
  names.forEach((b, k) => {
    const i = nStr + k;
    w16(strTable, 4 + i * 12, 0x1f01);
    w32(strTable, 8 + i * 12, at);
    w32(strTable, 12 + i * 12, b.length);
    at += b.length;
  });
  strTable.set(strings, 4 + (nStr + adds.length) * 12);
  const treeAt = 16 + align(strTable.length, 4);
  const strgBody = new Uint8Array(treeAt + (sb.length - tree));
  strgBody.set(sb.subarray(0, 16));
  w32(strgBody, 4, 16);
  w32(strgBody, 12, treeAt);
  strgBody.set(strTable, 16);
  strgBody.set(sb.subarray(tree), treeAt);
  const strgBlock = concat([bcsar.subarray(strg.offset, strg.offset + 8), strgBody]);

  // ---- INFO: its tables in the order they are laid out
  const ib = bcsar.subarray(infoB.offset + 8, infoB.offset + infoB.size);
  const heads = Array.from({ length: 8 }, (_, i) => ({ type: u16(ib, i * 8), at: s32(ib, i * 8 + 4) }));
  const order = heads.filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  if (!order.length || order[0]!.at !== 0x40) throw new Error('CSAR の INFO が想定と違います');
  const parts = new Map<number, Uint8Array | Table>();
  order.forEach((h, i) => {
    const end = order[i + 1]?.at ?? ib.length;
    parts.set(h.type, h.type === SOUND_TABLE || h.type === FILE_TABLE ? readTable(ib, h.type, h.at, end) : ib.subarray(h.at, end));
  });
  const sounds = parts.get(SOUND_TABLE) as Table | undefined;
  const files = parts.get(FILE_TABLE) as Table | undefined;
  if (!sounds || !files) throw new Error('CSAR に音・ファイルの一覧がありません');
  // the template's entries: its sound (up to the next sound) and its file
  const entryOf = (t: Table, i: number): Uint8Array => {
    const start = t.refs[i]!;
    const next = t.refs.slice(i + 1).find((r) => r !== -1) ?? t.rest.length;
    return t.rest.subarray(start, next);
  };
  const tSound = entryOf(sounds, template);
  if (u16(tSound, 0x0c) !== 0x2201) throw new Error(`音 ${template} はストリームではありません`);
  if (!(u32(tSound, 0x14) & 1)) throw new Error(`音 ${template} に名前の欄がありません`);
  const tFile = entryOf(files, u32(tSound, 0));
  if (u16(tFile, 0) !== 0x220d) throw new Error(`音 ${template} のファイルが外部ファイルではありません`);
  const detail = s32(tSound, 0x10);
  const fileIds = append(files, adds.map((a) => {
    const path = new TextEncoder().encode(`${a.path}\0`);
    const e = new Uint8Array(align(0x0c + path.length, 4));
    e.set(tFile.subarray(0, 0x0c));
    e.set(path, 0x0c);
    return e;
  }));
  append(sounds, adds.map((a, k) => {
    const e = tSound.slice();
    w32(e, 0, fileIds[k]!);
    e[8] = a.volume;
    w32(e, 0x18, nStr + k);
    w16(e, detail + 2, a.channels);
    return e;
  }));
  // the header's references, then the tables at their new places
  const chunks: Uint8Array[] = [new Uint8Array(0x40)];
  let pos = 0x40;
  const placed = new Map<number, number>();
  for (const h of order) {
    const p = parts.get(h.type)!;
    const b = p instanceof Uint8Array ? p : writeTable(p);
    const pad = align(pos, 4) - pos;
    if (pad) chunks.push(new Uint8Array(pad));
    pos += pad;
    placed.set(h.type, pos);
    chunks.push(b);
    pos += b.length;
  }
  heads.forEach((h, i) => {
    w16(chunks[0]!, i * 8, h.type);
    w32(chunks[0]!, i * 8 + 4, h.at < 0 ? h.at : placed.get(h.type)!);
  });
  const infoBlock = concat([bcsar.subarray(infoB.offset, infoB.offset + 8), ...chunks]);

  return buildBlocks(bcsar, u32(bcsar, 8), blocks.map((b) => [b.type,
    b === strg ? trimmed(strgBlock) : b === infoB ? trimmed(infoBlock) : bcsar.slice(b.offset, b.offset + b.size)]));
}
