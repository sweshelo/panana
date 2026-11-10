// 初代's actions (naauao honolulu/monsters.md §3・§4): the master has no actionData; the antennas' skills (skillData)
// and the monsters' skills (monsterAttackSkill) are two tables the battle puts into the same kind of action
// (FUN_00205260 / FUN_00204A40). The action page lists both; an action is named by its table and row ("s12", "w34").
import type { TableRows } from '../game/tablerows';
import { attackName, battleRows, monsterName, SKILL_FILE, SKILL_SLOTS, skillRows } from './monsters';
import type { HonoluluSession } from './session';

export const ANTENNA_SKILL_FILE = 'skillData.bin';

/** 's': skillData (the antennas' skills), 'w': monsterAttackSkill (the monsters' skills). */
export type HonoluluActionKind = 's' | 'w';

export const ACTION_KIND_LABEL: Record<HonoluluActionKind, string> = { s: 'アンテナの特技', w: 'モンスターのワザ' };
export const ACTION_FILE: Record<HonoluluActionKind, string> = { s: ANTENNA_SKILL_FILE, w: SKILL_FILE };

/** The messages of an action: [field, label]. skillData +0x08 is +0x00 again where +0x00 is set. */
export const ACTION_TEXTS: Record<HonoluluActionKind, [string, string][]> = {
  s: [['name', '名前'], ['desc', '説明']],
  w: [['message', '戦闘メッセージ']],
};

export interface HonoluluAction {
  kind: HonoluluActionKind;
  row: number;
  name: string;
  min: number;
  max: number;
  /** The monsters (monsterBattleParameter's rows) with the skill in a slot. */
  users: number[];
}

export const honoluluActionHref = (kind: HonoluluActionKind, row: number): string => `#/actions/${kind}${row}`;
export const honoluluAttackHref = (row: number): string => honoluluActionHref('w', row);

/** "s12" → ['s', 12]; undefined for anything else. */
export function parseActionKey(arg: string | undefined): [HonoluluActionKind, number] | undefined {
  const m = arg?.match(/^([sw])(\d+)$/);
  return m ? [m[1] as HonoluluActionKind, Number(m[2])] : undefined;
}

export const actionRows = (session: HonoluluSession, kind: HonoluluActionKind): TableRows => session.master.rows(ACTION_FILE[kind]);

/** An antenna skill's name: skillData +0x00, or +0x08 in the rows where only that one is set. */
export function antennaSkillName(session: HonoluluSession, row: number): string {
  const t = actionRows(session, 's');
  if (row <= 0 || row >= t.rows) return '';
  return session.messages.texts.preview(t.get(row, 'name') || t.get(row, 'name2'), true) ?? '';
}

export function actionName(session: HonoluluSession, kind: HonoluluActionKind, row: number): string {
  return kind === 's' ? antennaSkillName(session, row) : attackName(session, row);
}

/** The monsters that have each skill in a slot (monsterAttackSkill's row → monsterBattleParameter's rows). */
export function attackUsers(session: HonoluluSession): Map<number, number[]> {
  const t = battleRows(session);
  const out = new Map<number, number[]>();
  for (let r = 1; r < t.rows; r++) {
    for (const k of SKILL_SLOTS) {
      const s = t.get(r, k);
      if (!s) continue;
      const list = out.get(s) ?? out.set(s, []).get(s)!;
      if (!list.includes(r)) list.push(r);
    }
  }
  return out;
}

/** Both tables' rows but row 0 (empty), the antennas' skills first. */
export function honoluluActions(session: HonoluluSession): HonoluluAction[] {
  const users = attackUsers(session);
  const out: HonoluluAction[] = [];
  for (const kind of ['s', 'w'] as const) {
    const t = actionRows(session, kind);
    for (let row = 1; row < t.rows; row++) {
      out.push({ kind, row, name: actionName(session, kind, row), min: t.get(row, 'min'), max: t.get(row, 'max'), users: kind === 'w' ? users.get(row) ?? [] : [] });
    }
  }
  return out;
}

/** The other rows of the same table whose field `key` holds the same message (editing it changes them too). */
export function rowsWithText(session: HonoluluSession, kind: HonoluluActionKind, row: number, key: string): number[] {
  const t = actionRows(session, kind);
  const id = t.get(row, key);
  const out: number[] = [];
  if (!id) return out;
  for (let r = 1; r < t.rows; r++) if (r !== row && t.get(r, key) === id) out.push(r);
  return out;
}

/** The message ids of an action (skillData's +0x08 is the name again). */
function textIds(session: HonoluluSession, kind: HonoluluActionKind, row: number): number[] {
  const t = actionRows(session, kind);
  return [...new Set(ACTION_TEXTS[kind].map(([k]) => t.get(row, k)).filter((id) => id))];
}

/** Whether the action's row or one of its messages was changed. */
export function actionChanged(session: HonoluluSession, kind: HonoluluActionKind, row: number): boolean {
  return actionRows(session, kind).changed(row) || textIds(session, kind, row).some((id) => session.messages.texts.isEdited(id));
}

/** Put the action's row and its messages back as they are in the master. */
export function revertAction(session: HonoluluSession, kind: HonoluluActionKind, row: number): void {
  const t = actionRows(session, kind);
  for (const id of textIds(session, kind, row)) session.messages.texts.revert(id);
  t.revert(row);
}

/** The monsters' names of a skill, for the lists. */
export const userNames = (session: HonoluluSession, users: number[]): string[] => [...new Set(users.map((m) => monsterName(session, m)))];
