// One GS table of RPG3's master edited through its field definitions (tables.ts): read and write a field of a row,
// the value in the archive, and whether a row was changed. The monster, group and action books use it.
import type { GsTable } from '../archive/gstable';
import { field, readField, writeField, type FieldDef, type TableDef } from '../game/tabledef';
import { equalBytes } from '../util/bytes';
import type { OahuMaster } from './master';

export class OahuRows {
  readonly table: GsTable;

  constructor(
    private readonly master: OahuMaster,
    readonly def: TableDef,
  ) {
    this.table = master.table(def.file);
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
    return this.master.originalRow(this.def.file, row);
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

  revert(row: number): void {
    this.row(row).set(this.originalRow(row));
  }
}
