// One opened 電波人間のRPG FREE! (lanai) dump (read only): the tables of the master (2135000A) and of the language
// archives (xxxx000A: UI text, codes; naauao lanai/analysis.md §1.1), the strings they hold, and the other root archives
// (the contents, the models) read when first asked for.
import { entryBlob, parseArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import type { Dump } from '../rom/dump';
import { LANAI } from '../rom/titles';
import { hex8 } from '../util/bytes';
import { lanaiPlain, lanaiText, parseLanaiMessage, type LanaiToken } from './message';
import { LanaiTable } from './table';

/** A table of a root archive. */
export interface LanaiTableRef {
  archive: string;
  /** Hash of its entry. */
  entry: number;
  /** File name in the entry's ZIP (null for the LZ entries, e.g. the master's message tables). */
  file: string | null;
  table: LanaiTable;
}

/** A string field of a row. */
export interface LanaiString {
  tokens: LanaiToken[];
  /** The text form (lanaiText). */
  text: string;
}

/** Whether an entry can hold a GS table (not a model, effect, layout or CRO). */
function mayBeTable(arc: Archive, e: ArcEntry): boolean {
  if (![1, 3, 11, 12].includes(e.type) || !e.raw) return false;
  if (e.comp !== 1) return true;
  const name = zipEntryName(entryBlob(arc, e));
  return !name || name.endsWith('.bin') || !name.includes('.');
}

/** The GS tables of an archive. */
export function archiveTables(name: string, arc: Archive): LanaiTableRef[] {
  const out: LanaiTableRef[] = [];
  for (const e of arc.entries) {
    if (!mayBeTable(arc, e)) continue;
    let u: { name: string | null; body: Uint8Array };
    try {
      u = unpackEntry(arc, e);
    } catch {
      continue;
    }
    if (LanaiTable.is(u.body)) out.push({ archive: name, entry: e.hash, file: u.name, table: new LanaiTable(u.body) });
  }
  return out;
}

export class LanaiSession {
  private readonly archives = new Map<string, Promise<Archive>>();
  private readonly tablesOf = new Map<string, Promise<LanaiTableRef[]>>();
  /** The master's tables by name (the first of a name). */
  private readonly byName = new Map<string, LanaiTable>();

  private constructor(
    readonly dump: Dump,
    /** Tables of the master and the language archives. */
    readonly tables: LanaiTableRef[],
  ) {
    for (const t of tables) if (!this.byName.has(t.table.name)) this.byName.set(t.table.name, t.table);
  }

  static async open(dump: Dump): Promise<LanaiSession> {
    if (dump.title !== LANAI) throw new Error(`『${LANAI.name}』のダンプではありません`);
    const names = dump.names().filter((n) => /^[0-9A-F]{4}000A$/i.test(n)).sort((a, b) => (a === LANAI.master ? -1 : b === LANAI.master ? 1 : a.localeCompare(b)));
    if (!names.includes(LANAI.master)) throw new Error(`RomFS に master (${LANAI.master}) がありません`);
    const tables: LanaiTableRef[] = [];
    for (const n of names) tables.push(...archiveTables(n, parseArchive(await dump.readRomfs(n))));
    return new LanaiSession(dump, tables);
  }

  /** A table of the master (or a language archive) by its name ("MonsterParameter"). */
  table(name: string): LanaiTable | undefined {
    return this.byName.get(name);
  }

  /** A table that must be there. */
  need(name: string): LanaiTable {
    const t = this.table(name);
    if (!t) throw new Error(`表 ${name} がありません`);
    return t;
  }

  /** A root archive (read once). */
  archive(name: string): Promise<Archive> {
    const key = name.toUpperCase();
    let p = this.archives.get(key);
    if (!p) {
      p = this.dump.readRomfs(key).then(parseArchive);
      p.catch(() => this.archives.delete(key));
      this.archives.set(key, p);
    }
    return p;
  }

  /** The GS tables of a root archive (read once). */
  tablesIn(name: string): Promise<LanaiTableRef[]> {
    const key = name.toUpperCase();
    let p = this.tablesOf.get(key);
    if (!p) {
      const known = this.tables.filter((t) => t.archive === key);
      p = known.length ? Promise.resolve(known) : this.archive(key).then((a) => archiveTables(key, a));
      this.tablesOf.set(key, p);
    }
    return p;
  }

  /** The string at a file offset of a table. */
  stringAt(t: LanaiTable, offset: number): LanaiString {
    const tokens = parseLanaiMessage(t.data, offset).tokens;
    return { tokens, text: lanaiText(tokens) };
  }

  /** The string field at `offset` of row `row` (undefined when it is not a string). */
  field(t: LanaiTable, row: number, offset: number): LanaiString | undefined {
    const o = t.stringOffset(row, offset);
    return o < 0 ? undefined : this.stringAt(t, o);
  }

  /** The string field `name` of row `row`, as a reader sees it (inserted strings put in). */
  plain(t: LanaiTable, row: number, name: string): string {
    const o = t.named(row, name);
    return o < 0 ? '' : this.plainAt(t, o);
  }

  plainAt(t: LanaiTable, offset: number, depth = 0): string {
    return lanaiPlain(parseLanaiMessage(t.data, offset).tokens, (ins) => (depth < 2 ? this.insert(ins.table, ins.id, ins.field, depth + 1) : undefined));
  }

  /** The string an insertion tag names (table of the master, row ID, field), as plain text; undefined when not found. */
  insert(table: string, id: number, field: string, depth = 0): string | undefined {
    const t = this.table(table);
    const r = t?.find(id) ?? -1;
    if (!t || r < 0) return undefined;
    const o = t.named(r, field);
    return o < 0 ? undefined : this.plainAt(t, o, depth);
  }

  /** "表 行 ID" for the UI. */
  static rowLabel(t: LanaiTable, row: number): string {
    return `${t.name} ${hex8(t.rowId(row))}`;
  }
}
