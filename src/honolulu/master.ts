// The GS tables of 電波人間のRPG (初代)'s master archive 56562135 (naauao honolulu/analysis.md §3), kept in MasterTables
// like RPG3's: the pages read and edit rows through rows() and the definitions of tables.ts, and the export puts the
// changed tables back (an unedited master comes out as it was). The name of the archive is the same as RPG2's.
import { parseArchive, rebuildArchive, unpackEntry } from '../archive/gsarc';
import { Gmsg, MessageStore, type MessageFile } from '../game/gmsg';
import { MasterTables } from '../game/mastertables';
import { HONOLULU_SYNTAX } from '../game/msgtext';
import { rowDef, readField, type FieldContext, type TableDef } from '../game/tabledef';
import { TableRows } from '../game/tablerows';
import type { Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';
import { HONOLULU_TABLES } from './tables';

export const HONOLULU_MASTER = HONOLULU.master;

/** The tables whose rows a `row` field names by their name field. */
const NAMED: Record<string, string> = { 'itemData.bin': 'name', 'dungeonData.bin': 'name', 'skillData.bin': 'name' };

export class HonoluluMaster extends MasterTables {
  private readonly loaded = new Map<string, TableRows>();
  /** The messages the names come from: the session's (every archive's, with the edits), or the master's own. */
  private readonly texts: MessageStore;

  /** Names of rows of the tables another archive holds (the session's: the monsters, whose names are in 2713402F). */
  names?: (table: string, row: number) => string | undefined;

  /** `name`: the root archive; the master, or another archive of GS tables (2713402F, HONOLULU_MONSTER_ARCHIVE). */
  constructor(bytes: Uint8Array, texts?: MessageStore, name = HONOLULU_MASTER) {
    super(parseArchive(bytes), name);
    this.texts = texts ?? new MessageStore(this.archive.entries.flatMap((e): MessageFile[] => {
      const { name, body } = unpackEntry(this.archive, e);
      if (String.fromCharCode(...body.subarray(0, 4)) !== 'GMSG') return [];
      return [{ name: name ?? `エントリ ${e.index}`, entryIndex: e.index, gmsg: new Gmsg(body), editable: false }];
    }), HONOLULU_SYNTAX, false);
  }

  static async load(dump: Dump, texts?: MessageStore, name = HONOLULU_MASTER): Promise<HonoluluMaster> {
    return new HonoluluMaster(await dump.readRomfs(name), texts, name);
  }

  /** A message on one line, as a reader sees it (ruby as the base, names as 〈…〉): names of rows, field views. */
  message(id: number): string | undefined {
    return this.texts.preview(id, true);
  }

  /** The definition of a table of the archive: its fields and raw fields over the rest (tables.ts, tabledef.rowDef). */
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
        if (!key) return this.names?.(table, row);
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
