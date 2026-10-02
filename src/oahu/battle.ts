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
import { OAHU_ACTION_DATA, OAHU_CONDITION_DATA, OAHU_FORM_CATEGORIES, OAHU_MONSTER_GROUP, OAHU_MONSTER_PARAMETER, OAHU_SKILLS, OAHU_STATE_NAMES } from './tables';

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

export interface OahuDropClass {
  label: string;
  /** The party's state that raises it (conditionData row, a percentage; FUN_001F3FAC with the IDs 33〜35). */
  bonus?: number;
  /** Rate 0: dropped without a roll (unless the battle forbids drops). */
  always?: boolean;
}

/** The drop classes of FUN_004CAB64, in the order of dropClass. */
export const OAHU_DROP_CLASSES: OahuDropClass[] = [
  { label: '必ず', always: true },
  { label: 'おたから', bonus: 37 },
  { label: 'レア', bonus: 38 },
  { label: '激レア', bonus: 39 },
];

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

/** A way a monster row changes into another form: an action of category 21 / 22 it has (OAHU_FORM_CATEGORIES). */
export interface OahuFormChange {
  action: number;
  /** Where the monster has the action: "skill1"〜"skill6" or a field of OAHU_STATE_FIELDS ("body" …). */
  via: string;
  /** monsterParameter row of the new form (the action's +0x1A). */
  to: number;
  /** When it fires (+0x2A, OAHU_ACTION_TRIGGER): a kind-3 action in a state's field; null for a skill (the AI picks it). */
  trigger: number | null;
}

/** Fields of a monster row with the actions of its states (not the skill slots). */
export const OAHU_STATE_FIELDS = ['auto', 'body', 'body2', 'act2B', 'act2C'];

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

  /**
   * battleParameter.bin u16 [0xE6 + rate × 2] (16 values): a drop of that rate value comes 1 in this many battles. The
   * unit gets it from FUN_004CD418, the drop is rolled per slot after the battle (FUN_001C3994's loop).
   */
  get dropBase(): number[] {
    const r = this.master.table('battleParameter.bin').row(0);
    const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
    return Array.from({ length: 16 }, (_, i) => dv.getUint16(0xe6 + i * 2, true));
  }

  /**
   * The class of a drop by its "1 in N" (FUN_004CAB64): N ≤ the value of rate 0 is a sure drop (no bonus), below the
   * value of rate 10 おたから, below rate 13 レア, else 激レア. The class picks the party's bonus state.
   */
  dropClass(rate: number): OahuDropClass {
    const base = this.dropBase;
    const n = base[rate & 15]!;
    return OAHU_DROP_CLASSES[n <= base[0]! ? 0 : n < base[10]! ? 1 : n < base[13]! ? 2 : 3]!;
  }

  /**
   * "1 in N" of a drop with rate value `rate` when the party's bonus of its class is `bonus` % (100 = none), as
   * FUN_001C3994 computes it in float: p = 1 − (1 − 1/B)^(bonus × 0.01), at least 0.00001; N = trunc(1/p), then
   * rand(N) = 0. A negative bonus always drops, 0 never; a B of 0 never, 1 always.
   */
  dropOdds(rate: number, bonus = 100): number {
    const b = this.dropBase[rate & 15]!;
    if (this.dropClass(rate).always || bonus < 0 || b === 1) return b === 0 ? Infinity : 1;
    if (bonus === 0 || b === 0) return Infinity;
    const f = Math.fround;
    let p = f(1 - f(Math.pow(f(1 - f(1 / b)), f(bonus * f(0.01)))));
    if (p < f(0.00001)) p = f(0.00001);
    return Math.max(1, Math.trunc(f(1 / p)));
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

  /** The monster row an action changes its user into (category 21 / 22, +0x1A), else 0. */
  formTarget(action: number): number {
    if (action <= 0 || action >= this.actions.rows || !OAHU_FORM_CATEGORIES.includes(this.actions.get(action, 'category'))) return 0;
    const to = this.actions.get(action, 'max') & 0xff; // only the low byte is read (@0x1B45AC)
    return to > 0 && to < this.monsters.rows ? to : 0;
  }

  /** Who a category 19 action calls: the monster row of +0x1A (low byte), else the group row of +0x18. */
  summonTarget(action: number): { monster: number } | { group: number } | null {
    if (action <= 0 || action >= this.actions.rows || this.actions.get(action, 'category') !== 19) return null;
    const monster = this.actions.get(action, 'max') & 0xff;
    if (monster) return { monster };
    const group = this.actions.get(action, 'min');
    return group ? { group } : null;
  }

  /** Monsters having the action in a slot only a kind-3 action fires from (ボディ・自動 …), with the slot. */
  stateSlotUsers(action: number): { monster: number; via: string }[] {
    const out: { monster: number; via: string }[] = [];
    for (let m = 1; m < this.monsters.rows; m++) {
      if (!this.monsters.get(m, 'name')) continue;
      for (const k of OAHU_STATE_FIELDS) if (this.monsters.get(m, k) === action) out.push({ monster: m, via: k });
    }
    return out;
  }

  /** The form changes of a monster row: its skills and the actions of its states that change the form. */
  formChanges(row: number): OahuFormChange[] {
    const out: OahuFormChange[] = [];
    const add = (via: string, action: number, state: boolean): void => {
      const to = this.formTarget(action);
      if (to) out.push({ action, via, to, trigger: state && this.actions.get(action, 'kind') === 3 ? this.actions.get(action, 'trigger') : null });
    };
    for (const s of this.usedSkills(row)) add(`skill${s.slot}`, s.action, false);
    for (const k of OAHU_STATE_FIELDS) add(k, this.monsters.get(row, k), true);
    return out;
  }

  /** The monster rows that change into this row, with the action that does it. */
  formSources(row: number): { monster: number; change: OahuFormChange }[] {
    const out: { monster: number; change: OahuFormChange }[] = [];
    for (let m = 1; m < this.monsters.rows; m++) {
      if (m === row || !this.monsters.get(m, 'name')) continue;
      for (const c of this.formChanges(m)) if (c.to === row) out.push({ monster: m, change: c });
    }
    return out;
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
