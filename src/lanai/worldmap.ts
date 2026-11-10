// 電波人間のRPG FREE!'s world maps (W01 in 9 contents, W02 in 3; naauao lanai/worldmap.md): RPG3's world (oahu/worldmap.ts)
// with the sections in the slots of the map table row itself (no table in code.bin) and the terrain in slot 9 of the
// content's map database instead of the master's W01_ground.bin (the same bytes: header, 300 x 300 cells, pools). The
// entrances' destinations are action 0x8000001F of the world's EventObject rows (+0x14 map, +0x18〜+0x24 points), their
// models EventObject +0x5A (else WorldmapParts +0x0C), their facings 1 / 2 / 4 / 8 as the dungeons'.
import { LANAI_ROT_CODEC } from '../game/sections';
import { equalBytes, s16, u32, w32 } from '../util/bytes';
import { parseOahuGround, ENTRANCE_SIZE, parseRanges, buildRanges, WE, oahuCoveredBy, type OahuGround, type OahuWorldRange } from '../oahu/worldmap';
import { LANAI_EVENT_ACTIONS, type LanaiMapInfo, type LanaiMaps } from './maps';
import type { LanaiTable } from './table';

export { WE, ENTRANCE_SIZE };
export type { OahuWorldRange as LanaiWorldRange };

/** The contents that have a world map (W01; 33 / 71 / 126 also W02). The page lists them without reading every content. */
export const LANAI_WORLD_CONTENTS = [2, 3, 12, 33, 69, 71, 101, 124, 126] as const;
export const LANAI_WORLD_SIZE = 300;
/** Slots of a world's map table row (FUN_002b164c reads slot k of the row; FUN_001fc200 sets the world up). */
export const LW = { tiles: 0, dark: 1, entrances: 2, land: 3, sea: 4, events: 5, props: 6, explored: 7, objects: 8, ground: 9 } as const;
export const LANAI_WORLD_SLOT_LABEL: Record<number, string> = {
  0: 'タイル (空)', 1: '暗い海', 2: '入口', 3: 'エンカウントの範囲 (陸)', 4: 'エンカウントの範囲 (海)', 5: 'イベントの範囲', 6: '置物', 7: '区画 7 (2 bit)', 8: '置物・扉 (12 B)', 9: '地形',
};
/** The action that takes the player from the world into a map: +0x14 the map, +0x18 / +0x1C / +0x20 / +0x24 four point IDs. */
export const LANAI_WORLD_ENTER = 0x8000001f;
/** EventObject +0x5A: the MapObject row of the entrance's model (0 = WorldmapParts +0x0C). */
export const LANAI_EO_MODEL = 0x5a;
/** The master's WorldmapParts (95 x 16 bytes). */
export const LANAI_WORLD_PARTS = 'WorldmapParts';
/** Archive of the terrain models (BCH, bgpt_wld_*) and their shared texture tex_worldmap.bch. */
export const LANAI_WORLD_MODELS = '0E820000';
export const LANAI_WORLD_TEXTURES = 0xd47b4000;

// ---- WorldmapParts

export interface LanaiWorldPart {
  row: number;
  /** +0x00: the model entry in LANAI_WORLD_MODELS (0 = none). */
  model: number;
  /** +0x04: 0x10 = 2 x 2 cells, 0x20 = 2 cells, 0x08 a mark of the cell, 0x04 / 0x02 / 0x01 the kind of ground (推定). */
  flags: number;
  /** +0x08: the BattleField row of the battles on it. */
  battle: number;
  /** +0x0C: the MapObject row of the entrances of this kind when their EventObject row has none. */
  object: number;
  /** The model's file name ("bgpt_wld_flat_00.bch"), '' until read. */
  name: string;
}

export function lanaiWorldParts(t: LanaiTable | undefined): LanaiWorldPart[] {
  const out: LanaiWorldPart[] = [];
  for (let r = 0; t && r < t.rows; r++) out.push({ row: r, model: t.u32(r, 0), flags: t.u8(r, 4), battle: t.u32(r, 8), object: t.rowSize >= 0x0e ? t.u16(r, 0x0c) : 0, name: '' });
  return out;
}

// ---- the terrain (slot 9; oahu's W01_ground.bin)

const N = LANAI_WORLD_SIZE;
const GRID_AT = 0x14;

/** Where the pools are (header +0x08) and how many (up to the list at +0x0C). */
function poolSpan(b: Uint8Array): [at: number, count: number] {
  const at = u32(b, 8), end = u32(b, 12);
  return [at, Math.max(0, Math.min(Math.floor((end - at) / 4), Math.floor((b.length - at) / 4)))];
}

/** The pools of the parts in the four 2 x 2 blocks around cell i that `part` would need (oahuGroundPools for those blocks). */
function blockNeed(parts: Uint8Array, x: number, y: number, part: number): number {
  let best = 0;
  for (const [bx, by] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]] as const) {
    if (bx < 0 || by < 0 || bx + 1 >= N || by + 1 >= N) continue;
    const i = by * N + bx;
    const n = [parts[i], parts[i + 1], parts[i + N], parts[i + N + 1]].filter((p) => p === part).length;
    if (n > best) best = n;
  }
  return best;
}

// ---- slot 8: {u32 EventObject row, u32 kind, s16 x, s16 y} (12 bytes; kind 0 takes EventObject +0x5A's model)

export interface LanaiWorldPoint {
  /** EventObject row (slots 5 / 8) or MapObject row (slot 6). */
  value: number;
  x: number;
  y: number;
  kind?: number;
  dir?: number;
}

export function parseWorldObjects(b: Uint8Array): LanaiWorldPoint[] {
  const out: LanaiWorldPoint[] = [];
  for (let o = 0; o + 12 <= b.length; o += 12) out.push({ value: u32(b, o), kind: u32(b, o + 4), x: s16(b, o + 8) + 0.5, y: s16(b, o + 10) + 0.5 });
  return out;
}

/** The turn (0..3) of an entrance's facing byte (+0x1C: 1 / 2 / 4 / 8); 0 for a byte that is none of them. */
export const entranceTurn = (r: Uint8Array): number => Math.max(0, LANAI_ROT_CODEC.decode(r[0x1c] ?? 0));

/** Where an entrance leads: its EventObject row and the action 0x8000001F in it. */
export interface LanaiEntranceDest {
  /** EventObject row (+0x0C), 0 = none. */
  row: number;
  /** Offset of the entering action in the row (0x10 / 0x28 / 0x40), -1 when it has none (a script, …). */
  action: number;
  /** The type of the row's first action. */
  type: number;
  mapHash: number;
  map: LanaiMapInfo | undefined;
  /** The four point IDs (+0x18〜+0x24 of the action). */
  points: number[];
}

interface Snapshot {
  sections: [number, Uint8Array][];
  events: Uint8Array[] | null;
}

/** One world map (W01 or W02) of a content, edited in the content's map database. */
export class LanaiWorld {
  readonly parts: LanaiWorldPart[];
  /** The terrain as edited (null when slot 9 is not a terrain). */
  readonly ground: OahuGround | null;
  /** Bumped on every edit. */
  revision = 0;

  constructor(
    readonly maps: LanaiMaps,
    readonly info: LanaiMapInfo,
    parts: LanaiWorldPart[],
  ) {
    this.parts = parts;
    const g = this.section(LW.ground);
    this.ground = g.length ? parseOahuGround(g) : null;
  }

  get name(): string {
    return this.info.name;
  }

  hash(slot: number): number {
    return this.info.slots[slot] ?? 0;
  }

  /** Bytes of a slot as edited (empty when the database has none). */
  section(slot: number): Uint8Array {
    const h = this.hash(slot);
    return h && this.maps.db.has(h) ? this.maps.db.get(h) : new Uint8Array(0);
  }
  originalSection(slot: number): Uint8Array {
    const h = this.hash(slot);
    return h && this.maps.db.has(h) ? this.maps.db.original(h) : new Uint8Array(0);
  }
  setSection(slot: number, bytes: Uint8Array): void {
    const h = this.hash(slot);
    if (!h || !this.maps.db.has(h)) return;
    if (equalBytes(bytes, this.maps.db.original(h))) this.maps.db.revert(h);
    else this.maps.db.set(h, bytes);
    if (slot === LW.ground) this.readGround();
    this.changed();
  }

  private readGround(): void {
    const g = this.ground, b = this.section(LW.ground);
    if (!g || b.length < GRID_AT + N * N * 2) return;
    for (let i = 0; i < N * N; i++) {
      g.parts[i] = b[GRID_AT + i * 2]!;
      g.rots[i] = b[GRID_AT + 1 + i * 2]! & 3;
    }
  }

  changed(): void {
    this.revision++;
    this.maps.changed();
    this.maps.session.edited();
  }

  // ---- terrain

  partFlags = (part: number): number => this.parts[part]?.flags ?? 0;

  /** The terrain's bytes painted in place (a copy put in the database by groundBuffer). */
  private groundOwn: Uint8Array | null = null;

  /** The terrain's bytes being edited: a copy put in the database once, then written in place. */
  private groundBuffer(): Uint8Array | null {
    const h = this.hash(LW.ground);
    if (!h || !this.maps.db.has(h)) return null;
    const cur = this.maps.db.get(h);
    if (cur === this.groundOwn) return cur;
    this.groundOwn = cur.slice();
    this.maps.db.set(h, this.groundOwn);
    return this.groundOwn;
  }

  /**
   * Put part `part` (0 = none) turned by `rot` at cell (x, y); false when it is already there. The pools (header +0x08)
   * grow for the blocks around the cell (a pool never shrinks; normalize() recounts them).
   */
  paint(x: number, y: number, part: number, rot: number): boolean {
    const g = this.ground;
    if (!g || x < 0 || y < 0 || x >= N || y >= N) return false;
    const i = y * N + x;
    if (g.parts[i] === part && (g.rots[i] === (rot & 3) || !part)) return false;
    const b = this.groundBuffer();
    if (!b) return false;
    g.parts[i] = part;
    g.rots[i] = part ? rot & 3 : 0;
    b[GRID_AT + i * 2] = part;
    b[GRID_AT + 1 + i * 2] = (b[GRID_AT + 1 + i * 2]! & ~3) | g.rots[i]!;
    const [at, count] = poolSpan(b);
    if (part && part < count) {
      const need = blockNeed(g.parts, x, y, part);
      if (need > u32(b, at + part * 4)) w32(b, at + part * 4, need);
    }
    this.changed();
    return true;
  }

  /**
   * Count the pools again (the most cells a part starts at in any 2 x 2 block, never below the ROM's) and drop the
   * change when the terrain is the ROM's again.
   */
  normalize(): void {
    const h = this.hash(LW.ground), g = this.ground;
    if (!g || !h || !this.maps.db.has(h)) return;
    const orig = this.maps.db.original(h), cur = this.maps.db.get(h);
    if (cur !== this.groundOwn) return;
    const [at, count] = poolSpan(orig);
    const need = new Array<number>(count).fill(0);
    for (let y = 0; y + 1 < N; y++)
      for (let x = 0; x + 1 < N; x++) {
        const i = y * N + x;
        const cells = [g.parts[i]!, g.parts[i + 1]!, g.parts[i + N]!, g.parts[i + N + 1]!];
        for (const p of cells) {
          if (!p || p >= count) continue;
          const n = cells.filter((c) => c === p).length;
          if (n > need[p]!) need[p] = n;
        }
      }
    for (let p = 0; p < count; p++) w32(cur, at + p * 4, Math.max(u32(orig, at + p * 4), need[p]!));
    if (equalBytes(cur, orig)) {
      this.maps.db.revert(h);
      this.groundOwn = null;
    }
  }

  groundChanged(): boolean {
    const h = this.hash(LW.ground);
    return !!h && this.maps.db.has(h) && !equalBytes(this.maps.db.get(h), this.maps.db.original(h));
  }

  /** The part covering each cell (2 x 2 and 2-cell parts, as the game spreads them; FUN_001f4558). */
  coveredBy(): Int32Array | null {
    return this.ground ? oahuCoveredBy(this.ground, this.partFlags) : null;
  }

  // ---- entrances (slot 2)

  entrances(): Uint8Array[] {
    return records(this.section(LW.entrances));
  }
  originalEntrances(): Uint8Array[] {
    return records(this.originalSection(LW.entrances));
  }
  setEntrances(list: Uint8Array[]): void {
    const out = new Uint8Array(list.length * ENTRANCE_SIZE);
    list.forEach((r, i) => out.set(r, i * ENTRANCE_SIZE));
    this.setSection(LW.entrances, out);
  }
  setEntrance(index: number, r: Uint8Array): void {
    const l = this.entrances();
    l[index] = r;
    this.setEntrances(l);
  }
  entranceById(id: number): number {
    return this.entrances().findIndex((r) => WE.id(r) === id);
  }

  /** The world's EventObject table (its MapGroup's +0x1C). */
  eventTable(): LanaiTable | undefined {
    return this.maps.eventTable(this.info.dungeon);
  }

  dest(r: Uint8Array): LanaiEntranceDest {
    const row = WE.event(r);
    const t = this.eventTable();
    if (!t || !row || row >= t.rows) return { row, action: -1, type: 0, mapHash: 0, map: undefined, points: [] };
    const action = LANAI_EVENT_ACTIONS.find((o) => t.u32(row, o) === LANAI_WORLD_ENTER) ?? -1;
    const mapHash = action >= 0 ? t.u32(row, action + 4) : 0;
    return {
      row, action, type: t.u32(row, LANAI_EVENT_ACTIONS[0]), mapHash, map: mapHash ? this.maps.map(mapHash) : undefined,
      points: action >= 0 ? [0, 1, 2, 3].map((k) => t.u32(row, action + 8 + k * 4)) : [],
    };
  }

  /** The MapObject row of an entrance's model: EventObject +0x5A, else its WorldmapParts row's +0x0C (FUN_001fc200). */
  entranceObject(r: Uint8Array): number {
    const t = this.eventTable();
    const row = WE.event(r);
    const own = t && row > 0 && row < t.rows ? t.u16(row, LANAI_EO_MODEL) : 0;
    return own || this.parts[WE.part(r)]?.object || 0;
  }

  /** How many entrances name EventObject row `row`. */
  eventUsers(row: number): number {
    return this.entrances().filter((r) => WE.event(r) === row).length;
  }

  /**
   * A new entrance copied from entrance `from` at cell (x, y), with an EventObject row of its own (a copy of the one of
   * `from`, so it leads to the same place until changed) and a new ID. Returns its index.
   */
  addEntrance(from: number, x: number, y: number): number {
    const list = this.entrances();
    const src = list[from];
    if (!src) throw new RangeError(`入口 #${from} はありません`);
    const r = src.slice();
    const ev = WE.event(src);
    const t = this.eventTable();
    if (t && ev > 0 && ev < t.rows) w32(r, 0x0c, this.maps.addEventRow(this.info.dungeon, ev));
    w32(r, 0x08, this.freshId());
    r.set(new Uint8Array(8), 0x14); // no offset
    const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
    v.setInt16(0x10, Math.max(0, Math.min(N - 1, x)), true);
    v.setInt16(0x12, Math.max(0, Math.min(N - 1, y)), true);
    this.setEntrances([...list, r]);
    return list.length;
  }

  /** Remove an entrance Panana added (the ROM's keep their places: the maps' exits name them by ID, not by index). */
  removeEntrance(index: number): boolean {
    const list = this.entrances();
    if (index < this.originalEntrances().length || index >= list.length) return false;
    this.setEntrances(list.filter((_, i) => i !== index));
    return true;
  }

  /** An entrance ID no entrance or exit of the content uses (IDs look like hashes; a counter above them does). */
  private freshId(): number {
    const used = new Set<number>(this.entrances().map((r) => WE.id(r)));
    for (const m of this.maps.maps) for (const e of this.maps.doc(m).recs[3] ?? []) used.add(u32(e.raw, 0));
    let id = (0x50414e00 + this.entrances().length) >>> 0; // "PAN" + n
    while (used.has(id)) id = (id + 1) >>> 0;
    return id;
  }

  /** The exits of the content's maps that lead to this world (EventObject actions naming it: 0x11 / 0x14 / 0x0D …). */
  exitsTo(): { map: LanaiMapInfo; section: number; index: number; point: number }[] {
    const out: { map: LanaiMapInfo; section: number; index: number; point: number }[] = [];
    for (const m of this.maps.maps) {
      if (m.world) continue;
      const t = this.maps.eventTable(m.dungeon);
      if (!t) continue;
      for (const section of [3, 4, 5, 8]) {
        (this.maps.doc(m).recs[section] ?? []).forEach((e, index) => {
          const row = u32(e.raw, 4);
          if (!row || row >= t.rows) return;
          for (const o of LANAI_EVENT_ACTIONS) if (t.u32(row, o + 4) === this.info.hash) out.push({ map: m, section, index, point: t.u32(row, o + 8) });
        });
      }
    }
    return out;
  }

  // ---- ranges (slots 3 / 4: {u32 AreaInfo row ID, s16 x, s16 y, u8 w, u8 h, u16 0})

  ranges(slot: typeof LW.land | typeof LW.sea): OahuWorldRange[] {
    return parseRanges(this.section(slot));
  }
  setRanges(slot: typeof LW.land | typeof LW.sea, list: OahuWorldRange[]): void {
    this.setSection(slot, buildRanges(list, this.originalSection(slot)));
  }

  /** The MonsterGroup row ID of an AreaInfo row ID (AreaInfo +0x04), and whether it is land (1) or sea (2) (+0x08). */
  areaInfo(id: number): { row: number; group: number; kind: number } | null {
    const t = this.maps.contentTable('AreaInfo');
    const row = t ? t.find(id) : -1;
    return t && row >= 0 ? { row, group: t.u32(row, 4), kind: t.u8(row, 8) } : null;
  }
  /** The AreaInfo row IDs of a kind (1 land, 2 sea). */
  areaInfoIds(kind: number): number[] {
    const t = this.maps.contentTable('AreaInfo');
    return t ? Array.from({ length: t.rows }, (_, r) => r).filter((r) => t.u8(r, 8) === kind && t.u32(r, 4)).map((r) => t.rowId(r)) : [];
  }

  // ---- undo and changes

  snapshot(): Snapshot {
    this.normalize();
    return {
      sections: [LW.entrances, LW.land, LW.sea, LW.ground].map((k): [number, Uint8Array] => [k, this.section(k).slice()]),
      events: this.maps.eventRows(this.info.dungeon),
    };
  }
  restore(s: unknown): void {
    const snap = s as Snapshot;
    if (snap.events) this.maps.restoreEventRows(this.info.dungeon, snap.events);
    for (const [k, b] of snap.sections) this.setSection(k, b.slice());
  }

  /** Slots whose bytes differ from the ROM's. */
  changedSlots(): number[] {
    return this.info.slots.flatMap((h, k) => (h && this.maps.db.has(h) && !equalBytes(this.maps.db.get(h), this.maps.db.original(h)) ? [k] : []));
  }
  isChanged(): boolean {
    return this.changedSlots().length > 0;
  }
  /** Put every slot back as in the ROM (the EventObject rows stay as edited). */
  revert(): void {
    for (const h of this.info.slots) if (h && this.maps.db.has(h)) this.maps.db.revert(h);
    this.readGround();
    this.changed();
  }
}

function records(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let o = 0; o + ENTRANCE_SIZE <= b.length; o += ENTRANCE_SIZE) out.push(b.slice(o, o + ENTRANCE_SIZE));
  return out;
}

