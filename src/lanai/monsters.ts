// The monsters of 電波人間のRPG FREE! (naauao lanai/monsters.md): MonsterParameter (master 2135000A, 1231 × 0x24) for the
// names, and the MonsterDesign row it names (+0x10, 570 × 0xA0) for the BCH entries of the model (+0x08), the colour's
// textures (+0x0C) and the battle motions (+0x10). The BCHs are `enemy_NN[_MM].bch`, `enemy_NN_MM_tex.bch` and
// `enemy_NN_battle.bch` of the root archives 28480000 (Base) and 719F0000 (Update). Monsters of one species share a
// model and differ by the texture entry (おおくちばし and アイスバード are both enemy_02).
// The stats (MonsterParameterMain / Extra / RegularEvent / SpecialEvent, 0x9C) are not linked to these rows yet.
import { entryBlob, unpackEntry, type ArcEntry, type Archive } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { f32, u16, u32 } from '../util/bytes';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** Root archives with the monsters' BCHs, the one searched first first (the Update's has the entries it replaced). */
export const LANAI_MONSTER_MODEL_ARCHIVES = ['719F0000', '28480000'] as const;

export interface LanaiMonster {
  /** Row of MonsterParameter. */
  row: number;
  /** Its row ID. */
  id: number;
  name: string;
  group: string;
  /** +0x10: row ID of MonsterDesign. */
  design: number;
  /** Row of MonsterDesign (-1 when the table has no such ID). */
  designRow: number;
}

/** The BCH entries of a MonsterDesign row (hashes; 0 = none). */
export interface LanaiMonsterDesign {
  row: number;
  id: number;
  model: number;
  texture: number;
  motion: number;
  /** +0x20..+0x48 as f32 (sizes and distances, assumed). */
  sizes: number[];
}

/** An entry of the model archives. */
export interface LanaiModelEntry {
  hash: number;
  archive: string;
  /** File name in its ZIP ("enemy_02.bch"). */
  name: string;
  entry: ArcEntry;
}

/** Offset of the first f32 of MonsterDesign that looks like a size, and the number of them (naauao: 推定). */
export const DESIGN_SIZES: [number, number] = [0x20, 11];

export const lanaiMonsterHref = (row: number): string => `#/monsters/${row}`;

const lists = new WeakMap<LanaiSession, LanaiMonster[]>();

/** Every row of MonsterParameter (read once per session). */
export function lanaiMonsters(session: LanaiSession): LanaiMonster[] {
  let out = lists.get(session);
  if (!out) {
    const t = session.need('MonsterParameter');
    const d = session.need('MonsterDesign');
    out = Array.from({ length: t.rows }, (_, row): LanaiMonster => {
      const design = t.u32(row, 0x10);
      return { row, id: t.rowId(row), name: session.plain(t, row, 'name'), group: session.plain(t, row, 'group_name'), design, designRow: d.find(design) };
    });
    lists.set(session, out);
  }
  return out;
}

export function lanaiMonsterDesign(session: LanaiSession, row: number): LanaiMonsterDesign | null {
  const t = session.need('MonsterDesign');
  if (row < 0 || row >= t.rows) return null;
  const r = t.row(row);
  return {
    row,
    id: t.rowId(row),
    model: t.u32(row, 0x08),
    texture: t.u32(row, 0x0c),
    motion: t.u32(row, 0x10),
    sizes: Array.from({ length: DESIGN_SIZES[1] }, (_, i) => f32(r, DESIGN_SIZES[0] + i * 4)),
  };
}

/**
 * The +0x08 field (`voice`): a byte string, not UTF-16 like the other strings. The ones that are there are half-width
 * katakana with ' / > | (a reading for speech synthesis, assumed); most monsters have none.
 */
export function lanaiVoice(t: LanaiTable, row: number): { bytes: number[]; text: string } {
  const o = t.stringOffset(row, 0x08);
  const bytes: number[] = [];
  if (o >= 0) for (let p = o; p < t.data.length && t.data[p] !== 0 && bytes.length < 256; p++) bytes.push(t.data[p]!);
  const text = bytes.map((b) => (b >= 0xa1 && b <= 0xdf ? String.fromCharCode(0xff61 + b - 0xa1) : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('');
  return { bytes, text };
}

/** The raw u32s of a row (offset, value). */
export function rowWords(t: LanaiTable, row: number): [number, number][] {
  const r = t.row(row);
  return Array.from({ length: t.rowSize >>> 2 }, (_, i): [number, number] => [i * 4, u32(r, i * 4)]);
}

/** The two u16 of MonsterParameter +0x14 (meaning not known). */
export function paramHalves(t: LanaiTable, row: number): [number, number] {
  const r = t.row(row);
  return [u16(r, 0x14), u16(r, 0x16)];
}

/** The entries of the model archives by hash (names from their ZIPs, nothing unpacked). */
export class LanaiModelIndex {
  private constructor(
    readonly archives: Map<string, Archive>,
    readonly entries: Map<number, LanaiModelEntry>,
  ) {}

  static async open(session: LanaiSession): Promise<LanaiModelIndex> {
    const archives = new Map<string, Archive>();
    const entries = new Map<number, LanaiModelEntry>();
    for (const name of LANAI_MONSTER_MODEL_ARCHIVES) {
      const arc = await session.archive(name);
      archives.set(name, arc);
      for (const e of arc.entries) {
        if (entries.has(e.hash)) continue;
        const file = e.comp === 1 ? zipEntryName(entryBlob(arc, e)) : null;
        entries.set(e.hash, { hash: e.hash, archive: name, name: file ?? '', entry: e });
      }
    }
    return new LanaiModelIndex(archives, entries);
  }

  get(hash: number): LanaiModelEntry | undefined {
    return hash ? this.entries.get(hash) : undefined;
  }

  name(hash: number): string | undefined {
    return this.get(hash)?.name || undefined;
  }

  /** The unpacked bytes of an entry, or null when no archive has it. */
  body(hash: number): Uint8Array | null {
    const e = this.get(hash);
    return e ? unpackEntry(this.archives.get(e.archive)!, e.entry).body : null;
  }
}

const indexes = new WeakMap<LanaiSession, Promise<LanaiModelIndex>>();

/** The model index of a session (read once). */
export function lanaiModelIndex(session: LanaiSession): Promise<LanaiModelIndex> {
  let p = indexes.get(session);
  if (!p) {
    p = LanaiModelIndex.open(session);
    p.catch(() => indexes.delete(session));
    indexes.set(session, p);
  }
  return p;
}

/** The monsters whose design uses the model `hash` (for "the same model"). */
export function monstersWithModel(session: LanaiSession, hash: number): LanaiMonster[] {
  const d = session.need('MonsterDesign');
  return lanaiMonsters(session).filter((m) => m.designRow >= 0 && d.u32(m.designRow, 0x08) === hash);
}
