// Items (itemData, 713 rows x 0x30) with their use effect (actionData) and the shops that sell them
// (ShopItem, see shops.ts). Fields: elpulse docs/analysis.md "itemData.bin".
import { GsTable } from '../archive/gstable';
import { findEntry, unpackEntry } from '../archive/gsarc';
import { equalBytes, s16, u16, u32, w16, w32 } from '../util/bytes';
import { cleanActionName, decodeAction, ELEMENT, itemEffect } from './actions';
import type { Game } from './game';
import type { Master } from './master';

export { loadShops, SHOP_ARCHIVE } from './shops';

export const ITEM_CATEGORY: Record<number, string> = { 1: '道具', 2: 'ゴールド', 3: '装備', 4: 'つりざお', 5: 'エサ' };
/** Equipment slot by the full category byte. */
export const EQUIP_SLOT: Record<number, string> = { 0x03: '首', 0x13: '腕', 0x23: '足', 0x33: '背中', 0x43: '服' };

/** Message fields of an item row (+0x10..+0x1C): offset and label. */
export const DESCRIPTION_FIELDS: [number, string][] = [[0x10, '説明'], [0x14, '+0x14'], [0x18, '+0x18'], [0x1c, '+0x1C']];

export interface ItemDescription {
  offset: number;
  label: string;
  /** Message ID (0 = none). */
  id: number;
  text: string;
}

/** The fields of an item row that can be edited. */
export interface ItemFields {
  /** +0x00 */
  price: number;
  /** +0x04 */
  sell: number;
  /** Stars (flags +0x08 bit5-7). */
  rarity: number;
  /** +0x2F (0 = 99). */
  limit: number;
  /** +0x24: actionData row (consumables). */
  action: number;
  /** +0x2A: item that replaces it at the limit (0 = none). */
  chain: number;
  /** Equipment: +0x2D / +0x2E = the states (conditionData ID, 0 = none) it gives, +0x24 / +0x26 (s16) = their values. */
  state1: number;
  amount1: number;
  state2: number;
  amount2: number;
}

export const MAX_RARITY = 7;
export const MAX_LIMIT = 255;

export function readItemFields(r: Uint8Array): ItemFields {
  return {
    price: u32(r, 0),
    sell: u32(r, 4),
    rarity: (u32(r, 8) >>> 5) & 7,
    limit: r[0x2f] || 99,
    action: u32(r, 0x24),
    chain: u16(r, 0x2a),
    state1: r[0x2d]!,
    amount1: s16(r, 0x24),
    state2: r[0x2e]!,
    amount2: s16(r, 0x26),
  };
}

/**
 * Write fields into an item row. A limit of 99 keeps the row's byte when it already means 99 (0 or 99),
 * so setting the shown value back does not count as a change.
 */
export function writeItemFields(r: Uint8Array, f: Partial<ItemFields>): void {
  if (f.price !== undefined) w32(r, 0, f.price);
  if (f.sell !== undefined) w32(r, 4, f.sell);
  if (f.rarity !== undefined) w32(r, 8, ((u32(r, 8) & ~0xe0) | ((f.rarity & 7) << 5)) >>> 0);
  if (f.limit !== undefined && !(f.limit === 99 && (r[0x2f] === 0 || r[0x2f] === 99))) r[0x2f] = f.limit & 0xff;
  if (f.action !== undefined) w32(r, 0x24, f.action);
  if (f.chain !== undefined) w16(r, 0x2a, f.chain);
  if (f.state1 !== undefined) r[0x2d] = f.state1 & 0xff;
  if (f.amount1 !== undefined) w16(r, 0x24, f.amount1 & 0xffff);
  if (f.state2 !== undefined) r[0x2e] = f.state2 & 0xff;
  if (f.amount2 !== undefined) w16(r, 0x26, f.amount2 & 0xffff);
}

/**
 * How a state adds up the values from its sources (conditionData +0x32 low 4 bits, unit state +0x13).
 * FUN_0030aff4: the base value (+0x00) and six sources (+0x06..+0x10: the equipment slots 0..4 and one more),
 * then clamped to the range (conditionData +0x04 / +0x06). Sources start at 0 (1 for 3, 100 for 4).
 */
export const COMBINE: Record<number, string> = {
  0: '元の値のまま (装備では変わらない)',
  1: '足し算',
  2: '足し算',
  3: '掛け算',
  4: '% の掛け算 (100 = そのまま)',
  5: '足し算 (元の値が上限ならそのまま)',
  6: '付くかどうか (0 でない値で上書き)',
  7: 'いちばん大きい値',
};

/** A row of conditionData as the item effects use it. */
export interface StateInfo {
  id: number;
  /** +0x14 (message). */
  name: string;
  /** +0x32 low 4 bits: see {@link COMBINE}. */
  combine: number;
  /** +0x04 / +0x06 (s16). */
  min: number;
  max: number;
}

export function readStates(master: Master): StateInfo[] {
  const t = master.table('conditionData.bin');
  return Array.from({ length: t.rows }, (_, id) => {
    const r = t.row(id);
    return { id, name: (master.message(u16(r, 0x14)) ?? '').replace(/Ē/g, '(色)'), combine: r[0x32]! & 0xf, min: s16(r, 4), max: s16(r, 6) };
  });
}

/** States whose value names something: the element of plain attacks, the action they add to plain attacks. */
export const STATE_ELEMENT = 47;
export const STATE_ACTION = 48;

/**
 * "毒たいせい +1", "経験値増加 120%", "必中": a state an equipment gives and its value, as the game adds it up.
 * `actionName` names the action of {@link STATE_ACTION}.
 */
export function equipEffectText(state: StateInfo | undefined, id: number, amount: number, actionName?: (row: number) => string): string {
  const name = state?.name || `状態 ${id}`;
  if (id === STATE_ELEMENT) return `${name}: ${ELEMENT[amount] || `属性 ${amount}`}`;
  if (id === STATE_ACTION) return `${name}: ${actionName?.(amount) || `#${amount}`}`;
  switch (state?.combine) {
    case 3: return `${name} ×${amount}`;
    case 4: return `${name} ${amount}%`;
    case 6: return amount === 1 ? name : `${name} (${amount})`;
    case 7: return `${name} ${amount}`;
    case 0: return `${name} (${amount}、効かない)`;
    default: return `${name} ${amount < 0 ? '' : '+'}${amount}`;
  }
}

export interface Item extends ItemFields {
  id: number;
  name: string;
  /** All the message fields joined (for searching). */
  description: string;
  descriptions: ItemDescription[];
  /** +0x2C: low 4 bits = category, high = sub category. */
  categoryByte: number;
  category: string;
  flags: number;
  effect: string;
  /** +0x20: model bcres (in 1D37838B, 302996EB or 56562135). */
  model: number;
  shops: number[];
}

export function categoryLabel(b: number): string {
  const main = ITEM_CATEGORY[b & 0xf] ?? `分類 ${b & 0xf}`;
  if ((b & 0xf) === 3) return `${main} (${EQUIP_SLOT[b] ?? `0x${b.toString(16)}`})`;
  return main;
}

const ITEM_TABLE = 'itemData.bin';

export class ItemBook {
  readonly items: Item[] = [];
  private readonly byId = new Map<number, Item>();
  private readonly master: Master;
  private readonly soldAt = new Map<number, number[]>();
  /** conditionData rows (the states equipment gives). */
  readonly states: StateInfo[];

  constructor(game: Game, shops: Map<number, number[]>) {
    this.master = game.master;
    this.states = readStates(this.master);
    this.indexShops(shops);
    const t = this.master.itemData;
    for (let id = 1; id < t.rows; id++) {
      const it = this.build(id);
      if (!it) continue;
      this.items.push(it);
      this.byId.set(id, it);
    }
  }

  private msg(id: number): string {
    return id ? (this.master.message(id) ?? '').replace(/Ē/g, '(色)') : '';
  }

  private build(id: number): Item | null {
    const r = this.master.itemData.row(id);
    const nameId = u32(r, 0x0c);
    if (!nameId) return null;
    const actions = this.master.table('actionData.bin');
    const fields = readItemFields(r);
    const cat = r[0x2c]!;
    const descriptions = DESCRIPTION_FIELDS.map(([offset, label]) => ({ offset, label, id: u32(r, offset), text: this.msg(u32(r, offset)) }));
    return {
      ...fields,
      id,
      name: this.msg(nameId) || `#${id}`,
      description: descriptions.map((d) => d.text).filter(Boolean).join(' '),
      descriptions,
      categoryByte: cat,
      category: categoryLabel(cat),
      flags: u32(r, 8),
      effect: (cat & 0xf) === 1 && fields.action > 0 && fields.action < actions.rows ? itemEffect(decodeAction(actions.row(fields.action)))
        : (cat & 0xf) === 3 ? this.equipEffects(fields).join('、') : '',
      model: u32(r, 0x20),
      shops: this.soldAt.get(id) ?? [],
    };
  }

  /** The states an equipment gives, as text (FUN_0030a3d0 reads them; FUN_0030a420 adds them to the unit). */
  equipEffects(f: ItemFields): string[] {
    return ([[f.state1, f.amount1], [f.state2, f.amount2]] as const).filter(([id]) => id).map(([id, v]) => equipEffectText(this.states[id], id, v, (row) => this.actionName(row)));
  }

  private actionName(row: number): string {
    const t = this.master.table('actionData.bin');
    if (row <= 0 || row >= t.rows) return '';
    const f = decodeAction(t.row(row));
    return `#${row} ${f.nameId ? cleanActionName(this.master.message(f.nameId) ?? '') : ''}`.trim();
  }

  private indexShops(shops: Map<number, number[]>): void {
    this.soldAt.clear();
    for (const [shop, ids] of shops) for (const id of ids) if (!this.soldAt.get(id)?.includes(shop)) this.soldAt.set(id, [...(this.soldAt.get(id) ?? []), shop]);
  }

  /** The shops' lists changed (shop edits): update where each item is sold. */
  setShops(shops: Map<number, number[]>): void {
    this.indexShops(shops);
    for (const it of this.items) it.shops = this.soldAt.get(it.id) ?? [];
  }

  item(id: number): Item | undefined {
    return this.byId.get(id);
  }

  /** Re-read an item from its row (after an edit); the Item object is updated in place. */
  private refresh(id: number): void {
    const it = this.byId.get(id);
    const next = this.build(id);
    if (it && next) Object.assign(it, next);
  }

  /** Edit fields of an item (exported as itemData.bin of the master). */
  set(id: number, f: Partial<ItemFields>): void {
    if (!this.byId.has(id)) return;
    writeItemFields(this.master.itemData.row(id), f);
    this.refresh(id);
  }

  /** Fields of an item as they are in the archive. */
  original(id: number): ItemFields {
    return readItemFields(this.master.originalRow(ITEM_TABLE, id));
  }

  changed(id: number): boolean {
    return this.byId.has(id) && !equalBytes(this.master.itemData.row(id), this.master.originalRow(ITEM_TABLE, id));
  }

  revert(id: number): void {
    if (!this.byId.has(id)) return;
    this.master.itemData.row(id).set(this.master.originalRow(ITEM_TABLE, id));
    this.refresh(id);
  }

  /** Item actions (kind 2) for the effect picker: row, name and effect. */
  itemActions(): { row: number; name: string; effect: string }[] {
    const t = this.master.table('actionData.bin');
    const out: { row: number; name: string; effect: string }[] = [];
    for (let row = 1; row < t.rows; row++) {
      const f = decodeAction(t.row(row));
      if (f.kind !== 2) continue;
      out.push({ row, name: f.nameId ? cleanActionName(this.master.message(f.nameId) ?? '') : '', effect: itemEffect(f) });
    }
    return out;
  }
}

/** Archives that hold item models (itemData +0x20): tools, equipment, the master. */
export const ITEM_MODEL_ARCHIVES = ['1D37838B', '302996EB', '56562135'];

/** Archive (of ITEM_MODEL_ARCHIVES) that holds a model entry, or null. */
export async function itemModelArchive(game: Game, hash: number): Promise<string | null> {
  for (const name of ITEM_MODEL_ARCHIVES) {
    const arc = await game.archive(name).catch(() => null);
    if (arc && findEntry(arc, hash)) return name;
  }
  return null;
}
