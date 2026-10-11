// The abilities of RPG FREE!'s monsters (naauao lanai/monsters.md §1・§3・§9): MonsterParameter +0x16 bit0-2 names one of
// four ability tables (1 Main, 2 Extra, 3 RegularEvent, 4 SpecialEvent; 0 counts as 1) and +0x14 its row. The rows are
// shared by several monsters (2nd and 3rd of a kind), so editing one changes all of them: a row can be copied to a new
// row at the end of its table and the monster linked to the copy. Transformations are actions of system 29 / 30
// (ActionData +0x14 bit4-11) whose +0x00 is the MonsterParameter row ID to become; those actions are shared too and can
// be copied the same way.
import { LANAI_STATS_TABLES } from './tables';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

export type LanaiStatsTable = (typeof LANAI_STATS_TABLES)[number];

/** Where a monster's abilities are. */
export interface LanaiStatsRef {
  /** 1〜4 (MonsterParameter +0x16 bit0-2, 0 read as 1). */
  kind: number;
  table: LanaiStatsTable;
  row: number;
}

/** The ability row of a MonsterParameter row (null when the row is not in its table). */
export function lanaiStatsOf(session: LanaiSession, monster: number): LanaiStatsRef | null {
  const p = session.need('MonsterParameter');
  const kind = Math.max(1, p.u16(monster, 0x16) & 7);
  if (kind > 4) return null;
  const table = LANAI_STATS_TABLES[kind - 1]!;
  const row = p.u16(monster, 0x14);
  return row < session.need(table).rows ? { kind, table, row } : null;
}

/** The MonsterParameter rows using an ability row. */
export function lanaiStatsSharers(session: LanaiSession, ref: Pick<LanaiStatsRef, 'kind' | 'row'>): number[] {
  const p = session.need('MonsterParameter');
  const out: number[] = [];
  for (let m = 0; m < p.rows; m++) if (Math.max(1, p.u16(m, 0x16) & 7) === ref.kind && p.u16(m, 0x14) === ref.row) out.push(m);
  return out;
}

/** Copies a monster's ability row to a new row at the end of its table and links the monster to it; returns the row. */
export function lanaiCopyStats(session: LanaiSession, monster: number): number {
  const ref = lanaiStatsOf(session, monster);
  if (!ref) throw new Error(`モンスター ${monster} の能力の行がありません`);
  const t = session.need(ref.table);
  const row = t.addRow(ref.row);
  if (row > 0xffff) throw new Error('能力の行番号が +0x14 (u16) に入りません');
  session.need('MonsterParameter').setU16(monster, 0x14, row);
  return row;
}

/**
 * Puts a monster back as read: its MonsterParameter row, its ability row, and the actions it names that were changed.
 * Rows an edit added are removed when nothing names them any more and they are the last of their table.
 */
export function lanaiRevertMonster(session: LanaiSession, monster: number): void {
  const before = lanaiStatsOf(session, monster);
  const acts = before ? lanaiStatsActions(session, before) : [];
  const p = session.need('MonsterParameter');
  if (p.originalRow(monster)) p.revertRow(monster);
  if (before) {
    const t = session.need(before.table);
    if (t.originalRow(before.row)) t.revertRow(before.row);
    else dropUnused(t, (r) => lanaiStatsSharers(session, { kind: before.kind, row: r }).length > 0);
  }
  const a = session.need('ActionData');
  for (const id of acts) {
    const r = a.find(id);
    if (r >= 0 && a.originalRow(r)) a.revertRow(r);
  }
  dropUnused(a, (r) => lanaiActionUsers(session, a.rowId(r)).length > 0);
}

/** Removes added rows from the end of a table while nothing uses them. */
function dropUnused(t: LanaiTable, used: (row: number) => boolean): void {
  while (t.rows > t.originalRows && !used(t.rows - 1)) t.removeLastRow();
}

// ---- actions

export const ACTION_SLOT_KEYS = ['actBattle', 'actDefault', 'actTurnStart', 'actHit1', 'actHit2', 'actTurnEnd', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6'] as const;
/** Offsets of the action slots of an ability row (the keys above, in order). */
export const ACTION_SLOT_OFFSETS = [0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x68];

export interface LanaiAction {
  row: number;
  id: number;
  /** +0x14 bit4-11. */
  system: number;
  /** +0x14 bit0-3 (5 / 8 work when hit). */
  kind: number;
  /** +0x00: the MonsterParameter row ID to become, for system 29 / 30. */
  target: number;
  /** The battle text (MessageAction `individual` of +0x0C). */
  message: string;
}

export const isTransform = (a: LanaiAction | null): boolean => !!a && (a.system === 29 || a.system === 30);

export function lanaiAction(session: LanaiSession, id: number): LanaiAction | null {
  const t = session.need('ActionData');
  const row = t.find(id);
  if (row < 0) return null;
  const head = t.u32(row, 0x14);
  return { row, id: t.rowId(row), system: (head >>> 4) & 0xff, kind: head & 0xf, target: t.u32(row, 0x00), message: session.insert('MessageAction', t.u32(row, 0x0c), 'individual') ?? '' };
}

/** The action IDs an ability row names (its slots). */
export function lanaiStatsActions(session: LanaiSession, ref: Pick<LanaiStatsRef, 'table' | 'row'>): number[] {
  const t = session.need(ref.table);
  return ACTION_SLOT_OFFSETS.map((o) => t.u32(ref.row, o));
}

/** The ability rows (table, row) naming an action in any slot. */
export function lanaiActionUsers(session: LanaiSession, id: number): { table: LanaiStatsTable; row: number }[] {
  const out: { table: LanaiStatsTable; row: number }[] = [];
  for (const table of LANAI_STATS_TABLES) {
    const t = session.need(table);
    for (let r = 0; r < t.rows; r++) if (ACTION_SLOT_OFFSETS.some((o) => t.u32(r, o) === id)) out.push({ table, row: r });
  }
  return out;
}

/** The monsters whose ability rows name an action. */
export function lanaiActionMonsters(session: LanaiSession, id: number): number[] {
  const users = new Set(lanaiActionUsers(session, id).map((u) => `${LANAI_STATS_TABLES.indexOf(u.table) + 1}:${u.row}`));
  const p = session.need('MonsterParameter');
  const out: number[] = [];
  for (let m = 0; m < p.rows; m++) if (users.has(`${Math.max(1, p.u16(m, 0x16) & 7)}:${p.u16(m, 0x14)}`)) out.push(m);
  return out;
}

/** Copies an action to a new ActionData row (a new row ID) and puts it in the slot at `offset` of an ability row; returns the new ID. */
export function lanaiCopyActionInto(session: LanaiSession, id: number, ref: Pick<LanaiStatsRef, 'table' | 'row'>, offset: number): number {
  const a = session.need('ActionData');
  const row = a.find(id);
  if (row < 0) throw new Error(`アクション ${id.toString(16)} がありません`);
  const copy = a.addRow(row);
  const nid = a.rowId(copy);
  session.need(ref.table).setU32(ref.row, offset, nid);
  return nid;
}

/**
 * Sets the monster an action turns into. For system 30 the ability row's +0x50 (read at the start of the battle) is
 * moved along when it named the old target.
 */
export function lanaiSetTransformTarget(session: LanaiSession, actionId: number, monster: number, ref?: Pick<LanaiStatsRef, 'table' | 'row'>): void {
  const act = lanaiAction(session, actionId);
  if (!act) return;
  const id = session.need('MonsterParameter').rowId(monster);
  session.need('ActionData').setU32(act.row, 0x00, id);
  if (ref && act.system === 30) {
    const t = session.need(ref.table);
    if (t.u32(ref.row, 0x50) === act.target) t.setU32(ref.row, 0x50, id);
  }
}

// ---- the values' names

/** Labels of the condition byte of the automatic actions (+0x96〜+0x99; naauao lanai/monsters.md §7). */
export function lanaiConditionLabel(v: number): string {
  const pct = [100, 20, 30, 50, 80];
  const pct2 = [100, 75, 50, 25, 10];
  const elems = ['火', '氷', '風', '土', '電気', '水', '光', '闇'];
  if (v === 0 || v === 100) return `必ず (${v})`;
  if (v < 100) return `${v}%`;
  if (v === 0x65) return '倒される一撃 (0x65)';
  const hx = `0x${v.toString(16).toUpperCase()}`;
  if (v >= 0x66 && v <= 0x6a) return `打撃を受けた ${pct[v - 0x66]}% (${hx})`;
  if (v >= 0x6b && v <= 0x6f) return `打撃 (会心?) を受けた ${pct[v - 0x6b]}% (${hx})`;
  if (v >= 0x70 && v <= 0x74) return `ブレス・呪文等を受けた ${pct[v - 0x70]}% (${hx})`;
  if (v >= 0x75 && v <= 0x9c) return `${elems[Math.floor((v - 0x75) / 5)]}属性を受けた ${pct[(v - 0x75) % 5]}% (${hx})`;
  if (v >= 0x9d && v <= 0xa1) return `味方が 2 体以上 ${pct2[v - 0x9d]}% (${hx})`;
  if (v >= 0xa2 && v <= 0xa6) return `自分 1 体だけ ${pct2[v - 0xa2]}% (${hx})`;
  if (v === 0xa7) return `戦闘 +0x11A ≠ 0 (${hx})`;
  if (v >= 0xa8 && v <= 0xac) return `プレイヤー側の条件 (${hx})`;
  if (v >= 0xad && v <= 0xc0) return `戦闘 +0x11C bit${Math.floor((v - 0xad) / 5)} = 0 ${pct[(v - 0xad) % 5]}% (${hx})`;
  if (v >= 0xc1 && v <= 0xc3) return `HP ${[75, 50, 25][v - 0xc1]}% 以下 (${hx})`;
  return `不明 (${hx})`;
}

export const LANAI_AI_LABELS = ['均等', '前の枠ほど重い', '19/20 で枠 1', '順番', '2 枠ずつ順番'];
export const LANAI_ACTION_COUNT_LABELS = ['1 回', '1〜2 回', '2 回', '1〜3 回', '2〜3 回', '3 回'];
