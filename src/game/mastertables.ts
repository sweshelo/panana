// The GS tables of a master archive, edited in place: editable copies of the tables the books change, their rows as
// they are in the archive, and the changed entries for the export (rebuildArchive). RPG3 (oahu/master.ts) and 初代
// (honolulu/master.ts) keep their masters in it; TableRows reads one of its tables through the field definitions.
import { findByName, type Archive } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { equalBytes } from '../util/bytes';

interface Loaded {
  entryIndex: number;
  table: GsTable;
  original: Uint8Array;
}

/** A row edit kept across loads: the row as it was and as it is (only the bytes that differ are put back). */
export type SavedRow = [table: string, row: number, before: Uint8Array, after: Uint8Array];

export class MasterTables {
  private readonly tables = new Map<string, Loaded>();

  /** `name`: the root file of the archive (for messages). */
  constructor(
    readonly archive: Archive,
    readonly name: string,
  ) {}

  /** A table of the archive, by file name (edits to it are exported). */
  table(name: string): GsTable {
    const have = this.tables.get(name);
    if (have) return have.table;
    const found = findByName(this.archive, name);
    if (!found) throw new Error(`${this.name} に ${name} がありません`);
    const loaded = { entryIndex: found.entry.index, table: new GsTable(found.body.slice()), original: found.body };
    this.tables.set(name, loaded);
    return loaded.table;
  }

  originalRow(name: string, row: number): Uint8Array {
    this.table(name);
    const t = new GsTable(this.tables.get(name)!.original);
    return row < t.rows ? t.row(row) : new Uint8Array(t.rowSize);
  }

  /** Rows in the archive (rows from here on were added by edits). */
  originalRows(name: string): number {
    this.table(name);
    return new GsTable(this.tables.get(name)!.original).rows;
  }

  /** Append a row to a table; returns its index. The game takes the number of rows from the table's header. */
  addRow(name: string, row: Uint8Array): number {
    const t = this.table(name);
    t.data = t.withRows([...Array.from({ length: t.rows }, (_, i) => t.row(i).slice()), row.slice()]);
    return t.rows - 1;
  }

  /** Drop the last row of a table when an edit added it. */
  removeLastRow(name: string): void {
    const t = this.table(name);
    if (t.rows <= this.originalRows(name)) throw new Error(`${name} の元の行は消せません`);
    t.data = t.withRows(Array.from({ length: t.rows - 1 }, (_, i) => t.row(i).slice()));
  }

  /** Changed tables: archive entry index -> bytes. */
  changedEntries(): Map<number, Uint8Array> {
    const out = new Map<number, Uint8Array>();
    for (const t of this.tables.values()) if (!equalBytes(t.table.data, t.original)) out.set(t.entryIndex, t.table.data);
    return out;
  }

  /** The changed rows, for saving. */
  saved(): SavedRow[] {
    const out: SavedRow[] = [];
    for (const [name, t] of this.tables) {
      for (let r = 0; r < t.table.rows; r++) {
        const before = this.originalRow(name, r);
        if (!equalBytes(before, t.table.row(r))) out.push([name, r, before.slice(), t.table.row(r).slice()]);
      }
    }
    return out;
  }

  /**
   * Put saved rows back. Only the bytes the edit changed are written, so a row the Update changed elsewhere keeps the
   * Update's bytes.
   */
  restore(saved: SavedRow[]): void {
    for (const [name, r, before, after] of saved) {
      let t: GsTable;
      try {
        t = this.table(name);
      } catch {
        continue;
      }
      if (after.length !== t.rowSize) continue;
      // A row added by an edit (addRow): grow the table up to it (rows saved in order, zeros between).
      if (r >= t.rows) t.data = t.withRows([...Array.from({ length: t.rows }, (_, i) => t.row(i).slice()), ...Array.from({ length: r + 1 - t.rows }, () => new Uint8Array(t.rowSize))]);
      const row = t.row(r);
      for (let i = 0; i < row.length; i++) if (after[i] !== before[i]) row[i] = after[i]!;
    }
  }
}
