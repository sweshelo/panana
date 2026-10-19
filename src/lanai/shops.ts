// RPG FREE!'s shops (naauao lanai/shops.md): every content's archive has a Shop table (0x1C a row: +0x00 the ShopItem
// row ID of the shop's head row, +0x04 / +0x08 the room's model and camera …) and a ShopItem table (0x2C a row) where a
// head row (+0x00 = 0, +0x24 = 1) is followed by the shop's items (+0x00 item ID, +0x26 how many can be bought, …) up
// to the next head row. The EventObject rows of type 0x80000032 (店の人: a line, then the shop) open the content's
// shop: all such rows are in contents with one Shop row (assumed: row 0; the code is not found yet).
//
// The stock of a shop is edited by laying the ShopItem rows out again in their order: the rows keep their places and
// row IDs, so a shop that grows or shrinks moves the shops after it (their Shop +0x00 is pointed at their head rows'
// new places). The table never gets fewer rows than it had: rows left over at the end become head rows of no shop.
import { equalBytes, u32, w32 } from '../util/bytes';
import type { LanaiContent } from './contents';
import { lanaiItems, type LanaiItem } from './items';
import { LANAI_EVENT_ACTIONS, LANAI_EVENT_SECTIONS, type LanaiMaps } from './maps';
import type { LanaiSession } from './session';
import { isRowId, type LanaiTable } from './table';

/** The action type of the clerks (actions.ts 店の人). */
export const LANAI_SHOP_ACTION = 0x80000032;
export const LANAI_SHOP_TABLE = 'Shop';
export const LANAI_SHOP_ITEM_TABLE = 'ShopItem';

/**
 * ShopItem (naauao lanai/shops.md §2, read in FUN_002233EC and the code that buys): the item ID (or a random slot's
 * kind), a price passed to the price code (推定: its override), the display condition (+0x10 its type, +0x08 its number,
 * +0x0C the value compared), the head mark, the random slot's save index, the most one can buy (counted per shop and
 * place) and the most one can buy counted by +0x28 (shared by the rows with the same +0x28; it wins over +0x26).
 */
export const SHOP_ITEM = 0x00;
export const SHOP_PRICE = 0x04;
export const SHOP_COND_NUMBER = 0x08;
export const SHOP_COND_VALUE = 0x0c;
export const SHOP_COND = 0x10;
export const SHOP_HEAD = 0x24;
export const SHOP_SLOT = 0x25;
export const SHOP_LIMIT = 0x26;
export const SHOP_SHARED_LIMIT = 0x27;
export const SHOP_SHARED_COUNTER = 0x28;
/** The usual value of +0x20 (not known; the same in nearly every row). */
const SHOP_ITEM_20 = 0x800001bf;

/**
 * The kind (ItemDataCore +0x32) a row draws an item of, or -1: a row whose +0x00 is not 0 nor a row ID and whose +0x25 is
 * not 0 is a random slot. The game picks one of the items of that kind (ItemDataCore +0x30 bit 0 set, not in the list
 * yet; 0x55 and 0x56 are one kind) once a day and keeps it in the save at +0x25.
 */
export const lanaiShopSlotKind = (b: Uint8Array): number => {
  const v = u32(b, SHOP_ITEM);
  return v && !isRowId(v) && b[SHOP_SLOT] ? v & 0xff : -1;
};

/** A row of a shop's stock: the item and the row's bytes (the fields not known are kept). */
export interface LanaiShopRow {
  item: number;
  bytes: Uint8Array;
}

export interface LanaiShop {
  /** Row of the Shop table. */
  row: number;
  /** Its row ID. */
  id: number;
}

const isHead = (b: Uint8Array): boolean => u32(b, SHOP_ITEM) === 0 && b[SHOP_HEAD] === 1;

/** A stock row of `item` (a copy of `template`, the other fields as in an item row with no limit). */
export function lanaiShopRowBytes(template: Uint8Array | undefined, item: number): Uint8Array {
  const b = template && !isHead(template) ? template.slice() : defaultItemRow();
  w32(b, SHOP_ITEM, item >>> 0);
  b[SHOP_HEAD] = 0;
  return b;
}

/** A row of `item` from `template` with the fields of the row (not of the item) cleared: no condition, no slot, no limit. */
export function lanaiShopItemRow(template: Uint8Array | undefined, item: number): Uint8Array {
  const b = lanaiShopRowBytes(template, item);
  for (const o of [SHOP_PRICE, SHOP_COND_NUMBER, SHOP_COND_VALUE]) w32(b, o, 0);
  for (const o of [SHOP_COND, SHOP_SLOT, SHOP_LIMIT, SHOP_SHARED_LIMIT, SHOP_SHARED_COUNTER]) b[o] = 0;
  return b;
}

/** An item row as the shops of the stages have them: 0 except +0x20, the 0xD0 padding of the packed words. */
function defaultItemRow(): Uint8Array {
  const b = new Uint8Array(0x2c);
  for (const o of [0x10, 0x1c, 0x28]) b.fill(0xd0, o + 1, o + 4);
  w32(b, 0x20, SHOP_ITEM_20);
  return b;
}

const rowOf = (item: number, bytes: Uint8Array): LanaiShopRow => ({ item, bytes });

/** The rows of a table as they are now, or as read (`original`; rows an edit added are left out). */
function tableRows(t: LanaiTable, original: boolean): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < (original ? t.originalRows : t.rows); i++) out.push((original ? t.originalRow(i) : t.row(i))?.slice() ?? new Uint8Array(t.rowSize));
  return out;
}

/** The head rows of a list of ShopItem rows, each with the rows of its stock. */
function segments(rows: Uint8Array[]): { prefix: Uint8Array[]; heads: { at: number; head: Uint8Array; stock: Uint8Array[] }[] } {
  const prefix: Uint8Array[] = [];
  const heads: { at: number; head: Uint8Array; stock: Uint8Array[] }[] = [];
  rows.forEach((b, at) => {
    if (isHead(b)) heads.push({ at, head: b, stock: [] });
    else (heads.at(-1)?.stock ?? prefix).push(b);
  });
  return { prefix, heads };
}

/** The ShopItem row a reference names in a list of rows (row IDs from the table; a small value is a row number). */
function findIn(t: LanaiTable, ref: number, count: number): number {
  if (!isRowId(ref)) return ref < count ? ref : -1;
  for (let i = 0; i < count; i++) if (t.rowId(i) === ref) return i;
  return -1;
}

/** The shops of one content (its Shop and ShopItem tables). */
export class LanaiContentShops {
  readonly shops: LanaiShop[];

  constructor(
    readonly session: LanaiSession,
    readonly content: LanaiContent,
    readonly shopTable: LanaiTable,
    readonly items: LanaiTable,
  ) {
    this.shops = Array.from({ length: shopTable.rows }, (_, row) => ({ row, id: shopTable.rowId(row) }));
  }

  /** The content's shop tables (null when its archive has none). */
  static async load(session: LanaiSession, content: LanaiContent): Promise<LanaiContentShops | null> {
    const tables = await session.tablesIn(content.archive);
    const shop = tables.find((t) => t.table.name === LANAI_SHOP_TABLE)?.table;
    const items = tables.find((t) => t.table.name === LANAI_SHOP_ITEM_TABLE)?.table;
    return shop && items ? new LanaiContentShops(session, content, shop, items) : null;
  }

  /** Shop +0x00 now / as read. */
  headRef(shop: number, original = false): number {
    return original ? u32(this.shopTable.originalRow(shop) ?? this.shopTable.row(shop), 0) : this.shopTable.u32(shop, 0);
  }

  private stockIn(rows: Uint8Array[], shop: number, original: boolean): LanaiShopRow[] {
    const at = findIn(this.items, this.headRef(shop, original), rows.length);
    if (at < 0 || !isHead(rows[at]!)) return [];
    const out: LanaiShopRow[] = [];
    for (let i = at + 1; i < rows.length && !isHead(rows[i]!); i++) out.push(rowOf(u32(rows[i]!, SHOP_ITEM), rows[i]!));
    return out;
  }

  /** The stock of a Shop row (empty when +0x00 names no head row). */
  rows(shop: number): LanaiShopRow[] {
    return this.stockIn(tableRows(this.items, false), shop, false);
  }

  originalRows(shop: number): LanaiShopRow[] {
    return this.stockIn(tableRows(this.items, true), shop, true);
  }

  /** The head row of a shop as it is now (-1: none). */
  headRow(shop: number): number {
    const at = this.items.find(this.headRef(shop));
    return at >= 0 && isHead(this.items.row(at)) ? at : -1;
  }

  /** Whether a Shop row names a head row (the others are shown, not edited). */
  editable(shop: number): boolean {
    return this.headRow(shop) >= 0;
  }

  /** The most items a shop of the content's archive had when read. */
  get originalMax(): number {
    return Math.max(0, ...this.shops.map((s) => this.originalRows(s.row).length));
  }

  /**
   * A row for an item added to a shop: a copy of the shop's first item row (or the content's), always shown, with no
   * limit. A kind (`item` below 0x80000000) makes a random slot with the next unused slot number.
   */
  newRow(shop: number, item: number): LanaiShopRow {
    const t = this.rows(shop).find((r) => r.item) ?? this.shops.flatMap((s) => this.rows(s.row)).find((r) => r.item);
    const b = lanaiShopItemRow(t?.bytes, item);
    if (item && !isRowId(item)) b[SHOP_SLOT] = this.nextSlot();
    return rowOf(item, b);
  }

  /** The lowest slot number no row of the content's ShopItem uses (the save keeps one item per number: 1〜99). */
  nextSlot(): number {
    const used = new Set<number>();
    for (let i = 0; i < this.items.rows; i++) if (lanaiShopSlotKind(this.items.row(i)) >= 0) used.add(this.items.u8(i, SHOP_SLOT));
    let n = 1;
    while (used.has(n) && n < LANAI_SHOP_SLOTS) n++;
    return n;
  }

  /** Writes a shop's stock (see the top of the file). */
  set(shop: number, stock: LanaiShopRow[]): void {
    const t = this.items;
    const { prefix, heads } = segments(tableRows(t, false));
    const k = heads.findIndex((h) => h.at === this.headRow(shop));
    if (k < 0) throw new Error(`Shop の行 ${shop} の品揃えの頭の行がありません`);
    // which segment each shop names (by its head row now)
    const named = this.shops.map((s) => heads.findIndex((h) => h.at === this.headRow(s.row)));
    heads[k]!.stock = stock.map((r) => lanaiShopRowBytes(r.bytes, r.item));
    // head rows of no shop at the end are the padding of an earlier edit (the ROM has none: one head row per Shop row)
    while (heads.length > 1 && !heads.at(-1)!.stock.length && !named.includes(heads.length - 1)) heads.pop();
    const flat: Uint8Array[] = [...prefix];
    const placed: number[] = [];
    for (const h of heads) {
      placed.push(flat.length);
      flat.push(h.head, ...h.stock);
    }
    // the table keeps at least the rows it was read with (the saved edits are rows by place)
    while (t.rows > Math.max(flat.length, t.originalRows)) t.removeLastRow();
    const pad = heads[0]!.head;
    while (flat.length < t.rows) flat.push(pad.slice());
    while (t.rows < flat.length) t.addRow();
    flat.forEach((b, i) => {
      const was = t.originalRow(i);
      if (was && equalBytes(was, b)) t.revertRow(i);
      else if (!equalBytes(t.row(i), b)) t.setRow(i, b);
    });
    // point the shops at their head rows' places
    this.shops.forEach((s, i) => {
      const seg = named[i]!;
      if (seg < 0) return;
      const at = placed[seg]!;
      const id = t.rowId(at);
      const was = this.headRef(s.row, true);
      const next = findIn(t, was, t.rows) === at ? was : isRowId(id) && t.rowIds.filter((x) => x === id).length === 1 ? id : at;
      if (next !== this.headRef(s.row)) this.shopTable.setU32(s.row, 0, next);
    });
  }

  /** Whether a shop's stock differs from the ROM's. */
  changed(shop: number): boolean {
    const a = this.rows(shop);
    const b = this.originalRows(shop);
    return a.length !== b.length || a.some((r, i) => !equalBytes(r.bytes, b[i]!.bytes));
  }
}

const loaded = new WeakMap<LanaiSession, Map<number, Promise<LanaiContentShops | null>>>();

/** The shops of a content, read once per session. */
export function lanaiShops(session: LanaiSession, content: LanaiContent): Promise<LanaiContentShops | null> {
  const m = loaded.get(session) ?? new Map<number, Promise<LanaiContentShops | null>>();
  loaded.set(session, m);
  let p = m.get(content.index);
  if (!p) {
    p = LanaiContentShops.load(session, content);
    p.catch(() => m.delete(content.index));
    m.set(content.index, p);
  }
  return p;
}

/** A clerk: an EventObject row with the 店の人 action, and the records of the maps that place it. */
export interface LanaiClerk {
  group: number;
  /** EventObject row. */
  event: number;
  /** Offset of the action's type (0x10 / 0x28 / 0x40). */
  action: number;
  /** The talk table row of its line (the action's first argument). */
  talk: number;
  /** The records that place it: map name, section, index in the section. */
  places: { map: string; section: number; index: number }[];
}

/** The clerks of a content's maps (every MapGroup's EventObject rows with the 店の人 action). */
export function lanaiClerks(maps: LanaiMaps): LanaiClerk[] {
  const out: LanaiClerk[] = [];
  for (let group = 0; group < maps.groups.length; group++) {
    const t = maps.eventTable(group);
    if (!t) continue;
    for (let event = 1; event < t.rows; event++)
      for (const action of LANAI_EVENT_ACTIONS)
        if (t.u32(event, action) === LANAI_SHOP_ACTION) out.push({ group, event, action, talk: t.u32(event, action + 4), places: [] });
  }
  if (!out.length) return out;
  for (const m of maps.maps) {
    if (m.world) continue;
    const doc = maps.doc(m);
    for (const section of LANAI_EVENT_SECTIONS)
      (doc.recs[section] ?? []).forEach((r, index) => {
        const event = u32(r.raw, 4);
        for (const c of out) if (c.group === m.dungeon && c.event === event) c.places.push({ map: m.name, section, index });
      });
  }
  return out;
}

/** The Shop row a content's clerks open: row 0 (assumed; naauao lanai/shops.md §4). */
export const LANAI_CLERK_SHOP = 0;


/** The random slots the save keeps (FlagData 0x97: 100 values; number 0 is no slot). */
export const LANAI_SHOP_SLOTS = 99;

/** ItemDataCore +0x30 bit 0: the item can be drawn by a random slot (FUN_001BDD1C). */
export const LANAI_SLOT_POOL_BIT = 1;

/** Whether an item is in the pool of the random slots of its kind. */
export const lanaiInSlotPool = (session: LanaiSession, it: LanaiItem): boolean => !!(session.need('ItemDataCore').u8(it.core, 0x30) & LANAI_SLOT_POOL_BIT);

/** Puts an item in (or out of) the pool of the random slots of its kind (ItemDataCore +0x30 bit 0; shared by every item of the same ItemDataCore row). */
export function lanaiSetSlotPool(session: LanaiSession, it: LanaiItem, on: boolean): void {
  const core = session.need('ItemDataCore');
  const v = core.u8(it.core, 0x30);
  core.setU8(it.core, 0x30, on ? v | LANAI_SLOT_POOL_BIT : v & ~LANAI_SLOT_POOL_BIT);
}

/** The items of a kind a random slot can draw (0x55 and 0x56 are one kind); `pool` false: the others of the kind. */
export function lanaiSlotKindItems(session: LanaiSession, kind: number): LanaiItem[] {
  const same = (k: number): boolean => k === kind || (kind === 0x55 && k === 0x56) || (kind === 0x56 && k === 0x55);
  return lanaiItems(session).filter((it) => same(it.kind));
}

/** The items a random slot of `kind` draws from: shown in shops (ItemDataCore +0x30 bit 0) and of the kind (0x55 = 0x56). */
export function lanaiShopSlotItems(session: LanaiSession, kind: number): LanaiItem[] {
  return lanaiSlotKindItems(session, kind).filter((it) => lanaiInSlotPool(session, it));
}
