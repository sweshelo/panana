// Items (itemData, 713 rows x 0x30) with their use effect (actionData) and the shops that sell them
// (ShopItem 0x67297400 in 49A43B63). Fields: elpulse docs/analysis.md "itemData.bin", "ShopItem".
import { GsTable } from '../archive/gstable';
import { findEntry, unpackEntry } from '../archive/gsarc';
import { s16, u16, u32 } from '../util/bytes';
import type { Game } from './game';

export const SHOP_ARCHIVE = '49A43B63';
const SHOP_ITEM = 0x67297400;

export const ITEM_CATEGORY: Record<number, string> = { 1: '道具', 2: 'ゴールド', 3: '装備', 4: 'つりざお', 5: 'エサ' };
/** Equipment slot by the full category byte. */
export const EQUIP_SLOT: Record<number, string> = { 0x03: '首', 0x13: '腕', 0x23: '足', 0x33: '背中', 0x43: '服' };
/** Item effect by actionData type (category 2; FUN_002f41ac). 4〜7 are added by the elpulse MOD. */
const ITEM_EFFECT: Record<number, string> = { 0: 'HP 回復', 1: 'AP 回復', 2: '状態の回復', 3: '復活', 4: '全回復 (MOD)', 5: '固定化 (MOD)' };

export interface Item {
  id: number;
  name: string;
  description: string;
  /** +0x2C: low 4 bits = category, high = sub category. */
  categoryByte: number;
  category: string;
  price: number;
  sell: number;
  flags: number;
  /** Stars (flags bit5-7). */
  rarity: number;
  /** +0x2F (0 = 99). */
  limit: number;
  /** +0x24: actionData row (consumables). */
  action: number;
  effect: string;
  /** +0x2A: item that replaces it at the limit (0 = none). */
  chain: number;
  /** +0x20: model bcres (in 1D37838B, 302996EB or 56562135). */
  model: number;
  /** +0x2D, +0x2E (equipment parameters, not analysed). */
  extra: [number, number];
  shops: number[];
}

export function categoryLabel(b: number): string {
  const main = ITEM_CATEGORY[b & 0xf] ?? `分類 ${b & 0xf}`;
  if ((b & 0xf) === 3) return `${main} (${EQUIP_SLOT[b] ?? `0x${b.toString(16)}`})`;
  return main;
}

export async function loadShops(game: Game): Promise<Map<number, number[]>> {
  const shops = new Map<number, number[]>();
  const arc = await game.archive(SHOP_ARCHIVE);
  const e = findEntry(arc, SHOP_ITEM);
  if (!e) return shops;
  const t = new GsTable(unpackEntry(arc, e).body);
  let cur = -1;
  for (let i = 0; i < t.rows; i++) {
    const r = t.row(i);
    const shop = u32(r, 0) | 0;
    if (shop >= 0) {
      cur = shop;
      shops.set(cur, []);
    } else if (cur >= 0) shops.get(cur)!.push(u32(r, 4));
  }
  return shops;
}

export class ItemBook {
  readonly items: Item[] = [];
  private readonly byId = new Map<number, Item>();

  constructor(game: Game, shops: Map<number, number[]>) {
    const master = game.master;
    const t = master.itemData;
    const actions = master.table('actionData.bin');
    const soldAt = new Map<number, number[]>();
    for (const [shop, ids] of shops) for (const id of ids) soldAt.set(id, [...(soldAt.get(id) ?? []), shop]);
    const msg = (id: number): string => (id ? (master.message(id) ?? '').replace(/Ē/g, '(色)') : '');
    for (let id = 1; id < t.rows; id++) {
      const r = t.row(id);
      const nameId = u32(r, 0x0c);
      if (!nameId) continue;
      const flags = u32(r, 8);
      const action = u32(r, 0x24);
      const cat = r[0x2c]!;
      const it: Item = {
        id,
        name: msg(nameId) || `#${id}`,
        description: [0x10, 0x14, 0x18, 0x1c].map((o) => msg(u32(r, o))).filter(Boolean).join(' '),
        categoryByte: cat,
        category: categoryLabel(cat),
        price: u32(r, 0),
        sell: u32(r, 4),
        flags,
        rarity: (flags >>> 5) & 7,
        limit: r[0x2f] || 99,
        action,
        effect: (cat & 0xf) === 1 && action > 0 && action < actions.rows ? effectOf(actions.row(action)) : '',
        chain: u16(r, 0x2a),
        model: u32(r, 0x20),
        extra: [r[0x2d]!, r[0x2e]!],
        shops: soldAt.get(id) ?? [],
      };
      this.items.push(it);
      this.byId.set(id, it);
    }
  }

  item(id: number): Item | undefined {
    return this.byId.get(id);
  }
}

/** "HP 回復 30〜40 (フィールド・戦闘)" from an actionData row (docs/battle.md §8). */
function effectOf(r: Uint8Array): string {
  const w0 = u32(r, 0);
  if (((w0 >>> 1) & 3) !== 2) return '';
  const type = (w0 >>> 3) & 15;
  const lo = s16(r, 0x18), hi = s16(r, 0x1a);
  const amount = lo || hi ? ` ${Math.min(lo, hi)}〜${Math.max(lo, hi)}` : '';
  const scenes = [[31, 'フィールド'], [30, 'ハウス'], [29, '戦闘']].filter(([b]) => (w0 >>> (b as number)) & 1).map(([, n]) => n);
  return `${ITEM_EFFECT[type] ?? `種別 ${type}`}${type <= 1 ? amount : ''}${scenes.length ? ` (${scenes.join('・')})` : ''}`;
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
