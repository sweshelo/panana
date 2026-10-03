// The shops of 電波人間のRPG3 (naauao oahu/shops.md): what each shop sells (ShopItem, 0x10 rows: the item, a price in
// ジュエル or points, the "only once" number) and its settings (Shop, 44 rows × 0x38: room model, clerk, clerk
// messages, how one pays). Both tables are in 3B630000 and E3C10000 with the same bytes; edits to the stock are
// written to both.
import { findEntry, parseArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import type { Dump } from '../rom/dump';
import { u32, w32 } from '../util/bytes';

/** Archives that hold ShopItem and Shop (the same tables). */
export const OAHU_SHOP_ARCHIVES = ['3B630000', 'E3C10000'];
const SHOP_ITEM = 0x67297400;
const SHOP_TABLE = 0xd5cef800;

/** Shop +0x37: what the shop takes (FUN_00232B68). */
export const OAHU_SHOP_PAYMENT: Record<number, string> = { 0: 'ゴールド', 1: 'ジュエル', 2: '別の数 (コロシアムのポイントと推定)', 3: 'バザー (ゴールド)' };
/** The unit of a ShopItem row's price (+0x08), by payment. */
export const OAHU_PRICE_UNIT: Record<number, string> = { 1: 'ジュエル', 2: 'pt' };
/** Shops the game reads another shop's stock for (FUN_0023119C: 17 → 16, 19 → 18). */
export const OAHU_SHOP_ALIASES: Record<number, number> = { 17: 16, 19: 18 };
/** Most of one currency a save holds (ジュエル: 9999, the other: 9,999,999). */
export const OAHU_PRICE_MAX: Record<number, number> = { 1: 9999, 2: 9999999 };

/** A ShopItem row of a shop's stock. */
export interface OahuShopRow {
  item: number;
  /** +0x08: price in ジュエル / points (0 in gold shops: those use itemData's price). */
  price: number;
  /** +0x0C: the "only once" number (save flag 0xAD bit once−1); 0 = any number of times. */
  once: number;
}

export interface OahuShopSettings {
  /** +0x00 / +0x04: the room's model and camera (entries of 3B630000). */
  room: number;
  camera: number;
  /** +0x08: the clerk (a mapObject.bin row when clerkKind is 0). */
  clerk: number;
  /** +0x0C..+0x30: clerk messages. */
  messages: number[];
  /** +0x34: which item description the shop shows (0 / 1 / 2, as in RPG2). */
  variant: number;
  /** +0x35: how the clerk is shown (0 = mapObject row, 2 = special). */
  clerkKind: number;
  /** +0x36: the clerk's height. */
  height: number;
  /** +0x37: payment (OAHU_SHOP_PAYMENT). */
  payment: number;
}

export interface OahuShop {
  id: number;
  /** +0x04 of the head row (0 or 1; not known). */
  head: number;
  settings: OahuShopSettings | null;
}

export function decodeOahuShop(r: Uint8Array): OahuShopSettings {
  const messages: number[] = [];
  for (let o = 0x0c; o <= 0x30; o += 4) messages.push(u32(r, o));
  return { room: u32(r, 0), camera: u32(r, 4), clerk: u32(r, 8), messages, variant: r[0x34]!, clerkKind: r[0x35]!, height: r[0x36]!, payment: r[0x37]! };
}

/** ShopItem rows: shop -> [head +0x04, rows], in table order. */
export function parseOahuShopItems(t: GsTable): Map<number, { head: number; rows: OahuShopRow[] }> {
  const shops = new Map<number, { head: number; rows: OahuShopRow[] }>();
  let cur: { head: number; rows: OahuShopRow[] } | null = null;
  for (let i = 0; i < t.rows; i++) {
    const r = t.row(i);
    const shop = u32(r, 0) | 0;
    if (shop >= 0) {
      cur = { head: u32(r, 4), rows: [] };
      shops.set(shop, cur);
    } else cur?.rows.push({ item: u32(r, 4), price: u32(r, 8), once: r[0x0c]! });
  }
  return shops;
}

/** One 0x10 row; the last three bytes are 0xD0 as in the game's rows. */
function itemRow(shop: number, item: number, price: number, once: number): Uint8Array {
  const r = new Uint8Array(0x10);
  w32(r, 0, shop);
  w32(r, 4, item);
  w32(r, 8, price);
  r[0x0c] = once;
  r.fill(0xd0, 0x0d);
  return r;
}

export function oahuShopItemRows(shops: Map<number, { head: number; rows: OahuShopRow[] }>): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const [shop, { head, rows }] of shops) {
    out.push(itemRow(shop, head, 0, 0));
    for (const r of rows) out.push(itemRow(0xffffffff, r.item, r.price, r.once));
  }
  return out;
}

const sameRow = (a: OahuShopRow, b: OahuShopRow): boolean => a.item === b.item && a.price === b.price && a.once === b.once;

export type SavedShop = [shop: number, rows: [item: number, price: number, once: number][]];

interface Source {
  name: string;
  archive: Archive;
  entry: ArcEntry;
}

export class OahuShops {
  readonly shops: OahuShop[];
  private readonly original: Map<number, { head: number; rows: OahuShopRow[] }>;
  private readonly lists: Map<number, { head: number; rows: OahuShopRow[] }>;

  private constructor(
    private readonly table: GsTable,
    settings: GsTable | null,
    private readonly sources: Source[],
  ) {
    this.original = parseOahuShopItems(table);
    this.lists = new Map([...this.original].map(([s, l]) => [s, { head: l.head, rows: l.rows.map((r) => ({ ...r })) }]));
    this.shops = [...this.original.keys()].sort((a, b) => a - b).map((id) => ({
      id,
      head: this.original.get(id)!.head,
      settings: settings && id < settings.rows ? decodeOahuShop(settings.row(id)) : null,
    }));
  }

  /** The archives' parsed copies are kept to rebuild them with the edited ShopItem. */
  static async load(dump: Dump): Promise<OahuShops | null> {
    const have = new Set(dump.names());
    const sources: Source[] = [];
    let table: GsTable | null = null;
    let settings: GsTable | null = null;
    for (const name of OAHU_SHOP_ARCHIVES) {
      if (!have.has(name)) continue;
      const archive = parseArchive(await dump.readRomfs(name));
      const entry = findEntry(archive, SHOP_ITEM);
      if (!entry) continue;
      sources.push({ name, archive, entry });
      table ??= new GsTable(unpackEntry(archive, entry).body);
      const s = findEntry(archive, SHOP_TABLE);
      if (!settings && s) settings = new GsTable(unpackEntry(archive, s).body);
    }
    return table ? new OahuShops(table, settings, sources) : null;
  }

  shop(id: number): OahuShop | undefined {
    return this.shops.find((s) => s.id === id);
  }

  rows(shop: number): OahuShopRow[] {
    return this.lists.get(shop)?.rows ?? [];
  }

  originalRows(shop: number): OahuShopRow[] {
    return this.original.get(shop)?.rows ?? [];
  }

  /** Largest stock in the game's table. */
  get originalMax(): number {
    return Math.max(0, ...[...this.original.values()].map((l) => l.rows.length));
  }

  /** The "only once" numbers the game's rows use. */
  get onceNumbers(): number[] {
    return [...new Set([...this.original.values()].flatMap((l) => l.rows.map((r) => r.once)).filter((n) => n))].sort((a, b) => a - b);
  }

  set(shop: number, rows: OahuShopRow[]): void {
    const l = this.lists.get(shop);
    if (l) l.rows = rows.map((r) => ({ ...r }));
  }

  changedShop(shop: number): boolean {
    const a = this.rows(shop), b = this.originalRows(shop);
    return a.length !== b.length || a.some((r, i) => !sameRow(r, b[i]!));
  }

  changedShops(): number[] {
    return [...this.lists.keys()].filter((s) => this.changedShop(s));
  }

  changed(): boolean {
    return this.changedShops().length > 0;
  }

  /** Shops that sell an item (current stock). */
  sellers(item: number): number[] {
    return [...this.lists].filter(([, l]) => l.rows.some((r) => r.item === item)).map(([s]) => s);
  }

  saved(): SavedShop[] {
    return this.changedShops().map((s) => [s, this.rows(s).map((r) => [r.item, r.price, r.once])]);
  }

  restore(saved: SavedShop[]): void {
    for (const [s, rows] of saved) this.set(s, rows.map(([item, price, once]) => ({ item, price, once })));
  }

  /** The ShopItem table with the current stock. */
  build(): Uint8Array {
    return this.table.withRows(oahuShopItemRows(this.lists));
  }

  /** Changed entries: archive name -> entry index -> bytes (empty when nothing changed). */
  changedEntries(): Map<string, Map<number, Uint8Array>> {
    const out = new Map<string, Map<number, Uint8Array>>();
    if (!this.changed()) return out;
    const data = this.build();
    for (const s of this.sources) out.set(s.name, new Map([[s.entry.index, data]]));
    return out;
  }

  /** The parsed archives (for rebuilding the ones the messages do not hold). */
  archives(): Map<string, Archive> {
    return new Map(this.sources.map((s) => [s.name, s.archive]));
  }

  archiveNames(): string[] {
    return this.sources.map((s) => s.name);
  }
}

export const oahuShopLabel = (s: OahuShop): string => {
  const pay = s.settings?.payment ?? 0;
  return `店 ${s.id}${pay ? ` (${pay === 1 ? 'ジュエル' : pay === 2 ? 'ポイント' : 'バザー'})` : ''}`;
};
