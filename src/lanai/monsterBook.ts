// What RPG FREE!'s monster book shows of its tables, in the shape the shared parts of the books want (ui/MonsterList,
// ui/MonsterSlots): a monster's level and HP from its ability row, the names of actions and items, which monsters use
// an action, and the transformations into a monster. The indexes are read again after every edit of the session.
import type { FieldAccess } from '../ui/FieldEdit';
import { ACTION_SLOT_OFFSETS, isTransform, lanaiAction, lanaiStatsOf, type LanaiAction } from './monsterStats';
import { lanaiMonsters } from './monsters';
import type { LanaiSession } from './session';
import { LANAI_STATS_TABLES } from './tables';

/** A monster's level and HP (the upper value) from its ability row; undefined without one. */
export function lanaiMonsterStats(session: LanaiSession, monster: number): { level: number; hp: number } | undefined {
  const ref = lanaiStatsOf(session, monster);
  if (!ref) return undefined;
  const rows = session.rows(ref.table);
  return { level: rows.get(ref.row, 'level'), hp: rows.get(ref.row, 'hpHi') };
}

/** Whether a monster's MonsterParameter row or its ability row was changed. */
export function lanaiMonsterChanged(session: LanaiSession, row: number): boolean {
  if (session.need('MonsterParameter').rowChanged(row)) return true;
  const s = lanaiStatsOf(session, row);
  return !!s && session.need(s.table).rowChanged(s.row);
}

export const lanaiMonsterName = (session: LanaiSession, row: number): string => lanaiMonsters(session)[row]?.name || `(行 ${row})`;

/** An action's text without the actor ("〈name〉は　ひっかいた！" → "ひっかいた！"); '' when it has none. */
export function lanaiActionText(a: LanaiAction): string {
  return a.message.replace(/^〈name〉[はの]?[\s　]*/, '').trim();
}

/** The name an action is shown by: row 0 is "なし", the others their text or their row. */
export function lanaiActionName(session: LanaiSession, id: number): string {
  const a = lanaiAction(session, id);
  if (!a) return `0x${(id >>> 0).toString(16).toUpperCase()} (表にない)`;
  if (a.row === 0) return 'なし';
  return lanaiActionText(a) || `アクション ${a.row}`;
}

/** An empty action slot: row 0 of ActionData (its ID 0x80000000, or 0 in the skill slots of the data). */
export const isNoAction = (session: LanaiSession, id: number): boolean => session.need('ActionData').find(id) === 0;

/** The book's description of a monster: the MessageFlavor row MonsterParameter +0x10 names ('' when none). */
export function lanaiFlavor(session: LanaiSession, id: number): string {
  const t = session.table('MessageFlavor');
  const r = t?.find(id) ?? -1;
  return t && r >= 0 ? session.plain(t, r, 'message') : '';
}

/** A skill slot of an ability row: the action ID, the slot's target rule and level, and the slot it was read from. */
export interface LanaiSkillSlot {
  id: number;
  target: number;
  lv: number;
  /** 0〜5, or -1 for a slot being added. */
  from: number;
}

/** The skill slots up to the last one holding an action (an empty slot before it stays, as "なし"). */
export function lanaiSkillSlots(session: LanaiSession, f: FieldAccess): LanaiSkillSlot[] {
  const all = [1, 2, 3, 4, 5, 6].map((i) => ({ id: f.get(`skill${i}`), target: f.get(`target${i}`), lv: f.get(`slotLv${i}`), from: i - 1 }));
  let n = all.length;
  while (n > 0 && isNoAction(session, all[n - 1]!.id)) n--;
  return all.slice(0, n);
}

/**
 * Writes the skill slots in order, each with its target and level; the slots after them are emptied (action 0, target
 * 1, level 0, as in the data). The slot used when no skill can be used follows its skill.
 */
export function lanaiSetSkillSlots(f: FieldAccess, next: LanaiSkillSlot[]): void {
  if (next.length > 6) throw new Error('ワザの枠は 6 つまでです');
  const fallback = f.get('fallback');
  for (let i = 0; i < 6; i++) {
    const s = next[i] ?? { id: 0, target: 1, lv: 0 };
    f.set(`skill${i + 1}`, s.id);
    f.set(`target${i + 1}`, s.target);
    f.set(`slotLv${i + 1}`, s.lv);
  }
  const to = next.findIndex((s) => s.from === fallback);
  if (to >= 0) f.set('fallback', to);
}

export function lanaiItemName(session: LanaiSession, id: number): string {
  return session.insert('ItemData', id, 'name') ?? `0x${(id >>> 0).toString(16).toUpperCase()}`;
}

export interface LanaiActionUse {
  /** The monster whose ability row has the action. */
  monster: number;
  /** Offset of the slot in the ability row (ACTION_SLOT_OFFSETS). */
  offset: number;
}

export interface LanaiMonsterIndex {
  /** Action ID → the monsters (and slots) using it. */
  users: Map<number, LanaiActionUse[]>;
  /** MonsterParameter row → the transformations into it: the action and who has it in which slot. */
  into: Map<number, { action: LanaiAction; use: LanaiActionUse }[]>;
}

const indexes = new WeakMap<LanaiSession, { revision: number; index: LanaiMonsterIndex }>();

/** Who uses each action, and the transformations into each monster (read once per edit). */
export function lanaiMonsterIndex(session: LanaiSession): LanaiMonsterIndex {
  const cached = indexes.get(session);
  if (cached && cached.revision === session.revision) return cached.index;
  const p = session.need('MonsterParameter');
  const users = new Map<number, LanaiActionUse[]>();
  const into = new Map<number, { action: LanaiAction; use: LanaiActionUse }[]>();
  const actions = new Map<number, LanaiAction | null>();
  const tables = LANAI_STATS_TABLES.map((t) => session.need(t));
  for (let m = 0; m < p.rows; m++) {
    const kind = Math.max(1, p.u16(m, 0x16) & 7);
    const t = tables[kind - 1];
    const row = p.u16(m, 0x14);
    if (!t || row >= t.rows) continue;
    for (const offset of ACTION_SLOT_OFFSETS) {
      const id = t.u32(row, offset);
      const use = { monster: m, offset };
      users.set(id, [...(users.get(id) ?? []), use]);
      if (!actions.has(id)) actions.set(id, lanaiAction(session, id));
      const a = actions.get(id)!;
      if (!a || !isTransform(a)) continue;
      const to = p.find(a.target);
      if (to >= 0) into.set(to, [...(into.get(to) ?? []), { action: a, use }]);
    }
  }
  const index = { users, into };
  indexes.set(session, { revision: session.revision, index });
  return index;
}

/** The monsters using an action (each once). */
export function lanaiActionUsers(session: LanaiSession, id: number): number[] {
  return [...new Set((lanaiMonsterIndex(session).users.get(id) ?? []).map((u) => u.monster))];
}

/** Whether a monster transforms (a slot holds an action of system 29 / 30) or is transformed into. */
export function lanaiTransforms(session: LanaiSession, monster: number): boolean {
  const ref = lanaiStatsOf(session, monster);
  if (lanaiMonsterIndex(session).into.has(monster)) return true;
  if (!ref) return false;
  const t = session.need(ref.table);
  return ACTION_SLOT_OFFSETS.some((o) => isTransform(lanaiAction(session, t.u32(ref.row, o))));
}
