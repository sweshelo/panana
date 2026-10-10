// One GS table of RPG FREE! read through its field definitions (tables.ts), shaped like RPG3's OahuRows: a field of a
// row, the value in the archive, and whether a row was changed. The rows are the session's table (an edit writes into
// them); nothing is saved or exported yet.
import { field, fieldRange, readField, writeField, type FieldContext, type FieldDef, type TableDef } from '../game/tabledef';
import { equalBytes, u32 } from '../util/bytes';
import type { FieldAccess } from '../ui/FieldEdit';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

export class LanaiRows {
  /** The rows as read from the archive. */
  private readonly archive: Uint8Array;

  constructor(
    readonly table: LanaiTable,
    readonly def: TableDef,
  ) {
    if (table.rowSize !== def.rowSize) throw new Error(`${def.file}: 行の大きさが ${table.rowSize} です (定義は ${def.rowSize})`);
    this.archive = table.data.slice();
  }

  get rows(): number {
    return this.table.rows;
  }

  field(key: string): FieldDef {
    return field(this.def, key);
  }

  row(row: number): Uint8Array {
    return this.table.row(row);
  }

  originalRow(row: number): Uint8Array {
    const o = this.table.dataOffset + row * this.table.rowSize;
    return this.archive.subarray(o, o + this.table.rowSize);
  }

  get(row: number, key: string): number {
    return readField(this.row(row), this.field(key));
  }

  original(row: number, key: string): number {
    return readField(this.originalRow(row), this.field(key));
  }

  set(row: number, key: string, v: number): void {
    writeField(this.row(row), this.field(key), v);
  }

  changed(row: number): boolean {
    return !equalBytes(this.row(row), this.originalRow(row));
  }

  /** The fields of a row for the shared inputs (ui/FieldEdit). */
  access(row: number): FieldAccess {
    return { get: (k) => this.get(row, k), original: (k) => this.original(row, k), set: (k, v) => this.set(row, k, v), range: (k) => fieldRange(this.field(k)) };
  }

  /**
   * Names of the values for ui/RowFields: the strings of this table (a string field holds the file offset of its
   * string in the pool), the rows of the master's other tables by row ID, and the files of resource hashes.
   */
  context(session: LanaiSession, more: FieldContext = {}): FieldContext {
    const t = this.table;
    const poolEnd = 0x40 + u32(t.data, 0x0c);
    return {
      message: (v) => (v >= 0x40 && v < poolEnd ? session.plainAt(t, v) : undefined),
      rowName: (table, v) => {
        const other = session.table(table);
        const r = other?.find(v) ?? -1;
        return r < 0 ? undefined : `行 ${r}`;
      },
      ...more,
    };
  }
}
