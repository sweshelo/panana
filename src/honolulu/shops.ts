// 電波人間のRPG (初代)'s shop (naauao honolulu/shops.md): the one shop of デンパ島 sells the stock of one of 12 stages,
// the rows of shopItemGroup. Each stage names a run of shopItemData rows (+0x00 first, +0x02 last, inclusive), the
// stage before it (+0x08 / +0x0A, its first and last) and when it starts: the last stage whose dungeon (+0x04,
// dungeonData's row) has reached the progress +0x06 is the shop's stock (none: stage 0). A stage's list is the whole
// stock at that point (the items of the earlier stages are listed again). The 12 stages are fixed in the code.
//
// A stock is edited by laying the stages' runs out again in their order: shopItemData gets as many rows as the stages
// have items, and every stage's +0x00 / +0x02 / +0x08 / +0x0A are pointed at the new places (stage 0's "before" is
// itself, as in the ROM). The other fields of the rows are kept.
import { equalBytes, u16, w16 } from '../util/bytes';
import type { HonoluluMaster } from './master';

export const HONOLULU_SHOP_ITEMS = 'shopItemData.bin';
export const HONOLULU_SHOP_GROUPS = 'shopItemGroup.bin';
/** The number of stages the code reads (`cmp r4, #0xc`). */
export const HONOLULU_SHOP_STAGES = 12;
/** shopItemData +0x02 bit 0: the 目玉 item (when the stage starts with one, flag 0x27 is set for the clerk's greeting). */
export const HONOLULU_FEATURED_BIT = 1;

/**
 * The lists the shop's code (FUN_00230074) fills, 12 bytes an entry, one after another in the shop's object: the whole
 * stock (+0x64), the featured items (+0xE5C), the equipment (分類 3, +0x10B4) and the clothes (分類 4, +0x17B0) up to
 * the stage number at +0x1FB0, and the stage before on the stack (0xDF8 bytes). A stage with more overruns them.
 */
export const HONOLULU_SHOP_LIMITS = { all: 298, featured: 50, equip: 149, cloth: 170 } as const;

/** What a stage's stock would overrun (`category`: itemData +0x1A of an item). */
export function honoluluShopProblems(stock: HonoluluShopRow[], category: (item: number) => number | undefined): string[] {
  const L = HONOLULU_SHOP_LIMITS;
  const out: string[] = [];
  const count = (f: (r: HonoluluShopRow) => boolean): number => stock.filter(f).length;
  if (stock.length > L.all) out.push(`品数が ${L.all} を超えています (店の一覧の大きさ)。`);
  if (count((r) => r.featured) > L.featured) out.push(`目玉の品が ${L.featured} を超えています。`);
  if (count((r) => category(r.item) === 3) > L.equip) out.push(`装備が ${L.equip} を超えています。`);
  if (count((r) => category(r.item) === 4) > L.cloth) out.push(`ふくが ${L.cloth} を超えています。`);
  return out;
}

const FIRST = 0x00;
const LAST = 0x02;
const DUNGEON = 0x04;
const PROGRESS = 0x06;
const PREV_FIRST = 0x08;
const PREV_LAST = 0x0a;

/** A row of a stage's stock: the item, whether it is featured, and the row's bytes (the rest kept). */
export interface HonoluluShopRow {
  item: number;
  featured: boolean;
  bytes: Uint8Array;
}

/** A stage's condition: the dungeon (0 = the first stage) and the progress value. */
export interface HonoluluShopCondition {
  dungeon: number;
  progress: number;
}

/** What is saved of the shop: the stocks of the stages, as they are now. */
export type HonoluluSavedShop = [stage: number, rows: Uint8Array[]][];

/** A new row of `item`: as the ROM's (0xA0 in +0x02 besides the bit, 0xD0 padding). */
export function honoluluShopRowBytes(item: number, featured = false, template?: Uint8Array): Uint8Array {
  const b = template?.slice() ?? Uint8Array.of(0, 0, 0xa0, 0xd0);
  w16(b, 0, item);
  b[2] = (b[2]! & ~HONOLULU_FEATURED_BIT) | (featured ? HONOLULU_FEATURED_BIT : 0);
  return b;
}

const rowOf = (bytes: Uint8Array): HonoluluShopRow => ({ item: u16(bytes, 0), featured: !!(bytes[2]! & HONOLULU_FEATURED_BIT), bytes });

export class HonoluluShop {
  constructor(readonly master: HonoluluMaster) {}

  private get items() {
    return this.master.table(HONOLULU_SHOP_ITEMS);
  }

  private get groups() {
    return this.master.table(HONOLULU_SHOP_GROUPS);
  }

  /** The stages the table has (12 in the ROM; the code reads no more). */
  get stages(): number {
    return Math.min(this.groups.rows, HONOLULU_SHOP_STAGES);
  }

  /** The range a stage names now / as read: [first, last] (last < first: none). */
  range(stage: number, original = false): [number, number] {
    const g = original ? this.master.originalRow(HONOLULU_SHOP_GROUPS, stage) : this.groups.row(stage);
    return [u16(g, FIRST), u16(g, LAST)];
  }

  private stockOf(stage: number, original: boolean): HonoluluShopRow[] {
    const [first, last] = this.range(stage, original);
    const count = original ? this.master.originalRows(HONOLULU_SHOP_ITEMS) : this.items.rows;
    const out: HonoluluShopRow[] = [];
    if (last < first) return out;
    for (let i = first; i <= last && i < count; i++) out.push(rowOf((original ? this.master.originalRow(HONOLULU_SHOP_ITEMS, i) : this.items.row(i)).slice()));
    return out;
  }

  /** A stage's stock as it is now. */
  rows(stage: number): HonoluluShopRow[] {
    return this.stockOf(stage, false);
  }

  /** A stage's stock as the ROM has it. */
  originalRows(stage: number): HonoluluShopRow[] {
    return this.stockOf(stage, true);
  }

  /**
   * Whether the clerk marks a row as new: its item is not in the stage before (stage 0: itself, so never). The code
   * keeps this in the list (+0x0A of the entry).
   */
  isNew(stage: number, item: number): boolean {
    return !this.rows(Math.max(0, stage - 1)).some((r) => r.item === item);
  }

  /** Writes a stage's stock and lays every stage out again (see the top of the file). */
  set(stage: number, stock: HonoluluShopRow[]): void {
    const stocks = Array.from({ length: this.stages }, (_, i) => (i === stage ? stock : this.rows(i)));
    this.layOut(stocks);
  }

  private layOut(stocks: HonoluluShopRow[][]): void {
    const items = this.items;
    const rows: Uint8Array[] = [];
    const ranges: [number, number][] = [];
    for (const s of stocks) {
      const first = rows.length;
      for (const r of s) rows.push(honoluluShopRowBytes(r.item, r.featured, r.bytes));
      // an empty stage: last = first - 1 (the code skips it: `cmp first, last; bgt`); at row 0, [1, 0] (0xFFFF would list 65536 rows)
      ranges.push(s.length || first ? [first, rows.length - 1] : [1, 0]);
    }
    // rows the ROM's stages do not cover (none in the ROM) are kept after them
    for (let i = this.originalCoverage(); i < this.master.originalRows(HONOLULU_SHOP_ITEMS); i++) rows.push(this.master.originalRow(HONOLULU_SHOP_ITEMS, i).slice());
    const same = rows.length === items.rows && rows.every((b, i) => equalBytes(b, items.row(i)));
    if (!same) items.data = items.withRows(rows);
    ranges.forEach(([first, last], i) => {
      const g = this.groups.row(i);
      const [pf, pl] = ranges[Math.max(0, i - 1)]!;
      w16(g, FIRST, first);
      w16(g, LAST, last);
      w16(g, PREV_FIRST, pf);
      w16(g, PREV_LAST, pl);
    });
  }

  /** The rows the ROM's stages cover (one past the last stage's last row). */
  private originalCoverage(): number {
    let end = 0;
    for (let i = 0; i < this.stages; i++) {
      const [first, last] = this.range(i, true);
      if (last >= first) end = Math.max(end, last + 1);
    }
    return end;
  }

  condition(stage: number, original = false): HonoluluShopCondition {
    const g = original ? this.master.originalRow(HONOLULU_SHOP_GROUPS, stage) : this.groups.row(stage);
    return { dungeon: u16(g, DUNGEON), progress: u16(g, PROGRESS) };
  }

  setCondition(stage: number, c: HonoluluShopCondition): void {
    const g = this.groups.row(stage);
    w16(g, DUNGEON, c.dungeon);
    w16(g, PROGRESS, c.progress);
  }

  /** Whether a stage's stock or condition differs from the ROM's. */
  changed(stage: number): boolean {
    const a = this.rows(stage);
    const b = this.originalRows(stage);
    const c = this.condition(stage);
    const d = this.condition(stage, true);
    return a.length !== b.length || a.some((r, i) => !equalBytes(r.bytes, b[i]!.bytes)) || c.dungeon !== d.dungeon || c.progress !== d.progress;
  }

  /** The stages whose stock or condition were changed. */
  changedStages(): number[] {
    return Array.from({ length: this.stages }, (_, i) => i).filter((i) => this.changed(i));
  }

  /** The most items a stage had in the ROM. */
  get originalMax(): number {
    return Math.max(0, ...Array.from({ length: this.stages }, (_, i) => this.originalRows(i).length));
  }

  /** The stage the shop sells at a progress: the last stage whose condition holds (dungeon → its progress value). */
  stageAt(progress: (dungeon: number) => number): number {
    let at = 0;
    for (let i = 0; i < this.stages; i++) {
      const c = this.condition(i);
      if (progress(c.dungeon) === c.progress) at = i;
    }
    return at;
  }

  /** The stocks, for saving (only when a stock differs from the ROM's; the conditions are rows of the master). */
  saved(): HonoluluSavedShop {
    const stocks = Array.from({ length: this.stages }, (_, i) => i);
    const edited = stocks.some((i) => {
      const a = this.rows(i);
      const b = this.originalRows(i);
      return a.length !== b.length || a.some((r, j) => !equalBytes(r.bytes, b[j]!.bytes));
    });
    return edited ? stocks.map((i) => [i, this.rows(i).map((r) => r.bytes.slice())]) : [];
  }

  /** Puts saved stocks back (after the master's rows). */
  restore(saved: HonoluluSavedShop): void {
    if (!saved.length) return;
    const stocks = Array.from({ length: this.stages }, (_, i) => this.originalRows(i));
    for (const [stage, rows] of saved) if (stage < stocks.length) stocks[stage] = rows.filter((b) => b.length === 4).map((b) => rowOf(b.slice()));
    this.layOut(stocks);
  }

  /** Every stage back to the ROM's stock (the conditions too). */
  revert(): void {
    this.layOut(Array.from({ length: this.stages }, (_, i) => this.originalRows(i)));
    for (let i = 0; i < this.stages; i++) this.groups.row(i).set(this.master.originalRow(HONOLULU_SHOP_GROUPS, i));
  }
}
