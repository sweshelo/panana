// The GS tables of 電波人間のRPG (初代)'s master archive 56562135 (naauao honolulu/analysis.md §3), kept in MasterTables
// like RPG3's: the pages read and edit rows through rows() and the definitions of tables.ts, and the export puts the
// changed tables back (an unedited master comes out as it was). The name of the archive is the same as RPG2's.
import { parseArchive, rebuildArchive, unpackEntry } from '../archive/gsarc';
import { GmsgFile } from '../game/master';
import { MasterTables } from '../game/mastertables';
import { rowDef, readField, type FieldContext, type TableDef } from '../game/tabledef';
import { TableRows } from '../game/tablerows';
import type { Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';
import { HONOLULU_TABLES } from './tables';

export const HONOLULU_MASTER = HONOLULU.master;

/** The tables whose rows a `row` field names by their name field. */
const NAMED: Record<string, string> = { 'itemData.bin': 'name', 'dungeonData.bin': 'name', 'skillData.bin': 'name' };

export class HonoluluMaster extends MasterTables {
  private readonly messages: GmsgFile[] = [];
  private readonly loaded = new Map<string, TableRows>();

  constructor(bytes: Uint8Array) {
    super(parseArchive(bytes), HONOLULU_MASTER);
    for (const e of this.archive.entries) {
      const { name, body } = unpackEntry(this.archive, e);
      // the _IN files hold the readings in another encoding (analysis.md §6)
      if (String.fromCharCode(...body.subarray(0, 4)) === 'GMSG' && !name?.includes('_IN')) this.messages.push(new GmsgFile(body));
    }
  }

  static async load(dump: Dump): Promise<HonoluluMaster> {
    return new HonoluluMaster(await dump.readRomfs(HONOLULU_MASTER));
  }

  /** The text of a message of the master's message files (MessageSystemCommon …). */
  message(id: number): string | undefined {
    for (const m of this.messages) {
      const t = m.text(id);
      if (t !== undefined) return t;
    }
    return undefined;
  }

  /** The definition of a table of the master: its fields and raw fields over the rest (tables.ts, tabledef.rowDef). */
  def(file: string): TableDef {
    return rowDef(HONOLULU_TABLES, file, this.table(file).rowSize);
  }

  /** A table of the master read through its definition (one per file: edits go to the same rows). */
  rows(file: string): TableRows {
    let r = this.loaded.get(file);
    if (!r) this.loaded.set(file, (r = new TableRows(this, this.def(file))));
    return r;
  }

  /** What the field views need to show messages and the names of rows. */
  context(): FieldContext {
    return {
      message: (id) => this.message(id),
      rowName: (table, row) => {
        const key = NAMED[table];
        if (!key) return undefined;
        const rows = this.rows(table);
        return row < rows.rows ? this.message(readField(rows.row(row), rows.field(key))) : undefined;
      },
    };
  }

  /** The archive with the edited tables put back. */
  export(): Uint8Array {
    return rebuildArchive(this.archive, this.changedEntries());
  }
}
