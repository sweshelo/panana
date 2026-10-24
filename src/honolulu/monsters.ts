// 初代's monsters (naauao honolulu/monsters.md): the rows of monsterBattleParameter (master, bit-packed stats, drops and
// skills), their looks in monsterData (2713402F: the name and the 470D2848 model, shared by the forms of a monster), the
// skills of monsterAttackSkill, and the groups (monsterGroup, monsterFixGroup) that hold them. Where the groups appear
// (the dungeon floors' files) is not read yet (naauao#47).
import { loadComposite } from '../cgfx/loader';
import { lowerPriorityFirst } from '../cgfx/tileset';
import type { TableRows } from '../game/tablerows';
import type { ModelRef } from '../pages/modelview';
import { hex8 } from '../util/bytes';
import type { HonoluluSession } from './session';

/** The archive of monsterData (the looks), directData and effectData. */
export const HONOLULU_MONSTER_ARCHIVE = '2713402F';
/** The monsters' models (CGFX, as RPG2's). */
export const HONOLULU_MONSTER_MODELS = '470D2848';

export const BATTLE_FILE = 'monsterBattleParameter.bin';
export const DESIGN_FILE = 'monsterData.bin';
export const SKILL_FILE = 'monsterAttackSkill.bin';
export const GROUP_FILE = 'monsterGroup.bin';
export const FIX_GROUP_FILE = 'monsterFixGroup.bin';

export const DROP_SLOTS = [['drop1', 'drop1Rate'], ['drop2', 'drop2Rate']] as const;
export const SKILL_SLOTS = ['skill0', 'skill1', 'skill2', 'skill3', 'skill4'] as const;

export interface HonoluluMonster {
  row: number;
  /** monsterData's row (+0x2C). */
  design: number;
  name: string;
  level: number;
  hp: { min: number; max: number };
  /** monsterBattleParameter's row of the next form, 0 = none. */
  next: number;
}

export const battleRows = (session: HonoluluSession): TableRows => session.master.rows(BATTLE_FILE);
export const designRows = (session: HonoluluSession): TableRows => session.design.rows(DESIGN_FILE);
export const skillRows = (session: HonoluluSession): TableRows => session.master.rows(SKILL_FILE);

/** The name of a look (monsterData's row). */
export function designName(session: HonoluluSession, design: number): string {
  const d = designRows(session);
  return design > 0 && design < d.rows ? session.messages.texts.preview(d.get(design, 'name'), true) ?? '' : '';
}

/** The monsters: the rows of monsterBattleParameter with a look (row 0 is empty), in row order. */
export function honoluluMonsters(session: HonoluluSession): HonoluluMonster[] {
  const t = battleRows(session);
  const out: HonoluluMonster[] = [];
  for (let row = 1; row < t.rows; row++) {
    const design = t.get(row, 'design');
    if (!design) continue;
    const a = t.get(row, 'hpMin');
    const b = t.get(row, 'hpMax');
    out.push({ row, design, name: designName(session, design), level: t.get(row, 'level'), hp: { min: Math.min(a, b), max: Math.max(a, b) }, next: t.get(row, 'next') });
  }
  return out;
}

/** A skill's name: its battle message without "〈モンスター〉〈A〜Z〉の" / "…は" and the closing "！" / "。" (たいあたり). */
export function attackName(session: HonoluluSession, row: number): string {
  const t = skillRows(session);
  if (row <= 0 || row >= t.rows) return '';
  const text = session.messages.texts.preview(t.get(row, 'message'), true) ?? '';
  return text.replace(/^〈モンスター〉(?:〈[^〉]*〉)?[のは][\s　]*/, '').replace(/[！!。]$/, '') || text;
}

export const honoluluMonsterHref = (row: number): string => `#/monsters/${row}`;

/** The name of a monsterBattleParameter row (its look's), '' when there is none. */
export function monsterName(session: HonoluluSession, row: number): string {
  const t = battleRows(session);
  return row > 0 && row < t.rows ? designName(session, t.get(row, 'design')) : '';
}

/** Names of rows of the monster tables (FieldContext.rowName for the tables both archives refer to). */
export function monsterRowName(session: HonoluluSession, table: string, row: number): string | undefined {
  switch (table) {
    case DESIGN_FILE: return designName(session, row) || undefined;
    case BATTLE_FILE: return monsterName(session, row) || undefined;
    case SKILL_FILE: return attackName(session, row) || undefined;
  }
  return undefined;
}

/** The groups that hold a monster: monsterGroup's rows (slots A or B) and monsterFixGroup's. */
export interface MonsterGroups {
  groups: number[];
  fixed: number[];
}

/** The groups of every monster (monsterBattleParameter's row -> groups). */
export function monsterGroups(session: HonoluluSession): Map<number, MonsterGroups> {
  const out = new Map<number, MonsterGroups>();
  const add = (m: number, kind: keyof MonsterGroups, row: number): void => {
    if (!m) return;
    const g = out.get(m) ?? out.set(m, { groups: [], fixed: [] }).get(m)!;
    if (!g[kind].includes(row)) g[kind].push(row);
  };
  const groups = session.master.rows(GROUP_FILE);
  for (let r = 0; r < groups.rows; r++) for (let k = 0; k < 5; k++) { add(groups.get(r, `a${k}`), 'groups', r); add(groups.get(r, `b${k}`), 'groups', r); }
  const fixed = session.master.rows(FIX_GROUP_FILE);
  for (let r = 0; r < fixed.rows; r++) for (let k = 0; k < 5; k++) add(fixed.get(r, `m${k}`), 'fixed', r);
  return out;
}

/** The monsters of a group, by name (the group's slots A then B, or a fixed group's). */
export function groupMembers(session: HonoluluSession, file: string, row: number): string[] {
  const t = session.master.rows(file);
  const keys = file === GROUP_FILE ? [...Array.from({ length: 5 }, (_, k) => `a${k}`), ...Array.from({ length: 5 }, (_, k) => `b${k}`)] : Array.from({ length: 5 }, (_, k) => `m${k}`);
  return keys.map((k) => t.get(row, k)).filter((m) => m).map((m) => monsterRowName(session, BATTLE_FILE, m) ?? `#${m}`);
}

/** The model of a look (monsterData +0x04 with the textures of +0x08, in 470D2848), or null. */
export function honoluluMonsterModel(session: HonoluluSession, design: number): ModelRef | null {
  const d = designRows(session);
  if (design <= 0 || design >= d.rows) return null;
  const model = d.get(design, 'model');
  const texture = d.get(design, 'texture');
  if (!model) return null;
  return {
    key: `honolulu-monster/${hex8(model)}/${hex8(texture)}`,
    // 初代 draws the lower render priority first (the eyes over the bodies), not RPG2's order
    load: async () => ({ set: lowerPriorityFirst(await loadComposite(session, HONOLULU_MONSTER_MODELS, model, texture, 'honolulu')), hash: model }),
  };
}

/** The other rows with the same look (the other forms, or monsters that only differ in their stats). */
export function sameDesign(session: HonoluluSession, row: number): number[] {
  const t = battleRows(session);
  const design = t.get(row, 'design');
  const out: number[] = [];
  for (let r = 1; r < t.rows; r++) if (r !== row && t.get(r, 'design') === design) out.push(r);
  return out;
}

/** The rows whose next form is this one. */
export function previousForms(session: HonoluluSession, row: number): number[] {
  const t = battleRows(session);
  const out: number[] = [];
  for (let r = 1; r < t.rows; r++) if (t.get(r, 'next') === row) out.push(r);
  return out;
}

/** Whether a monster's row, its look's row or its name was changed. */
export function monsterChanged(session: HonoluluSession, row: number): boolean {
  const t = battleRows(session);
  if (t.changed(row)) return true;
  const d = designRows(session);
  const design = t.get(row, 'design');
  if (design <= 0 || design >= d.rows) return false;
  return d.changed(design) || session.messages.texts.isEdited(d.get(design, 'name'));
}

/** Put the monster's row, its look's row and name back as they are in the archives (the look of the row as it was). */
export function revertMonster(session: HonoluluSession, row: number): void {
  const t = battleRows(session);
  const d = designRows(session);
  for (const design of new Set([t.get(row, 'design'), t.original(row, 'design')])) {
    if (design <= 0 || design >= d.rows) continue;
    const id = d.get(design, 'name');
    if (id) session.messages.texts.revert(id);
    d.revert(design);
  }
  t.revert(row);
}
