// The maps of a 電波人間のRPG FREE! (lanai) content (naauao lanai/map.md): every content (stage) has a map database
// (entry C9F79000) and a map table (131C5000, 0x4C bytes a row) of its own, the sections of a map as RPG2's editing
// model (game/sections.ts MapDoc, with RPG FREE!'s record layouts and 1 / 2 / 4 / 8 facings), and the tile models:
// MapData -> MapPartsType (tileset) -> MapParts<name> -> a GSC of the root archive that the pair names.
import { findEntry, unpackEntry, type Archive } from '../archive/gsarc';
import { MapDb } from '../game/mapdb';
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
}

const loaded = new WeakMap<LanaiSession, Map<number, Promise<LanaiMaps>>>();

/** The maps of a content, read once per session (the pages share the documents). */
export function lanaiMaps(session: LanaiSession, content: LanaiContent): Promise<LanaiMaps> {
  const m = loaded.get(session) ?? new Map<number, Promise<LanaiMaps>>();
  loaded.set(session, m);
  let p = m.get(content.index);
  if (!p) {
    p = LanaiMaps.load(session, content);
    p.catch(() => m.delete(content.index));
    m.set(content.index, p);
  }
  return p;
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
    private readonly mapData: LanaiTable | undefined,
    private readonly mapGroup: LanaiTable | undefined,
    private readonly partsType: LanaiTable | undefined,
    private readonly mapResource: LanaiTable | undefined,
    parts: { entry: number; table: LanaiTable }[],
  ) {
    const dbEntry = findEntry(archive, LANAI_MAPDB_ENTRY);
    const tableEntry = findEntry(archive, LANAI_MAP_TABLE_ENTRY);
    if (!dbEntry || !tableEntry) throw new Error(`コンテンツ ${content.index} (${content.archive}) にマップ DB / マップ表がありません`);
    this.db = new MapDb(unpackEntry(archive, dbEntry).body);
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
      this.groups.push({ row: r, nameId: mapGroup.u32(r, 0), mapData: mapGroup.u32(r, 8), mapDataIndoor: mapGroup.u32(r, 0x0c), firstMap: mapGroup.u32(r, 0x14), firstPoint: mapGroup.u32(r, 0x18), eventEntry: mapGroup.u32(r, 0x1c) });
    for (const p of parts) this.partsByEntry.set(p.entry, p.table);
  }

  /** The maps of a content (reads its archive when first asked for). */
  static async load(session: LanaiSession, content: LanaiContent): Promise<LanaiMaps> {
    const archive = await session.archive(content.archive);
    const tables = await session.tablesIn(content.archive);
    // MapParts<name>: the type 11 tables of the content, by entry
    const parts = tables.filter((t) => t.table.name.startsWith('MapParts') && t.table.name !== 'MapPartsType').map((t) => ({ entry: t.entry, table: t.table }));
    return new LanaiMaps(session, content, archive, tableNamed(tables, 'MapData'), tableNamed(tables, 'MapGroup'), tableNamed(tables, 'MapPartsType'), tableNamed(tables, 'MapResource'), parts);
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
  partRef(src: LanaiTileSource, kind: number, letter: number): LanaiPartRef | null {
    const parts = this.partsTable(src.tileset);
    const r = kind + 1;
    if (!parts || r >= parts.rows || letter < 0 || letter > 7) return null;
    const archive = parts.u32(r, letter * 8), entry = parts.u32(r, letter * 8 + 4);
    return archive && entry ? { archive, entry } : null;
  }
}
