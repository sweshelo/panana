// 電波人間のRPG3's world map W01 (naauao oahu/worldmap.md): its own section table in code.bin (9 map DB hashes), the
// terrain of master 21350000's W01_ground.bin (300 x 300 cells of worldmapParts rows), the entrances to the towns
// and dungeons (32 bytes; their w01_EventObject row says where they lead), the encounter ranges of the land and the
// sea, the chests, props and event ranges. Edits go to the map database (sections) and to the master (the terrain,
// with its pool table rebuilt); the entrances' EventObject rows are edited through OahuMaps' tables.
import { findByName, findEntry, parseArchive, unpackEntry, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import type { Dump } from '../rom/dump';
import { equalBytes, f32, hex8, s16, u16, u32, u8, view, w16, w32 } from '../util/bytes';
import type { OahuMapInfo, OahuMaps } from './maps';
import type { OahuMaster } from './master';

/** Map ID of the world map (FUN_002ab73c and the other getters take row 0 of the table for it). */
export const OAHU_WORLD = 0xa8654391;
/** code.bin of v4096: the world's section table, 9 u32 (one row; index = slot). */
export const OAHU_WORLD_TABLE = 0x556d54;
/** The table's hashes (v4096; the tests read them back from code.bin). */
export const OAHU_WORLD_SECTIONS = [0xa8654391, 0xf54b912e, 0x85175911, 0x085d1b2b, 0x6b11fa64, 0xad947450, 0x59a0b01e, 0x32407956, 0x3bf20831] as const;
/** Slots of the table (the getter of each and its user in naauao oahu/worldmap.md §2). */
export const WS = { tiles: 0, zone: 1, entrances: 2, land: 3, sea: 4, events: 5, props: 6, explored: 7, chests: 8 } as const;
export const OAHU_WORLD_SIZE = 300;
/** World units per cell; a cell's centre is 50 + x * 100 (dungeons: 500). */
export const OAHU_WORLD_CELL = 100;
export const OAHU_GROUND_FILE = 'W01_ground.bin';
/** Archive of the terrain models (worldmapParts +0x00) and of the entrances' models (mapObject rows 362〜403). */
export const OAHU_WORLD_MODELS = '0E820000';
/** The terrain's shared textures (bg_sea, mnmp_*). */
export const OAHU_WORLD_TEXTURES = 0xd47b4000;

// ---- worldmapParts (master +0x604, 95 x 12 bytes)

/** +4 flags: 0x10 = covers 2 x 2 cells, 0x20 = covers 2 cells (by its rotation), 0x08 → cell flag 0x20 (FUN_002fa9ec). */
export const WP_2X2 = 0x10;
export const WP_2 = 0x20;

export interface OahuWorldPart {
  row: number;
  /** Model entry in OAHU_WORLD_MODELS (0 = none). */
  model: number;
  flags: number;
  /** +0x08: the default mapObject row of the entrances of this kind (rows 88〜93). */
  object: number;
  /** +0x0A: the mapData row of the battles on it (BGM and background, naauao oahu/sound.md). */
  battle: number;
  /** The model's file name ("bgpt_wld_flat_00.bch"), '' when it has none. */
  name: string;
}

/** What a part's model name says it is ("flat", "mount", …), for the 2D colours. */
export const partCategory = (name: string): string => /^bgpt_wld_(s_)?([a-z]+)/.exec(name)?.[2] ?? '';

const CATEGORY_COLOR: Record<string, string> = {
  flat: '#7cc860', hill: '#a6cf63', wood: '#3e8a3a', mount: '#9b7b52', alp: '#b9b2a6', snow: '#eef3f6', sand: '#e3d08a',
  bog: '#708a4b', rock: '#8a8a8a', volca: '#b4513a', pond: '#4f9ed8', river: '#4f9ed8', sea: '#2b5d9c', ford: '#6fb7c9',
  bridge: '#b58b5a', wall: '#5d5048',
};
export function partColor(p: OahuWorldPart | undefined): string {
  if (!p) return '#ff00ff';
  if (!p.model) return p.object ? '#ffffff' : '#00000000';
  return CATEGORY_COLOR[partCategory(p.name)] ?? '#c0a0ff';
}

// ---- the terrain (W01_ground.bin)

/**
 * W01_ground.bin: {u32 1, u32 0x14 (grid), u32 pools, u32 explored, u32}, 300 x 300 x {u8 part, u8 rotation} (y * 300 +
 * x; a part that covers more cells is only at its first one), then u32 x 95 (pools) and a list of s16 {x, y} ended by
 * 0 (cells of slot 7 set when the game starts, FUN_002fb4c0).
 */
export interface OahuGround {
  parts: Uint8Array;
  rots: Uint8Array;
}

const GRID_AT = 0x14;
const N = OAHU_WORLD_SIZE;

export function parseOahuGround(b: Uint8Array): OahuGround | null {
  if (b.length < GRID_AT + N * N * 2 || u32(b, 0) !== 1 || u32(b, 4) !== GRID_AT) return null;
  const parts = new Uint8Array(N * N), rots = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    parts[i] = b[GRID_AT + i * 2]!;
    rots[i] = b[GRID_AT + 1 + i * 2]! & 3;
  }
  return { parts, rots };
}

/**
 * The pool of each part (W01_ground.bin +8, read by FUN_00327138): the most cells of the part in any 2 x 2 block of the
 * grid (counting the cells a part starts at; this gives the ROM's 95 values). Part 0 (no part) has none.
 */
export function oahuGroundPools(parts: Uint8Array, count: number): number[] {
  const out = new Array<number>(count).fill(0);
  for (let y = 0; y + 1 < N; y++)
    for (let x = 0; x + 1 < N; x++) {
      const i = y * N + x;
      const cells = [parts[i]!, parts[i + 1]!, parts[i + N]!, parts[i + N + 1]!];
      for (const p of new Set(cells)) {
        if (!p || p >= count) continue;
        const n = cells.filter((c) => c === p).length;
        if (n > out[p]!) out[p] = n;
      }
    }
  return out;
}

/**
 * The file with the grid replaced and the pools made large enough for it (a pool never shrinks below the ROM's, so an
 * unedited grid gives the ROM's bytes).
 */
export function buildOahuGround(original: Uint8Array, g: OahuGround): Uint8Array {
  const out = original.slice();
  for (let i = 0; i < N * N; i++) {
    out[GRID_AT + i * 2] = g.parts[i]!;
    out[GRID_AT + 1 + i * 2] = (original[GRID_AT + 1 + i * 2]! & ~3) | (g.rots[i]! & 3);
  }
  const at = u32(original, 8), end = u32(original, 12);
  const count = Math.max(0, Math.floor((end - at) / 4));
  const pools = oahuGroundPools(g.parts, count);
  for (let p = 0; p < count; p++) w32(out, at + p * 4, Math.max(u32(original, at + p * 4), pools[p]!));
  return out;
}

/** Cells of slot 7 the game sets when it starts (the list at W01_ground.bin +0x0C). */
export function oahuGroundExplored(b: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let o = u32(b, 12); o + 4 <= b.length && u16(b, o); o += 4) out.push([s16(b, o), s16(b, o + 2)]);
  return out;
}

/**
 * The part covering each cell: a 2 x 2 part (flag 0x10) also covers x+1 / y+1, a 2-cell part (0x20) x+1 (rotation 0 / 2)
 * or y+1 (1 / 3); a cell keeps a part of its own (FUN_002fa9ec). -1 = no part there.
 */
export function oahuCoveredBy(g: OahuGround, flags: (part: number) => number): Int32Array {
  const out = new Int32Array(N * N).fill(-1);
  for (let i = 0; i < N * N; i++) if (g.parts[i]) out[i] = i;
  const cover = (x: number, y: number, from: number): void => {
    if (x >= N || y >= N) return;
    const i = y * N + x;
    if (!g.parts[i]) out[i] = from;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x, p = g.parts[i]!;
      if (!p) continue;
      const f = flags(p);
      if (f & WP_2X2) {
        cover(x + 1, y, i);
        cover(x, y + 1, i);
        cover(x + 1, y + 1, i);
      } else if (f & WP_2) {
        if (g.rots[i]! & 1) cover(x, y + 1, i);
        else cover(x + 1, y, i);
      }
    }
  return out;
}

// ---- slot 2: entrances (32 bytes, FUN_002fc10c / FUN_0032d134)

export const ENTRANCE_SIZE = 0x20;
/**
 * +0x00 worldmapParts row (88〜93; 0 = no model: where the player stands when coming out), +0x04 mapObject row of the
 * model, +0x08 ID (the exits of the towns lead to it), +0x0C w01_EventObject row (its +0x10 / +0x14 = destination map /
 * point; 0 = none), +0x10 / +0x12 s16 x / y (cells), +0x14 / +0x18 f32 dx / dy (cells), +0x1C direction (FUN_00276078),
 * +0x1D mapJumpPoint row, +0x1E (2 on two places, unknown).
 */
export const WE = {
  part: (r: Uint8Array) => u32(r, 0x00),
  model: (r: Uint8Array) => u32(r, 0x04),
  id: (r: Uint8Array) => u32(r, 0x08),
  event: (r: Uint8Array) => u32(r, 0x0c),
  x: (r: Uint8Array) => s16(r, 0x10),
  y: (r: Uint8Array) => s16(r, 0x12),
  dx: (r: Uint8Array) => f32(r, 0x14),
  dy: (r: Uint8Array) => f32(r, 0x18),
  dir: (r: Uint8Array) => u8(r, 0x1c),
  jump: (r: Uint8Array) => u8(r, 0x1d),
};
/** u32 fields an edit can set. */
export type EntranceField = 0x00 | 0x04 | 0x08 | 0x0c;

/** The position of an entrance in cells (with its offset). */
export const entranceCell = (r: Uint8Array): [number, number] => [WE.x(r) + WE.dx(r) + 0.5, WE.y(r) + WE.dy(r) + 0.5];

export function setEntranceU32(r: Uint8Array, field: EntranceField, v: number): Uint8Array {
  const c = r.slice();
  w32(c, field, v >>> 0);
  return c;
}

/** A copy moved to cell (x, y) (clamped to the grid) with offsets dx / dy. */
export function moveEntrance(r: Uint8Array, x: number, y: number, dx = WE.dx(r), dy = WE.dy(r)): Uint8Array {
  const c = r.slice();
  const clamp = (v: number): number => Math.max(0, Math.min(N - 1, Math.round(v)));
  w16(c, 0x10, clamp(x));
  w16(c, 0x12, clamp(y));
  view(c).setFloat32(0x14, dx, true);
  view(c).setFloat32(0x18, dy, true);
  return c;
}

export function setEntranceByte(r: Uint8Array, at: 0x1c | 0x1d, v: number): Uint8Array {
  const c = r.slice();
  c[at] = v & 0xff;
  return c;
}

// ---- slots 3 / 4: encounter ranges {u32 areaInfoData hash, s16 x, s16 y, u8 w, u8 h} (cells; FUN_0032cc9c / FUN_0032cb14
// write the areaInfoData row into the 100 x 100 area grid, layer 0 = land, 1 = sea, by cells / 3)

export const RANGE_SIZE = 12;
export interface OahuWorldRange {
  hash: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function parseRanges(b: Uint8Array): OahuWorldRange[] {
  const out: OahuWorldRange[] = [];
  for (let o = 0; o + RANGE_SIZE <= b.length; o += RANGE_SIZE) out.push({ hash: u32(b, o), x: s16(b, o + 4), y: s16(b, o + 6), w: b[o + 8]!, h: b[o + 9]! });
  return out;
}

/** Ranges back to bytes; `original` keeps the two bytes after w / h of the records that are still there. */
export function buildRanges(list: OahuWorldRange[], original: Uint8Array): Uint8Array {
  const out = new Uint8Array(list.length * RANGE_SIZE);
  list.forEach((r, i) => {
    const o = i * RANGE_SIZE;
    if (o + RANGE_SIZE <= original.length) out.set(original.subarray(o, o + RANGE_SIZE), o);
    w32(out, o, r.hash);
    w16(out, o + 4, r.x);
    w16(out, o + 6, r.y);
    out[o + 8] = r.w;
    out[o + 9] = r.h;
  });
  return out;
}

// ---- slot 8: chests {u32 w01_EventObject row, s16 x, s16 y} (FUN_0032ce24: chest at 50 + x * 100)
// ---- slot 6: props (20 bytes, as dungeon section 2: mapObject row, s16 x, s16 y, f32 dx, f32 dy)
// ---- slot 5: event ranges (32 bytes, as dungeon section 8; FUN_0032cf88 → FUN_00369038)

export interface OahuWorldPoint {
  /** mapObject row (props), EventObject row (chests, events). */
  value: number;
  x: number;
  y: number;
  /** Kind of an event range (+0x00). */
  kind?: number;
}

export function parseChests(b: Uint8Array): OahuWorldPoint[] {
  const out: OahuWorldPoint[] = [];
  for (let o = 0; o + 8 <= b.length; o += 8) out.push({ value: u32(b, o), x: s16(b, o + 4) + 0.5, y: s16(b, o + 6) + 0.5 });
  return out;
}

export function parseProps(b: Uint8Array): OahuWorldPoint[] {
  const out: OahuWorldPoint[] = [];
  for (let o = 0; o + 20 <= b.length; o += 20) out.push({ value: u32(b, o), x: s16(b, o + 4) + f32(b, o + 8) + 0.5, y: s16(b, o + 6) + f32(b, o + 12) + 0.5 });
  return out;
}

export function parseEventRanges(b: Uint8Array): OahuWorldPoint[] {
  const out: OahuWorldPoint[] = [];
  for (let o = 0; o + 32 <= b.length; o += 32) out.push({ kind: u32(b, o), value: u32(b, o + 4), x: s16(b, o + 8) + f32(b, o + 12) + 0.5, y: s16(b, o + 10) + f32(b, o + 16) + 0.5 });
  return out;
}

/** The 2-bit grids of slots 1 and 7 (300 x 300, 4 cells a byte, FUN_002ab700). */
export const grid2 = (b: Uint8Array, x: number, y: number): number => ((b[(y * N + x) >> 2] ?? 0) >> (((y * N + x) & 3) * 2)) & 3;

// ---- the world as the pages edit it

/** Where an entrance leads: its EventObject row and the map / point that row names. */
export interface OahuEntranceDest {
  /** w01_EventObject row (+0x0C), 0 = none. */
  row: number;
  /** +0x55 of the row. */
  kind: number;
  map: OahuMapInfo | undefined;
  mapHash: number;
  point: number;
}

export interface OahuWorldSaved {
  /** The terrain's grid: 300 x 300 x {part, rotation}. */
  cells?: Uint8Array;
  /** Changed sections of the world table: [hash, bytes]. */
  sections?: [number, Uint8Array][];
}

export class OahuWorld {
  readonly parts: OahuWorldPart[];
  /** The edited terrain (null when the master has no W01_ground.bin). */
  readonly ground: OahuGround | null;
  private readonly groundOriginal: Uint8Array | null;
  private readonly groundEntry: ArcEntry | null;
  /** worldmapPort: the IDs of the entrances the ship stops at. */
  readonly ports: Set<number>;
  /** Bumped on every edit (pages subscribe through OahuMaps' listeners). */
  revision = 0;

  constructor(
    readonly maps: OahuMaps,
    readonly master: OahuMaster,
  ) {
    const wp = tableOrNull(master, 'worldmapParts.bin');
    this.parts = [];
    for (let r = 0; wp && r < wp.rows; r++) {
      const row = wp.row(r);
      this.parts.push({ row: r, model: u32(row, 0), flags: row[4]!, object: u16(row, 8), battle: row[0x0a]!, name: '' });
    }
    const g = findByName(master.archive, OAHU_GROUND_FILE);
    this.groundEntry = g?.entry ?? null;
    this.groundOriginal = g?.body ?? null;
    this.ground = g ? parseOahuGround(g.body) : null;
    const pt = tableOrNull(master, 'worldmapPort.bin');
    this.ports = new Set(Array.from({ length: pt?.rows ?? 0 }, (_, i) => u32(pt!.row(i), 0)));
  }

  /** The world's row in the map table (its dungeon is w01's EventObject table). */
  get info(): OahuMapInfo | undefined {
    return this.maps.map(OAHU_WORLD);
  }

  /** Bytes of a slot as edited ('' sections: empty). */
  section(slot: number): Uint8Array {
    const h = OAHU_WORLD_SECTIONS[slot];
    return h !== undefined && this.maps.db.has(h) ? this.maps.db.get(h) : new Uint8Array(0);
  }
  originalSection(slot: number): Uint8Array {
    const h = OAHU_WORLD_SECTIONS[slot];
    return h !== undefined && this.maps.db.has(h) ? this.maps.db.original(h) : new Uint8Array(0);
  }
  setSection(slot: number, bytes: Uint8Array): void {
    const h = OAHU_WORLD_SECTIONS[slot]!;
    if (equalBytes(bytes, this.maps.db.original(h))) this.maps.db.revert(h);
    else this.maps.db.set(h, bytes);
    this.changed();
  }

  private changed(): void {
    this.revision++;
    this.maps.changed();
  }

  // ---- entrances

  entrances(): Uint8Array[] {
    const b = this.section(WS.entrances);
    const out: Uint8Array[] = [];
    for (let o = 0; o + ENTRANCE_SIZE <= b.length; o += ENTRANCE_SIZE) out.push(b.slice(o, o + ENTRANCE_SIZE));
    return out;
  }
  originalEntrances(): Uint8Array[] {
    const b = this.originalSection(WS.entrances);
    const out: Uint8Array[] = [];
    for (let o = 0; o + ENTRANCE_SIZE <= b.length; o += ENTRANCE_SIZE) out.push(b.slice(o, o + ENTRANCE_SIZE));
    return out;
  }
  setEntrances(list: Uint8Array[]): void {
    const out = new Uint8Array(list.length * ENTRANCE_SIZE);
    list.forEach((r, i) => out.set(r, i * ENTRANCE_SIZE));
    this.setSection(WS.entrances, out);
  }
  setEntrance(index: number, r: Uint8Array): void {
    const l = this.entrances();
    l[index] = r;
    this.setEntrances(l);
  }

  /** The w01 EventObject table (loaded by {@link load}). */
  eventTable(): GsTable | null {
    const d = this.info && this.maps.dungeonOf(this.info);
    return d ? this.maps.loadedEventTable(d) : null;
  }

  /** Loads w01's EventObject table (the entrances' destinations) and the names of the terrain's models. */
  async load(dump: Dump): Promise<void> {
    const d = this.info && this.maps.dungeonOf(this.info);
    if (d) await this.maps.eventTable(d);
    if (this.parts.some((p) => p.model && !p.name) && dump.names().includes(OAHU_WORLD_MODELS)) {
      const arc = parseArchive(await dump.readRomfs(OAHU_WORLD_MODELS));
      for (const p of this.parts) {
        const e = p.model ? findEntry(arc, p.model) : undefined;
        if (e?.comp === 1) p.name = unpackEntry(arc, e).name ?? '';
      }
      this.changed();
    }
  }

  dest(r: Uint8Array): OahuEntranceDest {
    const row = WE.event(r);
    const t = this.eventTable();
    const ev = row && t && row < t.rows ? t.row(row) : null;
    const mapHash = ev ? u32(ev, 0x10) : 0;
    return { row, kind: ev ? ev[0x55]! : 0, map: mapHash ? this.maps.map(mapHash) : undefined, mapHash, point: ev ? u32(ev, 0x14) : 0 };
  }

  /** Index of the entrance with ID `id`, -1 when none. */
  entranceById(id: number): number {
    return this.entrances().findIndex((r) => WE.id(r) === id);
  }

  /** The maps of a dungeon (mapGroup row), by floor then name: what an entrance's destination is part of. */
  dungeonMaps(dungeon: number): OahuMapInfo[] {
    return this.maps.maps.filter((m) => m.dungeon === dungeon && !m.world).sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));
  }

  // ---- ranges

  ranges(slot: typeof WS.land | typeof WS.sea): OahuWorldRange[] {
    return parseRanges(this.section(slot));
  }
  setRanges(slot: typeof WS.land | typeof WS.sea, list: OahuWorldRange[]): void {
    this.setSection(slot, buildRanges(list, this.originalSection(slot)));
  }

  // ---- terrain

  partFlags = (part: number): number => this.parts[part]?.flags ?? 0;

  /** Put part `part` (0 = none) turned by `rot` at cell (x, y); false when it is already there. */
  paint(x: number, y: number, part: number, rot: number): boolean {
    const g = this.ground;
    if (!g || x < 0 || y < 0 || x >= N || y >= N) return false;
    const i = y * N + x;
    if (g.parts[i] === part && (g.rots[i] === (rot & 3) || !part)) return false;
    g.parts[i] = part;
    g.rots[i] = part ? rot & 3 : 0;
    this.changed();
    return true;
  }

  /** The terrain as a snapshot (undo) and back. */
  groundSnapshot(): Uint8Array | null {
    const g = this.ground;
    if (!g) return null;
    const out = new Uint8Array(N * N * 2);
    out.set(g.parts);
    out.set(g.rots, N * N);
    return out;
  }
  restoreGround(snap: Uint8Array): void {
    const g = this.ground;
    if (!g || snap.length !== N * N * 2) return;
    g.parts.set(snap.subarray(0, N * N));
    g.rots.set(snap.subarray(N * N));
    this.changed();
  }

  /** Whether the terrain differs from the ROM's. */
  groundChanged(): boolean {
    const g = this.ground, o = this.groundOriginal;
    if (!g || !o) return false;
    for (let i = 0; i < N * N; i++) if (g.parts[i] !== o[GRID_AT + i * 2] || g.rots[i] !== (o[GRID_AT + 1 + i * 2]! & 3)) return true;
    return false;
  }

  revertGround(): void {
    const o = this.groundOriginal && parseOahuGround(this.groundOriginal);
    if (o) this.restoreGround(concatGround(o));
  }

  groundBytes(): Uint8Array | null {
    return this.ground && this.groundOriginal ? buildOahuGround(this.groundOriginal, this.ground) : null;
  }
  originalGroundBytes(): Uint8Array | null {
    return this.groundOriginal;
  }

  /** The cells of slot 7 set at the start (W01_ground.bin's list). */
  explored(): [number, number][] {
    return this.groundOriginal ? oahuGroundExplored(this.groundOriginal) : [];
  }

  // ---- changes, saving and export

  /** Slots whose bytes differ from the ROM's. */
  changedSlots(): number[] {
    return OAHU_WORLD_SECTIONS.flatMap((h, k) => (this.maps.db.has(h) && !equalBytes(this.maps.db.get(h), this.maps.db.original(h)) ? [k] : []));
  }

  isChanged(): boolean {
    return this.groundChanged() || this.changedSlots().length > 0;
  }

  saved(): OahuWorldSaved {
    const sections = this.changedSlots().map((k): [number, Uint8Array] => [OAHU_WORLD_SECTIONS[k]!, this.section(k).slice()]);
    return { ...(this.groundChanged() ? { cells: this.groundSnapshot()! } : {}), ...(sections.length ? { sections } : {}) };
  }

  restore(saved: OahuWorldSaved): void {
    for (const [h, b] of saved.sections ?? []) if (this.maps.db.has(h) && (OAHU_WORLD_SECTIONS as readonly number[]).includes(h)) this.maps.db.set(h, b);
    if (saved.cells) this.restoreGround(saved.cells);
    this.changed();
  }

  /** The master's entries the export replaces (entry index -> bytes): the terrain when it was edited. */
  changedMasterEntries(): Map<number, Uint8Array> {
    const out = new Map<number, Uint8Array>();
    const b = this.groundBytes();
    if (b && this.groundEntry && this.groundOriginal && !equalBytes(b, this.groundOriginal)) out.set(this.groundEntry.index, b);
    return out;
  }
}

function concatGround(g: OahuGround): Uint8Array {
  const out = new Uint8Array(N * N * 2);
  out.set(g.parts);
  out.set(g.rots, N * N);
  return out;
}

function tableOrNull(master: OahuMaster, name: string): GsTable | null {
  try {
    return master.table(name);
  } catch {
    return null;
  }
}

/** "W01 の入口 #3" style label of an entrance ID. */
export const entranceIdLabel = (id: number): string => hex8(id).toUpperCase();
