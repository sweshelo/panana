// Shops: what each shop sells (ShopItem 0x67297400, the same table in 49A43B63 and 1D37838B) and its settings
// (Shop 0xD5CEF800 in 49A43B63, 18 rows x 0x38). Fields: elpulse docs/analysis.md "ShopItem テーブル", "Shop テーブル".
import { findEntry, rebuildArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { u32, w32 } from '../util/bytes';
import type { Game } from './game';

export const SHOP_ARCHIVE = '49A43B63';
/** Archives that hold ShopItem; an edit is written to each of them so they stay the same. */
export const SHOP_ITEM_ARCHIVES = [SHOP_ARCHIVE, '1D37838B'];
const SHOP_ITEM = 0x67297400;
const SHOP_TABLE = 0xd5cef800;

/** Offsets of the clerk's message IDs (+0x0C..+0x30). */
export const CLERK_MESSAGE_OFFSETS = [0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c, 0x30];

/** Item description a shop shows, by the variant byte (+0x34): itemData offset. */
export const DESCRIPTION_VARIANT: Record<number, number> = { 0: 0x14, 1: 0x18, 2: 0x1c };

/** Shops whose place is known. */
export const SHOP_PLACES: Record<number, string> = { 17: '妖精の里' };

export interface Shop {
  id: number;
  /** Item IDs in the order the shop lists them (ShopItem; the current, possibly edited, list). */
  items: number[];
  /** Clerk message IDs (+0x0C..+0x30; 0 = none). Empty when the Shop table could not be read. */
  messages: number[];
  /** +0x34: which item description the shop shows (DESCRIPTION_VARIANT); -1 when unknown. */
  variant: number;
  /** The Shop row (empty when the table could not be read). */
  raw: Uint8Array;
}

export const shopLabel = (id: number): string => `店 ${id}${SHOP_PLACES[id] ? ` (${SHOP_PLACES[id]})` : ''}`;

/** ShopItem rows: `s32 shop (-1 = the previous shop goes on), u32 item`. Shop -> item IDs, in table order. */
export function parseShopItems(t: GsTable): Map<number, number[]> {
  const shops = new Map<number, number[]>();
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

/** ShopItem rows for the given lists (shops in map order: a head row, then one row per item). */
export function shopItemRows(shops: Map<number, number[]>): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (const [shop, items] of shops) {
    const head = new Uint8Array(8);
    w32(head, 0, shop);
    rows.push(head);
    for (const id of items) {
      const r = new Uint8Array(8);
      w32(r, 0, 0xffffffff);
      w32(r, 4, id);
      rows.push(r);
    }
  }
  return rows;
}

export async function loadShops(game: Game): Promise<Map<number, number[]>> {
  const arc = await game.archive(SHOP_ARCHIVE);
  const e = findEntry(arc, SHOP_ITEM);
  return e ? parseShopItems(new GsTable(unpackEntry(arc, e).body)) : new Map();
}

/**
 * The shops' item lists, editable. Edits are exported as ShopItem in every archive of SHOP_ITEM_ARCHIVES that
 * has it (the rest of each archive is copied verbatim).
 */
export class ShopStock {
  /** Current lists (shop -> item IDs), in the table's shop order. */
  readonly lists: Map<number, number[]>;
  private readonly original: Map<number, number[]>;

  constructor(
    private readonly table: GsTable,
    private readonly sources: { name: string; archive: Archive; entry: ArcEntry }[],
  ) {
    this.original = parseShopItems(table);
    this.lists = new Map([...this.original].map(([s, ids]) => [s, [...ids]]));
  }

  static async load(game: Game): Promise<ShopStock | null> {
    const sources: { name: string; archive: Archive; entry: ArcEntry }[] = [];
    let table: GsTable | null = null;
    for (const name of SHOP_ITEM_ARCHIVES) {
      const archive = await game.archive(name).catch(() => null);
      const entry = archive && findEntry(archive, SHOP_ITEM);
      if (!archive || !entry) continue;
      sources.push({ name, archive, entry });
      table ??= new GsTable(unpackEntry(archive, entry).body);
    }
    return table ? new ShopStock(table, sources) : null;
  }

  items(shop: number): number[] {
    return this.lists.get(shop) ?? [];
  }

  originalItems(shop: number): number[] {
    return this.original.get(shop) ?? [];
  }

  /** Largest list in the original table (lists longer than this are not known to work in the game). */
  get originalMax(): number {
    return Math.max(0, ...[...this.original.values()].map((l) => l.length));
  }

  set(shop: number, items: number[]): void {
    if (!this.lists.has(shop)) return;
    this.lists.set(shop, [...items]);
  }

  changedShop(shop: number): boolean {
    const a = this.items(shop), b = this.originalItems(shop);
    return a.length !== b.length || a.some((id, i) => id !== b[i]);
  }

  changedShops(): number[] {
    return [...this.lists.keys()].filter((s) => this.changedShop(s));
  }

  changed(): boolean {
    return this.changedShops().length > 0;
  }

  revert(shop: number): void {
    this.set(shop, this.originalItems(shop));
  }

  /** Edited lists, for saving. */
  saved(): [number, number[]][] {
    return this.changedShops().map((s) => [s, this.items(s)]);
  }

  restore(saved: [number, number[]][]): void {
    for (const [s, items] of saved) this.set(s, items);
  }

  /** The ShopItem table with the current lists. */
  build(): Uint8Array {
    return this.table.withRows(shopItemRows(this.lists));
  }

  /** Archive name -> rebuilt archive (empty when nothing changed). */
  buildArchives(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    if (!this.changed()) return out;
    const data = this.build();
    for (const s of this.sources) out.set(s.name, rebuildArchive(s.archive, new Map([[s.entry.index, data]])));
    return out;
  }

  archiveNames(): string[] {
    return this.sources.map((s) => s.name);
  }
}

/** Decode a Shop row. */
export function decodeShopRow(r: Uint8Array): { messages: number[]; variant: number } {
  return { messages: CLERK_MESSAGE_OFFSETS.map((o) => u32(r, o)), variant: r[0x34]! };
}

/** Rows of the Shop table (null when the archive has no such entry). */
export async function loadShopTable(game: Game): Promise<GsTable | null> {
  const arc = await game.archive(SHOP_ARCHIVE);
  const e = findEntry(arc, SHOP_TABLE);
  return e ? new GsTable(unpackEntry(arc, e).body) : null;
}

/**
 * Every shop of ShopItem (by ID), with its settings from the Shop table when there is a row for it. `items` of each
 * shop is the stock's list itself, so edits to the stock show up.
 */
export function buildShops(stock: Map<number, number[]>, table: GsTable | null): Shop[] {
  const ids = new Set(stock.keys());
  if (table) for (let i = 0; i < table.rows; i++) ids.add(i);
  return [...ids].sort((a, b) => a - b).map((id) => {
    const raw = table && id < table.rows ? table.row(id) : new Uint8Array(0);
    const { messages, variant } = raw.length >= 0x35 ? decodeShopRow(raw) : { messages: [], variant: -1 };
    return { id, items: stock.get(id) ?? [], messages, variant, raw };
  });
}

/** What is being dragged onto a shop's list: one of its rows, or an item from the item palette. */
export type ShopDrag = { kind: 'row'; index: number } | { kind: 'item'; id: number };

/**
 * The list after a drop at `at` (0..length: the gap before that row). A row moves; an item is inserted, or moved
 * when the shop already sells it.
 */
export function dropInto(list: number[], drag: ShopDrag, at: number): number[] {
  return dropRows(list, drag, at, (id) => id, (id) => id);
}

/** {@link dropInto} for rows that carry more than the item ID (RPG3's ShopItem): `item` reads a row's item, `make` builds the row of a new item. */
export function dropRows<T>(list: T[], drag: ShopDrag, at: number, item: (row: T) => number, make: (id: number) => T): T[] {
  const from = drag.kind === 'row' ? drag.index : list.findIndex((r) => item(r) === drag.id);
  const row = drag.kind === 'row' ? list[drag.index]! : from >= 0 ? list[from]! : make(drag.id);
  const next = [...list];
  let to = Math.max(0, Math.min(at, list.length));
  if (from >= 0) {
    next.splice(from, 1);
    if (to > from) to--;
  }
  next.splice(to, 0, row);
  return next;
}
