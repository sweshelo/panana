// Shops: the settings of each shop (Shop 0xD5CEF800 in 49A43B63, 18 rows x 0x38) and what it sells (ShopItem,
// loadShops). Fields: elpulse docs/analysis.md "Shop テーブル", "ShopItem テーブル".
import { findEntry, unpackEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { u32 } from '../util/bytes';
import type { Game } from './game';
import { SHOP_ARCHIVE } from './items';

const SHOP_TABLE = 0xd5cef800;

/** Offsets of the clerk's message IDs (+0x0C..+0x30). */
export const CLERK_MESSAGE_OFFSETS = [0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c, 0x30];

/** Item description a shop shows, by the variant byte (+0x34): itemData offset. */
export const DESCRIPTION_VARIANT: Record<number, number> = { 0: 0x14, 1: 0x18, 2: 0x1c };

/** Shops whose place is known. */
export const SHOP_PLACES: Record<number, string> = { 17: '妖精の里' };

export interface Shop {
  id: number;
  /** Item IDs in the order the shop lists them (ShopItem). */
  items: number[];
  /** Clerk message IDs (+0x0C..+0x30; 0 = none). Empty when the Shop table could not be read. */
  messages: number[];
  /** +0x34: which item description the shop shows (DESCRIPTION_VARIANT); -1 when unknown. */
  variant: number;
  /** The Shop row (empty when the table could not be read). */
  raw: Uint8Array;
}

export const shopLabel = (id: number): string => `店 ${id}${SHOP_PLACES[id] ? ` (${SHOP_PLACES[id]})` : ''}`;

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

/** Every shop of ShopItem (by ID), with its settings from the Shop table when there is a row for it. */
export function buildShops(stock: Map<number, number[]>, table: GsTable | null): Shop[] {
  const ids = new Set(stock.keys());
  if (table) for (let i = 0; i < table.rows; i++) ids.add(i);
  return [...ids].sort((a, b) => a - b).map((id) => {
    const raw = table && id < table.rows ? table.row(id) : new Uint8Array(0);
    const { messages, variant } = raw.length >= 0x35 ? decodeShopRow(raw) : { messages: [], variant: -1 };
    return { id, items: stock.get(id) ?? [], messages, variant, raw };
  });
}
