// The maps of a 電波人間のRPG FREE! (lanai) content (naauao lanai/map.md): every content (stage) has a map database
// (entry C9F79000) and a map table (131C5000, 0x4C bytes a row) of its own, the sections of a map as RPG2's editing
// model (game/sections.ts MapDoc, with RPG FREE!'s record layouts and 1 / 2 / 4 / 8 facings), and the tile models:
// MapData -> MapPartsType (tileset) -> MapParts<name> -> a GSC of the root archive that the pair names.
import type { Archive } from '../archive/gsarc';
import type { MapDb } from '../game/mapdb';
import {
  LANAI_ROT_CODEC,
  loadDoc,
  sectionBytes,
  type MapDoc,
  type MapFormat,
  type RecordLayout,
} from '../game/sections';
import { cstr, equalBytes, s32, u32 } from '../util/bytes';
import type { LanaiContent } from './contents';
import { lanaiCharaRowBytes } from './mapObjects';
import { encodeLanaiMessage, lanaiMessageBytes, parseLanaiText } from './message';
import { setTalkVoice, talkColumns, talkVoice, TALK_SPEAKER, TALK_TONES } from './talk';
import type { LanaiMapDb, LanaiSession } from './session';
import type { LanaiTable } from './table';

/** Entries of a content's archive: the map database and the map table (MapDataResource rows 0 / 1). */
export const LANAI_MAPDB_ENTRY = 0xc9f79000;
export const LANAI_MAP_TABLE_ENTRY = 0x131c5000;
export const LANAI_MAP_ROW = 0x4c;
const MAP_ROW = LANAI_MAP_ROW;
export const LANAI_MAP_NAME_OFFSET = 0x40;
const NAME_OFFSET = LANAI_MAP_NAME_OFFSET;
/** The longest map name (+0x40, 12 bytes with its terminator). */
export const LANAI_MAP_NAME_MAX = 11;

/** Slot of the map table row that holds section k (section k = slot k; section 7 has no data, 8 / 9 moved up). */
export const LANAI_SECTION_SLOT = [0, 1, 2, 3, 4, 5, 6, -1, 7, 8] as const;

/** Older Panana maps omitted empty sections. Update 0x2B164C reads slots 0–8 with lower_bound
 * and uses the next entry's offset and size without checking its hash. All 553 normal ROM maps
 * index each of these slots, with size zero for an empty section. World maps have a different layout. */
export function restoreMissingLanaiSections(db: MapDb, table: Uint8Array): number {
  let restored = 0;
  for (let row = 0; row + MAP_ROW <= table.length; row += MAP_ROW) {
    if (table[row + NAME_OFFSET] === 0x57) continue; // W01 / W02
    for (const slot of LANAI_SECTION_SLOT) {
      if (slot < 0) continue;
      const hash = u32(table, row + slot * 4);
      if (db.has(hash)) continue;
      db.add(hash, new Uint8Array());
      restored++;
    }
  }
  return restored;
}

/**
 * Record layouts of the sections (§3): oahu's, with the treasure and character positions in 100 units. Every offset
 * is added × 100 (checked in the Update's code.bin: sections 2 / 4 / 5 / 8 / 3).
 */
export const LANAI_LAYOUTS: Record<number, RecordLayout> = {
  1: { size: 16, xo: 0, yo: 2, unit: 'cell', label: '床のギミック (区画 1)' },
  2: { size: 20, xo: 4, yo: 6, unit: 'fine', fxo: 8, fyo: 0x0c, label: '置物 (区画 2)' },
  3: { size: 24, xo: 8, yo: 0x0a, unit: 'cell', fxo: 0x0c, fyo: 0x10, label: '出入口 (区画 3)' },
  4: { size: 24, xo: 8, yo: 0x0a, unit: 'fine', fxo: 0x0c, fyo: 0x10, label: '宝箱 (区画 4)' },
  // characters: world = 100 + v × 100 + d × 100 (FUN_0021c844 of the Update's code.bin; the others start at 50)
  5: {
    size: 32,
    xo: 8,
    yo: 0x0a,
    unit: 'fine',
    fxo: 0x0c,
    fyo: 0x10,
    base: 100,
    label: 'キャラ・オブジェクト (区画 5)',
  },
  8: { size: 32, xo: 8, yo: 0x0a, unit: 'fine', fxo: 0x0c, fyo: 0x10, label: 'イベントの範囲 (区画 8)' },
  9: { size: 24, xo: 0x0c, yo: 0x0e, unit: 'fine', label: '地点 (区画 9)' },
};

/** Tiles are 20 bytes with the facing at +0x10 as a 1 / 2 / 4 / 8 mask (§3.1). */
export const LANAI_MAP_FORMAT: MapFormat = {
  tile: { size: 20, rot: 0x10, letter: 0x11, pad: 0x12, rotCodec: LANAI_ROT_CODEC },
  layouts: LANAI_LAYOUTS,
};

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
// Kinds 0 / 1 / 8 / 10 / 11 / 13〜15 / 19 / 28〜69: ROM survey of Issue #219 (2,258 records of 553 maps) and the
// Update code.bin (0x21D970〜 placement by kind, 0x1F841C bottom-screen icon by kind). 9 (no record in the ROM) and
// 17 / 18 (no action; how they open is unknown) keep their numbers.
export const LANAI_EXIT_KIND: Record<number, string> = {
  0: 'マップの門',
  1: 'ワールドへの門',
  2: 'ワープホール',
  3: 'クリアのワープ',
  4: 'ワープゲート',
  5: '上り階段',
  6: '下り階段',
  // 40 of the ROM's 54 have the action 0x1D (穴、HoleFallCommon), the rest a script
  7: '落とし穴',
  8: '落下の到着点',
  10: '見えない出入口',
  11: '到着点',
  12: '扉',
  13: '鍵つき扉',
  14: '移動扉',
  15: '像をはめる扉',
  16: 'レベルの扉',
  19: '裏口',
  68: '崖の降下点',
  100: '壁の扉',
};
/** Kinds 28〜69 (but 68): a building's door, each kind with its own default model (twn_bill*). */
export const lanaiIsBuildingExit = (k: number): boolean => k >= 28 && k <= 69 && k !== 68;
/** What the ROM tells of a kind (the add panel's tooltip); the certainty is said where it is a guess. */
export const LANAI_EXIT_NOTE: Record<number, string> = {
  0: '同じステージの別のマップへ移る門。',
  1: 'ワールドマップへ出る門。',
  8: '落とし穴や崖から落ちた先の地点。見た目も動作もなく、落とし穴・崖の行き先に選ぶ。',
  9: 'ROM のステージに配置例がなく、用途がわかっていない。',
  10: '見た目のない出入口。別のマップへ移る。',
  11: '見た目も動作もない地点。ワープや門の行き先に選ぶ。下画面には表示されない。',
  13: '鍵となるアイテムを持っていると開く扉。',
  14: '別のマップへ移る扉。移る前に確認するものとしないものがある。',
  15: '像をはめると開く扉。',
  17: '動作を持たない扉。開け方がわかっていない。',
  18: '動作を持たない扉。開け方がわかっていない。',
  19: '見た目のない裏口。別のマップへ移る。',
  68: '崖を降りる地点。降りた先は「落下の到着点」。',
};
export const lanaiExitNote = (k: number): string =>
  LANAI_EXIT_NOTE[k] ?? (lanaiIsBuildingExit(k) ? '建物の扉。種類ごとに建物の見た目が違う。' : '');
export const lanaiExitKind = (raw: Uint8Array): number => raw[0x15] ?? 0;
/** The exit kind (+0x15) of the level door (MapObject #49 gimk_03_gate_06 when the row has no look). */
export const LANAI_LEVEL_DOOR_KIND = 16;
/**
 * EventObject +0x5C of a level door: the level the door asks for (the "X" of its LvX; the ROM's 14 doors with the
 * model have 5 / 10 / 30 / 40 / 50 / 60 there, every other door 0). Ranges (section 8) keep a flag in bit 15 of the
 * same field (rangeShape.ts).
 */
export const LANAI_EVENT_LEVEL = 0x5c;
/**
 * Section 1 +0x0D: the kind of a floor gimmick (0〜3 in the ROM). Kind 1 is the poison floor and kind 3 the frozen
 * (slippery) floor, both seen in the game by the user. Update FUN_0021C534 @0x21C588 picks the model: 0 MapObject #90
 * gimk_08_damg5_01, 1 #89 gimk_07_damg3_01, 2 / 3 #113 gimk_16_frozen_3; 0 and 1 both set the hazard flag (+0x5476,
 * @0x21C738), so 0 is a damage floor of another model (how much it takes is not known); only 3 sets the cell's
 * slippery bit (+0x0A bit 1, @0x21C784), so 2 is a frozen floor that does not slide (roms/tmpmap/kinds-gaps-findings.md).
 */
export const LANAI_FLOOR_KIND = 0x0d;
export const LANAI_FLOOR_POISON = 1;
export const LANAI_FLOOR_ICE = 3;
export const LANAI_FLOOR_KINDS: Record<number, string> = {
  0: 'ダメージ床',
  [LANAI_FLOOR_POISON]: '毒床',
  2: '凍った床 (すべらない)',
  [LANAI_FLOOR_ICE]: '凍った床',
};
export const lanaiFloorKindLabel = (kind: number): string => LANAI_FLOOR_KINDS[kind] ?? `床のギミック ${kind}`;
export const lanaiExitLabel = (k: number): string =>
  LANAI_EXIT_KIND[k] ?? (lanaiIsBuildingExit(k) ? `建物の入口 ${k}` : `種類 ${k}`);
/** The add panel's group of an exit kind: a building's door, a door, or a way out (arrival points too). */
export const lanaiExitCategory = (k: number): '建物' | '扉' | '出入口・移動' =>
  lanaiIsBuildingExit(k) ? '建物' : (k >= 12 && k <= 19) || k === 100 ? '扉' : '出入口・移動';
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
/** The content's table of chests' contents (treasure.ts). */
export const LANAI_TREASURE_TABLE = 'TreasureGroup';

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
  /** The row's ten slots as written (+0x00〜+0x24): the world maps use them by slot, slot 9 being the terrain (worldmap.ts). */
  slots: number[];
  /** +0x28: row ID of MapData (0 / 0x80000000 = the group's). */
  mapDataId: number;
  /** +0x2C: MapGroup row of the content (named `dungeon` as RPG2's map info). */
  dungeon: number;
  /** +0x30: how the enemies come (3 / 4 / 5, 0 = none; 推定). */
  encounterLevel: number;
  floor: number;
  /** A world map (W01 / W02): its slots have another shape and are edited on the world page (worldmap.ts). */
  world: boolean;
  /** Added by an edit (mapadd.ts): its row follows the ROM's rows of the map table. */
  added: boolean;
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
  /** Entry of the group's talk table (`*_msg`, +0x24; 0: the content's MessageContents): the lines of its NPCs. */
  talkEntry: number;
  /** The group's state slots (+0x28 u16 first, +0x2A u8 count; map.md §7): EventObject slots from the count on are not saved. */
  stateFirst: number;
  stateCount: number;
}

/** A row of the content's MonsterGroup (what section 6 names by row ID). */
export interface LanaiMonsterGroupRow {
  row: number;
  id: number;
  /** +0x00: the battle field's row ID (monsterGroup.ts LANAI_MG_FIELD); not a monster (#130). */
  kind: number;
  /** +0x04〜+0x64: 25 MonsterParameter row IDs as written (0 = none; 0x80000000 = row 0, the empty monster). */
  slots: number[];
  /** The MonsterParameter row IDs of the group (the slots, empty ones left out). */
  monsters: number[];
  /** The bytes after the slots (+0x68 on: limit, flags, weights and count codes; monsterGroup.ts). */
  tail: Uint8Array;
}

/** A map that uses a MonsterGroup row (LanaiMaps.monsterGroupUses). */
export interface LanaiMonsterGroupUse {
  map: string;
  /** 'map' = the map's group (section 6 header), else the number of cells with this group. */
  cells: number | 'map';
}

/** MonsterGroup rows: +0x00 battle field, then 25 u32 monster slots from +0x04 (lists A〜E: monsterGroup.ts; 0x9C bytes a row). */
export const LANAI_MG_SLOTS = 25;
export const LANAI_MG_SLOT0 = 0x04;

const loaded = new WeakMap<LanaiSession, Map<number, Promise<LanaiMaps>>>();
const ready = new WeakMap<LanaiSession, Map<number, LanaiMaps>>();

/** The maps of a content, read once per session (the pages share the documents). */
/** Forgets the maps read of the contents from `first` on (their numbers now name other contents). */
export function forgetLanaiMaps(session: LanaiSession, first: number): void {
  for (const m of [loaded.get(session), ready.get(session)])
    if (m) for (const k of [...m.keys()]) if (k >= first) m.delete(k);
}

export function lanaiMaps(session: LanaiSession, content: LanaiContent): Promise<LanaiMaps> {
  const m = loaded.get(session) ?? new Map<number, Promise<LanaiMaps>>();
  loaded.set(session, m);
  let p = m.get(content.index);
  // A content added and taken out again (revertAll) and added anew keeps its number, but the session reads its archive
  // and map database again: maps read for the old one would edit a store the session no longer exports.
  const read = ready.get(session)?.get(content.index);
  if (p && read && (read.content.archive !== content.archive || read.store !== session.readMapDb(content.archive))) {
    ready.get(session)!.delete(content.index);
    p = undefined;
  }
  if (!p) {
    p = LanaiMaps.load(session, content);
    p.then(
      (maps) => {
        const r = ready.get(session) ?? new Map<number, LanaiMaps>();
        ready.set(session, r);
        r.set(content.index, maps);
      },
      () => m.delete(content.index),
    );
    m.set(content.index, p);
  }
  return p;
}

/** The maps of a content if they have been read already (the map picker lists them without reading every content). */
export function loadedLanaiMaps(session: LanaiSession, content: number): LanaiMaps | undefined {
  return ready.get(session)?.get(content);
}

const tableNamed = (tables: { table: LanaiTable }[], name: string): LanaiTable | undefined =>
  tables.find((t) => t.table.name === name)?.table;

export class LanaiMaps {
  readonly maps: LanaiMapInfo[] = [];
  readonly db: MapDb;
  readonly groups: LanaiMapGroup[] = [];
  private readonly byHash = new Map<number, LanaiMapInfo>();
  private readonly byName = new Map<string, LanaiMapInfo>();
  private readonly docs = new Map<number, MapDoc>();
  private readonly partsByEntry = new Map<number, LanaiTable>();

  private constructor(
    readonly session: LanaiSession,
    readonly content: LanaiContent,
    readonly archive: Archive,
    /** The content's map database and map table, shared with the session (it saves and exports them). */
    readonly store: LanaiMapDb,
    private readonly mapData: LanaiTable | undefined,
    /** The content's MapGroup (mapadd.ts adds rows to it). */
    readonly mapGroup: LanaiTable | undefined,
    private readonly partsType: LanaiTable | undefined,
    private readonly mapResource: LanaiTable | undefined,
    parts: { entry: number; table: LanaiTable }[],
    /** The content's tables (the EventObject tables of the groups among them). */
    private readonly tables: { entry: number; table: LanaiTable }[],
  ) {
    if (!store.table) throw new Error(`コンテンツ ${content.index} (${content.archive}) にマップ表がありません`);
    this.db = store.db;
    this.read();
    for (const p of parts) this.partsByEntry.set(p.entry, p.table);
    // sections put back or reverted by the session: read the documents (and the map table) again
    session.onMapReset((a) => {
      if (a !== content.archive.toUpperCase()) return;
      this.docs.clear();
      // the tables the session took out (added ones, reverted) leave the content's tables
      for (let i = this.tables.length - 1; i >= 0; i--)
        if (!session.refOf(this.tables[i]!.table)) this.tables.splice(i, 1);
      this.read();
      this.changed();
    });
  }

  /** The bytes of the map table (as edited). */
  get tableBytes(): Uint8Array {
    return this.store.table!.data;
  }

  /** Puts new bytes of the map table in place (rows added or names written) and reads the maps and groups again. */
  setTableBytes(bytes: Uint8Array): void {
    if (bytes.length % MAP_ROW) throw new Error('マップ表の大きさが行 (0x4C) の倍数ではありません');
    const t = this.store.table!;
    t.data = equalBytes(bytes, t.original) ? t.original : bytes;
    this.read();
    this.changed();
  }

  /** Rows of the map table as read from the ROM (the rows after them were added). */
  get originalMapRows(): number {
    return this.store.table!.original.length / MAP_ROW;
  }

  /** Reads the map table and the MapGroup rows (again). */
  read(): void {
    const t = this.tableBytes;
    const rom = this.originalMapRows;
    this.maps.length = 0;
    this.byHash.clear();
    this.byName.clear();
    for (let i = 0; i + MAP_ROW <= t.length; i += MAP_ROW) {
      const slots = Array.from({ length: 10 }, (_, k) => u32(t, i + k * 4));
      const name = cstr(t.subarray(i + NAME_OFFSET, i + MAP_ROW), 0);
      const info: LanaiMapInfo = {
        index: i / MAP_ROW,
        hash: slots[0]!,
        name,
        sections: LANAI_SECTION_SLOT.map((s) => (s < 0 ? 0 : slots[s]!)),
        slots,
        mapDataId: u32(t, i + 0x28),
        dungeon: u32(t, i + 0x2c),
        encounterLevel: s32(t, i + 0x30),
        floor: s32(t, i + 0x34),
        world: name.startsWith('W'),
        added: i / MAP_ROW >= rom,
      };
      this.maps.push(info);
      this.byHash.set(info.hash, info);
      this.byName.set(name, info);
    }
    this.readGroups();
  }

  /** Reads the MapGroup rows (again, after rows were added or changed). */
  readGroups(): void {
    const mapGroup = this.mapGroup;
    this.groups.length = 0;
    for (let r = 0; mapGroup && r < mapGroup.rows; r++)
      this.groups.push({
        row: r,
        nameId: mapGroup.u32(r, 0),
        mapData: mapGroup.u32(r, 8),
        mapDataIndoor: mapGroup.u32(r, 0x0c),
        firstMap: mapGroup.u32(r, 0x14),
        firstPoint: mapGroup.u32(r, 0x18),
        eventEntry: mapGroup.u32(r, 0x1c),
        talkEntry: mapGroup.u32(r, 0x24),
        stateFirst: mapGroup.u16(r, 0x28),
        stateCount: mapGroup.u8(r, 0x2a),
      });
  }

  /** The content's tables (the EventObject tables of the groups and the tables added to the archive among them). */
  get contentTables(): { entry: number; table: LanaiTable }[] {
    return this.tables;
  }

  /** Puts a table the session added to the archive among the content's tables (a new group's EventObject table). */
  addContentTable(entry: number, table: LanaiTable): void {
    this.tables.push({ entry, table });
  }

  /** Takes out a table addContentTable put in. */
  removeContentTable(entry: number): void {
    const i = this.tables.findIndex((t) => t.entry === entry);
    if (i >= 0) this.tables.splice(i, 1);
  }

  /** The maps of a content (reads its archive when first asked for). */
  static async load(session: LanaiSession, content: LanaiContent): Promise<LanaiMaps> {
    const archive = await session.archive(content.archive);
    const mapDb = await session.mapDb(content.archive);
    if (!mapDb) throw new Error(`コンテンツ ${content.index} (${content.archive}) にマップ DB がありません`);
    const tables = await session.tablesIn(content.archive);
    // MapParts<name>: the type 11 tables of the content, by entry
    const parts = tables
      .filter((t) => t.table.name.startsWith('MapParts') && t.table.name !== 'MapPartsType')
      .map((t) => ({ entry: t.entry, table: t.table }));
    return new LanaiMaps(
      session,
      content,
      archive,
      mapDb,
      tableNamed(tables, 'MapData'),
      tableNamed(tables, 'MapGroup'),
      tableNamed(tables, 'MapPartsType'),
      tableNamed(tables, 'MapResource'),
      parts,
      tables.map((t) => ({ entry: t.entry, table: t.table })),
    );
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

  /** Whether a map's sections differ from the ROM's (an added map is not: it has no ROM's sections to go back to). */
  isChanged(info: LanaiMapInfo): boolean {
    if (info.added) return false;
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
      if (k === 7 || !h) continue;
      const b = sectionBytes(d, k, LANAI_MAP_FORMAT);
      // a section the database does not have (empty in the ROM, or of an added map) is added once it has bytes
      if (!this.db.has(h)) {
        if (b.length) this.db.add(h, b);
      } else if (this.db.isAdded(h)) {
        if (!equalBytes(b, this.db.get(h))) this.db.set(h, b);
      } else if (equalBytes(b, this.db.original(h))) this.db.revert(h);
      else if (!equalBytes(b, this.db.get(h))) this.db.set(h, b);
    }
    this.changed();
  }

  /** Put an edited copy of a document in place (undo / redo of the map page) and write it to the map database. */
  setDoc(info: LanaiMapInfo, doc: MapDoc): void {
    this.docs.set(info.hash, doc);
    this.commit(info);
  }

  /** Put a map back as it is in the ROM (the sections the ROM did not have are taken out). */
  revert(info: LanaiMapInfo): void {
    for (const h of info.sections)
      if (h && this.db.has(h)) {
        if (this.db.isAdded(h)) this.db.remove(h);
        else this.db.revert(h);
      }
    this.docs.delete(info.hash);
    this.changed();
  }

  /** The EventObject table of a MapGroup (MapGroup +0x1C names its entry in the content's archive), if it is there. */
  eventTable(group: number): LanaiTable | undefined {
    const g = this.groups[group];
    return g?.eventEntry ? this.tables.find((t) => t.entry === g.eventEntry)?.table : undefined;
  }

  /**
   * The talk table of a MapGroup: the rows the talking actions of its EventObject rows name (actions.ts). MapGroup +0x24
   * names its `*_msg` entry in the content's archive; a group with 0 there (the towns and the story contents, about half
   * of the groups) uses the content's MessageContents (ROM: every talking NPC of such groups names a row of it, and the
   * rows are their lines).
   */
  talkTable(group: number): LanaiTable | undefined {
    const g = this.groups[group];
    if (!g) return undefined;
    return g.talkEntry ? this.tables.find((t) => t.entry === g.talkEntry)?.table : this.contentTable('MessageContents');
  }

  /**
   * Append a line to a group's talk table and return its row (what the talking actions name: actions.ts). The row is a
   * copy of one of the table's rows (so that its message field is a string field) with the message `text` (the text
   * form of message.ts), the speaker kind `speaker` (+0x08: 0 for a sign, 18 for most NPCs of the ROM) and no voice
   * (the ROM's NPC lines have an empty one).
   */
  addTalkRow(group: number, text: string, speaker: number): number {
    const t = this.talkTable(group);
    if (!t) throw new Error(`MapGroup ${group} の台詞の表がありません`);
    return lanaiAppendTalkRow(t, encodeLanaiMessage(parseLanaiText(text)), speaker);
  }

  /**
   * Append the eight tones of a line of the lead 電波人間 to a group's talk table (speaker kinds 1〜8 in a row, what
   * StartMessageAuto picks from) and return the first row, whose ID the script names. `texts` are the tones 1〜8.
   */
  addTalkSet(group: number, texts: string[]): number {
    const t = this.talkTable(group);
    if (!t) throw new Error(`MapGroup ${group} の台詞の表がありません`);
    return lanaiAppendTalkSet(t, texts);
  }

  /** The lines an edit added to a group's talk table (an undo point of the map page; the ROM's rows are not in it). */
  talkRows(group: number): LanaiTalkRows | null {
    const t = this.talkTable(group);
    const cols = t && talkColumns({ table: t });
    if (!t || !cols) return null;
    const added: LanaiTalkRows['added'] = [];
    for (let r = t.originalRows; r < t.rows; r++)
      added.push({
        speaker: t.u8(r, TALK_SPEAKER),
        message: t.isString(r, cols.message) ? lanaiMessageBytes(t.data, t.u32(r, cols.message)).slice() : null,
        voice: talkVoice({ table: t }, r),
      });
    return { group, rows: t.rows, added };
  }

  /**
   * Put a group's talk table back to the number of rows saved by talkRows: rows added since are removed, rows removed
   * since are added again with their text. The rows both have keep the text they have now (it is edited in the
   * message editor, outside the undo points).
   */
  restoreTalkRows(saved: LanaiTalkRows): void {
    const t = this.talkTable(saved.group);
    if (!t) return;
    while (t.rows > saved.rows && t.rows > t.originalRows) t.removeLastRow();
    for (let r = t.rows; r < saved.rows; r++) {
      const row = saved.added[r - t.originalRows];
      if (!row?.message) break;
      const added = lanaiAppendTalkRow(t, row.message, row.speaker);
      if (row.voice) setTalkVoice({ table: t }, added, row.voice);
    }
  }

  /** A table of the content's archive by its name ("MapChara"). */
  contentTable(name: string): LanaiTable | undefined {
    return tableNamed(this.tables, name);
  }

  /** Puts a MapParts<name> table the session added to the archive among the tilesets (tilesets.ts). */
  addPartsTable(entry: number, table: LanaiTable): void {
    this.partsByEntry.set(entry, table);
  }

  /**
   * Append a copy of EventObject row `from` to a group's table, with a state slot of its own: the first slot of the
   * group (below its count) that no row uses, or 0xFFFF (the row number) when none is free. Returns the new row.
   */
  addEventRow(group: number, from: number): number {
    const t = this.eventTable(group);
    if (!t) throw new Error(`MapGroup ${group} の EventObject の表がありません`);
    if (from <= 0 || from >= t.rows) throw new RangeError(`イベント番号 ${from} は写せません (表は ${t.rows} 件)`);
    return this.giveSlot(group, t, t.addRow(from));
  }

  /**
   * Append a new EventObject row to a group's table: a copy of row 0 (the empty row: no action, the end's padding)
   * with the first action `action` and the look (+0x5A) `look`, with a state slot of its own. Returns the new row.
   */
  addNewEventRow(group: number, action: number, look: number): number {
    const t = this.eventTable(group);
    if (!t) throw new Error(`MapGroup ${group} の EventObject の表がありません`);
    if (!t.rows) throw new Error(`${t.name} に行 0 がありません`);
    const row = t.addRow(0);
    t.setU32(row, LANAI_EVENT_ACTIONS[0], action);
    t.setU16(row, 0x5a, look);
    return this.giveSlot(group, t, row);
  }

  /**
   * Append an EventObject row of the bytes `bytes` (a row of another content: romParts.ts romEventRow) with the look
   * `look` and a state slot of its own. Returns the new row.
   */
  addEventRowBytes(group: number, bytes: Uint8Array, look: number): number {
    const t = this.eventTable(group);
    if (!t) throw new Error(`MapGroup ${group} の EventObject の表がありません`);
    if (!t.rows) throw new Error(`${t.name} に行 0 がありません`);
    if (bytes.length !== t.rowSize)
      throw new Error(`EventObject の行の大きさが違います (${bytes.length} / ${t.rowSize})`);
    const row = t.addRow(0);
    t.setRow(row, bytes);
    t.setU16(row, 0x5a, look);
    return this.giveSlot(group, t, row);
  }

  /**
   * Append a MapChara row to the content (the looks of its characters: EventObject +0x5A of section 5 kinds 0〜2): an
   * NPC (kind 0) of a MapObject row or a monster (kind 1) of a MonsterDesign row. The motions are taken from a row of
   * the same kind when the content has one (mapObjects.ts lanaiCharaRowBytes). Returns the new row.
   */
  addCharaRow(kind: number, model: number): number {
    const t = this.contentTable('MapChara');
    if (!t) throw new Error('このコンテンツには MapChara の表がありません');
    if (t.rowSize !== 0x30) throw new Error(`MapChara の行の大きさが ${t.rowSize} です (0x30 のはず)`);
    let donor: Uint8Array | undefined;
    for (let r = 1; r < t.rows && !donor; r++) if ((t.u32(r, 0) & 7) === kind) donor = t.row(r);
    const row = t.addRow();
    t.setRow(row, lanaiCharaRowBytes(kind, model, donor));
    return row;
  }

  /** Give a row added to a group's table the first state slot no other row uses (or 0xFFFF: the row number). */
  private giveSlot(group: number, t: LanaiTable, row: number): number {
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
    return t ? tableRows(t) : null;
  }

  /** Put a group's EventObject table back to rows saved by eventRows (rows added since are removed). */
  restoreEventRows(group: number, rows: Uint8Array[]): void {
    const t = this.eventTable(group);
    if (!t) return;
    restoreTableRows(t, rows);
    this.changed();
  }

  /** The content's TreasureGroup (chests' contents: treasure.ts), named by row number from a chest's EventObject row. */
  get treasureGroup(): LanaiTable | undefined {
    return this.contentTable(LANAI_TREASURE_TABLE);
  }

  /** The rows of the TreasureGroup (an undo point of the map page). */
  treasureRows(): Uint8Array[] | null {
    const t = this.treasureGroup;
    return t ? tableRows(t) : null;
  }

  /** Put the TreasureGroup back to rows saved by treasureRows. */
  restoreTreasureRows(rows: Uint8Array[]): void {
    const t = this.treasureGroup;
    if (!t) return;
    restoreTableRows(t, rows);
    this.changed();
  }

  /** The content's MonsterGroup (section 6 names its rows by row ID). */
  get monsterGroup(): LanaiTable | undefined {
    return this.contentTable('MonsterGroup');
  }

  monsterGroups(): LanaiMonsterGroupRow[] {
    const t = this.monsterGroup;
    if (!t) return [];
    const n = Math.max(0, Math.min(LANAI_MG_SLOTS, (t.rowSize - LANAI_MG_SLOT0) >> 2));
    const end = LANAI_MG_SLOT0 + LANAI_MG_SLOTS * 4;
    return Array.from({ length: t.rows }, (_, row) => {
      const slots = Array.from({ length: n }, (_, i) => t.u32(row, LANAI_MG_SLOT0 + i * 4));
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

  /**
   * MonsterGroup row -> the maps of the content that use it (the current documents, so edits show up): 'map' for the
   * map's group (the section 6 header), else the number of cells. Values the table does not have are left out.
   */
  monsterGroupUses(): Map<number, LanaiMonsterGroupUse[]> {
    const out = new Map<number, LanaiMonsterGroupUse[]>();
    if (!this.monsterGroup) return out;
    const add = (value: number, use: LanaiMonsterGroupUse): void => {
      const row = this.monsterGroupRow(value);
      if (row >= 0) out.set(row, [...(out.get(row) ?? []), use]);
    };
    for (const m of this.maps) {
      if (m.world) continue;
      const doc = this.doc(m);
      if (doc.sec6Header.length >= 4) add(u32(doc.sec6Header, 0), { map: m.name, cells: 'map' });
      const cells = new Map<number, number>();
      for (const c of doc.cells6) cells.set(c.value, (cells.get(c.value) ?? 0) + 1);
      for (const [value, n] of cells) add(value, { map: m.name, cells: n });
    }
    return out;
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
    const none: LanaiTileSource = {
      mapData: -1,
      tileset: 0,
      partsName: '',
      resource: 0,
      textureArchive: 0,
      textureEntry: 0,
    };
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
    const archive = parts.u32(r, letter * 8),
      entry = parts.u32(r, letter * 8 + 4);
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

/** The rows an edit added to a talk table (LanaiMaps.talkRows). */
export interface LanaiTalkRows {
  group: number;
  /** Rows of the table then. */
  rows: number;
  /** The rows after the ROM's: the speaker kind and the message's bytes (null: the field is not a string). */
  added: { speaker: number; message: Uint8Array | null; voice?: string }[];
}

/** Appends a row with the message `bytes` (encoded, with its terminator) to a talk table; returns its row. */
export function lanaiAppendTalkRow(t: LanaiTable, bytes: Uint8Array, speaker: number): number {
  const cols = talkColumns({ table: t });
  if (!cols) throw new Error(`${t.name} は台詞の表ではありません`);
  let donor = -1;
  for (let r = t.rows - 1; r >= 0 && donor < 0; r--) if (t.isString(r, cols.message)) donor = r;
  if (donor < 0) throw new Error(`${t.name} に写せる台詞の行がありません`);
  const row = t.addRow(donor);
  t.setU8(row, TALK_SPEAKER, speaker);
  t.setString(row, cols.message, bytes);
  if (cols.voice >= 0 && t.isString(row, cols.voice)) t.setString(row, cols.voice, new Uint8Array(2));
  return row;
}

/**
 * Appends the eight tones of a line (speaker kinds 1〜8 in a row: StartMessageAuto adds the lead's personality to the
 * first row's place) with the texts `texts` (the text form of message.ts, tones 1〜8); returns the first row.
 */
export function lanaiAppendTalkSet(t: LanaiTable, texts: string[]): number {
  if (texts.length !== TALK_TONES) throw new Error(`性格違いの組は ${TALK_TONES} 行です`);
  const bytes = texts.map((x) => encodeLanaiMessage(parseLanaiText(x)));
  const first = lanaiAppendTalkRow(t, bytes[0]!, 1);
  for (let k = 1; k < TALK_TONES; k++) lanaiAppendTalkRow(t, bytes[k]!, k + 1);
  return first;
}

/** A copy of a table's rows (an undo point). */
export function tableRows(t: LanaiTable): Uint8Array[] {
  return Array.from({ length: t.rows }, (_, r) => t.row(r).slice());
}

/** Put a table back to rows saved by tableRows (rows added since are removed; rows as read are reverted, not written). */
export function restoreTableRows(t: LanaiTable, rows: Uint8Array[]): void {
  while (t.rows > rows.length && t.rows > t.originalRows) t.removeLastRow();
  while (t.rows < rows.length) t.addRow();
  rows.forEach((b, r) => {
    if (r >= t.rows || equalBytes(b, t.row(r))) return;
    const was = t.originalRow(r);
    if (was && equalBytes(was, b)) t.revertRow(r);
    else t.setRow(r, b);
  });
}
