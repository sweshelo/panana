// Dungeon event objects: archive = mapGroup +0x0C, entry dXX_EventObject.bin (GS table, 0x50 bytes a row).
// Rows are referenced by section 3 (+0x0C), 4 (+0x00), 5 (+0x00) and 8 (+0x00). Fields used by the game:
//   +0x08 u32  treasureGroup row (chests)                        FUN_00305dc8
//   +0x44 u16  state slot (0xFFFF = the row number): the state (2 bits, e.g. chest opened) is saved in
//              save variable 0x8E at mapGroup +0x1A + slot; rows must be below mapGroup +0x1C (FUN_0031bff4)
//   +0x46 u16  model: mapObject row (section 3/4/5), or mapChara row (section 5 kind 0); 0 = default
//   +0x4B / +0x4C u8  appearance conditions (FUN_0030b8a4)
//   +0x4D u8   kind (0x0C = chest …)
import { parseArchive, rebuildArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { equalBytes, hex8, u16, u32, w16, w32 } from '../util/bytes';

export class EventTable {
  readonly table: GsTable;
  private readonly original: Uint8Array;
  /**
   * Rows nothing uses any more (game/eventslots.ts), lowest first. The map editor sets it, as only it knows the maps
   * that point at the rows; addRow takes rows out of the returned list (so several adds in one edit take different
   * rows), so the source hands out a fresh list after every edit.
   */
  freeRows: () => number[] = () => [];

  private constructor(
    readonly dungeon: number,
    /** Rows that can keep a state (mapGroup +0x1C). */
    public capacity: number,
    readonly archiveName: string,
    private readonly archive: Archive,
    private readonly entry: ArcEntry,
    data: Uint8Array,
  ) {
    this.original = data.slice();
    this.table = new GsTable(data.slice());
  }

  static fromArchive(dungeon: number, capacity: number, archiveName: string, bytes: Uint8Array): EventTable | null {
    const arc = parseArchive(bytes);
    for (const e of arc.entries) {
      if (e.comp !== 1) continue;
      const { name, body } = unpackEntry(arc, e);
      if (name && /_EventObject\.bin$/.test(name)) return new EventTable(dungeon, capacity, archiveName, arc, e, body);
    }
    return null;
  }

  get rows(): number {
    return this.table.rows;
  }
  has(row: number): boolean {
    return row >= 0 && row < this.table.rows;
  }
  treasureRow(row: number): number {
    return this.has(row) ? u32(this.table.row(row), 0x08) : 0;
  }
  setTreasureRow(row: number, v: number): void {
    if (this.has(row)) w32(this.table.row(row), 0x08, v);
  }
  flag(row: number): number {
    return this.has(row) ? u16(this.table.row(row), 0x44) : 0;
  }
  model(row: number): number {
    return this.has(row) ? u16(this.table.row(row), 0x46) : 0;
  }
  setModel(row: number, v: number): void {
    if (this.has(row)) w16(this.table.row(row), 0x46, v);
  }
  kind(row: number): number {
    return this.has(row) ? this.table.row(row)[0x4d]! : 0;
  }

  get data(): Uint8Array {
    return this.table.data;
  }
  restore(data: Uint8Array): void {
    this.table.data = data.slice();
  }

  /** State slot of a row (+0x44, or the row number when it is 0xFFFF). */
  slot(row: number): number {
    const v = this.flag(row);
    return v === 0xffff ? row : v;
  }

  /** State slots below the capacity that the rows in use do not hold (free rows give theirs back). */
  private freeSlots(free: readonly number[] = this.freeRows()): number[] {
    const skip = new Set(free);
    const used = new Set<number>();
    for (let i = 0; i < this.rows; i++) if (!skip.has(i)) used.add(this.slot(i));
    const out: number[] = [];
    for (let s = 0; s < this.capacity; s++) if (!used.has(s)) out.push(s);
    return out;
  }

  /** A slot below the capacity that no row in use holds, or -1. */
  freeSlot(): number {
    return this.freeSlots()[0] ?? -1;
  }

  /** Rows that can still be added: free rows to take again plus room to grow, as far as the state slots go. */
  roomLeft(): number {
    const free = this.freeRows();
    return Math.max(0, Math.min(this.capacity - this.rows + free.length, this.freeSlots(free).length));
  }

  /**
   * A row copied from `template` with its own state slot: a free row taken again, else a new row at the end.
   * Returns its number. Throws when the dungeon has no room (rows and slots are limited to mapGroup +0x1C).
   */
  addRow(template: Uint8Array): number {
    const free = this.freeRows();
    if (!free.length && this.rows >= this.capacity) throw new Error(`このダンジョンのイベント番号は ${this.capacity - 1} までです`);
    const slot = this.freeSlots(free)[0];
    if (slot === undefined) throw new Error('このダンジョンには空いている状態の枠がありません');
    const row = template.slice();
    w16(row, 0x44, slot);
    const reuse = free.shift();
    if (reuse === undefined) return this.table.append(row);
    this.table.row(reuse).set(row);
    return reuse;
  }

  /** Number of rows the table has in the game (rows from this one on were added). */
  get originalRows(): number {
    return new GsTable(this.original).rows;
  }

  /** Drop the rows from `n` on (only added ones: the table keeps at least the game's rows). */
  truncate(n: number): void {
    const t = this.table;
    n = Math.max(n, this.originalRows);
    if (n >= t.rows) return;
    if (t.indexOffset) {
      t.data = t.withRows(Array.from({ length: n }, (_, i) => t.row(i).slice()));
      return;
    }
    const end = t.offset + n * t.rowSize;
    const orig = new GsTable(this.original);
    // back to the game's row count: the game's bytes after the rows (padding) too, so an undone add leaves no trace
    const out = n === orig.rows && orig.offset === t.offset ? this.original.slice() : t.data.slice(0, end);
    out.set(t.data.subarray(0, end));
    w32(out, 0, n);
    w32(out, 0x14, n * t.rowSize);
    w32(out, 0x18, out.length);
    t.data = out;
  }
  changed(): boolean {
    return !equalBytes(this.table.data, this.original);
  }
  /** Back to the table as in the game. */
  revert(): void {
    this.table.data = this.original.slice();
  }
  /** A row as in the game (undefined for added rows). */
  originalRow(row: number): Uint8Array | undefined {
    const t = new GsTable(this.original);
    return row >= 0 && row < t.rows ? t.row(row) : undefined;
  }

  /** The event archive with this table re-packed (other entries copied verbatim). */
  buildArchive(): Uint8Array {
    return rebuildArchive(this.archive, new Map([[this.entry.index, this.table.data]]));
  }

  toString(): string {
    return `${this.archiveName} (${hex8(this.entry.hash)})`;
  }
}
