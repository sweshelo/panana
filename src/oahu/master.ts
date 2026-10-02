// The GS tables of 電波人間のRPG3's master archive 21350000 (naauao oahu/analysis.md §4.3): editable copies of the
// tables the books change, their rows as they are in the archive, and the changed entries for the export.
import { findByName, parseArchive, type Archive } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import type { Dump } from '../rom/dump';
import { OAHU } from '../rom/titles';
import { equalBytes } from '../util/bytes';

export const OAHU_MASTER = OAHU.master;

interface Loaded {
  entryIndex: number;
  table: GsTable;
  original: Uint8Array;
}

/** A row edit kept across loads: the row as it was and as it is (only the bytes that differ are put back). */
export type SavedRow = [table: string, row: number, before: Uint8Array, after: Uint8Array];

export class OahuMaster {
  private readonly tables = new Map<string, Loaded>();

  private constructor(readonly archive: Archive) {}

  static async load(dump: Dump): Promise<OahuMaster> {
    return new OahuMaster(parseArchive(await dump.readRomfs(OAHU_MASTER)));
  }

  /** A table of the archive, by file name (edits to it are exported). */
  table(name: string): GsTable {
    const have = this.tables.get(name);
    if (have) return have.table;
    const found = findByName(this.archive, name);
    if (!found) throw new Error(`${OAHU_MASTER} に ${name} がありません`);
    const loaded = { entryIndex: found.entry.index, table: new GsTable(found.body.slice()), original: found.body };
    this.tables.set(name, loaded);
    return loaded.table;
  }

  originalRow(name: string, row: number): Uint8Array {
    this.table(name);
    const t = new GsTable(this.tables.get(name)!.original);
    return row < t.rows ? t.row(row) : new Uint8Array(t.rowSize);
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
      if (r >= t.rows || after.length !== t.rowSize) continue;
      const row = t.row(r);
      for (let i = 0; i < row.length; i++) if (after[i] !== before[i]) row[i] = after[i]!;
    }
  }
}
