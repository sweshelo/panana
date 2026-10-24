// 初代's items (naauao honolulu/items.md): the rows of itemData that hold an item (+0x18 = 1; 235 of 298), their texts
// and prices, the equipData / clothData row of an equipment / clothes, and the shop stages that sell them. The items
// have no model; only the clothes have a texture (clothData → B50A5EA9), read when first shown.
import { findEntry, parseArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { parseCgfx, type CgfxTexture } from '../cgfx/cgfx';
import type { TableRows } from '../game/tablerows';
import type { Dump } from '../rom/dump';
import { HONOLULU_ITEM_CATEGORY } from './tables';
import type { HonoluluSession } from './session';

export const HONOLULU_ITEM_FILE = 'itemData.bin';
/** The archive of the clothes' textures (one CGFX per pattern). */
export const HONOLULU_CLOTH_ARCHIVE = 'B50A5EA9';

/** itemData +0x1A of an equipment and of clothes. */
export const EQUIP_CATEGORY = 3;
export const CLOTH_CATEGORY = 4;

/** The texts of an item: the field and its label. */
export const HONOLULU_ITEM_TEXTS = [['name', '名前'], ['desc', '説明'], ['shopDesc', '店員の説明']] as const;
export type HonoluluItemText = (typeof HONOLULU_ITEM_TEXTS)[number][0];

export interface HonoluluItem {
  row: number;
  name: string;
  category: number;
  price: number;
  sell: number;
}

export const categoryName = (c: number): string => HONOLULU_ITEM_CATEGORY[c] ?? `分類 ${c}`;

export const honoluluItemRows = (session: HonoluluSession): TableRows => session.master.rows(HONOLULU_ITEM_FILE);

/** The rows that hold an item, in row order. */
export function honoluluItems(session: HonoluluSession): HonoluluItem[] {
  const t = honoluluItemRows(session);
  const texts = session.messages.texts;
  const out: HonoluluItem[] = [];
  for (let row = 0; row < t.rows; row++) {
    if (!t.get(row, 'used')) continue;
    out.push({ row, name: texts.preview(t.get(row, 'name'), true) ?? '', category: t.get(row, 'category'), price: t.get(row, 'price'), sell: t.get(row, 'sell') });
  }
  return out;
}

/** The equipData / clothData row of an equipment / clothes (itemData +0x19), or null. */
export function itemSubRow(session: HonoluluSession, row: number): { rows: TableRows; row: number } | null {
  const t = honoluluItemRows(session);
  const file = { [EQUIP_CATEGORY]: 'equipData.bin', [CLOTH_CATEGORY]: 'clothData.bin' }[t.get(row, 'category')];
  if (!file) return null;
  const rows = session.master.rows(file);
  const sub = t.get(row, 'sub');
  return sub > 0 && sub < rows.rows ? { rows, row: sub } : null;
}

/** The message IDs of an item's texts, and the fields that share one (clothes: the name is the description). */
export function itemTextIds(session: HonoluluSession, row: number): { key: HonoluluItemText; label: string; id: number; same?: string }[] {
  const t = honoluluItemRows(session);
  const seen = new Map<number, string>();
  return HONOLULU_ITEM_TEXTS.map(([key, label]) => {
    const id = t.get(row, key);
    const same = id ? seen.get(id) : undefined;
    if (id && !same) seen.set(id, label);
    return { key, label, id, same };
  });
}

/** Whether an item's row, its texts or its equipData / clothData row was changed. */
export function itemChanged(session: HonoluluSession, row: number): boolean {
  const t = honoluluItemRows(session);
  if (t.changed(row)) return true;
  const texts = session.messages.texts;
  if (itemTextIds(session, row).some(({ id }) => id && texts.isEdited(id))) return true;
  const sub = itemSubRow(session, row);
  return !!sub && sub.rows.changed(sub.row);
}

/** Put the item's row, texts and equipData / clothData row back as they are in the archive. */
export function revertItem(session: HonoluluSession, row: number): void {
  const sub = itemSubRow(session, row);
  for (const { id } of itemTextIds(session, row)) if (id) session.messages.texts.revert(id);
  honoluluItemRows(session).revert(row);
  if (sub) sub.rows.revert(sub.row);
}

/** A shop stage that sells an item: the stage (shopItemGroup's row), its dungeon and whether the item is featured. */
export interface ItemStage {
  stage: number;
  dungeon: string;
  featured: boolean;
}

/** The shop stages of every item (item row -> stages), from shopItemGroup's ranges of shopItemData. */
export function itemStages(session: HonoluluSession): Map<number, ItemStage[]> {
  const groups = session.master.rows('shopItemGroup.bin');
  const stock = session.master.rows('shopItemData.bin');
  const context = session.master.context();
  const out = new Map<number, ItemStage[]>();
  for (let g = 0; g < groups.rows; g++) {
    const first = groups.get(g, 'first');
    const last = Math.min(groups.get(g, 'last'), stock.rows - 1);
    const dungeon = groups.get(g, 'dungeon');
    const name = dungeon ? context.rowName?.('dungeonData.bin', dungeon) ?? `ダンジョン ${dungeon}` : '最初';
    for (let r = first; r <= last; r++) {
      const item = stock.get(r, 'item');
      const list = out.get(item) ?? out.set(item, []).get(item)!;
      const featured = !!stock.get(r, 'featured');
      const have = list.find((s) => s.stage === g);
      if (have) have.featured ||= featured;
      else list.push({ stage: g, dungeon: name, featured });
    }
  }
  return out;
}

/** The clothes' textures (B50A5EA9), the archive read when the first one is asked for. */
export class HonoluluClothTextures {
  private archive: Promise<Archive> | null = null;
  private readonly cache = new Map<number, Promise<CgfxTexture | null>>();

  constructor(private readonly dump: Dump) {}

  /** The texture of a clothData row's entry (+0x00), or null when the archive has no such entry. */
  texture(hash: number): Promise<CgfxTexture | null> {
    let p = this.cache.get(hash);
    if (!p) {
      this.archive ??= this.dump.readRomfs(HONOLULU_CLOTH_ARCHIVE).then(parseArchive);
      p = this.archive.then((arc) => {
        const e = findEntry(arc, hash);
        return e ? parseCgfx(unpackEntry(arc, e).body).textures[0] ?? null : null;
      });
      this.cache.set(hash, p);
    }
    return p;
  }
}
