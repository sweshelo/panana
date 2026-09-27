// Actions (actionData in the master): item use effects and monster skills. Known fields (elpulse
// docs/battle.md §8, FUN_002f41ac): +0 w0 (bit1-2 = kind, 2 = item; bit3-6 = item effect type; bit13-15 =
// base infliction level of a skill; bit29-31 = usable in battle / house / field), +4 u32 name message,
// +0x18 / +0x1A s16 amount (min / max). The other bytes are not analysed and are shown as they are.
import type { GsTable } from '../archive/gstable';
import { s16, u16, u32 } from '../util/bytes';
import type { Master } from './master';

/**
 * Entry hash of the performance table (runtime master +0x71C, bound by FUN_0019643c). actionData +0x1E is a
 * row of it; the row's +0x0A is the animation (animData row) the user plays, e.g. 0x45〜0x48 = a monster's
 * skill A〜D (FUN_002f46bc, FUN_002e7f44). FUN_001dd694 also picks MonsterDesign +0x18〜+0x24 by it.
 */
export const PERFORMANCE_TABLE = 0x92124c00;

/** Item effect by actionData type (kind 2; FUN_002f41ac). 4〜7 are added by the elpulse MOD. */
export const ITEM_EFFECT: Record<number, string> = { 0: 'HP 回復', 1: 'AP 回復', 2: '状態の回復', 3: '復活', 4: '全回復 (MOD)', 5: '固定化 (MOD)' };
/** Kind (category) of an action (w0 bit1-2; elpulse docs/battle.md §8). */
export const ACTION_KIND: Record<number, string> = { 0: '状態', 1: '攻撃・とくぎ', 2: 'アイテム', 3: '特殊' };
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
}

export function decodeAction(r: Uint8Array): ActionFields {
  const w0 = u32(r, 0);
  return {
    w0,
    kind: (w0 >>> 1) & 3,
    type: (w0 >>> 3) & 15,
    level: (w0 >>> 13) & 7,
    scenes: SCENES.filter(([b]) => (w0 >>> b) & 1).map(([, n]) => n),
    nameId: r.length >= 8 ? u32(r, 4) : 0,
    amount: r.length >= 0x1c ? [s16(r, 0x18), s16(r, 0x1a)] : [0, 0],
    element: (w0 >>> 24) & 15,
    performance: r.length >= 0x20 ? u16(r, 0x1e) : 0,
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

  constructor(master: Master, monsterName: (row: number) => string = () => '') {
    const perf = master.tableName(PERFORMANCE_TABLE);
    this.performances = perf ? master.table(perf) : null;
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

  refsOf(row: number): ActionRefs {
    return this.refs.get(row) ?? { items: [], monsters: [] };
  }
}
