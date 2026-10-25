// One opened 電波人間のRPG FREE! (lanai) dump: the tables of the master (2135000A) and of the language archives
// (xxxx000A: UI text, codes; naauao lanai/analysis.md §1.1), the strings they hold, and the other root archives (the
// contents, the models) read when first asked for. The numbers of the tables' rows and their strings can be edited
// (table.ts; the pool is laid out again for a written string): the edits are saved to IndexedDB like RPG3's (oahu/session.ts) and put back when the dump is opened again
// (with or without the Update), and the archives holding changed tables are rebuilt into a LayeredFS MOD (the Update's
// archives under them, so it needs the Update like RPG3's).
import { entryBlob, findEntry, parseArchive, rebuildArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { buildModZip } from '../export/pack';
import { PortStore } from '../port/store';
import { dropCapPatch, dropCapProblem } from '../game/dropcap';
import { MapDb } from '../game/mapdb';
import { buildPatches, patchRecords } from '../game/patch';
import { buildIps } from '../rom/ips';
import type { Dump } from '../rom/dump';
import { LANAI } from '../rom/titles';
import { equalBytes, hex8, u32 } from '../util/bytes';
import { idbGet, idbSet } from '../util/idb';
import type { SoundNames } from '../game/sound';
import type { SoundRenderer } from '../sound/render';
import { loadSoundNames, openSoundRenderer } from '../sound/source';
import { LANAI_LAYOUT, lanaiCode } from './code';
import { LANAI_MAPDB_ENTRY } from './maps';
import { encodeLanaiMessage, lanaiPlain, lanaiText, parseLanaiMessage, parseLanaiText, type LanaiToken } from './message';
import { LanaiRows } from './rows';
import { LANAI_TABLES } from './tables';
import { LanaiTable } from './table';

/** A table of a root archive. */
export interface LanaiTableRef {
  archive: string;
  /** Hash of its entry. */
  entry: number;
  /** Index of its entry in the archive. */
  index: number;
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
    if (LanaiTable.is(u.body)) out.push({ archive: name, entry: e.hash, index: e.index, file: u.name, table: new LanaiTable(u.body) });
  }
  return out;
}

/** IndexedDB key of the edits (apart from RPG3's oahu/edits/v1). */
export const LANAI_EDITS_KEY = 'lanai/edits/v1';

/**
 * A row edit kept across loads: the table (tableKey), the row, the row as it was (null for a row an edit added) and as
 * it is. Only the bytes that differ are put back, so a row the Update changed elsewhere keeps the Update's bytes.
 */
export type LanaiSavedRow = [table: string, row: number, before: Uint8Array | null, after: Uint8Array];

/** A section of a content's map database kept across loads: the content's root archive, the section hash, its bytes. */
export type LanaiSavedSection = [archive: string, hash: number, bytes: Uint8Array];

/** A written string kept across loads: the table (tableKey), the row, the offset of the field, the string's bytes. */
export type LanaiSavedString = [table: string, row: number, offset: number, bytes: Uint8Array];

export interface LanaiSaved {
  rows: LanaiSavedRow[];
  /** Written strings (absent in edits saved before strings could be written, and when none were). */
  strings?: LanaiSavedString[];
  /** Edited map sections (absent in edits saved before the map editor). */
  maps?: LanaiSavedSection[];
  /** Panana's code MOD "ドロップ率の天井を撤廃" is on (game/dropcap.ts). */
  dropCap?: boolean;
}

/** The map database of a content's root archive (entry C9F79000, maps.ts), shared by the pages and the MOD export. */
export interface LanaiMapDb {
  archive: string;
  arc: Archive;
  entry: ArcEntry;
  db: MapDb;
}

/** `bytes` for row `r` with the string fields the table has there (the strings are put back on their own; their offsets may differ). */
function mergeStrings(t: LanaiTable, r: number, bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const cur = t.row(r);
  for (let o = 0; o + 4 <= t.rowSize; o += 4) if (t.isString(r, o)) out.set(cur.subarray(o, o + 4), o);
  return out;
}

/** "archive/entry hash": names a table across loads. */
export const lanaiTableKey = (t: Pick<LanaiTableRef, 'archive' | 'entry'>): string => `${t.archive}/${hex8(t.entry)}`;

export class LanaiSession {
  private readonly archives = new Map<string, Promise<Archive>>();
  private readonly tablesOf = new Map<string, Promise<LanaiTableRef[]>>();
  /** The master's tables by name (the first of a name). */
  private readonly byName = new Map<string, LanaiTable>();
  private readonly refs = new Map<LanaiTable, LanaiTableRef>();
  /** Tables of the other root archives (the contents' talks …), once read by tablesIn: edited and exported like the master's. */
  private readonly others: LanaiTableRef[] = [];
  private readonly otherSources = new Map<string, Archive>();
  /** The contents' map databases (read when first asked for), by root archive. */
  private readonly mapDbs = new Map<string, Promise<LanaiMapDb | null>>();
  private readonly mapDbsRead = new Map<string, LanaiMapDb>();
  /** Called when map sections were put back or reverted from outside a page (the documents read from them are stale). */
  private readonly mapResets = new Set<(archive: string) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every edit (the pages redraw on it). */
  revision = 0;
  /** Whether the export writes Panana's code MOD "ドロップ率の天井を撤廃" (game/dropcap.ts) to exefs/code.ips. */
  dropCap = false;

  private constructor(
    readonly dump: Dump,
    /** Tables of the master and the language archives. */
    readonly tables: LanaiTableRef[],
    /** The master and the language archives as read (the MOD rebuilds them). */
    private readonly sources: Map<string, Archive>,
  ) {
    for (const t of tables) {
      if (!this.byName.has(t.table.name)) this.byName.set(t.table.name, t.table);
      this.refs.set(t.table, t);
    }
  }

  /** Opens a dump and puts back the edits saved in IndexedDB (none with `fresh`). */
  static async open(dump: Dump, { fresh = false }: { fresh?: boolean } = {}): Promise<LanaiSession> {
    await PortStore.install(dump);
    if (dump.title !== LANAI) throw new Error(`『${LANAI.name}』のダンプではありません`);
    const names = dump.names().filter((n) => /^[0-9A-F]{4}000A$/i.test(n)).sort((a, b) => (a === LANAI.master ? -1 : b === LANAI.master ? 1 : a.localeCompare(b)));
    if (!names.includes(LANAI.master)) throw new Error(`RomFS に master (${LANAI.master}) がありません`);
    const tables: LanaiTableRef[] = [];
    const sources = new Map<string, Archive>();
    for (const n of names) {
      const arc = parseArchive(await dump.readRomfs(n));
      sources.set(n.toUpperCase(), arc);
      tables.push(...archiveTables(n.toUpperCase(), arc));
    }
    const s = new LanaiSession(dump, tables, sources);
    if (!fresh) {
      const saved = await idbGet<LanaiSaved>(LANAI_EDITS_KEY).catch(() => undefined);
      if (saved?.rows) await s.restore(saved);
    }
    return s;
  }

  // ---- map databases

  /** The map database of a content's root archive (null when the archive has none). */
  mapDb(name: string): Promise<LanaiMapDb | null> {
    const key = name.toUpperCase();
    let p = this.mapDbs.get(key);
    if (!p) {
      p = this.archive(key).then((arc) => {
        const entry = findEntry(arc, LANAI_MAPDB_ENTRY);
        if (!entry) return null;
        const r: LanaiMapDb = { archive: key, arc, entry, db: new MapDb(unpackEntry(arc, entry).body) };
        this.mapDbsRead.set(key, r);
        return r;
      });
      p.catch(() => this.mapDbs.delete(key));
      this.mapDbs.set(key, p);
    }
    return p;
  }

  /** The map databases with edited sections: root archive and how many sections differ from the ROM. */
  changedMapDbs(): { archive: string; sections: number }[] {
    return [...this.mapDbsRead.values()].map((r) => ({ archive: r.archive, sections: r.db.changedHashes().length })).filter((x) => x.sections > 0);
  }

  /** `f(archive)` runs when the sections of an archive's map database were put back or reverted (not by a page's edit). */
  onMapReset(f: (archive: string) => void): () => void {
    this.mapResets.add(f);
    return () => this.mapResets.delete(f);
  }

  private mapsReset(archive: string): void {
    for (const f of this.mapResets) f(archive);
  }

  // ---- edits

  /** The table's place (archive, entry): the master's and the language archives' tables, and those tablesIn read. */
  refOf(t: LanaiTable): LanaiTableRef | undefined {
    return this.refs.get(t);
  }

  /** Call after an edit: the pages redraw and the edits are saved. */
  edited(): void {
    this.revision++;
    for (const f of this.listeners) f();
    this.scheduleSave();
  }

  onEdit(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** The tables that differ from the archives. */
  changedTables(): LanaiTableRef[] {
    return [...this.tables, ...this.others].filter((t) => t.table.changed);
  }

  /** Whether anything differs from the ROM (tables or maps). */
  get changed(): boolean {
    return this.changedTables().length > 0 || this.changedMapDbs().length > 0;
  }

  /** Puts every table and every map back as it was read. */
  revertAll(): void {
    for (const t of [...this.tables, ...this.others]) t.table.revert();
    for (const r of this.mapDbsRead.values()) {
      const hashes = r.db.changedHashes();
      if (!hashes.length) continue;
      for (const h of hashes) r.db.revert(h);
      this.mapsReset(r.archive);
    }
    this.dropCap = false;
    this.edited();
  }

  saved(): LanaiSaved {
    const rows: LanaiSavedRow[] = [];
    const strings: LanaiSavedString[] = [];
    for (const ref of this.changedTables()) {
      const key = lanaiTableKey(ref);
      for (const r of ref.table.changedRows()) rows.push([key, r, ref.table.originalRow(r)?.slice() ?? null, ref.table.row(r).slice()]);
      for (const [r, o, b] of ref.table.changedStrings()) strings.push([key, r, o, b.slice()]);
    }
    const maps: LanaiSavedSection[] = [];
    for (const r of this.mapDbsRead.values()) for (const h of r.db.changedHashes()) maps.push([r.archive, h, r.db.get(h).slice()]);
    return { rows, ...(strings.length ? { strings } : {}), ...(maps.length ? { maps } : {}), ...(this.dropCap ? { dropCap: true } : {}) };
  }

  /**
   * Puts saved rows back. Only the bytes the edit changed are written (a row the Update changed elsewhere keeps the
   * Update's bytes); a row an edit added is added again (rows saved in order). Rows of tables that are not there, or
   * whose size differs, are left out. The written strings follow the rows (fields that are no longer strings are left
   * out). The rows of the master and the language archives are put back before the promise (those of the other
   * archives and the map sections, whose archives are read first, after it).
   */
  async restore(saved: LanaiSaved): Promise<void> {
    this.dropCap = !!saved.dropCap;
    this.restoreRows(saved);
    const known = new Set([...this.sources.keys(), ...this.otherSources.keys()]);
    const later = new Set([...saved.rows, ...(saved.strings ?? [])].map(([key]) => key.split('/')[0]!).filter((a) => !known.has(a)));
    const read = new Set<string>();
    for (const a of later) if (await this.tablesIn(a).then(() => true, () => false)) read.add(a);
    if (read.size) this.restoreRows(saved, read);
    const touched = new Set<string>();
    for (const [archive, h, bytes] of saved.maps ?? []) {
      const r = await this.mapDb(archive).catch(() => null);
      if (!r || !r.db.has(h)) continue;
      if (equalBytes(bytes, r.db.original(h))) r.db.revert(h);
      else r.db.set(h, bytes.slice());
      touched.add(r.archive);
    }
    for (const a of touched) this.mapsReset(a);
    if (touched.size) this.revision++;
  }

  /** Puts the saved rows and strings back (only those of the archives `only` when given). */
  private restoreRows(saved: LanaiSaved, only?: Set<string>): void {
    const byKey = new Map([...this.tables, ...this.others].filter((t) => !only || only.has(t.archive)).map((t) => [lanaiTableKey(t), t.table]));
    for (const [key, r, before, after] of saved.rows) {
      const t = byKey.get(key);
      if (!t || after.length !== t.rowSize) continue;
      try {
        if (!before) {
          while (t.rows <= r) t.addRow();
          t.setRow(r, mergeStrings(t, r, after));
          continue;
        }
        if (r >= t.rows) continue;
        const row = t.row(r).slice();
        for (let i = 0; i < row.length; i++) if (after[i] !== before[i]) row[i] = after[i]!;
        if (!equalBytes(row, t.row(r))) t.setRow(r, mergeStrings(t, r, row));
      } catch {
        // a row that no longer fits (a string field moved by the Update): left out
      }
    }
    for (const [key, r, o, bytes] of saved.strings ?? []) {
      const t = byKey.get(key);
      if (!t || r >= t.rows) continue;
      try {
        t.setString(r, o, bytes);
      } catch {
        // not a string field there any more: left out
      }
    }
    this.revision++;
  }

  readonly scheduleSave = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 500);
  };

  saveNow(): void {
    clearTimeout(this.saveTimer);
    idbSet(LANAI_EDITS_KEY, this.saved()).catch(() => {});
  }

  /** Whether a MOD can be exported: the edits must go on the Update's archives (else its fixes would be lost). */
  get canExport(): boolean {
    return !!this.dump.update;
  }

  /**
   * RomFS files of the MOD (root name -> bytes): the archives with changed tables, and the contents' archives whose map
   * database changed (rebuilt by MapDb.build), the other entries copied as they are.
   */
  modFiles(): Map<string, Uint8Array> {
    if (!this.canExport) throw new Error('書き出しには Update の CIA が要ります');
    const repl = new Map<string, { arc: Archive; m: Map<number, Uint8Array> }>();
    const put = (name: string, arc: Archive, index: number, bytes: Uint8Array): void => {
      const x = repl.get(name) ?? { arc, m: new Map<number, Uint8Array>() };
      x.m.set(index, bytes);
      repl.set(name, x);
    };
    for (const t of this.changedTables()) put(t.archive, (this.sources.get(t.archive) ?? this.otherSources.get(t.archive))!, t.index, t.table.data);
    for (const r of this.mapDbsRead.values()) if (r.db.changedHashes().length) put(r.archive, r.arc, r.entry.index, r.db.build());
    return new Map([...repl].map(([name, { arc, m }]) => [name, rebuildArchive(arc, m)]));
  }

  /** The RomFS files of the MOD with the archives holding ported models (#100). */
  async allModFiles(): Promise<Map<string, Uint8Array>> {
    const files = this.modFiles();
    for (const [name, b] of await (await PortStore.of('lanai')).archives()) if (!files.has(name)) files.set(name, b);
    return files;
  }

  /** Why the code MOD "ドロップ率の天井を撤廃" cannot be written (no Update, another version), or null. */
  dropCapProblem(): string | null {
    try {
      return dropCapProblem(lanaiCode(this.dump), 'lanai');
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** exefs/code.ips of Panana's code MODs that are on, or null when there is none (throws when one cannot be built). */
  codeIps(): Uint8Array | null {
    if (!this.dropCap) return null;
    const problem = this.dropCapProblem();
    if (problem) throw new Error(problem);
    const code = lanaiCode(this.dump);
    const built = [...buildPatches(code, [dropCapPatch('lanai')], LANAI_LAYOUT).values()];
    const err = built.find((b) => b.errors.length)?.errors[0];
    if (err) throw new Error(`パッチの ${err.line} 行目: ${err.message}`);
    return buildIps(patchRecords(built), code);
  }

  /** The LayeredFS zip: 0004000000125D00/romfs/<archive> and exefs/code.ips. */
  async modZip(): Promise<Uint8Array> {
    const pkg = new Map([...(await this.allModFiles())].map(([name, b]) => [`romfs/${name}`, b]));
    const ips = this.codeIps();
    if (ips) pkg.set('exefs/code.ips', ips);
    return buildModZip(pkg, LANAI.titleId);
  }

  private soundNames: Promise<SoundNames> | null = null;

  /** Names of the SoundData rows (+0x00 = sound.bcsar item ID, battle-field.md §5), from the Base's sound/sound.bcsar. */
  sounds(): Promise<SoundNames> {
    const t = this.need('SoundData');
    return (this.soundNames ??= loadSoundNames(this.dump, 'lanai/sound/names/v1', Array.from({ length: t.rows }, (_, i) => t.u32(i, 0))));
  }

  private renderer: Promise<SoundRenderer> | null = null;

  /** Plays the sounds of sound/sound.bcsar (its streams from sound/stream/). */
  soundRenderer(): Promise<SoundRenderer> {
    this.renderer ??= openSoundRenderer(this.dump).catch((err: Error) => {
      this.renderer = null;
      throw err;
    });
    return this.renderer;
  }

  /** A table of the master (or a language archive) by its name ("MonsterParameter"). */
  table(name: string): LanaiTable | undefined {
    return this.byName.get(name);
  }

  private readonly rowsOf = new Map<string, LanaiRows>();

  /** A table of the master read through its field definitions (tables.ts). */
  rows(name: string): LanaiRows {
    let r = this.rowsOf.get(name);
    if (!r) {
      const def = LANAI_TABLES[name];
      if (!def) throw new Error(`表 ${name} の欄の定義がありません`);
      r = new LanaiRows(this.need(name), def);
      this.rowsOf.set(name, r);
    }
    return r;
  }

  /** A table that must be there. */
  need(name: string): LanaiTable {
    const t = this.table(name);
    if (!t) throw new Error(`表 ${name} がありません`);
    return t;
  }

  /** Reads a root archive again next time (a port added entries to it). */
  forgetArchive(name: string): void {
    this.archives.delete(name.toUpperCase());
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

  /** The GS tables of a root archive (read once; they can be edited like the master's). */
  tablesIn(name: string): Promise<LanaiTableRef[]> {
    const key = name.toUpperCase();
    let p = this.tablesOf.get(key);
    if (!p) {
      const known = this.tables.filter((t) => t.archive === key);
      p = known.length ? Promise.resolve(known) : this.archive(key).then((a) => {
        const ts = archiveTables(key, a);
        this.otherSources.set(key, a);
        this.others.push(...ts);
        for (const t of ts) this.refs.set(t.table, t);
        return ts;
      });
      p.catch(() => this.tablesOf.delete(key));
      this.tablesOf.set(key, p);
    }
    return p;
  }

  /** The string at a file offset of a table. */
  stringAt(t: LanaiTable, offset: number): LanaiString {
    const tokens = parseLanaiMessage(t.data, offset).tokens;
    return { tokens, text: lanaiText(tokens) };
  }

  /**
   * Writes the string field at `offset` of row `row` from its text form (lanaiText: {ruby:…}, {page}, {ins:…}, {tag:…}).
   * Text equal to the string as read puts the string as read back. Call edited() after.
   */
  setText(t: LanaiTable, row: number, offset: number, text: string): void {
    t.setString(row, offset, encodeLanaiMessage(parseLanaiText(text)));
  }

  /** The string field at `offset` of row `row` as read (undefined when it is not a string or the row was added). */
  originalField(t: LanaiTable, row: number, offset: number): LanaiString | undefined {
    const o = t.originalRow(row);
    if (!o || !t.isString(row, offset)) return undefined;
    const tokens = parseLanaiMessage(t.original, u32(o, offset)).tokens;
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
