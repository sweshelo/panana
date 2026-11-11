// One opened 電波人間のRPG FREE! (lanai) dump: the tables of the master (2135000A) and of the language archives
// (xxxx000A: UI text, codes; naauao lanai/analysis.md §1.1), the strings they hold, and the other root archives (the
// contents, the models) read when first asked for. The numbers of the tables' rows and their strings can be edited
// (table.ts; the pool is laid out again for a written string): the edits are saved to IndexedDB like RPG3's (oahu/session.ts) and put back when the dump is opened again
// (with or without the Update), and the archives holding changed tables are rebuilt into a LayeredFS MOD (the Update's
// archives under them, so it needs the Update like RPG3's).
import {
  entryBlob,
  findEntry,
  parseArchive,
  rebuildArchive,
  unpackEntry,
  type Archive,
  type ArcEntry,
  type NewEntry,
} from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { buildModZip } from '../export/pack';
import { PortStore } from '../port/store';
import { dropCapPatch, dropCapProblem } from '../game/dropcap';
import { MapDb } from '../game/mapdb';
import { buildPatches, patchRecords } from '../game/patch';
import { packageOn } from '../rom/basemod';
import { appendIps } from '../rom/ips';
import { overlayDump, type BaseMod, type Dump } from '../rom/dump';
import { LANAI } from '../rom/titles';
import { equalBytes, hex8, u32 } from '../util/bytes';
import { idbGet, idbSet } from '../util/idb';
import type { SoundNames } from '../game/sound';
import type { SoundRenderer } from '../sound/render';
import { loadSoundNames, openSoundRenderer } from '../sound/source';
import { LANAI_LAYOUT, lanaiCode } from './code';
import { conditionScriptPatch, parseConditionScript } from './conditionScript';
import { LANAI_MAPDB_ENTRY, LANAI_MAP_TABLE_ENTRY } from './maps';
import {
  encodeLanaiMessage,
  lanaiPlain,
  lanaiText,
  parseLanaiMessage,
  parseLanaiText,
  type LanaiToken,
} from './message';
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
  /**
   * An entry an edit added to the archive (a new MapGroup's EventObject table): it is saved whole and goes into the
   * export as a new entry packed like `like` (the entry it was copied from); `index` is -1.
   */
  added?: { like: number };
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
    if (LanaiTable.is(u.body))
      out.push({ archive: name, entry: e.hash, index: e.index, file: u.name, table: new LanaiTable(u.body) });
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

/** A content's map table kept across loads (whole: maps added, names changed): the root archive and the table's bytes. */
export type LanaiSavedMapTable = [archive: string, bytes: Uint8Array];

/**
 * A table an edit added to a root archive (a new MapGroup's EventObject table): the archive, the entry's hash, the file
 * name in its ZIP, the entry it is packed like, and the table's bytes.
 */
export type LanaiSavedEntry = [archive: string, hash: number, file: string, like: number, bytes: Uint8Array];

export interface LanaiSaved {
  createdFiles?: [string, Uint8Array][];
  conditionScripts?: [number, string][];
  rows: LanaiSavedRow[];
  /** Written strings (absent in edits saved before strings could be written, and when none were). */
  strings?: LanaiSavedString[];
  /** Edited map sections (absent in edits saved before the map editor), the sections of added maps among them. */
  maps?: LanaiSavedSection[];
  /** Map tables with added maps or changed names (absent when none). */
  mapTables?: LanaiSavedMapTable[];
  /** Tables added to the contents' archives (absent when none). */
  entries?: LanaiSavedEntry[];
  /** Panana's code MOD "ドロップ率の天井を撤廃" is on (game/dropcap.ts). */
  dropCap?: boolean;
}

/** The map database of a content's root archive (entry C9F79000, maps.ts), shared by the pages and the MOD export. */
export interface LanaiMapDb {
  archive: string;
  arc: Archive;
  entry: ArcEntry;
  db: MapDb;
  /** The content's map table (entry 131C5000, n × 0x4C; maps.ts), null when the archive has none. */
  table: LanaiMapTable | null;
}

/** A content's map table: the bytes as read and as edited (maps appended, names written; maps.ts LanaiMaps). */
export interface LanaiMapTable {
  entry: ArcEntry;
  original: Uint8Array;
  data: Uint8Array;
}

/** `bytes` for row `r` with the string fields the table has there (the strings are put back on their own; their offsets may differ). */
function mergeStrings(t: LanaiTable, r: number, bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const cur = t.row(r);
  for (let o = 0; o + 4 <= t.rowSize; o += 4) if (t.isString(r, o)) out.set(cur.subarray(o, o + 4), o);
  return out;
}

/**
 * The row an added row is put back as a copy of, so that its string fields are string fields again (a row of zeros has
 * none, and the saved strings could not be written into it): the ROM's row whose string fields hold what the saved row
 * holds (the row it was copied from, for the strings that were not written), else the first row with string fields.
 */
function addedRowSource(t: LanaiTable, after: Uint8Array): number | undefined {
  const cols = t.stringOffsets();
  if (!cols.length || !t.rows) return t.rows ? 0 : undefined;
  const rows = Math.min(t.rows, t.originalRows);
  let first: number | undefined;
  for (let r = 0; r < rows; r++) {
    const strings = cols.filter((o) => t.isString(r, o));
    if (!strings.length) continue;
    first ??= r;
    if (strings.every((o) => t.u32(r, o) === u32(after, o))) return r;
  }
  return first ?? 0;
}

/** "archive/entry hash": names a table across loads. */
export const lanaiTableKey = (t: Pick<LanaiTableRef, 'archive' | 'entry'>): string => `${t.archive}/${hex8(t.entry)}`;

export class LanaiSession {
  /** New archive/CRR files; the initial archive bytes are the baseline for subsequent table/map edits. */
  readonly createdFiles = new Map<string, Uint8Array>();
  readonly conditionScripts = new Map<number, string>();

  addFile(name: string, bytes: Uint8Array): void {
    if (this.createdFiles.has(name) || this.dump.files?.().some((f) => f.path.toUpperCase() === name.toUpperCase()))
      throw new Error(`ファイル ${name} は既にあります`);
    this.createdFiles.set(name, bytes.slice());
  }

  setConditionScript(id: number, source: string): void {
    if (!Number.isInteger(id) || id < 1 || id > 0xffff) throw new Error('スクリプト番号は 1〜65535 です');
    parseConditionScript(source);
    this.conditionScripts.set(id, source);
  }

  private readonly archives = new Map<string, Promise<Archive>>();
  private readonly tablesOf = new Map<string, Promise<LanaiTableRef[]>>();
  /** The lists tablesIn resolved to (the added tables go into them). */
  private readonly tablesRead = new Map<string, LanaiTableRef[]>();
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
  /** The dump as opened, without the base MOD ({@link dump} reads through it). */
  raw!: Dump;
  /** The existing MOD the dump is read with (its files and code.ips also go into the export), or null. */
  baseMod: BaseMod | null = null;

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

  /** Opens a dump (on a base MOD when one is given) and puts back the edits saved in IndexedDB (none with `fresh`). */
  static async open(
    raw: Dump,
    { fresh = false, baseMod = null }: { fresh?: boolean; baseMod?: BaseMod | null } = {},
  ): Promise<LanaiSession> {
    const dump = baseMod ? overlayDump(raw, baseMod) : raw;
    await PortStore.install(dump);
    if (dump.title !== LANAI) throw new Error(`『${LANAI.name}』のダンプではありません`);
    const names = dump
      .names()
      .filter((n) => /^[0-9A-F]{4}000A$/i.test(n))
      .sort((a, b) => (a === LANAI.master ? -1 : b === LANAI.master ? 1 : a.localeCompare(b)));
    if (!names.includes(LANAI.master)) throw new Error(`RomFS に master (${LANAI.master}) がありません`);
    const tables: LanaiTableRef[] = [];
    const sources = new Map<string, Archive>();
    for (const n of names) {
      const arc = parseArchive(await dump.readRomfs(n));
      sources.set(n.toUpperCase(), arc);
      tables.push(...archiveTables(n.toUpperCase(), arc));
    }
    const s = new LanaiSession(dump, tables, sources);
    s.raw = raw;
    s.baseMod = baseMod;
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
        const te = findEntry(arc, LANAI_MAP_TABLE_ENTRY);
        const tb = te ? unpackEntry(arc, te).body : null;
        const table = te && tb ? { entry: te, original: tb, data: tb } : null;
        const r: LanaiMapDb = { archive: key, arc, entry, db: new MapDb(unpackEntry(arc, entry).body), table };
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
    return [...this.mapDbsRead.values()]
      .map((r) => ({ archive: r.archive, sections: r.db.changedHashes().length }))
      .filter((x) => x.sections > 0);
  }

  /** The map tables that differ from the ROM's (maps added, names changed). */
  changedMapTables(): LanaiMapDb[] {
    return [...this.mapDbsRead.values()].filter((r) => r.table && !equalBytes(r.table.data, r.table.original));
  }

  /** The map database (and map table) of an archive if it has been read. */
  readMapDb(archive: string): LanaiMapDb | undefined {
    return this.mapDbsRead.get(archive.toUpperCase());
  }

  // ---- tables added to the contents' archives

  /** The tables edits added to the root archives. */
  addedTables(): LanaiTableRef[] {
    return this.others.filter((t) => t.added);
  }

  /**
   * Add a table to a root archive (read by tablesIn first): a new entry `hash` (not in the archive) whose ZIP holds
   * `file`, packed like the entry `like` of the archive. It is edited like the other tables and saved whole.
   */
  addTable(archive: string, hash: number, file: string, like: number, table: LanaiTable): LanaiTableRef {
    const key = archive.toUpperCase();
    const arc = this.otherSources.get(key);
    if (!arc) throw new Error(`アーカイブ ${key} の表をまだ読んでいません`);
    if (findEntry(arc, hash) || this.others.some((t) => t.archive === key && t.entry === hash))
      throw new Error(`アーカイブ ${key} にはエントリ ${hex8(hash)} がもうあります`);
    if (!findEntry(arc, like)) throw new Error(`アーカイブ ${key} にエントリ ${hex8(like)} がありません`);
    const ref: LanaiTableRef = { archive: key, entry: hash, index: -1, file, table, added: { like } };
    this.others.push(ref);
    this.refs.set(table, ref);
    this.tablesRead.get(key)?.push(ref);
    return ref;
  }

  /** Take out a table addTable added. */
  removeTable(ref: LanaiTableRef): void {
    if (!ref.added) throw new Error(`${ref.table.name} は元からある表なので消せません`);
    const i = this.others.indexOf(ref);
    if (i >= 0) this.others.splice(i, 1);
    this.refs.delete(ref.table);
    const ts = this.tablesRead.get(ref.archive);
    const j = ts?.indexOf(ref) ?? -1;
    if (j >= 0) ts!.splice(j, 1);
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

  /** The tables of the archives that differ from what was read (not the added ones: addedTables). */
  changedTables(): LanaiTableRef[] {
    return [...this.tables, ...this.others].filter((t) => !t.added && t.table.changed);
  }

  /** Whether anything differs from the ROM (tables or maps). */
  get changed(): boolean {
    return (
      this.createdFiles.size > 0 ||
      this.conditionScripts.size > 0 ||
      this.changedTables().length > 0 ||
      this.changedMapDbs().length > 0 ||
      this.changedMapTables().length > 0 ||
      this.addedTables().length > 0
    );
  }

  /** Puts every table and every map back as it was read. */
  revertAll(): void {
    for (const t of this.addedTables()) this.removeTable(t);
    for (const t of [...this.tables, ...this.others]) t.table.revert();
    // every content's maps are read again (their MapGroup and EventObject tables were reverted too)
    for (const r of this.mapDbsRead.values()) {
      for (const h of r.db.addedHashes()) r.db.remove(h);
      for (const h of r.db.changedHashes()) r.db.revert(h);
      if (r.table) r.table.data = r.table.original;
      this.mapsReset(r.archive);
    }
    for (const key of this.createdFiles.keys()) {
      for (const t of this.others.filter((t) => t.archive === key)) {
        this.refs.delete(t.table);
        this.others.splice(this.others.indexOf(t), 1);
      }
      this.otherSources.delete(key);
      this.archives.delete(key);
      this.tablesOf.delete(key);
      this.tablesRead.delete(key);
      this.mapDbs.delete(key);
      this.mapDbsRead.delete(key);
    }
    this.createdFiles.clear();
    this.conditionScripts.clear();
    this.dropCap = false;
    this.edited();
  }

  saved(): LanaiSaved {
    const rows: LanaiSavedRow[] = [];
    const strings: LanaiSavedString[] = [];
    for (const ref of this.changedTables()) {
      const key = lanaiTableKey(ref);
      for (const r of ref.table.changedRows())
        rows.push([key, r, ref.table.originalRow(r)?.slice() ?? null, ref.table.row(r).slice()]);
      for (const [r, o, b] of ref.table.changedStrings()) strings.push([key, r, o, b.slice()]);
    }
    const maps: LanaiSavedSection[] = [];
    for (const r of this.mapDbsRead.values())
      for (const h of r.db.changedHashes()) maps.push([r.archive, h, r.db.get(h).slice()]);
    const mapTables: LanaiSavedMapTable[] = this.changedMapTables().map((r) => [r.archive, r.table!.data.slice()]);
    const entries: LanaiSavedEntry[] = this.addedTables().map((t) => [
      t.archive,
      t.entry,
      t.file ?? '',
      t.added!.like,
      t.table.data.slice(),
    ]);
    return {
      rows,
      ...(this.createdFiles.size ? { createdFiles: [...this.createdFiles] } : {}),
      ...(this.conditionScripts.size ? { conditionScripts: [...this.conditionScripts] } : {}),
      ...(strings.length ? { strings } : {}),
      ...(maps.length ? { maps } : {}),
      ...(mapTables.length ? { mapTables } : {}),
      ...(entries.length ? { entries } : {}),
      ...(this.dropCap ? { dropCap: true } : {}),
    };
  }

  /**
   * Puts saved rows back. Only the bytes the edit changed are written (a row the Update changed elsewhere keeps the
   * Update's bytes); a row an edit added is added again (rows saved in order). Rows of tables that are not there, or
   * whose size differs, are left out. The written strings follow the rows (fields that are no longer strings are left
   * out). The rows of the master and the language archives are put back before the promise (those of the other
   * archives and the map sections, whose archives are read first, after it).
   */
  async restore(saved: LanaiSaved): Promise<void> {
    for (const [name, bytes] of saved.createdFiles ?? []) this.addFile(name, bytes);
    for (const [id, source] of saved.conditionScripts ?? []) this.setConditionScript(id, source);
    this.dropCap = !!saved.dropCap;
    this.restoreRows(saved);
    const known = new Set([...this.sources.keys(), ...this.otherSources.keys()]);
    const later = new Set(
      [...saved.rows, ...(saved.strings ?? [])].map(([key]) => key.split('/')[0]!).filter((a) => !known.has(a)),
    );
    for (const [a] of saved.entries ?? []) if (!this.sources.has(a)) later.add(a);
    const read = new Set<string>();
    for (const a of later)
      if (
        await this.tablesIn(a).then(
          () => true,
          () => false,
        )
      )
        read.add(a);
    // the added tables first (rows of other tables may come after them in a later save)
    for (const [archive, hash, file, like, bytes] of saved.entries ?? []) {
      if (!read.has(archive)) continue;
      try {
        this.addTable(archive, hash, file, like, new LanaiTable(bytes.slice()));
      } catch {
        // the archive changed (an entry of that hash is there now): left out
      }
    }
    if (read.size) this.restoreRows(saved, read);
    const touched = new Set<string>();
    for (const [archive, bytes] of saved.mapTables ?? []) {
      const r = await this.mapDb(archive).catch(() => null);
      if (!r?.table || bytes.length % 0x4c) continue;
      r.table.data = equalBytes(bytes, r.table.original) ? r.table.original : bytes.slice();
      touched.add(r.archive);
    }
    for (const [archive, h, bytes] of saved.maps ?? []) {
      const r = await this.mapDb(archive).catch(() => null);
      if (!r) continue;
      if (!r.db.has(h)) r.db.add(h, bytes.slice()); // a section of an added map (or one the ROM leaves out)
      else if (equalBytes(bytes, r.db.original(h))) r.db.revert(h);
      else r.db.set(h, bytes.slice());
      touched.add(r.archive);
    }
    for (const a of touched) this.mapsReset(a);
    if (touched.size) this.revision++;
  }

  /** Puts the saved rows and strings back (only those of the archives `only` when given). */
  private restoreRows(saved: LanaiSaved, only?: Set<string>): void {
    const byKey = new Map(
      [...this.tables, ...this.others]
        .filter((t) => !only || only.has(t.archive))
        .map((t) => [lanaiTableKey(t), t.table]),
    );
    for (const [key, r, before, after] of saved.rows) {
      const t = byKey.get(key);
      if (!t || after.length !== t.rowSize) continue;
      try {
        if (!before) {
          while (t.rows <= r) t.addRow(addedRowSource(t, after));
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
    const repl = new Map<string, { arc: Archive; m: Map<number, Uint8Array>; added: NewEntry[] }>();
    const at = (name: string, arc: Archive): { arc: Archive; m: Map<number, Uint8Array>; added: NewEntry[] } => {
      const x = repl.get(name) ?? { arc, m: new Map<number, Uint8Array>(), added: [] };
      repl.set(name, x);
      return x;
    };
    const put = (name: string, arc: Archive, index: number, bytes: Uint8Array): void =>
      void at(name, arc).m.set(index, bytes);
    const sourceOf = (archive: string): Archive => (this.sources.get(archive) ?? this.otherSources.get(archive))!;
    for (const t of this.changedTables()) put(t.archive, sourceOf(t.archive), t.index, t.table.data);
    for (const r of this.mapDbsRead.values()) {
      if (r.db.changedHashes().length || r.db.addedHashes().length) put(r.archive, r.arc, r.entry.index, r.db.build());
      if (r.table && !equalBytes(r.table.data, r.table.original))
        put(r.archive, r.arc, r.table.entry.index, r.table.data);
    }
    for (const t of this.addedTables()) {
      const arc = sourceOf(t.archive);
      at(t.archive, arc).added.push({
        hash: t.entry,
        name: t.file ?? '',
        body: t.table.data,
        like: findEntry(arc, t.added!.like)!,
      });
    }
    const files = new Map(this.createdFiles);
    for (const [name, { arc, m, added }] of repl) files.set(name, rebuildArchive(arc, m, added));
    const roots = [...this.createdFiles.keys()].filter((n) => /^[0-9A-F]{8}$/.test(n));
    if (roots.length) {
      const hashes = [...new Set([...this.dump.update!.patched, ...roots])];
      const list = new Uint8Array(4 + hashes.length * 4);
      const view = new DataView(list.buffer);
      view.setUint32(0, hashes.length, true);
      hashes.forEach((h, i) => view.setUint32(4 + i * 4, parseInt(h, 16), true));
      files.set('patchList.bin', list);
    }
    return files;
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

  /**
   * exefs/code.ips: the base MOD's, then Panana's code MODs that are on; null when there is none (throws when one cannot
   * be built).
   */
  codeIps(): Uint8Array | null {
    const base = this.baseMod?.ips ?? null;
    const script = conditionScriptPatch(this);
    if (!this.dropCap && !script) return base;
    const problem = this.dropCap ? this.dropCapProblem() : null;
    if (problem) throw new Error(problem);
    const code = lanaiCode(this.dump);
    const built = [
      ...buildPatches(
        code,
        [...(this.dropCap ? [dropCapPatch('lanai')] : []), ...(script ? [script] : [])],
        LANAI_LAYOUT,
      ).values(),
    ];
    const err = built.find((b) => b.errors.length)?.errors[0];
    if (err) throw new Error(`パッチの ${err.line} 行目: ${err.message}`);
    return appendIps(base, patchRecords(built), code);
  }

  /** The LayeredFS zip: 0004000000125D00/romfs/<archive> (with the base MOD's files) and exefs/code.ips. */
  async modZip(): Promise<Uint8Array> {
    return buildModZip(packageOn(this.baseMod, await this.allModFiles(), this.codeIps()), LANAI.titleId);
  }

  private soundNames: Promise<SoundNames> | null = null;

  /** Names of the SoundData rows (+0x00 = sound.bcsar item ID, battle-field.md §5), from the Base's sound/sound.bcsar. */
  sounds(): Promise<SoundNames> {
    const t = this.need('SoundData');
    return (this.soundNames ??= loadSoundNames(
      this.dump,
      'lanai/sound/names/v1',
      Array.from({ length: t.rows }, (_, i) => t.u32(i, 0)),
    ));
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
      p = (this.createdFiles.has(key) ? Promise.resolve(this.createdFiles.get(key)!) : this.dump.readRomfs(key)).then(
        parseArchive,
      );
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
      p = known.length
        ? Promise.resolve(known)
        : this.archive(key).then((a) => {
            const ts = archiveTables(key, a);
            this.otherSources.set(key, a);
            this.others.push(...ts);
            for (const t of ts) this.refs.set(t.table, t);
            this.tablesRead.set(key, ts);
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
    return lanaiPlain(parseLanaiMessage(t.data, offset).tokens, (ins) =>
      depth < 2 ? this.insert(ins.table, ins.id, ins.field, depth + 1) : undefined,
    );
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
