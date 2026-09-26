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

  private constructor(
    readonly dungeon: number,
    /** Rows that can keep a state (mapGroup +0x1C). */
    readonly capacity: number,
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

  /** A slot below the capacity that no row uses, or -1. */
  freeSlot(): number {
    const used = new Set<number>();
    for (let i = 0; i < this.rows; i++) used.add(this.slot(i));
    for (let s = 0; s < this.capacity; s++) if (!used.has(s)) return s;
    return -1;
  }

  /** Rows that can still be added (0 when the dungeon has no room). */
  roomLeft(): number {
    if (this.freeSlot() < 0) return 0;
    return Math.max(0, this.capacity - this.rows);
  }

  /**
   * Append a row copied from `template` with its own state slot. Throws when the dungeon has no room
   * (rows and slots are limited to mapGroup +0x1C).
   */
  addRow(template: Uint8Array): number {
    if (this.rows >= this.capacity) throw new Error(`このダンジョンのイベントの行は ${this.capacity} 行までです`);
    const slot = this.freeSlot();
    if (slot < 0) throw new Error('このダンジョンには空いている状態の枠がありません');
    const row = template.slice();
    w16(row, 0x44, slot);
    return this.table.append(row);
  }
  changed(): boolean {
    return !equalBytes(this.table.data, this.original);
  }

  /** The event archive with this table re-packed (other entries copied verbatim). */
  buildArchive(): Uint8Array {
    return rebuildArchive(this.archive, new Map([[this.entry.index, this.table.data]]));
  }

  toString(): string {
    return `${this.archiveName} (${hex8(this.entry.hash)})`;
  }
}
