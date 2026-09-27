// Sections of a map (docs/map.md §2-§5) <-> editable model. Unknown bytes are always kept (round trip).
import { s16, u32, u8, w16, w32 } from '../util/bytes';
import type { MapInfo } from './codebin';
import type { MapDb } from './mapdb';

export const LETTER_DEFAULT = 0x7a; // 'z'

export interface Tile {
  kind: number; // +0 u32 (grid holds kind + 1)
  x: number; // +4 s16 (cell)
  y: number; // +6 s16
  rot: number; // +8 low 2 bits (90° steps)
  rotHi: number; // +8 upper 6 bits (kept)
  letter: number; // +9: 0x7A ('z') or 0 = default, 'a'..'g' = variants 1..7
  pad: number; // +10 u16 (kept)
}

/** Letter byte -> model column (FUN_001c97f8): 'z' / 0 -> 0, 'a'..'g' -> 1..7. */
export function letterIndex(letter: number): number {
  if (letter >= 0x61 && letter <= 0x67) return letter - 0x60;
  return 0;
}
export function letterByte(index: number): number {
  return index === 0 ? LETTER_DEFAULT : 0x60 + index;
}
export function letterLabel(letter: number): string {
  return letterIndex(letter) === 0 ? '' : String.fromCharCode(letter);
}

/** cell = cell index, fine = world 50 + v * 100, world = world units (a cell is 500). */
export type Unit = 'cell' | 'fine' | 'world';

/** Record layouts of the point-like sections. x / y are edited, every other byte is kept as is. */
export interface RecordLayout {
  size: number;
  xo: number;
  yo: number;
  unit: Unit;
  label: string;
}
export const LAYOUTS: Record<number, RecordLayout> = {
  1: { size: 8, xo: 0, yo: 2, unit: 'cell', label: '床のギミック (区画 1)' },
  2: { size: 12, xo: 4, yo: 6, unit: 'fine', label: '置物 (区画 2)' },
  3: { size: 28, xo: 0x10, yo: 0x12, unit: 'cell', label: '出入口 (区画 3)' },
  4: { size: 12, xo: 4, yo: 6, unit: 'fine', label: '宝箱 (区画 4)' },
  5: { size: 16, xo: 4, yo: 6, unit: 'fine', label: 'キャラ・オブジェクト (区画 5)' },
  7: { size: 24, xo: 0x10, yo: 0x12, unit: 'world', label: '壁の扉・出口 (区画 7)' },
  8: { size: 16, xo: 4, yo: 6, unit: 'fine', label: 'イベントの範囲 (区画 8)' },
  9: { size: 16, xo: 8, yo: 10, unit: 'fine', label: '区画 9' },
};
export const POINT_SECTIONS = [3, 7, 4, 5, 8, 2, 1, 9] as const;

export interface Rec {
  /** Full record bytes; x / y inside are overwritten by the fields below on save. */
  raw: Uint8Array;
  x: number;
  y: number;
}

export interface Cell6 {
  value: number;
  x: number;
  y: number;
}

export interface MapDoc {
  hash: number;
  name: string;
  dungeon: number;
  floor: number;
  tiles: Tile[];
  /** Sections 1, 2, 3, 4, 5, 7, 8, 9. */
  recs: Record<number, Rec[]>;
  /** Section 6: header (8 bytes: u32 hash, u32 -1) + cells. */
  sec6Header: Uint8Array;
  cells6: Cell6[];
  /** Sections kept as bytes (any section whose size does not fit its layout). */
  raw: Record<number, Uint8Array>;
}

// ---- section 3 fields
export const P3 = {
  id: (r: Uint8Array) => u32(r, 0),
  destMap: (r: Uint8Array) => u32(r, 4),
  destPoint: (r: Uint8Array) => u32(r, 8),
  /** EventObject row (doors, warp holes …; 0 = none). */
  door: (r: Uint8Array) => u32(r, 0x0c),
  kind: (r: Uint8Array) => u8(r, 0x14),
  aux: (r: Uint8Array) => u8(r, 0x15),
  /** Slot of the model inside the cell: 3x3, 0 = north-west, 4 = centre, 8 = south-east (FUN_002f1844). */
  slot: (r: Uint8Array) => u8(r, 0x19),
  /** Doors: non-zero = step 250 instead of 100 from the cell centre (FUN_002effa0). */
  doorStep: (r: Uint8Array) => u8(r, 0x1a),
};

// ---- section 7 fields: doors and exits on walls (houses of the towns …; FUN_0020e554 / FUN_001c6280)
export const P7 = {
  id: (r: Uint8Array) => u32(r, 0),
  /** EventObject row (0 = none). With a row and +0x14 = 0 the record is a door (handler FUN_00430318). */
  door: (r: Uint8Array) => u32(r, 4),
  destMap: (r: Uint8Array) => u32(r, 8),
  destPoint: (r: Uint8Array) => u32(r, 0x0c),
  /** 0 = door, otherwise an exit (FUN_002eff80). */
  kind: (r: Uint8Array) => u8(r, 0x14),
  /** Which way the door is pushed along the wall by 50 (0 / 1 flip it). */
  side: (r: Uint8Array) => u8(r, 0x15),
  /** Facing 0..3 (angle table of section 3 with c = +0x16 + 1). */
  dir: (r: Uint8Array) => u8(r, 0x16),
  /** 1 = a visible door (cell gimmick 9 -> mapObject 5), 0 = an invisible exit (7 -> 0x134). */
  visible: (r: Uint8Array) => u8(r, 0x17),
};

/** Sections whose records refer to an EventObject row. */
export const EVENT_SECTIONS = [3, 7, 4, 5, 8] as const;

/** EventObject row a record refers to (0 = none): section 3 +0x0C, section 7 +0x04, sections 4 / 5 / 8 +0. */
export function recEventRow(section: number, raw: Uint8Array): number {
  if (section === 3) return P3.door(raw);
  if (section === 7) return P7.door(raw);
  if (section === 4 || section === 5 || section === 8) return u32(raw, 0);
  return 0;
}

export const P3_KIND: Record<number, string> = {
  4: '上り階段',
  5: '下り階段・出入口',
  8: 'ワープホール',
  11: '扉',
  16: '扉',
  17: '扉',
};
export const pointKindLabel = (k: number): string => P3_KIND[k] ?? `種類 ${k}`;

export function parseTiles(b: Uint8Array): Tile[] {
  const out: Tile[] = [];
  for (let o = 0; o + 12 <= b.length; o += 12) {
    const r = u8(b, o + 8);
    out.push({
      kind: u32(b, o),
      x: s16(b, o + 4),
      y: s16(b, o + 6),
      rot: r & 3,
      rotHi: r & ~3,
      letter: u8(b, o + 9),
      pad: b[o + 10]! | (b[o + 11]! << 8),
    });
  }
  return out;
}

export function buildTiles(tiles: Tile[]): Uint8Array {
  const out = new Uint8Array(tiles.length * 12);
  tiles.forEach((t, i) => {
    const o = i * 12;
    w32(out, o, t.kind);
    w16(out, o + 4, t.x);
    w16(out, o + 6, t.y);
    out[o + 8] = (t.rotHi & ~3) | (t.rot & 3);
    out[o + 9] = t.letter;
    w16(out, o + 10, t.pad);
  });
  return out;
}

function parseRecs(b: Uint8Array, L: RecordLayout): Rec[] {
  const out: Rec[] = [];
  for (let o = 0; o + L.size <= b.length; o += L.size) {
    const raw = b.slice(o, o + L.size);
    out.push({ raw, x: s16(raw, L.xo), y: s16(raw, L.yo) });
  }
  return out;
}

export function buildRecs(recs: Rec[], L: RecordLayout): Uint8Array {
  const out = new Uint8Array(recs.length * L.size);
  recs.forEach((r, i) => {
    out.set(r.raw, i * L.size);
    w16(out, i * L.size + L.xo, r.x);
    w16(out, i * L.size + L.yo, r.y);
  });
  return out;
}

export function loadDoc(db: MapDb, info: MapInfo): MapDoc {
  const doc: MapDoc = {
    hash: info.hash,
    name: info.name,
    dungeon: info.dungeon,
    floor: info.floor,
    tiles: [],
    recs: {},
    sec6Header: new Uint8Array(0),
    cells6: [],
    raw: {},
  };
  for (let k = 0; k < 10; k++) {
    const b = db.get(info.sections[k]!);
    const L = LAYOUTS[k];
    if (k === 0 && b.length % 12 === 0) doc.tiles = parseTiles(b);
    else if (L && b.length % L.size === 0) doc.recs[k] = parseRecs(b, L);
    else if (k === 6 && b.length >= 8 && (b.length - 8) % 8 === 0) {
      doc.sec6Header = b.slice(0, 8);
      for (let o = 8; o < b.length; o += 8) doc.cells6.push({ value: u32(b, o), x: s16(b, o + 4), y: s16(b, o + 6) });
    } else doc.raw[k] = b.slice();
  }
  return doc;
}

/** Section k bytes of a document. */
export function sectionBytes(doc: MapDoc, k: number): Uint8Array {
  if (doc.raw[k]) return doc.raw[k]!;
  if (k === 0) return buildTiles(doc.tiles);
  if (k === 6) {
    if (!doc.sec6Header.length && !doc.cells6.length) return new Uint8Array(0);
    const out = new Uint8Array(8 + doc.cells6.length * 8);
    out.set(doc.sec6Header);
    doc.cells6.forEach((c, i) => {
      w32(out, 8 + i * 8, c.value);
      w16(out, 12 + i * 8, c.x);
      w16(out, 14 + i * 8, c.y);
    });
    return out;
  }
  const L = LAYOUTS[k];
  if (L) return buildRecs(doc.recs[k] ?? [], L);
  return new Uint8Array(0);
}

// ---- coordinates (docs/map.md §3)
export const CELL = 500;
/** Fine units (sections 2/4/5/8/9): world = 50 + v * 100. */
export const fineToWorld = (v: number): number => 50 + v * 100;
export const worldToFine = (w: number): number => Math.round((w - 50) / 100);
export const cellCenterWorld = (c: number): number => (c + 0.5) * CELL;

/** Position of a record in cell coordinates (floating, cell centre = n + 0.5). */
export function recCellPos(r: Rec, L: RecordLayout): [number, number] {
  if (L.unit === 'cell') return [r.x + 0.5, r.y + 0.5];
  if (L.unit === 'world') return [r.x / CELL, r.y / CELL];
  return [fineToWorld(r.x) / CELL, fineToWorld(r.y) / CELL];
}

/** Grid the world-unit records snap to when moved (doors on the walls sit on multiples of 50 in the game). */
export const WORLD_SNAP = 50;

export function setRecCellPos(r: Rec, L: RecordLayout, cx: number, cy: number): void {
  if (L.unit === 'cell') {
    r.x = Math.floor(cx);
    r.y = Math.floor(cy);
  } else if (L.unit === 'world') {
    const snap = (c: number): number => Math.max(-32768, Math.min(32767, Math.round((c * CELL) / WORLD_SNAP) * WORLD_SNAP));
    r.x = snap(cx);
    r.y = snap(cy);
  } else {
    r.x = Math.max(0, Math.min(299, worldToFine(cx * CELL)));
    r.y = Math.max(0, Math.min(299, worldToFine(cy * CELL)));
  }
}

export function cloneDoc(d: MapDoc): MapDoc {
  return structuredClone(d);
}
