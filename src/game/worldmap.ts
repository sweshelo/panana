// World maps (W01, W02, W98, W99): their own section table, a 300 x 300 grid and the entrances to towns and
// dungeons (section 2). docs/worldmap.md.
import { s16, u32, u8, w16, w32 } from '../util/bytes';

/** 4 rows x 8 u32 (section 0..7 hashes of the map DB), row = FUN_002d9ac4(map). docs/worldmap.md §2. */
export const WORLD_TABLE = 0x4c3a7c;
export const WORLD_ROWS = 4;
/** Map IDs of the rows (FUN_002d9ac4). */
export const WORLD_HASHES = [0xa8654391, 0x09a1da1b, 0xe1e102f7, 0xa7835bbd] as const;
/** mapGroup rows 0x34.. (W98 / W99 are inferred from the order). */
export const WORLD_CODES = ['W01', 'W02', 'W98', 'W99'] as const;
export const WORLD_DUNGEON = 0x34;
/** Cells per side; the world wraps around (FUN_002e609c). */
export const WORLD_SIZE = 300;

export interface WorldInfo {
  /** Row of the table (0..3). */
  index: number;
  hash: number;
  code: string;
  /** mapGroup row. */
  dungeon: number;
  /** Section 0..7 hashes. */
  sections: number[];
  /** Terrain file in the master archive (W01 / W02 do not use section 0; docs/worldmap.md §4). */
  groundFile: string | null;
  /** Hash of that entry in the master archive (used when the name is not found). */
  groundEntry: number;
}

const GROUND_ENTRIES = [0x2bc1d000, 0x52d98000];

export function readWorldTable(code: Uint8Array, base: number): WorldInfo[] {
  const at = WORLD_TABLE - base;
  if (code.length < at + WORLD_ROWS * 32) return [];
  return WORLD_HASHES.map((hash, index) => ({
    index,
    hash,
    code: WORLD_CODES[index]!,
    dungeon: WORLD_DUNGEON + index,
    sections: Array.from({ length: 8 }, (_, k) => u32(code, at + index * 32 + k * 4)),
    groundFile: index < 2 ? `${WORLD_CODES[index]}_ground.bin` : null,
    groundEntry: GROUND_ENTRIES[index] ?? 0,
  }));
}

// ---- section 2: entrances (36 bytes, FUN_001e2ac4; docs/worldmap.md §6)
export const ENTRANCE_SIZE = 0x24;

export const ENT = {
  /** worldmapParts row (74..79: entrances without a model of their own). */
  part: (r: Uint8Array) => u32(r, 0x00),
  id: (r: Uint8Array) => u32(r, 0x04),
  destMap: (r: Uint8Array) => u32(r, 0x08),
  destPoint: (r: Uint8Array) => u32(r, 0x0c),
  /** Wxx_EventObject row that makes it appear (0 = always). */
  event: (r: Uint8Array) => u32(r, 0x10),
  /** Section 3 point the player is moved to. */
  point: (r: Uint8Array) => u32(r, 0x14),
  /** mapObject row of the model (0 = worldmapParts +8). */
  model: (r: Uint8Array) => u32(r, 0x18),
  x: (r: Uint8Array) => s16(r, 0x1c),
  y: (r: Uint8Array) => s16(r, 0x1e),
  rot: (r: Uint8Array) => u8(r, 0x20) & 3,
};

/** u32 fields that can be written with {@link setEntranceU32}. */
export type EntranceField = 0x00 | 0x08 | 0x0c | 0x10 | 0x14 | 0x18;

export function parseEntrances(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let o = 0; o + ENTRANCE_SIZE <= b.length; o += ENTRANCE_SIZE) out.push(b.slice(o, o + ENTRANCE_SIZE));
  return out;
}

export function buildEntrances(list: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(list.length * ENTRANCE_SIZE);
  list.forEach((r, i) => out.set(r, i * ENTRANCE_SIZE));
  return out;
}

/** Copy of an entrance with a u32 field changed. */
export function setEntranceU32(r: Uint8Array, field: EntranceField, v: number): Uint8Array {
  const c = r.slice();
  w32(c, field, v >>> 0);
  return c;
}

/** Copy of an entrance moved (cells, clamped to the grid) and turned (0..3, upper bits kept). */
export function moveEntrance(r: Uint8Array, x: number, y: number, rot = ENT.rot(r)): Uint8Array {
  const c = r.slice();
  const clamp = (v: number): number => Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(v)));
  w16(c, 0x1c, clamp(x));
  w16(c, 0x1e, clamp(y));
  c[0x20] = (c[0x20]! & ~3) | (rot & 3);
  return c;
}

// ---- section 3: points {u32 id, s16 x, s16 y} (FUN_00234234)
export interface WorldPoint {
  id: number;
  x: number;
  y: number;
}

export function parseWorldPoints(b: Uint8Array): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (let o = 0; o + 8 <= b.length; o += 8) out.push({ id: u32(b, o), x: s16(b, o + 4), y: s16(b, o + 6) });
  return out;
}

// ---- terrain
export interface Ground {
  /** worldmapParts row per cell (y * 300 + x; 0 = empty / sea). */
  parts: Uint8Array;
  /** Rotation (0..3) per cell. */
  rots: Uint8Array;
}

/** Wxx_ground.bin: {u32 1, u32 0x10, u32, u32}, then 300 x 300 x {u8 part, u8 rotation}, then two u32 x 81 tables. */
export function parseGround(b: Uint8Array): Ground | null {
  const n = WORLD_SIZE * WORLD_SIZE;
  if (b.length < 0x10 + n * 2 || u32(b, 0) !== 1 || u32(b, 4) !== 0x10) return null;
  const parts = new Uint8Array(n);
  const rots = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    parts[i] = b[0x10 + i * 2]!;
    rots[i] = b[0x11 + i * 2]! & 3;
  }
  return { parts, rots };
}

/** Terrain of W98 / W99: section 0 in the dungeon tile layout (12 bytes, the kind is a worldmapParts row). */
export function groundFromTiles(b: Uint8Array): Ground {
  const n = WORLD_SIZE * WORLD_SIZE;
  const parts = new Uint8Array(n);
  const rots = new Uint8Array(n);
  for (let o = 0; o + 12 <= b.length; o += 12) {
    const x = s16(b, o + 4);
    const y = s16(b, o + 6);
    if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) continue;
    parts[y * WORLD_SIZE + x] = u32(b, o) & 0xff;
    rots[y * WORLD_SIZE + x] = b[o + 8]! & 3;
  }
  return { parts, rots };
}
