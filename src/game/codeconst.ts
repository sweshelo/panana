// Addresses of the map tables in code.bin (v1.1.0, flat binary with base address 0x100000). docs/map.md §0-§2.
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
