// Dungeon event objects: archive = mapGroup +0x0C, entry dXX_EventObject.bin (GS table, 0x50 bytes a row).
// Rows are referenced by section 3 (+0x0C), 4 (+0x00), 5 (+0x00) and 8 (+0x00). Fields used by the game:
//   +0x08 u32  treasureGroup row (chests)                        FUN_00305dc8
//   +0x44 u16  flag number (e.g. "opened")
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
    readonly archiveName: string,
    private readonly archive: Archive,
    private readonly entry: ArcEntry,
    data: Uint8Array,
  ) {
    this.original = data.slice();
    this.table = new GsTable(data.slice());
  }

  static fromArchive(dungeon: number, archiveName: string, bytes: Uint8Array): EventTable | null {
    const arc = parseArchive(bytes);
    for (const e of arc.entries) {
      if (e.comp !== 1) continue;
      const { name, body } = unpackEntry(arc, e);
      if (name && /_EventObject\.bin$/.test(name)) return new EventTable(dungeon, archiveName, arc, e, body);
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
    this.table.data.set(data);
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
