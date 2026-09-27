// New maps (issue #19): the code.bin tables are extended with a code.ips. docs/new-map.md.
//   - section table: FUN_002d9b18's "not found" path (0x2D9B70) jumps to a hook that searches an extra table.
//   - dungeon table: the rows of a dungeon that gets new maps are copied to a new array with the new rows appended,
//     and the dungeon's count / pointer (0x4C3AFC) are changed. No hook.
// Everything is written into the zero padding at the end of .rodata (0x510490-0x511000), behind the header "PNMP";
// dungeon arrays that do not fit go into copies of the mapData key array that nothing reads (SPILL).
import { u32, w32 } from '../util/bytes';
import { BASE, MAP_DATA_KEYS, MAP_DATA_NONE, MAP_ROWS, MAP_SECTIONS_ROWS, MAP_TABLE, MAP_TABLE_ROWS } from './codeconst';

export const EXT_HEADER = 0x510490;
export const EXT_END = 0x511000;
export const EXT_MAGIC = 0x504d4e50; // "PNMP"
export const EXT_VERSION = 1;
const HEADER_SIZE = 0x18;

/** `mvn r0, #0` of FUN_002d9b18 (section lookup: map not found). */
export const HOOK_SITE = 0x2d9b70;
const HOOK_SITE_ORIGINAL = 0xe3e00000;
const HOOK_SITE_PATCHED = 0xea079902; // b HOOK_ADDR
/** The last 128 bytes of the code cave at the end of .text are kept for this hook (elpulse mod/build_code.py). */
export const HOOK_ADDR = 0x4bff80;
/**
 * sect_ext (r1 = map hash): search {count, table} of the header; found -> r3 = row, r0 = 0; else r0 = -1; back to
 * 0x2D9B74, which reads section r2 of row r3 + r0 * 40. Assembled with keystone (docs/new-map.md §2.1).
 */
const HOOK_CODE = [
  0xe59fc02c, // ldr   ip, =EXT_HEADER
  0xe59c0008, // ldr   r0, [ip, #8]
  0xe59cc00c, // ldr   ip, [ip, #12]
  0xe2500001, // subs  r0, r0, #1
  0x4a000005, // bmi   miss
  0xe49c5028, // ldr   r5, [ip], #40
  0xe1550001, // cmp   r5, r1
  0x1afffffa, // bne   loop
  0xe24c3028, // sub   r3, ip, #40
  0xe3a00000, // mov   r0, #0
  0xeaf866f1, // b     0x2D9B74
  0xe3e00000, // mvn   r0, #0      (miss)
  0xeaf866ef, // b     0x2D9B74
  EXT_HEADER,
];

/**
 * Copies of the mapData key array (205 x u32) that only their own static initializer reads (it writes them into a
 * copy of the map rows that nothing reads). Used for dungeon arrays when the .rodata padding is full; restored to
 * the key array when unused. docs/new-map.md §2.3.
 */
export const SPILL = [
  0x4c4d38, 0x4c506c, 0x4c571c, 0x4c68a4, 0x4c83bc, 0x4c8b2c, 0x4c8e60, 0x4c9194, 0x4c9850, 0x4c9b84, 0x4c9eb8, 0x4ca1ec,
  0x4ca520, 0x4ca854, 0x4cbea8, 0x4cc574, 0x4cc8a8, 0x4cd5a0, 0x4cdc6c, 0x4cf490, 0x4cf7c4, 0x4cfaf8, 0x4d0164, 0x4d0b08,
];
const SPILL_SIZE = MAP_SECTIONS_ROWS * 4;

export const ROW_SIZE = 0x1c;
/** Dungeon table rows with maps of their own (the world maps W01 / W02 / W98 / W99 have none and a different system). */
export const canAddTo = (count: number): boolean => count > 0;

export interface DungeonRow {
  /** Row in the dungeon table (0x4C3AFC). */
  index: number;
  dungeon: number;
  count: number;
  /** Address of the map rows. */
  array: number;
}

export function dungeonRows(code: Uint8Array): DungeonRow[] {
  return Array.from({ length: MAP_TABLE_ROWS }, (_, index) => {
    const o = MAP_TABLE - BASE + index * 16;
    return { index, dungeon: u32(code, o), count: u32(code, o + 8), array: u32(code, o + 12) };
  });
}

export interface Extension {
  /** Extra section rows: map hash + sections 1..9. */
  sections: number[][];
  /** Addresses of the added map rows. */
  rows: number[];
}

/** The PNMP extension of a (patched) code.bin, or null. */
export function readExtension(code: Uint8Array): Extension | null {
  const h = EXT_HEADER - BASE;
  if (code.length < EXT_END - BASE || u32(code, h) !== EXT_MAGIC) return null;
  const inCode = (a: number, size: number): boolean => a >= BASE && a + size <= BASE + code.length;
  const n = u32(code, h + 8), sp = u32(code, h + 0xc);
  const m = u32(code, h + 0x10), rp = u32(code, h + 0x14);
  if (!inCode(sp, n * 40) || !inCode(rp, m * 4)) throw new Error('code.bin の新しいマップの表 (PNMP) が壊れています');
  const sections = Array.from({ length: n }, (_, i) => Array.from({ length: 10 }, (_, k) => u32(code, sp - BASE + i * 40 + k * 4)));
  const rows = Array.from({ length: m }, (_, i) => u32(code, rp - BASE + i * 4));
  return { sections, rows };
}

/** A map added by the editor: what goes into its section row and map row. */
export interface AddedMap {
  hash: number;
  /** Section 0..9 hashes (section 0 = hash). */
  sections: number[];
  /** Map code ("D01B03001"). */
  name: string;
  /** Dungeon ID (dungeon table +0, = mapGroup row). */
  dungeon: number;
  floor: number;
  /** mapData key (0 = none). */
  mapDataKey: number;
  /** Map row +0x14 (u32; the low byte goes to the map runtime +0xA8CB). */
  extra: number;
}

export interface Patch {
  /** file offset (address - BASE) -> bytes */
  records: [number, Uint8Array][];
}

/** First original row (in the table at 0x5204F4) whose hash is `hash`, or -1. */
function originalRow(code: Uint8Array, hash: number): number {
  for (let k = 0; k < MAP_SECTIONS_ROWS; k++) if (u32(code, MAP_ROWS - BASE + k * ROW_SIZE) === hash) return k;
  return -1;
}

class Allocator {
  readonly regions: { start: number; end: number; pos: number; bytes: Uint8Array }[];
  constructor(first: { start: number; end: number }, spill: number[]) {
    this.regions = [first, ...spill.map((s) => ({ start: s, end: s + SPILL_SIZE }))].map((r) => ({
      ...r,
      pos: r.start,
      bytes: new Uint8Array(r.end - r.start),
    }));
  }
  /** Place bytes (4-aligned) in the first region with room; returns the address. */
  put(data: Uint8Array, onlyFirst = false): number {
    for (const r of onlyFirst ? this.regions.slice(0, 1) : this.regions) {
      if (r.pos + data.length > r.end) continue;
      const a = r.pos;
      r.bytes.set(data, a - r.start);
      r.pos = (a + data.length + 3) & ~3;
      return a;
    }
    throw new Error('新しいマップの表を置く場所が足りません (マップの数を減らしてください)');
  }
  used(i: number): boolean {
    return this.regions[i]!.pos > this.regions[i]!.start;
  }
}

/**
 * The code.ips records for exactly `maps` as the added maps. `code` is the code.bin the editor reads (the dump
 * with the base MOD's code.ips, which may already have an older PNMP extension: it is rebuilt from scratch, and
 * with no maps the tables are restored).
 */
export function buildMapPatch(code: Uint8Array, maps: AddedMap[]): Patch {
  const at = (a: number): number => a - BASE;
  const records: [number, Uint8Array][] = [];
  const word = (a: number, v: number): void => {
    const b = new Uint8Array(4);
    w32(b, 0, v);
    records.push([at(a), b]);
  };
  const addedHashes = new Set([...maps.map((m) => m.hash), ...(readExtension(code)?.sections.map((s) => s[0]!) ?? [])]);
  const none = u32(code, at(MAP_DATA_NONE));
  const keys = code.slice(at(MAP_DATA_KEYS), at(MAP_DATA_KEYS) + SPILL_SIZE);

  const alloc = new Allocator({ start: EXT_HEADER, end: EXT_END }, SPILL);
  const header = alloc.put(new Uint8Array(HEADER_SIZE), true);
  const sectBytes = new Uint8Array(maps.length * 40);
  maps.forEach((m, i) => m.sections.forEach((h, k) => w32(sectBytes, i * 40 + k * 4, h)));
  const sectTable = maps.length ? alloc.put(sectBytes, true) : 0;
  const rowPtrs = maps.length ? alloc.put(new Uint8Array(maps.length * 4), true) : 0;

  const names = new Map<string, number>();
  const nameAddr = (s: string): number => {
    let a = names.get(s);
    if (a === undefined) {
      const b = new Uint8Array((s.length + 4) & ~3);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7f;
      a = alloc.put(b);
      names.set(s, a);
    }
    return a;
  };

  const rowAddr = new Map<number, number>();
  const dungeonEdits: [DungeonRow, number, number][] = []; // row, new count, new array
  for (const d of dungeonRows(code)) {
    const mine = maps.filter((m) => m.dungeon === d.dungeon);
    const relocated = d.count > 0 && (d.array < MAP_ROWS || d.array >= MAP_ROWS + MAP_SECTIONS_ROWS * ROW_SIZE);
    if (!mine.length && !relocated) continue;
    if (mine.length && !canAddTo(d.count)) throw new Error(`ダンジョン ${d.dungeon} にはマップを足せません`);
    // Original rows (from wherever they are now), with their mapData key as it is at run time.
    const orig: Uint8Array[] = [];
    for (let j = 0; j < d.count; j++) {
      const r = at(d.array + j * ROW_SIZE);
      if (addedHashes.has(u32(code, r))) continue;
      const row = code.slice(r, r + ROW_SIZE);
      const k = (d.array + j * ROW_SIZE - MAP_ROWS) / ROW_SIZE;
      if (Number.isInteger(k) && k >= 0 && k < MAP_SECTIONS_ROWS) w32(row, 0x10, u32(code, at(MAP_DATA_KEYS) + k * 4));
      orig.push(row);
    }
    if (!mine.length) {
      // Back to the original rows.
      const k = orig.length ? originalRow(code, u32(orig[0]!, 0)) : -1;
      if (k < 0) throw new Error(`ダンジョン ${d.dungeon} の元のマップの行が見つかりません`);
      dungeonEdits.push([d, orig.length, MAP_ROWS + k * ROW_SIZE]);
      continue;
    }
    const arr = new Uint8Array((orig.length + mine.length) * ROW_SIZE);
    orig.forEach((r, j) => arr.set(r, j * ROW_SIZE));
    mine.forEach((m, j) => {
      const o = (orig.length + j) * ROW_SIZE;
      w32(arr, o, m.hash);
      w32(arr, o + 4, m.floor);
      w32(arr, o + 0x10, m.mapDataKey || none);
      w32(arr, o + 0x14, m.extra);
      w32(arr, o + 0x18, nameAddr(m.name));
    });
    const a = alloc.put(arr);
    mine.forEach((m, j) => rowAddr.set(m.hash, a + (orig.length + j) * ROW_SIZE));
    dungeonEdits.push([d, orig.length + mine.length, a]);
  }
  const missing = maps.find((m) => !rowAddr.has(m.hash));
  if (missing) throw new Error(`${missing.name} のダンジョン (${missing.dungeon}) が code.bin の表にありません`);

  // Header and the list of added rows.
  const first = alloc.regions[0]!;
  const put32 = (a: number, v: number): void => w32(first.bytes, a - first.start, v);
  if (maps.length) {
    put32(header, EXT_MAGIC);
    put32(header + 4, EXT_VERSION);
    put32(header + 8, maps.length);
    put32(header + 0xc, sectTable);
    put32(header + 0x10, maps.length);
    put32(header + 0x14, rowPtrs);
    maps.forEach((m, i) => put32(rowPtrs + i * 4, rowAddr.get(m.hash)!));
  }

  // Regions: the whole .rodata padding (zeros when empty), used spill regions, and spill regions to restore.
  records.push([at(first.start), maps.length ? first.bytes : new Uint8Array(first.bytes.length)]);
  alloc.regions.slice(1).forEach((r, i) => {
    if (alloc.used(i + 1)) records.push([at(r.start), r.bytes]);
    else if (!equal(code, at(r.start), keys)) records.push([at(r.start), keys]);
  });
  // Hook.
  const hook = new Uint8Array(HOOK_CODE.length * 4);
  if (maps.length) HOOK_CODE.forEach((v, i) => w32(hook, i * 4, v));
  records.push([at(HOOK_ADDR), hook]);
  word(HOOK_SITE, maps.length ? HOOK_SITE_PATCHED : HOOK_SITE_ORIGINAL);
  // Dungeon rows.
  for (const [d, count, array] of dungeonEdits) {
    const b = new Uint8Array(8);
    w32(b, 0, count);
    w32(b, 4, array);
    records.push([at(MAP_TABLE) + d.index * 16 + 8, b]);
  }
  return { records };
}

function equal(code: Uint8Array, off: number, b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (code[off + i] !== b[i]) return false;
  return true;
}

/** Hashes used anywhere a new hash must not collide with (map DB, section tables, map rows). */
export function newHash(taken: (h: number) => boolean, rand: () => number = Math.random): number {
  for (;;) {
    const h = Math.floor(rand() * 0x100000000) >>> 0;
    if (h > 0x10000 && h !== 0xffffffff && !taken(h)) return h;
  }
}
