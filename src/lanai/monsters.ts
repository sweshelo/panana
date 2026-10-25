// The monsters of 電波人間のRPG FREE! (naauao lanai/monsters.md): MonsterParameter (master 2135000A, 1231 × 0x24) for the
// names, and the MonsterDesign row it names (+0x00 bits 20-29, a row number; 570 × 0xA0) for the BCH entries of the
// model (+0x08), the colour's
// textures (+0x0C) and the battle motions (+0x10): the game reads the look that way (code.bin 0x306E84 and 0x2B7ED0:
// `lsl #2; lsr #22` of +0x00, then FUN_0031C038 on MonsterDesign with the row number). +0x10 is a 0x8000xxxx value of
// another numbering (only 40 rows agree with MonsterDesign's row IDs); it is not the look. The BCHs are `enemy_NN[_MM].bch`, `enemy_NN_MM_tex.bch` and
// `enemy_NN_battle.bch` of the root archives 28480000 (Base) and 719F0000 (Update). Monsters of one species share a
// model and differ by the texture entry (おおくちばし and アイスバード are both enemy_02).
// The abilities (MonsterParameterMain / Extra / RegularEvent / SpecialEvent, 0x9C) are read and edited in monsterStats.ts.
import { entryBlob } from '../archive/gsarc';
import { BchEntryIndex, type BchIndexEntry } from '../bch/models';
import { zipEntryName } from '../archive/zip';
import { u32 } from '../util/bytes';
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
  /** +0x10: the row ID of the book's description in MessageFlavor (4177000A; not the look). */
  design: number;
  /** Row number of MonsterDesign: +0x00 bits 20-29 (-1 when the table has no such row). */
  designRow: number;
}

/** The BCH entries of a MonsterDesign row (hashes; 0 = none). */
export interface LanaiMonsterDesign {
  row: number;
  id: number;
  model: number;
  texture: number;
  motion: number;
}

/** An entry of the model archives. */
export interface LanaiModelEntry extends BchIndexEntry {
  /** File name in its ZIP ("enemy_02.bch"). */
  name: string;
}

export const lanaiMonsterHref = (row: number): string => `#/monsters/${row}`;

const lists = new WeakMap<LanaiSession, LanaiMonster[]>();

/** Every row of MonsterParameter (read once per session). */
export function lanaiMonsters(session: LanaiSession): LanaiMonster[] {
  let out = lists.get(session);
  if (!out) {
    const t = session.need('MonsterParameter');
    const d = session.need('MonsterDesign');
    out = Array.from({ length: t.rows }, (_, row): LanaiMonster => {
      const look = (t.u32(row, 0x00) >>> 20) & 0x3ff;
      return { row, id: t.rowId(row), name: session.plain(t, row, 'name'), group: session.plain(t, row, 'group_name'), design: t.u32(row, 0x10), designRow: look < d.rows ? look : -1 };
    });
    lists.set(session, out);
  }
  return out;
}

export function lanaiMonsterDesign(session: LanaiSession, row: number): LanaiMonsterDesign | null {
  const t = session.need('MonsterDesign');
  if (row < 0 || row >= t.rows) return null;
  return {
    row,
    id: t.rowId(row),
    model: t.u32(row, 0x08),
    texture: t.u32(row, 0x0c),
    motion: t.u32(row, 0x10),
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

/** The entries of the model archives by hash, with their file names (from their ZIPs, nothing unpacked). */
export class LanaiModelIndex extends BchEntryIndex<LanaiModelEntry> {
  static async open(session: LanaiSession): Promise<LanaiModelIndex> {
    const [archives, entries] = await BchEntryIndex.read(LANAI_MONSTER_MODEL_ARCHIVES, (n) => session.archive(n), (e, arc): LanaiModelEntry => ({
      ...e,
      name: (e.entry.comp === 1 ? zipEntryName(entryBlob(arc, e.entry)) : null) ?? '',
    }));
    return new LanaiModelIndex(archives, entries);
  }

  name(hash: number): string | undefined {
    return this.get(hash)?.name || undefined;
  }
}

const indexes = new WeakMap<LanaiSession, Promise<LanaiModelIndex>>();

/** The model archives are read again (a port added entries). */
export function forgetLanaiModelIndex(session: LanaiSession): void {
  indexes.delete(session);
}

/** The monsters' looks are read again (a monster got another design row). */
export function forgetLanaiMonsters(session: LanaiSession): void {
  lists.delete(session);
}

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
