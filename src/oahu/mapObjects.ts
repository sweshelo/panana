// What RPG3 places for the records of a map (naauao oahu/map.md §9): the model of props (section 2), chests (section 4),
// the characters and objects of section 5 and the invisible walls of section 8, and how it is turned. Characters name a
// mapChara row (EventObject +0x4E) that is an NPC (a mapObject model), a monster (a monsterDesign row) or a Denpa person
// (not drawn).
import type { GsTable } from '../archive/gstable';
import { f32, u16, u32 } from '../util/bytes';
import { EO } from './events';

/** What a record's model is. */
export type OahuRecordModel =
  /** A mapObject row (its archive and BCH entry, OahuMaps.objectModel). */
  | { type: 'object'; row: number }
  /** A monster model: a monsterDesign row (402F0000; monsterModels.ts). */
  | { type: 'monster'; design: number }
  /** A Denpa person (mapChara kinds 2 / 3, built from parts; not drawn yet). */
  | { type: 'denpa' }
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
  /** The map has indoor tiles (runtime +0x546C; chests use the indoor models). */
  indoor: boolean;
}

/** The model of a character: mapChara row `chara`, model slot `variant` (EventObject +0x50; FUN_00366F30). */
export function oahuCharaModel(mapChara: GsTable, chara: number, variant: number): OahuRecordModel | null {
  if (chara <= 0 || chara >= mapChara.rows) return null;
  const c = mapChara.row(chara);
  const kind = oahuCharaKindOf(c);
  const id = variant <= 2 ? u16(c, 8 + variant * 2) : 0;
  if (kind === 0) return id ? { type: 'object', row: id } : null;
  if (kind === 1) return { type: 'monster', design: id };
  return { type: 'denpa' };
}

/** The angle of props and the objects placed like them: FUN_00276078 turns directions past 3 into c = 1 (180°). */
const propAngle = (dir: number): number => (dir <= 3 ? QUARTER2[dir]! : Math.PI);

/** mapObject +0x35 (s8): what FUN_00364B80 (props) and FUN_00366880 (section 5 kinds 4〜6 / 0x0B / 0x0D / 0x0E) add to the height. */
export function oahuObjectLift(mapObject: GsTable, row: number): number {
  return row > 0 && row < mapObject.rows ? (mapObject.row(row)[0x35]! << 24) >> 24 : 0;
}

/** The model of a record and its angle; null = the section places no model. */
export function oahuRecordLook(section: number, raw: Uint8Array, ctx: OahuLookContext): OahuRecordLook | null {
  const evRow = section === 4 || section === 5 ? u32(raw, 4) : 0;
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
