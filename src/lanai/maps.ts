// The maps of a 電波人間のRPG FREE! (lanai) content (naauao lanai/map.md): every content (stage) has a map database
// (entry C9F79000) and a map table (131C5000, 0x4C bytes a row) of its own, the sections of a map as RPG2's editing
// model (game/sections.ts MapDoc, with RPG FREE!'s record layouts and 1 / 2 / 4 / 8 facings), and the tile models:
// MapData -> MapPartsType (tileset) -> MapParts<name> -> a GSC of the root archive that the pair names.
import { findEntry, unpackEntry, type Archive } from '../archive/gsarc';
import type { MapDb } from '../game/mapdb';
import { LANAI_ROT_CODEC, loadDoc, sectionBytes, type MapDoc, type MapFormat, type RecordLayout } from '../game/sections';
import { cstr, equalBytes, s32, u32 } from '../util/bytes';
import type { LanaiContent } from './contents';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** Entries of a content's archive: the map database and the map table (MapDataResource rows 0 / 1). */
export const LANAI_MAPDB_ENTRY = 0xc9f79000;
export const LANAI_MAP_TABLE_ENTRY = 0x131c5000;
const MAP_ROW = 0x4c;
const NAME_OFFSET = 0x40;

/** Slot of the map table row that holds section k (section k = slot k; section 7 has no data, 8 / 9 moved up). */
export const LANAI_SECTION_SLOT = [0, 1, 2, 3, 4, 5, 6, -1, 7, 8] as const;

/** Record layouts of the sections (§3): oahu's, with the treasure and character positions in 100 units. */
export const LANAI_LAYOUTS: Record<number, RecordLayout> = {
  1: { size: 16, xo: 0, yo: 2, unit: 'cell', label: '床のギミック (区画 1)' },
  2: { size: 20, xo: 4, yo: 6, unit: 'fine', fxo: 8, fyo: 0x0c, label: '置物 (区画 2)' },
  3: { size: 24, xo: 8, yo: 0x0a, unit: 'cell', fxo: 0x0c, fyo: 0x10, label: '出入口 (区画 3)' },
  4: { size: 24, xo: 8, yo: 0x0a, unit: 'fine', fxo: 0x0c, fyo: 0x10, label: '宝箱 (区画 4)' },
  5: { size: 32, xo: 8, yo: 0x0a, unit: 'fine', fxo: 0x0c, fyo: 0x10, label: 'キャラ・オブジェクト (区画 5)' },
  8: { size: 32, xo: 8, yo: 0x0a, unit: 'fine', fxo: 0x0c, fyo: 0x10, label: 'イベントの範囲 (区画 8)' },
  9: { size: 24, xo: 0x0c, yo: 0x0e, unit: 'fine', label: '地点 (区画 9)' },
};

/** Tiles are 20 bytes with the facing at +0x10 as a 1 / 2 / 4 / 8 mask (§3.1). */
export const LANAI_MAP_FORMAT: MapFormat = { tile: { size: 20, rot: 0x10, letter: 0x11, pad: 0x12, rotCodec: LANAI_ROT_CODEC }, layouts: LANAI_LAYOUTS };

/** Sections that have positioned records, drawn last first. */
/**
 * Where a tile's turn 0..3 faces on the 2D grid, as an index of ROT_ARROW (↑ → ↓ ←): the facing bytes are 4 / 2 / 1 / 8 =
 * S / W / N / E (map.md 3.2), a clockwise turn from the south like the 3D view's rotation.y = -turn·π/2 (kahara's and
 * oahu's turn 0 is north). The record facings (FACING_LABELS) already read this way.
 */
export const LANAI_ROT_DIR = [2, 3, 0, 1] as const;

export const LANAI_POINT_SECTIONS = [3, 4, 5, 8, 2, 1, 9] as const;

/** Where a section's record keeps its facing byte (§3.2: 2 +0x10, 3 +0x14, 4 +0x14, 5 +0x1C, 8 +0x1C), if it has one. */
export const LANAI_FACING_OFFSET: Record<number, number> = { 2: 0x10, 3: 0x14, 4: 0x14, 5: 0x1c, 8: 0x1c };

/** The turn (0..3, as oahu's r) of a record's facing byte; 0 when the section has none or the byte is none of the masks. */
export function lanaiRecFacing(section: number, raw: Uint8Array): number {
  const o = LANAI_FACING_OFFSET[section];
  return o === undefined ? 0 : Math.max(0, LANAI_ROT_CODEC.decode(raw[o] ?? 0));
}

/** Sections whose records name an EventObject row (+0x04), and the kinds of section 3 (+0x15; §5.1). */
export const LANAI_EVENT_SECTIONS = [3, 4, 5, 8] as const;
export const LANAI_EXIT_KIND: Record<number, string> = { 5: '上り階段', 6: '下り階段', 100: '壁の扉' };
export const lanaiExitKind = (raw: Uint8Array): number => raw[0x15] ?? 0;
export const lanaiExitLabel = (k: number): string => LANAI_EXIT_KIND[k] ?? `種類 ${k}`;
export const lanaiFloorLabel = (floor: number): string => (floor < 0 ? `B${-floor}F` : floor ? `${floor}F` : '');

/**
 * EventObject rows (100 bytes; map.md §7.1): the appear / disappear conditions (kind +0x5F / +0x60, values +0x00 /
 * +0x04 and +0x08 / +0x0C), three actions (type, then 5 arguments) chosen by the row's state, the state slot (+0x58).
 */
export const LANAI_EVENT_ROW = 100;
/** The type of the actions for the states 0 / 1 / 2〜3 (0 or 0x80000000 = none: the one before is used). */
export const LANAI_EVENT_ACTIONS = [0x10, 0x28, 0x40] as const;
export const LANAI_EVENT_ARGS = 5;
/** +0x58: the state slot in the MapGroup's slots; 0xFFFF = the row number is the slot (@0x191C68). */
export const LANAI_EVENT_SLOT = 0x58;
export const LANAI_SLOT_IS_ROW = 0xffff;
export const LANAI_EVENT_APPEAR = 0x5f;
export const LANAI_EVENT_DISAPPEAR = 0x60;

/** The state slot of an EventObject row (its row number when +0x58 is 0xFFFF). */
export const lanaiEventSlot = (t: LanaiTable, row: number): number => {
  const v = t.u16(row, LANAI_EVENT_SLOT);
  return v === LANAI_SLOT_IS_ROW ? row : v;
};

/** A row of a content's map table (§2). */
export interface LanaiMapInfo {
  /** Row in the map table. */
  index: number;
  hash: number;
  name: string;
  /** Section hashes by section number (0 = the map hash; 7 has no data = 0). */
  sections: number[];
  /** +0x28: row ID of MapData (0 / 0x80000000 = the group's). */
  mapDataId: number;
  /** +0x2C: MapGroup row of the content (named `dungeon` as RPG2's map info). */
  dungeon: number;
  /** +0x30: how the enemies come (3 / 4 / 5, 0 = none; 推定). */
  encounterLevel: number;
  floor: number;
  /** The world map (W01): its sections have another shape, it is shown read-only. */
  world: boolean;
}

/** The tile models of a map: MapData row, its tileset (MapPartsType row) and MapParts table, its MapResource row. */
export interface LanaiTileSource {
  /** MapData row (-1: none found). */
  mapData: number;
  /** MapData +0x0A: row of MapPartsType. */
  tileset: number;
  /** Name of the MapParts table the tileset points at ("MapPartsCaveB"), '' when there is none. */
  partsName: string;
  /** MapData +0x0B: row of MapResource. */
  resource: number;
  /** Texture of the tiles: MapResource +0x00 archive, +0x04 entry (0 = none). */
  textureArchive: number;
  textureEntry: number;
}

/** A model a tile kind and letter name: the root archive and the GSC entry in it. */
export interface LanaiPartRef {
  archive: number;
  entry: number;
}

/** A MapGroup row (§7). */
export interface LanaiMapGroup {
  row: number;
  /** MessageMapName row ID (+0x00). */
  nameId: number;
  /** MapData row IDs: outside / inside (+0x08 / +0x0C). */
  mapData: number;
  mapDataIndoor: number;
  /** First map hash and point (+0x14 / +0x18). */
  firstMap: number;
  firstPoint: number;
  /** Entry of the EventObject table (+0x1C). */
  eventEntry: number;
  /** The group's state slots (+0x28 u16 first, +0x2A u8 count; map.md §7): EventObject slots from the count on are not saved. */
  stateFirst: number;
  stateCount: number;
}

/** A row of the content's MonsterGroup (what section 6 names by row ID). */
export interface LanaiMonsterGroupRow {
  row: number;
  id: number;
  /** +0x00: a small row ID (0x80000000, 0x80000001, …); not a monster, meaning not known yet (#130). */
  kind: number;
  /** +0x04〜+0x64: 25 MonsterParameter row IDs as written (0 = none; 0x80000000 = row 0, the empty monster). */
  slots: number[];
  /** The MonsterParameter row IDs of the group (the slots, empty ones left out). */
  monsters: number[];
  /** The bytes after the slots (+0x68 on: weights, count codes or flags; not known yet). */
  tail: Uint8Array;
}

/** MonsterGroup rows: +0x00 kind, then 25 u32 monster slots from +0x04 (0x9C bytes a row; #130, map.md §5.7). */
const MG_SLOTS = 25;
const MG_SLOT0 = 0x04;

const loaded = new WeakMap<LanaiSession, Map<number, Promise<LanaiMaps>>>();
const ready = new WeakMap<LanaiSession, Map<number, LanaiMaps>>();

/** The maps of a content, read once per session (the pages share the documents). */
export function lanaiMaps(session: LanaiSession, content: LanaiContent): Promise<LanaiMaps> {
  const m = loaded.get(session) ?? new Map<number, Promise<LanaiMaps>>();
  loaded.set(session, m);
  let p = m.get(content.index);
  if (!p) {
    p = LanaiMaps.load(session, content);
    p.then((maps) => {
      const r = ready.get(session) ?? new Map<number, LanaiMaps>();
      ready.set(session, r);
      r.set(content.index, maps);
    }, () => m.delete(content.index));
    m.set(content.index, p);
  }
  return p;
}

/** The maps of a content if they have been read already (the map picker lists them without reading every content). */
export function loadedLanaiMaps(session: LanaiSession, content: number): LanaiMaps | undefined {
  return ready.get(session)?.get(content);
}

const tableNamed =(tables: { table: LanaiTable }[], name: string): LanaiTable | undefined => tables.find((t) => t.table.name === name)?.table;

export class LanaiMaps {
  readonly maps: LanaiMapInfo[];
  readonly db: MapDb;
  readonly groups: LanaiMapGroup[];
  private readonly byHash = new Map<number, LanaiMapInfo>();
  private readonly byName = new Map<string, LanaiMapInfo>();
  private readonly docs = new Map<number, MapDoc>();
  private readonly partsByEntry = new Map<number, LanaiTable>();

  private constructor(
    readonly session: LanaiSession,
    readonly content: LanaiContent,
    readonly archive: Archive,
    /** The content's map database, shared with the session (it saves and exports it). */
    db: MapDb,
    private readonly mapData: LanaiTable | undefined,
    private readonly mapGroup: LanaiTable | undefined,
    private readonly partsType: LanaiTable | undefined,
    private readonly mapResource: LanaiTable | undefined,
    parts: { entry: number; table: LanaiTable }[],
    /** The content's tables (the EventObject tables of the groups among them). */
    private readonly tables: { entry: number; table: LanaiTable }[],
  ) {
    const tableEntry = findEntry(archive, LANAI_MAP_TABLE_ENTRY);
    if (!tableEntry) throw new Error(`コンテンツ ${content.index} (${content.archive}) にマップ表がありません`);
    this.db = db;
    const t = unpackEntry(archive, tableEntry).body;
    this.maps = [];
    for (let i = 0; i + MAP_ROW <= t.length; i += MAP_ROW) {
      const slots = Array.from({ length: 10 }, (_, k) => u32(t, i + k * 4));
      const name = cstr(t.subarray(i + NAME_OFFSET, i + MAP_ROW), 0);
      const info: LanaiMapInfo = {
        index: i / MAP_ROW,
        hash: slots[0]!,
        name,
        sections: LANAI_SECTION_SLOT.map((s) => (s < 0 ? 0 : slots[s]!)),
        mapDataId: u32(t, i + 0x28),
        dungeon: u32(t, i + 0x2c),
        encounterLevel: s32(t, i + 0x30),
        floor: s32(t, i + 0x34),
        world: name.startsWith('W'),
      };
      this.maps.push(info);
      this.byHash.set(info.hash, info);
      this.byName.set(name, info);
    }
    this.groups = [];
    for (let r = 0; mapGroup && r < mapGroup.rows; r++)
      this.groups.push({ row: r, nameId: mapGroup.u32(r, 0), mapData: mapGroup.u32(r, 8), mapDataIndoor: mapGroup.u32(r, 0x0c), firstMap: mapGroup.u32(r, 0x14), firstPoint: mapGroup.u32(r, 0x18), eventEntry: mapGroup.u32(r, 0x1c), stateFirst: mapGroup.u16(r, 0x28), stateCount: mapGroup.u8(r, 0x2a) });
    for (const p of parts) this.partsByEntry.set(p.entry, p.table);
    // sections put back or reverted by the session: read the documents again
    session.onMapReset((a) => {
      if (a !== content.archive.toUpperCase()) return;
      this.docs.clear();
      this.changed();
    });
  }

  /** The maps of a content (reads its archive when first asked for). */
  static async load(session: LanaiSession, content: LanaiContent): Promise<LanaiMaps> {
    const archive = await session.archive(content.archive);
    const mapDb = await session.mapDb(content.archive);
    if (!mapDb) throw new Error(`コンテンツ ${content.index} (${content.archive}) にマップ DB がありません`);
    const tables = await session.tablesIn(content.archive);
    // MapParts<name>: the type 11 tables of the content, by entry
    const parts = tables.filter((t) => t.table.name.startsWith('MapParts') && t.table.name !== 'MapPartsType').map((t) => ({ entry: t.entry, table: t.table }));
    return new LanaiMaps(session, content, archive, mapDb.db, tableNamed(tables, 'MapData'), tableNamed(tables, 'MapGroup'), tableNamed(tables, 'MapPartsType'), tableNamed(tables, 'MapResource'), parts, tables.map((t) => ({ entry: t.entry, table: t.table })));
  }

  // ---- change notices (the map page redraws on them)

  private readonly listeners = new Set<() => void>();
  /** Bumped by every change of the maps (edits, reverts). */
  revision = 0;

  on(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  changed(): void {
    this.revision++;
    for (const f of [...this.listeners]) f();
  }

  map(hash: number): LanaiMapInfo | undefined {
    return this.byHash.get(hash);
  }
  mapByName(name: string): LanaiMapInfo | undefined {
    return this.byName.get(name);
  }

  /** The document of a map (loaded once, then edited in place). */
  doc(info: LanaiMapInfo): MapDoc {
    let d = this.docs.get(info.hash);
    if (!d) {
      d = loadDoc(this.db, info, LANAI_MAP_FORMAT);
      this.docs.set(info.hash, d);
    }
    return d;
  }

  /** A map as it is in the ROM (a new document). */
  originalDoc(info: LanaiMapInfo): MapDoc {
    return loadDoc({ get: (h) => this.db.original(h) }, info, LANAI_MAP_FORMAT);
  }

  /** Whether a map's sections differ from the ROM's. */
  isChanged(info: LanaiMapInfo): boolean {
    return info.sections.some((h) => h && this.db.has(h) && !equalBytes(this.db.get(h), this.db.original(h)));
  }

  /** Section k of a document as bytes (what the database holds after saving). */
  sectionBytes(doc: MapDoc, k: number): Uint8Array {
    return sectionBytes(doc, k, LANAI_MAP_FORMAT);
  }

  /**
   * Write a document's sections back to the map database (call after editing it). A section that is the ROM's bytes
   * again drops its change, so the database is built byte for byte as the ROM's. The world maps are not edited.
   */
  commit(info: LanaiMapInfo): void {
    const d = this.docs.get(info.hash);
    if (!d || info.world) return;
    for (let k = 0; k < 10; k++) {
      const h = info.sections[k]!;
      if (k === 7 || !h || !this.db.has(h)) continue;
      const b = sectionBytes(d, k, LANAI_MAP_FORMAT);
      if (equalBytes(b, this.db.original(h))) this.db.revert(h);
      else if (!equalBytes(b, this.db.get(h))) this.db.set(h, b);
    }
    this.changed();
  }

  /** Put an edited copy of a document in place (undo / redo of the map page) and write it to the map database. */
  setDoc(info: LanaiMapInfo, doc: MapDoc): void {
    this.docs.set(info.hash, doc);
    this.commit(info);
  }

  /** Put a map back as it is in the ROM. */
  revert(info: LanaiMapInfo): void {
    for (const h of info.sections) if (h && this.db.has(h)) this.db.revert(h);
    this.docs.delete(info.hash);
    this.changed();
  }

  /** The EventObject table of a MapGroup (MapGroup +0x1C names its entry in the content's archive), if it is there. */
  eventTable(group: number): LanaiTable | undefined {
    const g = this.groups[group];
    return g?.eventEntry ? this.tables.find((t) => t.entry === g.eventEntry)?.table : undefined;
  }

  /** A table of the content's archive by its name ("MapChara"). */
  contentTable(name: string): LanaiTable | undefined {
    return tableNamed(this.tables, name);
  }

  /**
   * Append a copy of EventObject row `from` to a group's table, with a state slot of its own: the first slot of the
   * group (below its count) that no row uses, or 0xFFFF (the row number) when none is free. Returns the new row.
   */
  addEventRow(group: number, from: number): number {
    const t = this.eventTable(group);
    if (!t) throw new Error(`MapGroup ${group} の EventObject の表がありません`);
    if (from <= 0 || from >= t.rows) throw new RangeError(`EventObject の行 ${from} は写せません (表は ${t.rows} 行)`);
    const row = t.addRow(from);
    const used = new Set(Array.from({ length: row }, (_, r) => lanaiEventSlot(t, r)));
    const count = this.groups[group]?.stateCount ?? 0;
    let slot = 0;
    while (slot < count && used.has(slot)) slot++;
    t.setU16(row, LANAI_EVENT_SLOT, slot < count ? slot : LANAI_SLOT_IS_ROW);
    return row;
  }

  /** The rows of a group's EventObject table (an undo point of the map page). */
  eventRows(group: number): Uint8Array[] | null {
    const t = this.eventTable(group);
    return t ? Array.from({ length: t.rows }, (_, r) => t.row(r).slice()) : null;
  }

  /** Put a group's EventObject table back to rows saved by eventRows (rows added since are removed). */
  restoreEventRows(group: number, rows: Uint8Array[]): void {
    const t = this.eventTable(group);
    if (!t) return;
    while (t.rows > rows.length && t.rows > t.originalRows) t.removeLastRow();
    while (t.rows < rows.length) t.addRow();
    rows.forEach((b, r) => {
      if (r >= t.rows || equalBytes(b, t.row(r))) return;
      const was = t.originalRow(r);
      if (was && equalBytes(was, b)) t.revertRow(r);
      else t.setRow(r, b);
    });
    this.changed();
  }

  /** The content's MonsterGroup (section 6 names its rows by row ID). */
  get monsterGroup(): LanaiTable | undefined {
    return this.contentTable('MonsterGroup');
  }

  monsterGroups(): LanaiMonsterGroupRow[] {
    const t = this.monsterGroup;
    if (!t) return [];
    const n = Math.max(0, Math.min(MG_SLOTS, (t.rowSize - MG_SLOT0) >> 2));
    const end = MG_SLOT0 + MG_SLOTS * 4;
    return Array.from({ length: t.rows }, (_, row) => {
      const slots = Array.from({ length: n }, (_, i) => t.u32(row, MG_SLOT0 + i * 4));
      return {
        row,
        id: t.rowId(row),
        kind: t.u32(row, 0),
        slots,
        monsters: slots.filter((v) => v && v !== 0x80000000),
        tail: t.row(row).slice(end),
      };
    });
  }

  /**
   * Whether section 6 can name `value`: a row ID of the MonsterGroup (the game also takes a row number below the row
   * count; anything else becomes row 0: FUN_0031C038, map.md §5.7).
   */
  monsterGroupRow(value: number): number {
    return this.monsterGroup ? this.monsterGroup.find(value) : -1;
  }

  group(info: LanaiMapInfo): LanaiMapGroup | undefined {
    return this.groups[info.dungeon];
  }

  /** The name of a group ("水源どうくつ"), '' when it has none. */
  groupName(row: number): string {
    const g = this.groups[row];
    const msg = this.session.table('MessageMapName');
    if (!g || !g.nameId || !msg) return '';
    const r = msg.find(g.nameId);
    return r < 0 ? '' : this.session.plain(msg, r, 'message').trim();
  }

  // ---- tile models (§6)

  /** MapData row of a map (-1: none): its own row ID, else its group's (the indoor one when it has indoor tiles). */
  mapDataRow(info: LanaiMapInfo, doc: MapDoc): number {
    const md = this.mapData;
    if (!md) return -1;
    if (info.mapDataId && info.mapDataId !== 0x80000000) {
      const r = md.find(info.mapDataId);
      if (r >= 0) return r;
    }
    const g = this.group(info);
    if (!g) return -1;
    const indoor = doc.tiles.some((t) => t.kind + 1 >= 0x10 && t.kind + 1 <= 0x1c);
    return md.find(indoor && g.mapDataIndoor ? g.mapDataIndoor : g.mapData);
  }

  tileSource(info: LanaiMapInfo, doc: MapDoc): LanaiTileSource {
    const none: LanaiTileSource = { mapData: -1, tileset: 0, partsName: '', resource: 0, textureArchive: 0, textureEntry: 0 };
    const md = this.mapData;
    const row = this.mapDataRow(info, doc);
    if (!md || row < 0) return none;
    const tileset = md.row(row)[0x0a]!;
    const resource = md.row(row)[0x0b]!;
    const parts = this.partsTable(tileset);
    const res = this.mapResource && resource < this.mapResource.rows ? this.mapResource : undefined;
    return {
      mapData: row,
      tileset,
      partsName: parts?.name ?? '',
      resource,
      textureArchive: res ? res.u32(resource, 0) : 0,
      textureEntry: res ? res.u32(resource, 4) : 0,
    };
  }

  /** The MapParts<name> table of a tileset (MapPartsType row). */
  partsTable(tileset: number): LanaiTable | undefined {
    const pt = this.partsType;
    return pt && tileset < pt.rows ? this.partsByEntry.get(pt.u32(tileset, 0)) : undefined;
  }

  /** The model a tile kind and letter index (0..7) name in the map's tileset; null = none (kind 33 and the like). */
  partRef(src: Pick<LanaiTileSource, 'tileset'>, kind: number, letter: number): LanaiPartRef | null {
    const parts = this.partsTable(src.tileset);
    const r = kind + 1;
    if (!parts || r >= parts.rows || letter < 0 || letter > 7) return null;
    const archive = parts.u32(r, letter * 8), entry = parts.u32(r, letter * 8 + 4);
    return archive && entry ? { archive, entry } : null;
  }

  /** The GSC entry of a tile kind and letter index in a tileset (0 = none): the palette keys its models by it. */
  partModel(tileset: number, kind: number, letter: number): number {
    return this.partRef({ tileset }, kind, letter)?.entry ?? 0;
  }

  /**
   * Tile kinds with a model in a tileset: kind -> letter indices worth offering (letters that repeat a model already
   * listed are left out), as RPG3's palette.
   */
  palette(tileset: number): Map<number, number[]> {
    const out = new Map<number, number[]>();
    const parts = this.partsTable(tileset);
    for (let kind = 0; parts && kind + 1 < parts.rows; kind++) {
      const base = this.partModel(tileset, kind, 0);
      const letters: number[] = base ? [0] : [];
      const seen = new Set(base ? [base] : []);
      for (let l = 1; l < 8; l++) {
        const h = this.partModel(tileset, kind, l);
        if (h && !seen.has(h)) {
          seen.add(h);
          letters.push(l);
        }
      }
      if (letters.length) out.set(kind, letters);
    }
    return out;
  }
}
