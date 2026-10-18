// The layout of a MonsterGroup row (0x9C bytes; code.bin FUN_00422368 / FUN_00422b18 / FUN_002711e0): five lists of
// five MonsterParameter row IDs — A the leaders, B and C the mates a leader takes, D and E fixed formations — with a
// weight and a count code for each slot, the weights of the four ways a battle is formed, the battle field and flags.
// The project notes (lanai/monstergroup.md) give the functions; "推定" marks what was only read from the code.
import { u32 } from '../util/bytes';
import type { LanaiTable } from './table';

/** The lists of a group: their monster slots (u32 × 5), and where their weights and count codes are (u8 × 5). */
export const LANAI_MG_LISTS = [
  { key: 'A', label: 'A: リーダー候補', ids: 0x04, weight: 0x6e, count: 0x73 },
  { key: 'B', label: 'B: お供リスト 1', ids: 0x18, weight: 0x7d, count: 0x82 },
  { key: 'C', label: 'C: お供リスト 2', ids: 0x2c, weight: 0x87, count: 0x8c },
  { key: 'D', label: 'D: 固定編成 1', ids: 0x40, weight: -1, count: 0x91 },
  { key: 'E', label: 'E: 固定編成 2', ids: 0x54, weight: -1, count: 0x96 },
] as const;
export type LanaiMgList = (typeof LANAI_MG_LISTS)[number];

/** +0x00: the battle field's row ID (BattleFieldContents of the content when flag bit 3 is set, else the master's BattleField). */
export const LANAI_MG_FIELD = 0x00;
/** +0x68: how many battles the group gives (0 = no limit; 推定: compared with a saved counter per row). */
export const LANAI_MG_LIMIT = 0x68;
/** +0x69: flags. */
export const LANAI_MG_FLAGS = 0x69;
/** +0x6A: weights of the four ways a battle is formed (LANAI_MG_PATTERNS). */
export const LANAI_MG_PATTERN = 0x6a;
/** +0x78: for each leader A[i], the list its mates come from (0 = none, 1 = B, 2 = C). */
export const LANAI_MG_MATES = 0x78;

export const LANAI_MG_PATTERNS = ['リーダーだけ', 'リーダー + お供', 'D の全員', 'E の全員'];
export const LANAI_MG_FLAG_BITS: [bit: number, label: string][] = [
  [0, 'bit0: 先制・不意打ちなし (推定)'],
  [1, 'bit1: 逃げられない (推定)'],
  [2, 'bit2: ボス戦扱い・先制なし (推定)'],
  [3, 'bit3: 背景はコンテンツの BattleFieldContents'],
];
export const LANAI_MG_MATE_LISTS = ['お供なし', 'B から', 'C から'];

/** Count codes (FUN_002711e0): how many of the monster come, a range being picked evenly. */
const COUNTS: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [8, 8], [1, 2], [1, 3], [1, 4], [1, 5], [1, 8], [2, 3], [2, 4], [3, 4], [3, 6], [4, 8]];
export const LANAI_MG_COUNT_CODES = COUNTS.length;

/** "1〜3 体" for a count code (codes the game does not know give 1). */
export function lanaiCountLabel(code: number): string {
  const c = COUNTS[code];
  if (!c) return `${code}: 1 体`;
  return c[0] === c[1] ? `${c[0]} 体` : `${c[0]}〜${c[1]} 体`;
}

export interface LanaiMgSlot {
  /** MonsterParameter row ID (0 = empty: the only value the game skips). */
  id: number;
  weight: number;
  count: number;
}

export function lanaiMgSlots(t: LanaiTable, row: number, list: LanaiMgList): LanaiMgSlot[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: t.u32(row, list.ids + i * 4),
    weight: list.weight < 0 ? 0 : t.u8(row, list.weight + i),
    count: t.u8(row, list.count + i),
  }));
}

/** The original value of a byte or u32 of a row (undefined for an added row). */
export function lanaiMgOriginal(t: LanaiTable, row: number, offset: number, size: 1 | 4): number | undefined {
  const o = t.originalRow(row);
  return !o ? undefined : size === 4 ? u32(o, offset) : o[offset];
}
