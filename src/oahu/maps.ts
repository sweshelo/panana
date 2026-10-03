// 電波人間のRPG3's maps (naauao oahu/map.md): the map table and the map database (archive B68E0000), the sections as
// RPG2's editing model (game/sections.ts MapDoc, with RPG3's record layouts), the dungeons' EventObject tables, and
// the tile models (mapData -> mapResource / mapParts). Edits are saved as changed section bytes and EventObject rows,
// and exported as rebuilt archives.
import { findEntry, parseArchive, rebuildArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { MapDb } from '../game/mapdb';
import { loadDoc, sectionBytes, type MapDoc, type MapFormat, type RecordLayout } from '../game/sections';
import type { Dump } from '../rom/dump';
import { cstr, equalBytes, hex8, s32, u16, u32, u8 } from '../util/bytes';
import type { OahuMaster } from './master';

/** Archive of the map database and the map table (§2). */
export const OAHU_MAP_ARCHIVE = 'B68E0000';
export const OAHU_MAPDB_ENTRY = 0xa2c14c00;
export const OAHU_MAP_TABLE_ENTRY = 0x5405e800;
const MAP_ROW = 0x44;

/** Slot of the map table row that holds section k (RPG2's numbering; FUN_002abeb0). Section 7 has no data. */
export const OAHU_SECTION_SLOT = [0, 1, 6, 2, 8, 5, 4, 3, 9, 7] as const;

/** The record layouts of RPG3's sections (§3). */
export const OAHU_LAYOUTS: Record<number, RecordLayout> = {
  1: { size: 16, xo: 0, yo: 2, unit: 'cell', label: '床のギミック (区画 1)' },
  2: { size: 20, xo: 4, yo: 6, unit: 'fine', fxo: 8, fyo: 0x0c, label: '置物 (区画 2)' },
  3: { size: 24, xo: 8, yo: 0x0a, unit: 'cell', fxo: 0x0c, fyo: 0x10, label: '出入口 (区画 3)' },
  4: { size: 24, xo: 8, yo: 0x0a, unit: 'quarter', fxo: 0x0c, fyo: 0x10, label: '宝箱 (区画 4)' },
  5: { size: 32, xo: 8, yo: 0x0a, unit: 'quarter', fxo: 0x0c, fyo: 0x10, label: 'キャラ・オブジェクト (区画 5)' },
  8: { size: 32, xo: 8, yo: 0x0a, unit: 'fine', fxo: 0x0c, fyo: 0x10, label: 'イベントの範囲 (区画 8)' },
  9: { size: 24, xo: 0x0c, yo: 0x0e, unit: 'cell', label: '地点 (区画 9)' },
};

/** Tiles are 20 bytes: RPG2's fields with 8 more bytes at +0x08 (§3.1). */
export const OAHU_MAP_FORMAT: MapFormat = { tile: { size: 20, rot: 0x10, letter: 0x11, pad: 0x12 }, layouts: OAHU_LAYOUTS };

/** Sections whose records refer to an EventObject row, and where (§3). */
export const OAHU_EVENT_SECTIONS = [3, 4, 5, 8] as const;
export function oahuRecEventRow(section: number, raw: Uint8Array): number {
  if (section === 8 && u32(raw, 0) >= 100) return 0; // objects placed by section 8
  return section === 3 || section === 4 || section === 5 || section === 8 ? u32(raw, 4) : 0;
}

/** Section 3's kinds (+0x15; §3.4). */
export const OAHU_EXIT_KIND: Record<number, string> = { 4: '上り階段', 5: '下り階段', 0x64: '壁の扉' };
export const oahuExitKind = (raw: Uint8Array): number => u8(raw, 0x15);
export const oahuExitLabel = (k: number): string => OAHU_EXIT_KIND[k] ?? (k >= 0x14 && k <= 0x42 ? `建物 ${k}` : `種類 ${k}`);

/** Section 5's kinds (+0x00; §3.6). */
export const oahuCharaKind = (raw: Uint8Array): number => u32(raw, 0);
export const oahuCharaLabel = (k: number): string => (k <= 2 ? 'キャラクター' : `オブジェクト ${k}`);

/** "B1F" for floor -1, "2F" for 2. */
export const oahuFloorLabel = (floor: number): string => (floor < 0 ? `B${-floor}F` : floor ? `${floor}F` : '');

/** A row of the map table (§2.2). */
export interface OahuMapInfo {
  /** Row in the map table. */
  index: number;
  hash: number;
  name: string;
  /** Section hashes by RPG2's section numbers (0 = the map hash; 7 has no data). */
  sections: number[];
  /** mapData key (0 = the dungeon's). */
  mapDataKey: number;
  /** mapGroup row. */
  dungeon: number;
  floor: number;
  /** The world map: its sections have another shape (§8), it is shown read-only. */
  world: boolean;
}

/** A dungeon (mapGroup row) and its event archive. */
export interface OahuDungeon {
  row: number;
  /** Event archive (mapGroup +0x14), e.g. 80790000 for d10. */
  archive: string;
  /** "D10" from the EventObject table's name. */
  code: string;
  /** Name message (mapGroup +0x1C). */
  nameId: number;
  /** mapData rows: outside / inside (+0x2E / +0x2F). */
  mapData: number;
  mapDataIndoor: number;
}

interface EventTable {
  archive: Archive;
  entryIndex: number;
  original: Uint8Array;
  table: GsTable;
}

/** Tile models of a map: mapData -> tileset and mapResource (§4). */
export interface OahuTileSource {
  mapData: number;
  tileset: number;
  resource: number;
  /** Archive of the tile models (type 8 entries). */
  modelArchive: string;
  /** Archive and entries of the textures loaded with the tiles (mapResource +0x04 / +0x08). */
  textureArchive: string;
  textureEntries: number[];
  /** Models of the model archive loaded with the tiles: the sky (+0x0C, "bgpt_01_caveA_sky") and the base (+0x14). */
  sky: number;
  base: number;
  /** Battle background (+0x10, "btmp_01_caveA"), an entry of archive 52120000. */
  battleBackground: number;
}

export type SavedEvent = [archive: string, row: number, before: Uint8Array, after: Uint8Array];

export interface OahuMapSaved {
  /** Changed sections: [hash, bytes]. */
  sections?: [number, Uint8Array][];
  events?: SavedEvent[];
}

const hexName = (n: number): string => hex8(n).toUpperCase();
/** A map database with no entries. */
const EMPTY_DB = new Uint8Array(4);

export class OahuMaps {
  readonly maps: OahuMapInfo[];
  readonly db: MapDb;
  readonly dungeons: OahuDungeon[];
  private readonly byHash = new Map<number, OahuMapInfo>();
  private readonly byName = new Map<string, OahuMapInfo>();
  /** Open documents (edited in place). */
  private readonly docs = new Map<number, MapDoc>();
  private readonly events = new Map<string, EventTable>();
  /** mapData key -> row (the table's hash index). */
  private readonly mapDataKeys: Map<number, number>;
  /** Bumped on every change (React pages subscribe through it). */
  revision = 0;
  private readonly listeners = new Set<() => void>();

  private constructor(
    private readonly dump: Dump,
    private readonly master: OahuMaster,
    /** null: the dump has no map archive (test dumps); there are no maps. */
    private readonly archive: Archive | null,
  ) {
    const db = archive && findEntry(archive, OAHU_MAPDB_ENTRY);
    const table = archive && findEntry(archive, OAHU_MAP_TABLE_ENTRY);
    if (archive && (!db || !table)) throw new Error(`${OAHU_MAP_ARCHIVE} にマップ DB / マップ表がありません`);
    this.db = new MapDb(archive && db ? unpackEntry(archive, db).body : EMPTY_DB);
    const t = archive && table ? unpackEntry(archive, table).body : new Uint8Array(0);
    this.maps = [];
    for (let i = 0; i + MAP_ROW <= t.length; i += MAP_ROW) {
      const slots = Array.from({ length: 10 }, (_, k) => u32(t, i + k * 4));
      const name = cstr(t.subarray(i + 0x38, i + MAP_ROW), 0);
      const info: OahuMapInfo = {
        index: i / MAP_ROW,
        hash: slots[0]!,
        name,
        sections: OAHU_SECTION_SLOT.map((s, k) => (k === 7 ? 0 : slots[s]!)),
        mapDataKey: u32(t, i + 0x28),
        dungeon: s32(t, i + 0x2c),
        floor: s32(t, i + 0x34),
        world: name.startsWith('W'),
      };
      this.maps.push(info);
      this.byHash.set(info.hash, info);
      this.byName.set(name, info);
    }
    const groups = archive ? master.table('mapGroup.bin') : null;
    this.dungeons = [];
    for (let r = 0; groups && r < groups.rows; r++) {
      const row = groups.row(r);
      const archive = u32(row, 0x14);
      this.dungeons.push({
        row: r,
        archive: archive ? hexName(archive) : '',
        code: '',
        nameId: u16(row, 0x1c),
        mapData: u8(row, 0x2e),
        mapDataIndoor: u8(row, 0x2f),
      });
    }
    this.mapDataKeys = archive ? master.table('mapData.bin').hashIndex() : new Map();
  }

  static async load(dump: Dump, master: OahuMaster): Promise<OahuMaps> {
    if (!dump.names().includes(OAHU_MAP_ARCHIVE)) return new OahuMaps(dump, master, null);
    return new OahuMaps(dump, master, parseArchive(await dump.readRomfs(OAHU_MAP_ARCHIVE)));
  }

  on(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  /** Call after editing a document or an EventObject row. */
  changed(): void {
    this.revision++;
    for (const f of this.listeners) f();
  }

  map(hash: number): OahuMapInfo | undefined {
    return this.byHash.get(hash);
  }
  mapByName(name: string): OahuMapInfo | undefined {
    return this.byName.get(name);
  }

  /** The exit (section 3 record) of a map with point ID `id` (+0x00), the destination of exits (§3.4). */
  exitByPoint(info: OahuMapInfo, id: number): number {
    return info.world ? -1 : (this.doc(info).recs[3] ?? []).findIndex((r) => u32(r.raw, 0) === id);
  }

  /** The document of a map (loaded once, then edited in place). */
  doc(info: OahuMapInfo): MapDoc {
    let d = this.docs.get(info.hash);
    if (!d) {
      d = loadDoc(this.db, info, OAHU_MAP_FORMAT);
      this.docs.set(info.hash, d);
    }
    return d;
  }

  /** Write a document's sections back to the map database (call after editing it). */
  commit(info: OahuMapInfo): void {
    const d = this.docs.get(info.hash);
    if (!d || info.world) return;
    for (let k = 0; k < 10; k++) {
      const h = info.sections[k]!;
      if (!h || !this.db.has(h)) continue;
      const b = sectionBytes(d, k, OAHU_MAP_FORMAT);
      if (!equalBytes(b, this.db.get(h))) this.db.set(h, b);
    }
    this.changed();
  }

  /** Whether a map's sections differ from the ROM's. */
  isChanged(info: OahuMapInfo): boolean {
    return info.sections.some((h) => h && this.db.has(h) && !equalBytes(this.db.get(h), this.db.original(h)));
  }

  /** Put a map back as it is in the ROM. */
  revert(info: OahuMapInfo): void {
    for (const h of info.sections) if (h && this.db.has(h)) this.db.set(h, this.db.original(h).slice());
    this.docs.delete(info.hash);
    this.changed();
  }

  // ---- dungeons and their EventObject tables (§5)

  dungeonOf(info: OahuMapInfo): OahuDungeon | undefined {
    return this.dungeons[info.dungeon];
  }

  /** The EventObject table of a dungeon (null when it has no event archive). */
  async eventTable(d: OahuDungeon): Promise<GsTable | null> {
    if (!d.archive) return null;
    const have = this.events.get(d.archive);
    if (have) return have.table;
    const archive = parseArchive(await this.dump.readRomfs(d.archive));
    const e = archive.entries.find((x) => {
      const name = x.comp === 1 ? unpackEntry(archive, x).name : null;
      return name?.endsWith('_EventObject.bin');
    });
    if (!e) return null;
    const original = unpackEntry(archive, e).body;
    const t: EventTable = { archive, entryIndex: e.index, original, table: new GsTable(original.slice()) };
    this.events.set(d.archive, t);
    if (!d.code) d.code = t.table.name.replace(/_EventObject$/, '');
    this.changed();
    return t.table;
  }

  /** The EventObject table if it is loaded already. */
  loadedEventTable(d: OahuDungeon): GsTable | null {
    return this.events.get(d.archive)?.table ?? null;
  }

  originalEventRow(d: OahuDungeon, row: number): Uint8Array | null {
    const t = this.events.get(d.archive);
    if (!t) return null;
    const o = new GsTable(t.original);
    return row < o.rows ? o.row(row) : null;
  }

  // ---- tile models (§4)

  /** mapData row of a map: its key's row, else the dungeon's (+0x2F when it has indoor tiles). */
  mapDataRow(info: OahuMapInfo, doc: MapDoc): number {
    if (info.mapDataKey) {
      const r = this.mapDataKeys.get(info.mapDataKey);
      if (r !== undefined) return r;
    }
    const d = this.dungeonOf(info);
    if (!d) return 0;
    const indoor = doc.tiles.some((t) => t.kind + 1 >= 0x10 && t.kind + 1 <= 0x1c);
    return indoor && d.mapDataIndoor ? d.mapDataIndoor : d.mapData;
  }

  tileSource(info: OahuMapInfo, doc: MapDoc): OahuTileSource {
    const mapData = this.mapDataRow(info, doc);
    const md = this.master.table('mapData.bin');
    const row = mapData < md.rows ? md.row(mapData) : new Uint8Array(7);
    const resource = u8(row, 1);
    const rt = this.master.table('mapResource.bin');
    const rr = resource < rt.rows ? rt.row(resource) : new Uint8Array(0x24);
    return {
      mapData,
      tileset: u8(row, 0),
      resource,
      modelArchive: hexName(u32(rr, 0)),
      textureArchive: hexName(u32(rr, 4)),
      textureEntries: [u32(rr, 8)].filter((h) => h),
      sky: u32(rr, 0x0c),
      base: u32(rr, 0x14),
      battleBackground: u32(rr, 0x10),
    };
  }

  /** Model hash of a tile (mapParts[kind + 1] + 8 + tileset * 0x20 + letter * 4), 0 = none. */
  partModel(kind: number, tileset: number, letter: number): number {
    const parts = this.master.table('mapParts.bin');
    const r = kind + 1;
    if (r >= parts.rows || tileset > 15 || letter > 7) return 0;
    return u32(parts.row(r), 8 + tileset * 0x20 + letter * 4);
  }

  /** mapObject row -> {archive, entry} of its BCH (0 = none). */
  objectModel(row: number): { archive: string; entry: number } | null {
    const t = this.master.table('mapObject.bin');
    if (row <= 0 || row >= t.rows) return null;
    const r = t.row(row);
    return u32(r, 0) && u32(r, 4) ? { archive: hexName(u32(r, 0)), entry: u32(r, 4) } : null;
  }

  // ---- saving and export

  saved(): OahuMapSaved {
    const sections: [number, Uint8Array][] = [];
    for (const info of this.maps)
      for (const h of info.sections) if (h && this.db.has(h) && !equalBytes(this.db.get(h), this.db.original(h))) sections.push([h, this.db.get(h).slice()]);
    const events: SavedEvent[] = [];
    for (const [name, t] of this.events) {
      const o = new GsTable(t.original);
      for (let r = 0; r < o.rows; r++) if (!equalBytes(o.row(r), t.table.row(r))) events.push([name, r, o.row(r).slice(), t.table.row(r).slice()]);
    }
    return { sections, events };
  }

  /** Put saved edits back (event rows only change the bytes the edit changed). */
  async restore(saved: OahuMapSaved): Promise<void> {
    for (const [h, b] of saved.sections ?? []) if (this.db.has(h)) this.db.set(h, b);
    for (const [name, r, before, after] of saved.events ?? []) {
      const d = this.dungeons.find((x) => x.archive === name);
      const t = d ? await this.eventTable(d).catch(() => null) : null;
      if (!t || r >= t.rows || after.length !== t.rowSize) continue;
      const row = t.row(r);
      for (let i = 0; i < row.length; i++) if (after[i] !== before[i]) row[i] = after[i]!;
    }
    this.docs.clear();
    this.changed();
  }

  /** Changed archives of the MOD (root name -> bytes). */
  changedArchives(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    if (!this.archive) return out;
    const dbBytes = this.db.build();
    const dbEntry = findEntry(this.archive, OAHU_MAPDB_ENTRY)!;
    if (!equalBytes(dbBytes, unpackEntry(this.archive, dbEntry).body)) out.set(OAHU_MAP_ARCHIVE, rebuildArchive(this.archive, new Map([[dbEntry.index, dbBytes]])));
    for (const [name, t] of this.events) if (!equalBytes(t.table.data, t.original)) out.set(name, rebuildArchive(t.archive, new Map([[t.entryIndex, t.table.data]])));
    return out;
  }
}
