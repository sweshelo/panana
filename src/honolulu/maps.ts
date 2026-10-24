// 初代's maps (naauao honolulu/map.md, analysis.md §4): the 97 maps of csvMap, their two sections in the map database
// (A90C8038 / A2C14C00, the same shape as RPG2's) read as RPG2's editing model (game/sections.ts MapDoc) for the
// view-only map page, and the dungeons' floors. A map has its tiles under its own hash and a second section of props
// facing N / S / E / W, named by the table of code.bin 0x2FF6D8. A dungeon (dungeonData +0x04) names the A90C8038
// entry of its floor definitions ("261" files, map.md §4): a record per floor with its map, its encounters
// (monsterGroup key), its default chest contents (itemGroup key) and arrays of exits, people, chests and placed groups.
import { findByName, findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { MapDb, MAPDB_ARCHIVE, MAPDB_ENTRY } from '../game/mapdb';
import { loadDoc, type MapDoc, type MapFormat, type RecordLayout, type RotCodec, type TileLayout } from '../game/sections';
import type { Dump } from '../rom/dump';
import { s16, u16, u32 } from '../util/bytes';
import type { HonoluluMaster } from './master';

/** The map → second section table of code.bin (map.md §2): 98 × {u32 map, u32 section}; FUN_002A6xxx reads 98. */
const SECTION_TABLE = 0x2ff6d8;
const SECTION_PAIRS = 98;
const CODE_BASE = 0x100000;

/** The first bytes of a floor definition file (map.md §4). */
const FLOORS_MAGIC = 0x00313632; // "261\0"
/** A floor record: a 0x64-byte header, then 9 arrays of {u32 count, count × element} (FUN_0025E0EC). */
const FLOOR_HEADER = 0x64;
const FLOOR_ARRAYS = [20, 12, 12, 12, 12, 6, 8, 12, 4] as const;
/** -9999 as x and y: the game puts the thing at a random place. */
export const RANDOM_POS = -9999;
/**
 * A floor's x / y are the tiles' minus one: moved by (+1, +1), 653 of the 655 placed exits, chests and groups are on a
 * tile, against 424 as they are (data; the map's own second section is not moved: 694 of 695 are on a tile).
 */
export const FLOOR_CELL_OFFSET = 1;

/** The facing letters of the records: 'N' / 'E' / 'S' / 'W' as turns 0..3 (north up in the 2D view; estimated). */
const FACING_BYTES = [0x4e, 0x45, 0x53, 0x57] as const;
export const HONOLULU_ROT_CODEC: RotCodec = {
  decode: (b) => FACING_BYTES.indexOf(b as 0x4e),
  encode: (r) => FACING_BYTES[r & 3]!,
};
export const facingLetter = (b: number): string => (FACING_BYTES.includes(b as 0x4e) ? String.fromCharCode(b) : `0x${b.toString(16)}`);

/** Tiles (map.md §3.1): {u32 kind, s16 x, s16 y, u16 0xFE4E, u16 0x0028}; +0x08 is 'N' on every tile of the ROM. */
export const HONOLULU_TILE: TileLayout = { size: 12, rot: 8, letter: 9, pad: 10, rotCodec: HONOLULU_ROT_CODEC };

/**
 * Where the page puts what it shows, by RPG2's section numbers (the shared views and controller draw and pick them):
 * the second section of the map (map.md §3.2: {u32 kind (24〜57), s16 x, s16 y, u8 facing, 0, 0, 0}) as the props,
 * and the shown floor's exits, chests, people and placed groups (map.md §4.3), at their x / y + FLOOR_CELL_OFFSET.
 */
export const HONOLULU_OBJECT_SECTION = 2;
export const HONOLULU_EXIT_SECTION = 3;
export const HONOLULU_CHEST_SECTION = 4;
export const HONOLULU_CHEST2_SECTION = 1;
export const HONOLULU_NPC_SECTION = 5;
export const HONOLULU_MONSTER_SECTION = 8;
export const HONOLULU_LAYOUTS: Record<number, RecordLayout> = {
  [HONOLULU_OBJECT_SECTION]: { size: 12, xo: 4, yo: 6, unit: 'cell', label: '置物 (2 つ目の区画)' },
  [HONOLULU_EXIT_SECTION]: { size: 20, xo: 0x10, yo: 0x12, unit: 'cell', label: '出入口 (階の定義)' },
  [HONOLULU_CHEST_SECTION]: { size: 12, xo: 8, yo: 0x0a, unit: 'cell', label: '宝箱 (階の定義)' },
  [HONOLULU_CHEST2_SECTION]: { size: 12, xo: 8, yo: 0x0a, unit: 'cell', label: '特別な宝箱 (階の定義)' },
  [HONOLULU_NPC_SECTION]: { size: 12, xo: 8, yo: 0x0a, unit: 'cell', label: '人物 (階の定義)' },
  [HONOLULU_MONSTER_SECTION]: { size: 12, xo: 8, yo: 0x0a, unit: 'cell', label: '置かれた敵の群れ (階の定義)' },
};
export const HONOLULU_POINT_SECTIONS = [HONOLULU_EXIT_SECTION, HONOLULU_CHEST_SECTION, HONOLULU_CHEST2_SECTION, HONOLULU_NPC_SECTION, HONOLULU_MONSTER_SECTION, HONOLULU_OBJECT_SECTION] as const;
export const HONOLULU_MAP_FORMAT: MapFormat = { tile: HONOLULU_TILE, layouts: HONOLULU_LAYOUTS };

/** The cells of the grid (x is 0〜49, y 0〜33 in the ROM). */
export const HONOLULU_GRID = 50;

/** A map: a row of csvMap. */
export interface HonoluluMapInfo {
  /** Row in csvMap. */
  index: number;
  hash: number;
  /** The second section's entry in the map database (0: the map is not in code.bin's table). */
  objects: number;
  /** dungeonData rows whose floor definitions list the map. */
  dungeons: number[];
  /** The floor records that use the map (a map can be several floors, of one dungeon or of several). */
  floors: HonoluluFloor[];
}

/** What a floor places (map.md §4.3): an exit, a chest, a person or a group of monsters (x / y as in the file; RANDOM_POS: anywhere). */
export interface FloorPoint {
  x: number;
  y: number;
  /** The element as in the file. */
  raw: Uint8Array;
}

/** A record of a floor definition file. */
export interface HonoluluFloor {
  /** dungeonData row. */
  dungeon: number;
  /** Index of the record in the file. */
  index: number;
  /** +0x00: the record's id (exits and scenario +0x20 point at it). */
  id: number;
  /** +0x04: the map (csvMap); 0 = none fixed (a generated floor, estimated). */
  map: number;
  /** +0x08: monsterGroup key of the floor's encounters (0 = none). */
  monsterGroup: number;
  /** +0x0C: itemGroup key; the default contents of chests without a place (estimated; 0 = none). */
  itemGroup: number;
  /** +0x18 s16: -1 = B1F, 1 = 1F. */
  floor: number;
  /** Array 0 (20 B): {u32 exit id, u32 destination record id, u32 destination exit id, 4 × u8, s16 x, s16 y}. */
  exits: FloorPoint[];
  /** Array 3 (12 B): {u32 itemGroup key, u8 count min, u8 count max (excluded), u8 room (generated floors; 0xFF = any), 0, s16 x, s16 y}. */
  chests: FloorPoint[];
  /** Array 2 (12 B): special chests (itemGroup key; their contents are decided by events, estimated), the same layout. */
  chests2: FloorPoint[];
  /** Array 1 (12 B): people, {u32 mapChara key, …, s16 x, s16 y}. */
  npcs: FloorPoint[];
  /** Array 7 (12 B): {u32 monsterGroup key (-1 = none), u8, u8 min, u8 max, 0, s16 x, s16 y}. */
  monsters: FloorPoint[];
  /** The 9 arrays as in the file (arrays 4, 5, 6 and 8 are not named yet). */
  arrays: Uint8Array[][];
}

/** A dungeonData row with a floor definition file. */
export interface HonoluluDungeon {
  row: number;
  name: string;
  /** The A90C8038 entry of its floor definitions (dungeonData +0x04). */
  floors: number;
  records: HonoluluFloor[];
  /** The maps of its floors, in the order of the records. */
  maps: number[];
}

export class HonoluluMaps {
  readonly maps: HonoluluMapInfo[] = [];
  readonly dungeons: HonoluluDungeon[] = [];
  private readonly byHash = new Map<number, HonoluluMapInfo>();
  private readonly docs = new Map<number, MapDoc>();

  constructor(
    readonly db: MapDb,
    csvMap: GsTable,
    code: Uint8Array,
    /** The floor definition files by their A90C8038 entry. */
    floorFiles: Map<number, Uint8Array>,
    readonly master: HonoluluMaster,
  ) {
    const sections = new Map<number, number>();
    for (let i = 0; i < SECTION_PAIRS; i++) {
      const o = SECTION_TABLE - CODE_BASE + i * 8;
      if (o + 8 > code.length) break;
      // E4544B2E is in the table twice, with the same section
      if (!sections.has(u32(code, o))) sections.set(u32(code, o), u32(code, o + 4));
    }
    for (let i = 0; i < csvMap.rows; i++) {
      const hash = u32(csvMap.row(i), 0);
      const info: HonoluluMapInfo = { index: i, hash, objects: sections.get(hash) ?? 0, dungeons: [], floors: [] };
      this.maps.push(info);
      this.byHash.set(hash, info);
    }
    const dungeons = master.rows('dungeonData.bin');
    const name = master.context().rowName!;
    for (let row = 1; row < dungeons.rows; row++) {
      const floors = u32(dungeons.row(row), 4);
      const file = floorFiles.get(floors);
      if (!file) continue;
      const records = parseFloors(file, row);
      const maps: number[] = [];
      for (const f of records) {
        const m = this.byHash.get(f.map);
        if (!m) continue;
        if (!maps.includes(f.map)) maps.push(f.map);
        if (!m.dungeons.includes(row)) m.dungeons.push(row);
        m.floors.push(f);
      }
      this.dungeons.push({ row, name: name('dungeonData.bin', row) ?? '', floors, records, maps });
    }
  }

  static async load(dump: Dump, master: HonoluluMaster): Promise<HonoluluMaps> {
    const archive = parseArchive(await dump.readRomfs(MAPDB_ARCHIVE));
    const db = findEntry(archive, MAPDB_ENTRY);
    const csv = findByName(archive, 'csvMap.bin');
    if (!db || !csv) throw new Error(`${MAPDB_ARCHIVE} にマップ DB / csvMap がありません`);
    const floors = new Map<number, Uint8Array>();
    for (const e of archive.entries) {
      if (e.index === db.index || e.index === csv.entry.index) continue;
      const { body } = unpackEntry(archive, e);
      if (body.length >= 8 && u32(body, 0) === FLOORS_MAGIC) floors.set(e.hash, body);
    }
    return new HonoluluMaps(new MapDb(unpackEntry(archive, db).body), new GsTable(csv.body), dump.code, floors, master);
  }

  map(hash: number): HonoluluMapInfo | undefined {
    return this.byHash.get(hash);
  }

  /** The map's two sections (read once; the page does not edit them). */
  doc(info: HonoluluMapInfo): MapDoc {
    let d = this.docs.get(info.hash);
    if (!d) {
      const sections = Array.from({ length: 10 }, (_, k) => (k === 0 ? info.hash : k === HONOLULU_OBJECT_SECTION ? info.objects : 0));
      d = loadDoc(this.db, { hash: info.hash, name: mapCode(info), dungeon: info.dungeons[0] ?? 0, floor: 0, sections }, HONOLULU_MAP_FORMAT);
      for (const k of Object.keys(d.raw).map(Number)) if (!d.raw[k]!.length || k === HONOLULU_OBJECT_SECTION) delete d.raw[k];
      this.docs.set(info.hash, d);
    }
    return d;
  }

  /** The map with what a floor of it places (the ones at a random place are left out: they have no cell). */
  floorDoc(info: HonoluluMapInfo, floor: HonoluluFloor | null): MapDoc {
    const d = { ...this.doc(info), recs: { ...this.doc(info).recs } };
    if (!floor) return d;
    d.dungeon = floor.dungeon;
    d.floor = floor.floor;
    const put = (k: number, points: FloorPoint[]): void => {
      d.recs[k] = points.filter((p) => p.x !== RANDOM_POS && p.y !== RANDOM_POS).map((p) => ({ raw: p.raw, x: p.x + FLOOR_CELL_OFFSET, y: p.y + FLOOR_CELL_OFFSET }));
    };
    put(HONOLULU_EXIT_SECTION, floor.exits);
    put(HONOLULU_CHEST_SECTION, floor.chests);
    put(HONOLULU_CHEST2_SECTION, floor.chests2);
    put(HONOLULU_NPC_SECTION, floor.npcs);
    put(HONOLULU_MONSTER_SECTION, floor.monsters);
    return d;
  }

  dungeon(row: number): HonoluluDungeon | undefined {
    return this.dungeons.find((d) => d.row === row);
  }

  /** The mapChara row of a key (its hash index), or undefined. */
  mapCharaRow(key: number): number | undefined {
    return this.master.table('mapChara.bin').hashIndex().get(key);
  }

  /** The monsterGroup row of a key (its hash index), or undefined. */
  monsterGroupRow(key: number): number | undefined {
    return this.master.table('monsterGroup.bin').hashIndex().get(key);
  }

  /** The floors whose encounters (header +0x08) or placed groups (array 7) are a monsterGroup row. */
  groupFloors(row: number): { floor: HonoluluFloor; placed: boolean }[] {
    const out: { floor: HonoluluFloor; placed: boolean }[] = [];
    for (const f of this.dungeons.flatMap((d) => d.records)) {
      if (f.monsterGroup && this.monsterGroupRow(f.monsterGroup) === row) out.push({ floor: f, placed: false });
      else if (f.monsters.some((g) => this.monsterGroupRow(u32(g.raw, 0)) === row)) out.push({ floor: f, placed: true });
    }
    return out;
  }

  /** The itemGroup row of a key (its hash index), or undefined. */
  itemGroupRow(key: number): number | undefined {
    return this.master.table('itemGroup.bin').hashIndex().get(key);
  }

  /** What an itemGroup row holds (map.md §5): up to 8 × {u16 itemData row, u16 count} from +0x04. */
  chestItems(row: number): { item: number; count: number }[] {
    const t = this.master.table('itemGroup.bin');
    if (row < 0 || row >= t.rows) return [];
    const r = t.row(row);
    const out: { item: number; count: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const item = u16(r, 4 + 4 * k);
      if (item) out.push({ item, count: u16(r, 6 + 4 * k) });
    }
    return out;
  }
}

/** The records of a floor definition file: "261\0", u32 count, then the records (naauao#47). */
export function parseFloors(file: Uint8Array, dungeon: number): HonoluluFloor[] {
  const out: HonoluluFloor[] = [];
  const n = u32(file, 4);
  let o = 8;
  for (let index = 0; index < n; index++) {
    if (o + FLOOR_HEADER > file.length) throw new Error(`階の定義が途中で終わっています (記録 ${index})`);
    const h = file.subarray(o, o + FLOOR_HEADER);
    o += FLOOR_HEADER;
    const arrays = FLOOR_ARRAYS.map((size) => {
      const count = u32(file, o);
      o += 4;
      if (o + count * size > file.length) throw new Error(`階の定義が途中で終わっています (記録 ${index})`);
      const a = Array.from({ length: count }, (_, i) => file.slice(o + i * size, o + (i + 1) * size));
      o += count * size;
      return a;
    });
    const at = (xo: number) => (raw: Uint8Array): FloorPoint => ({ x: s16(raw, xo), y: s16(raw, xo + 2), raw });
    out.push({
      dungeon, index, id: u32(h, 0), map: u32(h, 4), monsterGroup: u32(h, 8), itemGroup: u32(h, 0x0c), floor: s16(h, 0x18),
      exits: arrays[0]!.map(at(0x10)), npcs: arrays[1]!.map(at(8)), chests2: arrays[2]!.map(at(8)), chests: arrays[3]!.map(at(8)), monsters: arrays[7]!.map(at(8)), arrays,
    });
  }
  return out;
}

/** "B1F" for floor -1, "2F" for 2. */
export const floorLabel = (floor: number): string => (floor < 0 ? `B${-floor}F` : `${floor}F`);

/** The map's hash as its code ("35A70866"). */
export const mapCode = (m: HonoluluMapInfo): string => m.hash.toString(16).toUpperCase().padStart(8, '0');

/** "マップ 12" (the csvMap row; the maps have no names in the ROM). */
export const mapTitle = (m: HonoluluMapInfo): string => `マップ ${m.index}`;

/** "ダンジョン 1 デンパ島のどうくつ". */
export const dungeonLabel = (d: HonoluluDungeon): string => `ダンジョン ${d.row}${d.name ? ` ${d.name}` : ''}`;
