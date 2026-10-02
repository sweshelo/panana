// The battle tables of 電波人間のRPG3 (#63): monsters (monsterParameter), encounter groups (monsterGroup), actions
// (actionData) and states (conditionData), read and written through the field definitions of tables.ts, with the names
// the books show and what refers to what.
import { cleanActionName } from '../game/actions';
import type { MessageStore } from '../game/gmsg';
import { decodeGroupSlots, encodeGroupSlots, type GroupSlot } from '../game/monsters';
import type { TableDef } from '../game/tabledef';
import type { OahuItems } from './items';
import type { OahuMaster } from './master';
import type { OahuItemModels } from './itemModels';
import type { OahuMonsterModels } from './monsterModels';
import type { ModelRef } from '../pages/modelview';
import { OahuRows } from './rows';
import { OAHU_ACTION_DATA, OAHU_CONDITION_DATA, OAHU_MONSTER_GROUP, OAHU_MONSTER_PARAMETER, OAHU_SKILLS, OAHU_STATE_NAMES } from './tables';

export interface OahuMonster {
  id: number;
  name: string;
  level: number;
  hp: [number, number];
  exp: number;
  gold: number;
}

export interface OahuSkill {
  /** 1〜6. */
  slot: number;
  action: number;
  condition: number;
}

export interface OahuDrop {
  /** 1〜3. */
  slot: number;
  item: number;
  rate: number;
}

export interface OahuGroup {
  row: number;
  leads: GroupSlot[];
  mates: GroupSlot[];
  /** Monsters of the fixed formation (+0x28), 0 left out. */
  fixed: number[];
}

export interface OahuAction {
  row: number;
  name: string;
  /** w0 bit0-2 (OAHU_ACTION_KIND): 2 = a monster's row, followed by its skills. */
  kind: number;
  /** w0 bit3-13: the monster row of a kind-2 row. */
  subject: number;
  category: number;
  element: number;
  range: number;
  power: [number, number];
  state: number;
}

/** Message fields of a monster row. */
export const OAHU_MONSTER_TEXTS: [string, string][] = [['name', '名前'], ['desc', '説明']];
/** Message fields of an action row. */
export const OAHU_ACTION_TEXTS: [string, string][] = [['name', '名前'], ['result1', '結果'], ['result2', '結果 (複数・別)']];
/** Fields of a monster row that name an action. */
export const OAHU_MONSTER_ACTIONS = [...Array.from({ length: OAHU_SKILLS }, (_, i) => `skill${i + 1}`), 'own', 'auto', 'body', 'body2', 'act2B', 'act2C'];

export class OahuBattle {
  private readonly loaded = new Map<string, OahuRows>();

  constructor(
    private readonly master: OahuMaster,
    readonly items: OahuItems,
    private readonly models?: OahuMonsterModels,
    readonly itemModels?: OahuItemModels,
  ) {}

  /** A monster's model (by its design row); null without the dump's models. */
  monsterModel(row: number): ModelRef | null {
    if (!this.models || row <= 0 || row >= this.monsters.rows) return null;
    return this.models.ref(this.monsters.get(row, 'design'));
  }

  /** The tables are taken from the master when first used. */
  private rows(def: TableDef): OahuRows {
    let r = this.loaded.get(def.file);
    if (!r) this.loaded.set(def.file, (r = new OahuRows(this.master, def)));
    return r;
  }

  get monsters(): OahuRows {
    return this.rows(OAHU_MONSTER_PARAMETER);
  }

  get groups(): OahuRows {
    return this.rows(OAHU_MONSTER_GROUP);
  }

  get actions(): OahuRows {
    return this.rows(OAHU_ACTION_DATA);
  }

  get conditions(): OahuRows {
    return this.rows(OAHU_CONDITION_DATA);
  }

  get texts(): MessageStore {
    return this.items.texts;
  }

  message(id: number): string {
    return this.items.message(id);
  }

  monsterName(row: number): string {
    if (row <= 0 || row >= this.monsters.rows) return `#${row}`;
    return this.message(this.monsters.get(row, 'name')) || `#${row}`;
  }

  monsterList(): OahuMonster[] {
    const out: OahuMonster[] = [];
    for (let id = 1; id < this.monsters.rows; id++) {
      const g = (k: string): number => this.monsters.get(id, k);
      if (!g('name')) continue;
      out.push({ id, name: this.monsterName(id), level: g('level'), hp: [g('hpMin'), g('hpMax')], exp: g('exp'), gold: g('gold') });
    }
    return out;
  }

  skills(row: number): OahuSkill[] {
    return Array.from({ length: OAHU_SKILLS }, (_, i) => ({ slot: i + 1, action: this.monsters.get(row, `skill${i + 1}`), condition: this.monsters.get(row, `cond${i + 1}`) }));
  }

  /** The skills in use (action not 0); the game's rows keep them packed to the front. */
  usedSkills(row: number): OahuSkill[] {
    return this.skills(row).filter((s) => s.action);
  }

  /**
   * Write the skills packed to the front; the empty slots get action 0 and condition 1 as in the archive. `from` gives
   * each new slot's old slot (1〜6, 0 = new), so the slot used when none can be (+0x38 bit15-17) follows its skill.
   */
  setSkills(row: number, skills: { action: number; condition: number; from: number }[]): void {
    if (skills.length > OAHU_SKILLS) throw new Error(`ワザは ${OAHU_SKILLS} 個までです`);
    const fallback = this.monsters.get(row, 'fallback') + 1;
    const moved = skills.findIndex((s) => s.from === fallback);
    for (let i = 0; i < OAHU_SKILLS; i++) {
      const s = skills[i];
      this.monsters.set(row, `skill${i + 1}`, s?.action ?? 0);
      this.monsters.set(row, `cond${i + 1}`, s ? s.condition : 1);
    }
    this.monsters.set(row, 'fallback', Math.max(0, moved));
  }

  drops(row: number): OahuDrop[] {
    return [1, 2, 3].map((slot) => ({ slot, item: this.monsters.get(row, `drop${slot}`), rate: this.monsters.get(row, `rate${slot}`) }));
  }

  itemName(id: number): string {
    return this.items.item(id)?.name ?? (id ? `#${id}` : '');
  }

  /** A monster's row or its messages differ from the archive. */
  monsterChanged(row: number): boolean {
    return this.monsters.changed(row) || OAHU_MONSTER_TEXTS.some(([k]) => this.texts.isEdited(this.monsters.get(row, k)));
  }

  revertMonster(row: number): void {
    this.monsters.revert(row);
    for (const [k] of OAHU_MONSTER_TEXTS) {
      const m = this.monsters.get(row, k);
      if (m) this.texts.revert(m);
    }
  }

  /** The name an action shows in battle ("たいあたり"), or the items whose action it is. */
  actionName(row: number): string {
    if (row <= 0 || row >= this.actions.rows) return row ? `#${row}` : '';
    const byItems = this.items.actionName(row);
    if (byItems.endsWith('のアクション')) return byItems.replace(/^#\d+ /, '');
    return cleanActionName(this.message(this.actions.get(row, 'name')));
  }

  /** "#995 たいあたり". */
  actionLabel(row: number): string {
    if (!row) return 'なし';
    const n = this.actionName(row);
    return n && !n.startsWith('#') ? `#${row} ${n}` : `#${row}`;
  }

  actionList(): OahuAction[] {
    const out: OahuAction[] = [];
    for (let row = 1; row < this.actions.rows; row++) {
      const g = (k: string): number => this.actions.get(row, k);
      if (!g('name') && !g('bits')) continue;
      out.push({ row, name: this.actionName(row) || `#${row}`, kind: g('kind'), subject: g('subject'), category: g('category'), element: g('element'), range: g('range'), power: [g('min'), g('max')], state: g('state') });
    }
    return out;
  }

  actionChanged(row: number): boolean {
    return this.actions.changed(row) || OAHU_ACTION_TEXTS.some(([k]) => this.texts.isEdited(this.actions.get(row, k)));
  }

  revertAction(row: number): void {
    this.actions.revert(row);
    for (const [k] of OAHU_ACTION_TEXTS) {
      const m = this.actions.get(row, k);
      if (m) this.texts.revert(m);
    }
  }

  /** How many action rows use the same message as this row's field (a shared text changes for all of them). */
  actionsSharing(row: number, key: string): number {
    const m = this.actions.get(row, key);
    if (!m) return 0;
    let n = 0;
    for (let r = 1; r < this.actions.rows; r++) if (OAHU_ACTION_TEXTS.some(([k]) => this.actions.get(r, k) === m)) n++;
    return n;
  }

  /** Action row → the monsters having it as a skill. */
  skillUsers(): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (let m = 1; m < this.monsters.rows; m++) {
      if (!this.monsters.get(m, 'name')) continue;
      for (const s of this.usedSkills(m)) if (!out.get(s.action)?.includes(m)) out.set(s.action, [...(out.get(s.action) ?? []), m]);
    }
    return out;
  }

  /** Monsters with the action in a skill slot or as a state's action; items whose action it is. */
  actionUsers(row: number): { monsters: number[]; items: number[] } {
    const monsters: number[] = [];
    for (let m = 1; m < this.monsters.rows; m++) if (this.monsters.get(m, 'name') && OAHU_MONSTER_ACTIONS.some((k) => this.monsters.get(m, k) === row)) monsters.push(m);
    const items = this.items.items.filter((it) => it.action === row || it.effects.some((e) => e.value === row && e.kind >= 0x2b && e.kind <= 0x2f)).map((it) => it.id);
    return { monsters, items };
  }

  conditionName(row: number): string {
    if (row <= 0 || row >= this.conditions.rows) return row ? `#${row}` : 'なし';
    const n = this.message(this.conditions.get(row, 'name'));
    return n && n !== 'なし' ? n : OAHU_STATE_NAMES[row] ?? `状態 ${row}`;
  }

  setGroupSlots(row: number, leads: GroupSlot[], mates: GroupSlot[]): void {
    encodeGroupSlots(this.groups.row(row), leads, mates);
  }

  /** The fixed formation (+0x28), packed to the front. */
  setFixed(row: number, monsters: number[]): void {
    for (let i = 0; i < 5; i++) this.groups.set(row, `fixed${i + 1}`, monsters[i] ?? 0);
  }

  group(row: number): OahuGroup {
    const r = this.groups.row(row);
    const fixed = [1, 2, 3, 4, 5].map((i) => this.groups.get(row, `fixed${i}`)).filter(Boolean);
    return { row, ...decodeGroupSlots(r), fixed };
  }

  groupList(): OahuGroup[] {
    return Array.from({ length: this.groups.rows - 1 }, (_, i) => this.group(i + 1));
  }

  /** Groups with the monster among their candidates or in their fixed formation. */
  groupsOf(monster: number): number[] {
    return this.groupList().filter((g) => [...g.leads, ...g.mates].some((s) => s.monster === monster) || g.fixed.includes(monster)).map((g) => g.row);
  }
}
