// Actions (actionData in the master): item use effects and monster skills. Known fields (elpulse
// docs/battle.md §8, FUN_002f41ac): +0 w0 (bit1-2 = kind, 2 = item; bit3-6 = item effect type; bit13-15 =
// base infliction level of a skill; bit29-31 = usable in battle / house / field), +4 u32 name message,
// +0x18 / +0x1A s16 amount (min / max). The other bytes are not analysed and are shown as they are.
import type { GsTable } from '../archive/gstable';
import { equalBytes, s16, u16, u32, w16, w32 } from '../util/bytes';
import type { Master } from './master';
import { ABILITY_RANGES, ACTION_DIRECTION, ACTION_SLOTS, PERF, performanceUses, writePerfField, type PerfField } from './performance';

/**
 * Entry hash of the performance table: directData.bin (1026 × 20) in 2713402F, the archive of MonsterDesign
 * (runtime master +0x71C, bound by FUN_0019643c). actionData +0x1E is a
 * row of it; the row's +0x0A is the animation (animData row) the user plays, e.g. 0x45〜0x48 = a monster's
 * skill A〜D (FUN_002f46bc, FUN_002e7f44). FUN_001dd694 also picks MonsterDesign +0x18〜+0x24 by it.
 */
export const PERFORMANCE_TABLE = 0x92124c00;

/** Item effect by actionData type (kind 2; FUN_002f41ac). 4〜7 are added by the elpulse MOD. */
export const ITEM_EFFECT: Record<number, string> = { 0: 'HP 回復', 1: 'AP 回復', 2: '状態の回復', 3: '復活', 4: '全回復 (MOD)', 5: '固定化 (MOD)' };
/** Kind (category) of an action (w0 bit1-2; elpulse docs/battle.md §8). */
export const ACTION_KIND: Record<number, string> = { 0: '状態', 1: '攻撃・とくぎ', 2: 'アイテム', 3: '特殊' };
/**
 * Type (w0 bit3-6) by kind: how the battle computes it (elpulse docs/battle.md §6.1, §7). Kind 1 has no flag of its
 * own for 攻撃 / とくぎ: types 0 / 1 are physical (こうげき vs ぼうぎょ, ×+0x33; 1 can be critical), 2 / 3 a fixed range
 * (+0x18〜+0x1A). Type 3 of kinds 0 / 1 is a breath: ブレス封じ (state 0x5A) blocks it (FUN_00416a78).
 */
export const ACTION_TYPE: Record<number, Record<number, string>> = {
  0: { 3: 'ブレス' },
  1: { 0: '物理', 1: '物理・会心あり', 2: '固定の威力', 3: 'ブレス (固定の威力)' },
  2: ITEM_EFFECT,
  3: { 0: '効果なし (メッセージだけ)', 1: '能力の増減', 2: '場から消す (にげる)', 4: 'なかまをよぶ', 5: '変身・セリフ', 6: 'ゴールドをぬすむ', 7: '状態 (+0x32)', 8: '時間で変わる', 9: '時間で変わる' },
};

/**
 * Side (w0 bit7-8) the action hits: absolute, not relative to the user (FUN_002876f8 reads it as the side of the units;
 * users 0xFFF0〜0xFFF7 turn it over). A monster's attack on the party is 1, its own buffs 0; the party's spells 0.
 */
export const ACTION_SIDE: Record<number, string> = { 0: 'モンスターの側', 1: '電波人間の側' };
/**
 * Range (w0 bit9-12): which units of the side are hit (FUN_003188e0). 3〜5 hit the target and the units around it
 * in the formation (FUN_002842e4 with the distance 1〜3). The power of a physical attack with +0x33 = 10 is scaled by
 * BattleParameter [0x58 + range] (100 / 100 / 100 / 80 / 70 / 60 / 60 %).
 */
export const ACTION_RANGE: Record<number, string> = {
  0: '自分', 1: '自分', 2: '単体', 3: '目標と周り (距離 1)', 4: '目標と周り (距離 2)', 5: '目標と周り (距離 3)', 6: '全体', 7: 'なし (だれにも当たらない)', 8: '陣営全体 (場の効果)',
};

/** "2: 単体". */
export function actionRangeLabel(range: number): string {
  return `${range}: ${ACTION_RANGE[range] ?? '(表の外。だれにも当たらない)'}`;
}

/** "1: 物理・会心あり" (the number alone when the type means nothing special for the kind). */
export function actionTypeLabel(kind: number, type: number): string {
  const name = ACTION_TYPE[kind]?.[type];
  return name ? `${type}: ${name}` : String(type);
}

/** "攻撃・とくぎ (物理)": the kind of an action and, when it means something, its type. */
export function actionKindLabel(kind: number, type: number): string {
  const name = ACTION_TYPE[kind]?.[type];
  return `${ACTION_KIND[kind] ?? `種類 ${kind}`}${name && kind !== 3 ? ` (${name})` : ''}`;
}
/** Element of an action (w0 bit24-27). */
export const ELEMENT = ['', '火', '氷', '風', '土', '電気', '水', '光', '闇'];
/** Scenes where an item action can be used: w0 bit -> label. */
const SCENES: [number, string][] = [[31, 'フィールド'], [30, 'ハウス'], [29, '戦闘']];

export interface ActionFields {
  w0: number;
  /** w0 bit1-2 (2 = item). */
  kind: number;
  /** w0 bit3-6: item effect type (kind 2). */
  type: number;
  /** w0 bit7-8: side it hits (0 monsters, 1 the party; ACTION_SIDE). */
  side: number;
  /** w0 bit9-12: range (ACTION_RANGE). */
  range: number;
  /** w0 bit13-15: base infliction level of a skill (BattleParameter [0x60 + level]). */
  level: number;
  /** Where it can be used (w0 bit29-31). */
  scenes: string[];
  /** +4: name message. */
  nameId: number;
  /** +0x18 / +0x1A (s16). */
  amount: [number, number];
  /** w0 bit24-27 (1 火 .. 8 闇, 0 = none). */
  element: number;
  /**
   * Row of MonsterParameter the user turns into (kind 3, type 5: +0x16), or 0. +0x16 = 1 is a line with no
   * change of form (elpulse docs/battle.md §7).
   */
  formChange: number;
  /** +0x1E u16: row of the performance table (PERFORMANCE_TABLE; 0 = none). */
  performance: number;
  /** +0x32: the state it inflicts (conditionData ID; 0 = none). An attack's extra effect (elpulse docs/battle.md §6.5). */
  state: number;
  /** w0 bit16-19 / bit20-23: strength of the state (min / max; a random value between them). */
  strength: [number, number];
  /** +0x16 (s16): turns of the state (kind 3 type 5 uses it for the form change instead). */
  turns: number;
}

export function decodeAction(r: Uint8Array): ActionFields {
  const w0 = u32(r, 0);
  return {
    w0,
    kind: (w0 >>> 1) & 3,
    type: (w0 >>> 3) & 15,
    side: (w0 >>> 7) & 3,
    range: (w0 >>> 9) & 15,
    level: (w0 >>> 13) & 7,
    scenes: SCENES.filter(([b]) => (w0 >>> b) & 1).map(([, n]) => n),
    nameId: r.length >= 8 ? u32(r, 4) : 0,
    amount: r.length >= 0x1c ? [s16(r, 0x18), s16(r, 0x1a)] : [0, 0],
    element: (w0 >>> 24) & 15,
    performance: r.length >= 0x20 ? u16(r, 0x1e) : 0,
    state: r.length > 0x32 ? r[0x32]! : 0,
    strength: [(w0 >>> 16) & 15, (w0 >>> 20) & 15],
    turns: r.length >= 0x18 ? s16(r, 0x16) : 0,
    formChange: ((w0 >>> 1) & 3) === 3 && ((w0 >>> 3) & 15) === 5 && r.length >= 0x18 && s16(r, 0x16) > 1 ? s16(r, 0x16) : 0,
  };
}

/** "HP 回復 30〜40 (フィールド・戦闘)" for an item action, '' for anything else. */
export function itemEffect(f: ActionFields): string {
  if (f.kind !== 2) return '';
  const [lo, hi] = f.amount;
  const amount = lo || hi ? ` ${Math.min(lo, hi)}〜${Math.max(lo, hi)}` : '';
  return `${ITEM_EFFECT[f.type] ?? `種別 ${f.type}`}${f.type <= 1 ? amount : ''}${f.scenes.length ? ` (${f.scenes.join('・')})` : ''}`;
}

/** Name of an action as shown in battle, without the actor placeholders and the trailing "！". */
export function cleanActionName(s: string): string {
  return s.replace(/Ē/g, '(色)').replace(/^[Ąą]+/, '').replace(/^[のは]　/, '').replace(/！$/, '');
}

export interface Action extends ActionFields {
  row: number;
  name: string;
  /** The row as it is (for the fields not analysed). */
  raw: Uint8Array;
}

export interface ActionRefs {
  /** Items whose use effect (itemData +0x24) is this action. */
  items: { id: number; name: string }[];
  /** Monsters with this action as a skill (MonsterParameter +0x3C). */
  monsters: { row: number; name: string }[];
}

export class ActionBook {
  readonly actions: Action[] = [];
  private readonly refs = new Map<number, ActionRefs>();
  /** The performance table (null when the archive has no such entry). */
  private readonly performances: GsTable | null;

  /** `performances`: directData.bin (MonsterBook.directData), for the motions of the actions. */
  constructor(private readonly master: Master, monsterName: (row: number) => string = () => '', performances: GsTable | null = null) {
    this.performances = performances;
    const t = master.table('actionData.bin');
    for (let i = 0; i < t.rows; i++) {
      const raw = t.row(i);
      const f = decodeAction(raw);
      this.actions.push({ ...f, row: i, name: f.nameId ? cleanActionName(master.message(f.nameId) ?? '') : '', raw });
    }
    const refs = (a: number): ActionRefs | undefined => {
      if (a <= 0 || a >= t.rows) return undefined;
      let r = this.refs.get(a);
      if (!r) this.refs.set(a, (r = { items: [], monsters: [] }));
      return r;
    };
    const items = master.itemData;
    for (let id = 1; id < items.rows; id++) {
      const r = items.row(id);
      if (!u32(r, 0x0c) || (r[0x2c]! & 0xf) !== 1) continue; // +0x24 is an action only for tools (category 1)
      refs(u32(r, 0x24))?.items.push({ id, name: master.itemName(id) || `#${id}` });
    }
    const mp = master.table('monsterParameter.bin');
    for (let row = 1; row < mp.rows; row++) {
      const seen = new Set<number>();
      for (let k = 0; k < 6; k++) {
        const a = u16(mp.row(row), 0x3c + k * 2);
        if (!a || seen.has(a)) continue;
        seen.add(a);
        refs(a)?.monsters.push({ row, name: monsterName(row) || `#${row}` });
      }
    }
  }

  action(row: number): Action | undefined {
    return this.actions[row];
  }

  /** Animation number (animData row) an action plays, from its performance row +0x0A; 0 = none or unknown. */
  motion(row: number): number {
    const p = this.actions[row]?.performance ?? 0;
    const t = this.performances;
    return p && t && p < t.rows && t.rowSize > 0x0a ? t.row(p)[0x0a]! : 0;
  }

  /** The directData row of a performance slot of an action (ACTION_SLOTS; 0 = none). */
  slot(row: number, offset: number): number {
    const r = this.actions[row]?.raw;
    return r && r.length >= offset + 2 ? u16(r, offset) : 0;
  }

  /** A row as in the archive (null for a row added by an edit), with its motion (rows of directData in the archive are never changed). */
  original(row: number): (ActionFields & { motion: number }) | null {
    if (row >= this.master.originalRows('actionData.bin')) return null;
    const f = decodeAction(this.master.originalRow('actionData.bin', row));
    const t = this.performances;
    return { ...f, motion: f.performance && t && f.performance < t.rows && t.rowSize > 0x0a ? t.row(f.performance)[0x0a]! : 0 };
  }

  refsOf(row: number): ActionRefs {
    return this.refs.get(row) ?? { items: [], monsters: [] };
  }
}

/** Offset of the anim number in a performance row (the animData row the user plays). */
export const PERFORMANCE_ANIM = 0x0a;

/** A hash for a new row of a table with a hash index, not used by any other row. */
function newHash(t: GsTable, base: number): number {
  const used = t.hashes();
  let hash = (base + t.rows) >>> 0;
  while (used.has(hash)) hash = (hash + 0x10001) >>> 0;
  return hash;
}

/**
 * Edits of actionData rows: copying a row as a new action, its name, element, infliction level, amount, and its
 * motion. The motion lives in the performance row (directData), which several actions may share, so a changed
 * motion goes to a performance row with the same bytes and the new anim: an existing one when there is such a row,
 * else a copy appended to directData. Rows of the archive are never changed in place (code.bin may name some).
 */
export class ActionEdits {
  constructor(
    private readonly master: Master,
    /** directData (MonsterBook.directData), or null when it could not be read. */
    private readonly performances: GsTable | null,
    /** Rows of directData in the archive (MonsterBook.directOriginalRows). */
    private readonly performanceRows: number,
  ) {}

  private get table(): GsTable {
    return this.master.table('actionData.bin');
  }

  private row(row: number): Uint8Array {
    return this.table.row(row);
  }

  /** Whether a row was added by {@link copy}. */
  added(row: number): boolean {
    return row >= this.master.originalRows('actionData.bin');
  }

  /** Whether a row differs from the archive (added rows always do). */
  changed(row: number): boolean {
    return this.added(row) || !equalBytes(this.row(row), this.master.originalRow('actionData.bin', row));
  }

  /** Put a row of the archive back as it was (added rows are kept). */
  revert(row: number): void {
    if (!this.added(row)) this.row(row).set(this.master.originalRow('actionData.bin', row));
  }

  /**
   * Append a copy of a row as a new action. Returns its row number. It gets a name message of its own (the same
   * text; {@link ownName}), so renaming it leaves the original alone.
   */
  copy(row: number): number {
    const t = this.table;
    const src = t.row(row).slice();
    const n = t.append(src, t.indexOffset ? newHash(t, 0x7e710000) : 0);
    if (this.canOwnName(n)) this.ownName(n);
    return n;
  }

  /**
   * Append a copy of an item's action for another item: +0x14 (the item it uses up, FUN_002f4c54) becomes that item.
   * The messages stay shared ("āはĆを使った" names the item from +0x14). Returns the new row.
   */
  copyForItem(row: number, item: number): number {
    const t = this.table;
    const src = t.row(row).slice();
    w16(src, 0x14, item);
    return t.append(src, t.indexOffset ? newHash(t, 0x7e710000) : 0);
  }

  /** +4: the name message. */
  setName(row: number, id: number): void {
    w32(this.row(row), 4, id);
  }

  /** Whether an action can get a name message of its own (it has a name, and messages can be added). */
  canOwnName(row: number): boolean {
    const id = u32(this.row(row), 4);
    return !!id && !!this.master.texts.units(id) && this.master.texts.canAdd();
  }

  /**
   * Point an action at a new message with the text of its name (gmsg.ts MessageStore.add: a message file of our
   * own in the master), so its name can change without changing the others that show the same message.
   * Returns the new message ID.
   */
  ownName(row: number): number {
    const texts = this.master.texts;
    const units = texts.units(u32(this.row(row), 4));
    if (!units || !texts.canAdd()) throw new Error(`アクション #${row} の名前を新しいメッセージにできません`);
    const id = texts.add(units);
    this.setName(row, id);
    return id;
  }

  /** w0 bit24-27: element (0 = none, 1 火 .. 8 闇). */
  setElement(row: number, element: number): void {
    this.setBits(row, 24, 4, element);
  }

  /** w0 bit1-2 / bit3-6: kind and type (how the battle computes the action). */
  setKind(row: number, kind: number, type: number): void {
    this.setBits(row, 1, 2, kind);
    this.setBits(row, 3, 4, type);
  }

  /** w0 bit7-8 / bit9-12: the side and the range it hits. */
  setTarget(row: number, side: number, range: number): void {
    this.setBits(row, 7, 2, side);
    this.setBits(row, 9, 4, range);
  }

  /** w0 bit13-15: base infliction level. */
  setLevel(row: number, level: number): void {
    this.setBits(row, 13, 3, level);
  }

  /** +0x32: the state it inflicts (0 = none). */
  setState(row: number, state: number): void {
    const r = this.row(row);
    if (r.length > 0x32) r[0x32] = state & 0xff;
  }

  /** w0 bit16-19 / bit20-23: strength of the state (min / max, 0〜15). */
  setStrength(row: number, min: number, max: number): void {
    this.setBits(row, 16, 4, min);
    this.setBits(row, 20, 4, max);
  }

  /** +0x16 (s16): turns of the state. */
  setTurns(row: number, turns: number): void {
    const r = this.row(row);
    if (r.length >= 0x18) w16(r, 0x16, turns & 0xffff);
  }

  /** +0x18 / +0x1A: amount (min / max, s16). */
  setAmount(row: number, min: number, max: number): void {
    const r = this.row(row);
    if (r.length < 0x1c) return;
    w16(r, 0x18, min & 0xffff);
    w16(r, 0x1a, max & 0xffff);
  }

  private setBits(row: number, lo: number, n: number, v: number): void {
    const r = this.row(row);
    const mask = ((2 ** n - 1) * 2 ** lo) >>> 0;
    w32(r, 0, ((u32(r, 0) & ~mask) | ((v * 2 ** lo) & mask)) >>> 0);
  }

  /** Whether the motion of a row can be changed (it has a performance row). */
  canSetMotion(row: number): boolean {
    return this.canEditSlot(row, 0x1e);
  }

  /** Make an action play another anim (0x45〜0x48 = the user's skill A〜D; SKILL_MOTION). */
  setMotion(row: number, anim: number): void {
    this.setSlotField(row, 0x1e, 'anim', anim);
  }

  /** Point a performance slot of an action at a directData row (0 = none). */
  setSlot(row: number, offset: number, perf: number): void {
    const r = this.row(row);
    if (r.length < offset + 2) return;
    if (perf && (!this.performances || perf >= this.performances.rows)) throw new Error(`演出の行 ${perf} はありません`);
    w16(r, offset, perf);
  }

  /** actionData +0x1C (camera work or the kind of the performance; not confirmed). */
  setDirection(row: number, v: number): void {
    const r = this.row(row);
    if (r.length >= ACTION_DIRECTION + 2) w16(r, ACTION_DIRECTION, v);
  }

  /**
   * Copy the effect of another action ("アビリティ": kind, target, element, amounts, state, power, result messages;
   * ABILITY_RANGES). The name and the performance stay.
   */
  copyAbility(row: number, from: number): void {
    const src = this.row(from).slice(), dst = this.row(row);
    for (const [lo, hi] of ABILITY_RANGES) dst.set(src.subarray(lo, Math.min(hi, dst.length)), lo);
  }

  /** Copy the performance of another action: every slot and +0x1C. */
  copyPerformance(row: number, from: number): void {
    const src = this.row(from).slice(), dst = this.row(row);
    for (const o of [ACTION_DIRECTION, ...ACTION_SLOTS.map((s) => s.offset)]) if (dst.length >= o + 2) dst.set(src.subarray(o, o + 2), o);
  }

  /** Whether a slot of an action has a performance row whose fields can be changed. */
  canEditSlot(row: number, offset: number): boolean {
    const r = this.row(row);
    const p = r.length >= offset + 2 ? u16(r, offset) : 0;
    return !!this.performances && p > 0 && p < this.performances.rows && this.performances.rowSize > PERF.addEffect;
  }

  /**
   * Change a field of the performance of a slot (the motion, the effect, the sound effect …). The row may be shared by
   * other actions and monsters, so the slot is pointed at a row with the same bytes and the new field: an existing
   * one when there is such a row; the row itself when this editor added it and nothing else uses it; else a copy
   * appended to directData. Returns the row the slot uses.
   */
  setSlotField(row: number, offset: number, field: PerfField, v: number): number {
    const t = this.performances;
    if (!t || !this.canEditSlot(row, offset)) throw new Error(`アクション #${row} のこの枠には演出の行がありません`);
    const r = this.row(row);
    const p = u16(r, offset);
    const want = t.row(p).slice();
    writePerfField(want, field, v);
    return this.pointAt(row, offset, p, want);
  }

  /**
   * A new performance row for a slot: a copy of `base` with some fields replaced (the motion of one monster with the
   * effect of another …). An identical row is reused. Returns the row the slot uses.
   */
  composeSlot(row: number, offset: number, base: number, fields: Partial<Record<PerfField, number>>): number {
    const t = this.performances;
    if (!t || base <= 0 || base >= t.rows) throw new Error(`演出の行 ${base} はありません`);
    const want = t.row(base).slice();
    for (const [f, v] of Object.entries(fields) as [PerfField, number][]) writePerfField(want, f, v);
    const r = this.row(row);
    return this.pointAt(row, offset, u16(r, offset), want);
  }

  private pointAt(row: number, offset: number, p: number, want: Uint8Array): number {
    const t = this.performances!;
    const r = this.row(row);
    if (p > 0 && p < t.rows && equalBytes(want, t.row(p))) return p;
    for (let i = 1; i < t.rows; i++) {
      if (equalBytes(t.row(i), want)) {
        w16(r, offset, i);
        return i;
      }
    }
    // A row this editor added and only this slot uses: change it in place.
    if (p >= this.performanceRows && p < t.rows) {
      const uses = performanceUses(this.master).get(p) ?? [];
      if (uses.every((u) => u.kind === 'action' && u.action === row && u.slot === offset)) {
        t.row(p).set(want);
        return p;
      }
    }
    const n = t.append(want, t.indexOffset ? newHash(t, 0x7e720000) : 0);
    if (n > 0xffff) throw new Error('演出の表がいっぱいです');
    w16(r, offset, n);
    return n;
  }
}
