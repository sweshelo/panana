// What RPG3 places for the records of a map (naauao oahu/map.md §9): the model of props (section 2), exits, doors and
// buildings (section 3), chests (section 4), the characters and objects of section 5 and the invisible walls of
// section 8, and how it is turned and moved. Characters name a
// mapChara row (EventObject +0x4E) that is an NPC (a mapObject model), a monster (a monsterDesign row) or a Denpa person.
import type { GsTable } from '../archive/gstable';
import { f32, u16, u32 } from '../util/bytes';
import { EO } from './events';

/** What a record's model is. */
export type OahuRecordModel =
  /** A mapObject row (its archive and BCH entry, OahuMaps.objectModel). */
  | { type: 'object'; row: number }
  /** A monster model: a monsterDesign row (402F0000; monsterModels.ts). */
  | { type: 'monster'; design: number }
  /** Kind 2: denpaCustom row; kind 3: save-dependent character selector (not a denpaCustom row). */
  | { type: 'denpa'; kind: 2 | 3; id: number }
  /** An invisible wall (section 8 kinds 100〜102: obj_invisible, a box of `width` × `depth` with no model). */
  | { type: 'invisible'; row: number; width: number; depth: number };

export interface OahuRecordLook {
  model: OahuRecordModel | null;
  /** Angle about +Y (three.js rotation.y). */
  angle: number;
  /** mapChara row of a character (section 5 kinds 0〜2). */
  chara?: number;
  /** Raised by this much (world units; mapObject +0x35, s8). */
  lift?: number;
  /** Moved by this much from the record's position (world units, +x east, +z south; exits of section 3). */
  offset?: [number, number];
}

/** Chest models by the record's +0x00 (low byte) outside / inside (FUN_003684A4). */
export const OAHU_CHEST_OBJECTS = [0x34, 0x35, 0x36] as const;
export const OAHU_CHEST_OBJECTS_INDOOR = [0x37, 0x38, 0x39] as const;

/**
 * Section 5 objects that place a model of their own when EventObject +0x4E is 0 (kind 3 gimk_04_heal_01, 7 / 8
 * gimk_14_roller_01 / 02, 9 mnmp_obj_02_01; FUN_00368E30, FUN_00367EF0, FUN_00368ABC, FUN_00367BC0).
 */
export const OAHU_OBJECT_DEFAULT: Record<number, number> = { 3: 0x33, 7: 0x62, 8: 0x63, 9: 0x67 };
/** Section 8 kinds that place mapObject 0x1E6 / 0x1E7 / 0x1E8 (obj_invisible) like a prop; later kinds take 0x1E6. */
export const OAHU_INVISIBLE_KIND = 100;
export const OAHU_INVISIBLE_OBJECTS = [0x1e6, 0x1e7, 0x1e8] as const;
/** Height of the box of an invisible wall (FUN_00366880 passes 400 with mapObject +0x10 / +0x18). */
export const OAHU_WALL_HEIGHT = 400;

/** mapChara (master 21350000, 0x14 bytes): +0x00 flags (low 3 bits = what it is), +0x08 / +0x0A / +0x0C model by EventObject +0x50. */
export const OAHU_CHARA_KIND: Record<number, string> = { 0: 'NPC', 1: 'モンスター', 2: '電波人間', 3: '電波人間' };
export const oahuCharaKindOf = (row: Uint8Array): number => u32(row, 0) & 7;

const HALF = Math.PI / 2;
/**
 * Props (+0x10) and section 5 objects (+0x1C): c = direction + 1 → 1: 180°, 2: 90°, 3: 0°, 4: −90° (FUN_00364B80,
 * FUN_00366880; RPG2's table). Props past 3 take c = 1 (FUN_00276078), objects 0°.
 */
const QUARTER2 = [Math.PI, HALF, 0, -HALF];
/** Characters (+0x1C): 0: 180°, 1: 90°, 2: 0°, 3: 270° (FUN_00366F30). */
const CHARA_ANGLE = [Math.PI, HALF, 0, 3 * HALF];

export interface OahuLookContext {
  /** The dungeon's EventObject table (null = not loaded). */
  events: GsTable | null;
  mapChara: GsTable;
  mapObject: GsTable;
  /** The map has indoor tiles (runtime +0x546C; chests use the indoor models, stairs turn by their direction). */
  indoor: boolean;
  /** Hash of the map (some exits pick their model by map). */
  map?: number;
  /** The map's wall door model (mapResource +0x1C of its tiles; 0 = the default door). */
  wallDoor?: number;
}

// ---- section 3: exits, stairs, doors and buildings (§9.5)

/**
 * The cell fields FUN_002CA100 makes from an exit's kind (+0x15): stairs (+0x0C: 1 up, 2 down; the buildings 0x14〜0x42
 * also take 1), key (+0x0E: kinds 0x0B〜0x0E → 1〜4) and gimmick (+0x0F). The models follow from these.
 */
export function oahuExitCell(kind: number): { stairs: number; key: number; gimmick: number } {
  const building = kind >= 0x14 && kind <= 0x42;
  const stairs = kind === 4 || building ? 1 : kind === 5 ? 2 : 0;
  const key = kind >= 0x0b && kind <= 0x0e ? kind - 0x0a : 0;
  const gimmick = building ? kind : kind < EXIT_GIMMICK.length ? EXIT_GIMMICK[kind]! : 1;
  return { stairs, key, gimmick };
}
const EXIT_GIMMICK = [1, 1, 5, 0x0d, 2, 2, 3, 4, 6, 7, 8, 0, 0, 0, 0, 0, 0x0a, 0x0b, 0x0c, 0x0e];
/** Buildings (gimmick 0x14〜0x42) → mapObject (twn_bill00〜; FUN_00365294's table). */
const EXIT_BUILDINGS = [
  0xbe, 0xbf, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xd0, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xcc, 0xee,
];
/** Maps where kind 0x13 (the ship) is gimk_18_ship_01 (0xD0); elsewhere 0xD1. */
const SHIP_01_MAPS = new Set([0x249b26f7 /* M10OUT000 */, 0xbf209b55 /* M90OUT000 */]);
/** Kind of the wall doors (FUN_00274A6C; RPG2's section 7). */
export const OAHU_WALL_DOOR = 0x64;
/** Kind of the warp holes (FUN_00368784; gimk_11_warp_01). */
const OAHU_WARP = 8;

/** The model of an exit whose EventObject +0x4E is 0 (FUN_00365294); 0x1E4 / 0x1E5 / 0x170 are obj_invisible. */
export function oahuExitDefaultModel(kind: number, map = 0, wallDoor = 0): number {
  if (kind === OAHU_WALL_DOOR) return wallDoor || 5;
  if (kind === OAHU_WARP) return 0x5d;
  const { stairs, key, gimmick: g } = oahuExitCell(kind);
  if (g >= 0x14 && g <= 0x42) return EXIT_BUILDINGS[g - 0x14]!;
  if (g === 5) return 0x5e;
  if (g === 0x0a) return 0x26;
  if (g === 0x0b) return 0x27;
  if (g === 0 && key) return key >= 5 ? 0x25 : 0x20 + key;
  if (g === 9) return 5;
  if (g === 0x0e) return SHIP_01_MAPS.has(map) ? 0xd0 : 0xd1;
  if (stairs === 0) {
    if (g === 7 || g === 4 || g === 8) return 0x1e4;
    if (g === 3) return 0x49;
    if (g === 0x0c) return 0x1e5;
    return key ? 4 : 0x20;
  }
  if (stairs === 1) return 1;
  return g === 3 ? 0x49 : 2;
}
/** mapObject rows that are obj_invisible (exits nobody sees). */
export const OAHU_INVISIBLE_ROWS = new Set([0x170, 0x1e4, 0x1e5, 0x1e6, 0x1e7, 0x1e8]);

/** FUN_00225B64: c = direction + 1 → 1: 0°, 2: −90°, 3: 180°, 4: +90° (RPG2's section 3 table). */
const exitAngle = (c: number): number => [0, 0, -HALF, Math.PI, HALF][c] ?? 0;
/** FUN_00225C98: the way c faces (x, z): 1 north, 2 east, 3 south, 4 west. */
const exitStep = (c: number): [number, number] => ([[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][])[c] ?? [0, 0];

/**
 * How an exit is turned and moved from its cell (FUN_00365294 with the cell of FUN_002CA100): doors and gates stand
 * 100 towards their direction, kind 0x12 250; buildings, warps and holes sit in the middle, unturned; stairs turn by
 * the direction (inside ±90°, outside by a table) and inside step 50 towards it. Outside, the game also moves down
 * stairs 100 towards the open side of their tile (not done here).
 */
export function oahuExitPlacement(kind: number, dir: number, indoor: boolean): { angle: number; offset: [number, number] } {
  const c = dir + 1;
  if (kind === OAHU_WALL_DOOR) return { angle: exitAngle(propC(dir)), offset: [0, 0] };
  if (kind === OAHU_WARP) return { angle: 0, offset: [0, 0] };
  const { stairs, gimmick: g } = oahuExitCell(kind);
  const step = (d: number): [number, number] => {
    const [x, z] = exitStep(c);
    return x || z ? [x * d, z * d] : [0, -d];
  };
  // the angle (0x365A98〜)
  let angle: number;
  if ((g >= 0x14 && g <= 0x42) || g === 5) angle = 0;
  else if (stairs === 0 || g === 0x0a || g === 0x0b || g === 0) angle = exitAngle(c);
  else if (indoor) angle = exitAngle(c) + (stairs === 1 ? -HALF : HALF);
  else angle = (stairs === 1 ? [0, HALF, 0, 3 * HALF, Math.PI] : [0, 3 * HALF, Math.PI, HALF, 0])[c] ?? 0;
  // the position (0x365C70〜)
  let offset: [number, number] = [0, 0];
  if ((g >= 0x14 && g <= 0x42) || g === 5 || g === 8 || g === 3 || g === 4) offset = [0, 0];
  else if (g === 0x0c) offset = step(250);
  else if (stairs === 0 || g === 0x0a || g === 0x0b || g === 0) offset = step(100);
  else if (indoor) {
    const [x, z] = exitStep(c);
    offset = [x * 50, z * 50];
  }
  return { angle, offset };
}
/** FUN_00276078: c = direction + 1, directions past 3 take c = 1. */
const propC = (dir: number): number => (dir <= 3 ? dir + 1 : 1);

/** The model of a character: mapChara row `chara`, model slot `variant` (EventObject +0x50; FUN_00366F30). */
export function oahuCharaModel(mapChara: GsTable, chara: number, variant: number): OahuRecordModel | null {
  if (chara <= 0 || chara >= mapChara.rows) return null;
  const c = mapChara.row(chara);
  const kind = oahuCharaKindOf(c);
  if (!Number.isInteger(variant) || variant < 0 || variant > 2) return null;
  const id = u16(c, 8 + variant * 2);
  if (kind === 0) return id ? { type: 'object', row: id } : null;
  if (kind === 1) return { type: 'monster', design: id };
  return kind === 2 || kind === 3 ? { type: 'denpa', kind, id } : null;
}

/** The angle of props and the objects placed like them: FUN_00276078 turns directions past 3 into c = 1 (180°). */
const propAngle = (dir: number): number => QUARTER2[propC(dir) - 1]!;

/** mapObject +0x35 (s8): what FUN_00364B80 (props) and FUN_00366880 (section 5 kinds 4〜6 / 0x0B / 0x0D / 0x0E) add to the height. */
export function oahuObjectLift(mapObject: GsTable, row: number): number {
  return row > 0 && row < mapObject.rows ? (mapObject.row(row)[0x35]! << 24) >> 24 : 0;
}

/** The model of a record and its angle; null = the section places no model. */
export function oahuRecordLook(section: number, raw: Uint8Array, ctx: OahuLookContext): OahuRecordLook | null {
  const evRow = section === 3 || section === 4 || section === 5 ? u32(raw, 4) : 0;
  const ev = evRow && ctx.events && evRow < ctx.events.rows ? ctx.events.row(evRow) : null;
  const evModel = ev ? u16(ev, EO.model) : 0;
  const object = (row: number, angle: number, lift = false): OahuRecordLook => ({
    model: { type: 'object', row },
    angle,
    ...(lift ? { lift: oahuObjectLift(ctx.mapObject, row) } : {}),
  });
  switch (section) {
    case 2: {
      const row = u32(raw, 0);
      return row ? object(row, propAngle(raw[0x10]!), true) : null;
    }
    case 3: {
      const kind = raw[0x15]!;
      const row = evModel || oahuExitDefaultModel(kind, ctx.map, ctx.wallDoor);
      const { angle, offset } = oahuExitPlacement(kind, raw[0x14]!, ctx.indoor);
      const look: OahuRecordLook = OAHU_INVISIBLE_ROWS.has(row) ? { model: null, angle } : object(row, angle);
      // wall doors stand 5 below the floor like RPG2's
      if (kind === OAHU_WALL_DOOR) look.lift = -5;
      if (offset[0] || offset[1]) look.offset = offset;
      return look;
    }
    case 4: {
      // EventObject +0x4E, else the kind (+0x00, low byte) picks one of three chests; they are not turned
      const set = ctx.indoor ? OAHU_CHEST_OBJECTS_INDOOR : OAHU_CHEST_OBJECTS;
      return object(evModel || set[raw[0]!] || set[0], 0);
    }
    case 5: {
      const kind = u32(raw, 0);
      const dir = raw[0x1c]!;
      if (kind <= 2) {
        if (!ev) return { model: null, angle: 0, chara: 0 };
        return { model: oahuCharaModel(ctx.mapChara, evModel, u16(ev, EO.flags)), angle: CHARA_ANGLE[dir] ?? 0, chara: evModel };
      }
      if (!ev) return null;
      const row = evModel || OAHU_OBJECT_DEFAULT[kind] || 0;
      if (!row) return null;
      switch (kind) {
        // the healing spring, the rollers and kind 0x0C (an effect under the object) are not turned
        case 3: case 7: case 8: case 0x0c: return object(row, 0);
        case 9: case 0x0a: return object(row, propAngle(dir));
        // 4〜6 / 0x0B / 0x0D / 0x0E: c = direction + 1, other values keep 0° (FUN_003667A4 → FUN_00366880)
        default: return object(row, QUARTER2[dir] ?? 0, true);
      }
    }
    case 8: {
      const kind = u32(raw, 0);
      if (kind < OAHU_INVISIBLE_KIND) return null;
      const row = OAHU_INVISIBLE_OBJECTS[kind - OAHU_INVISIBLE_KIND] ?? OAHU_INVISIBLE_OBJECTS[0];
      const o = row < ctx.mapObject.rows ? ctx.mapObject.row(row) : null;
      return { model: { type: 'invisible', row, width: o ? f32(o, 0x10) : 0, depth: o ? f32(o, 0x18) : 0 }, angle: propAngle(raw[0x1c]!) };
    }
  }
  return null;
}
