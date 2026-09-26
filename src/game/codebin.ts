// Tables in code.bin (v1.1.0, flat binary with base address 0x100000). docs/map.md §0-§2.
import { cstr, s32, u32 } from '../util/bytes';
import { readWorldTable, type WorldInfo } from './worldmap';

export const BASE = 0x100000;
export const MAP_SECTIONS = 0x4c1a74; // 205 x {map hash, section 1..9 hashes}
export const MAP_SECTIONS_ROWS = 0xcd;
export const MAP_TABLE = 0x4c3afc; // 56 x {dungeon, name ptr, count, map array}
export const MAP_TABLE_ROWS = 0x38;
/** Map rows (0x1C bytes each) of every dungeon, back to back in .data. Their +0x10 is filled at startup. */
export const MAP_ROWS = 0x5204f4;
/**
 * mapData keys copied into the map rows +0x10 by the static initializer FUN_00488264 (row k <- entry k).
 * The file itself has 0 there. docs/map.md §3.
 */
export const MAP_DATA_KEYS = 0x4c1738;
/** Key meaning "no mapData of its own" (mapData row 0; FUN_001c4ec4 compares against *(0x4C64E8 + 0x334)). */
export const MAP_DATA_NONE = 0x4c681c;
/** Known map D01B02001, used to check that the tables are where v1.1.0 has them. */
export const PROBE_MAP = 0x98ec3fef;

export interface MapInfo {
  hash: number;
  name: string; // "D01B02001"
  dungeon: number; // mapGroup row
  dungeonCode: string; // "D01"
  floor: number;
  /**
   * mapData key of the map (map row +0x10 at run time; 0 = none). When set, the map uses that mapData row
   * (tileset, textures, BGM) instead of its dungeon's (e.g. デンパ島のどうくつ inside 海底トンネル).
   */
  mapDataKey: number;
  /** Section 0..9 hashes (section 0 = the map hash). */
  sections: number[];
}

export class CodeBin {
  readonly maps: MapInfo[];
  /** World maps (their own section table; not in {@link maps}). docs/worldmap.md. */
  readonly worlds: WorldInfo[];
  constructor(readonly code: Uint8Array) {
    const at = (addr: number): number => addr - BASE;
    if (code.length < at(MAP_TABLE) + MAP_TABLE_ROWS * 16) throw new Error('code.bin が短すぎます');
    const str = (ptr: number): string => {
      if (ptr < BASE || ptr >= BASE + code.length) throw new Error('code.bin: 文字列のポインタが範囲外です (バージョン違い?)');
      return cstr(code, at(ptr));
    };
    const sections = new Map<number, number[]>();
    for (let i = 0; i < MAP_SECTIONS_ROWS; i++) {
      const o = at(MAP_SECTIONS) + i * 40;
      const row: number[] = [];
      for (let k = 0; k < 10; k++) row.push(u32(code, o + k * 4));
      sections.set(row[0]!, row);
    }
    const none = u32(code, at(MAP_DATA_NONE));
    const mapDataKey = (row: number): number => {
      const k = (row - MAP_ROWS) / 0x1c;
      if (k < 0 || k >= MAP_SECTIONS_ROWS || !Number.isInteger(k)) return 0;
      const key = u32(code, at(MAP_DATA_KEYS) + k * 4);
      return key === none ? 0 : key;
    };
    const info = new Map<number, MapInfo>();
    for (let i = 0; i < MAP_TABLE_ROWS; i++) {
      const o = at(MAP_TABLE) + i * 16;
      const dungeon = u32(code, o);
      const dungeonCode = str(u32(code, o + 4));
      const n = u32(code, o + 8);
      const arr = u32(code, o + 12);
      for (let j = 0; j < n; j++) {
        const r = at(arr) + j * 0x1c;
        const hash = u32(code, r);
        const secs = sections.get(hash);
        if (!secs) continue;
        info.set(hash, {
          hash,
          name: str(u32(code, r + 0x18)),
          dungeon,
          dungeonCode,
          floor: s32(code, r + 4),
          mapDataKey: mapDataKey(arr + j * 0x1c),
          sections: secs,
        });
      }
    }
    if (!sections.has(PROBE_MAP) || info.get(PROBE_MAP)?.name !== 'D01B02001') {
      throw new Error('code.bin の表が v1.1.0 の位置にありません。v1.1.0 (TitleVersion 1040) のダンプを使ってください。');
    }
    // Table order of 0x4C1A74 (maps without a name keep "?").
    this.maps = [...sections.values()].map(
      (secs) =>
        info.get(secs[0]!) ?? {
          hash: secs[0]!,
          name: '?' + secs[0]!.toString(16).toUpperCase(),
          dungeon: -1,
          dungeonCode: '',
          floor: 0,
          mapDataKey: 0,
          sections: secs,
        },
    );
    this.worlds = readWorldTable(code, BASE);
  }

  /** World map of a map ID (A8654391 = W01 ...). */
  world(hash: number): WorldInfo | undefined {
    return this.worlds.find((w) => w.hash === hash);
  }

  byHash(hash: number): MapInfo | undefined {
    return this.maps.find((m) => m.hash === hash);
  }
  byName(name: string): MapInfo | undefined {
    return this.maps.find((m) => m.name.toUpperCase() === name.toUpperCase());
  }
}
