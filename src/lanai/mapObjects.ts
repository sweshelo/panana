// What RPG FREE! places for the records of a map, as RPG3's (oahu/mapObjects.ts): the models of props (section 2),
// exits and doors (section 3), chests (section 4) and the characters and objects of section 5, and how they are turned
// and moved. The models are rows of the master's MapObject (784 × 0x30: +0x00 archive, +0x04 entry, +0x1C scale).
// Read from the data of every map (naauao lanai/map.md §5, §7.1), not from the code:
// - EventObject +0x5A is the model of a record (RPG3's +0x4E): a MapObject row number for exits, chests and objects,
//   a MapChara row of the content for the characters of section 5 (kinds 0 / 1 / 2).
// - MapChara (0x30 bytes a row) +0x2C (u16) is the MapObject row of the character's model (npc_NN, …), but a MonsterDesign
//   row for a monster (kind 1, +0x00 & 7): the figures of the bosses that fight after a talk (lanai/key-objects.md §1).
// - The clear warp (section 3 kind 3) and the recovery points (section 5 kinds 12 / 13) place no model: the code puts an
//   effect of EffectData (master +0x1E4) there and does not read EventObject +0x5A (key-objects.md §3.2, §3.3).
// - The goal chest (section 4 look 3) is MapObject 0x80000274 gimk_05_trebox_goal outside and inside (FUN_0044F9EC).
// - Section 5 kinds 3 (heal) / 9 / 10 without EventObject +0x5A take MapObject rows 0x3F (gimk_04_heal_1) / 0x72 / 0x75.
// These defaults were checked in the code (Update v17408).
// - MapObject keeps RPG3's mapObject numbering in its row IDs (0x80000034〜39 are the chests gimk_05_trebox_*,
//   0x80000001 / 2 the stairs, 0x80000004 / 5 the doors), so the defaults of a record without a model are RPG3's.
// The facings are 1 / 2 / 4 / 8 masks (§3.2) read as RPG3's directions 0..3 (maps.ts lanaiRecFacing).
import { LANAI_ROT_CODEC } from '../game/sections';
import { f32, u16, u32 } from '../util/bytes';
import type { LanaiPartRef } from './maps';
import { ROW_ID, type LanaiTable } from './table';

/** What a record's model is: a MapObject row (number) of the master, a MonsterDesign row, or an effect (EffectData row). */
export type LanaiRecordModel =
  | { type: 'object'; row: number }
  /** A monster's model: a MonsterDesign row (monsterModels.ts). */
  | { type: 'monster'; design: number }
  /** An effect the game puts there instead of a model (EffectData row; the viewer draws a marker). */
  | { type: 'effect'; row: number };

export interface LanaiRecordLook {
  model: LanaiRecordModel | null;
  /** Angle about +Y (three.js rotation.y). */
  angle: number;
  /** MapChara row of a character (section 5 kinds 0〜2). */
  chara?: number;
  /** Moved by this much from the record's position (world units, +x east, +z south; exits of section 3). */
  offset?: [number, number];
}

/** EventObject +0x5A: the record's model (RPG3's +0x4E). */
export const LANAI_EO_MODEL = 0x5a;
/** MapChara +0x2C: the MapObject row of the character's model (a MonsterDesign row for a monster). */
export const LANAI_CHARA_OBJECT = 0x2c;
/** MapChara +0x00 (low 3 bits; RPG3's mapChara kinds): 0 NPC, 1 monster, 2 / 3 Denpa person (assumed, as RPG3's). */
export const LANAI_CHARA_KIND: Record<number, string> = { 0: 'NPC', 1: 'モンスター', 2: '電波人間', 3: '電波人間' };
/** The MapChara kind of a monster: +0x2C is a MonsterDesign row. */
export const LANAI_CHARA_MONSTER = 1;

/** Chest models (RPG3's mapObject numbers = MapObject row IDs) by the record's look (+0x00) outside / inside; look 3 is the goal chest. */
const CHEST_IDS = [0x34, 0x35, 0x36, 0x274] as const;
const CHEST_IDS_INDOOR = [0x37, 0x38, 0x39, 0x274] as const;
/** The look (+0x00) of the goal chest (opening it clears the content; action 0x8000002E). */
export const LANAI_GOAL_CHEST = 3;
/** The exit kind (+0x15) of the clear warp (action 0x80000031). */
export const LANAI_CLEAR_WARP = 3;
/** Section 5 kinds of the recovery points: 13 the point (action 0x80000030), 12 the field. */
export const LANAI_REPAIR_POINT = 13;
export const LANAI_REPAIR_FIELD = 12;
/** EffectData rows the game puts for them: fx_bg_f_warpzone_goal, fx_bg_repair_field, fx_bg_repair_point. */
export const LANAI_EFFECT_CLEAR_WARP = 0x22;
export const LANAI_EFFECT_REPAIR_FIELD = 0x26;
export const LANAI_EFFECT_REPAIR_POINT = 0x27;
/** Exit kinds (+0x15; map.md §5.1): 5 up stairs, 6 down stairs (RPG3's 4 / 5), 100 the wall door. */
export const LANAI_UP_STAIRS = 5;
export const LANAI_DOWN_STAIRS = 6;
export const LANAI_WALL_DOOR = 100;
/** Stairs and the default wall door (RPG3's mapObject 1 / 2 / 5). */
const STAIRS_UP_ID = 1, STAIRS_DOWN_ID = 2, WALL_DOOR_ID = 5;

/** MapObject rows (row numbers) section 5 places for a kind when EventObject +0x5A is 0: 3 → 0x3F gimk_04_heal_1, 9 → 0x72, 10 → 0x75. */
const SECTION5_DEFAULT_ROWS: Record<number, number> = { 3: 0x3f, 9: 0x72, 10: 0x75 };

const HALF = Math.PI / 2;
/** Props, objects and characters: direction 0..3 → 180°, 90°, 0°, −90° (RPG3's FUN_00364B80 / FUN_00366F30). */
const QUARTER = [Math.PI, HALF, 0, -HALF];
/** Exits: c = direction + 1 → 1: 0°, 2: −90°, 3: 180°, 4: +90° (RPG3's FUN_00225B64). */
const exitAngle = (dir: number): number => [0, -HALF, Math.PI, HALF][dir] ?? 0;
/** The way an exit faces (x, z): 0 north, 1 east, 2 south, 3 west (RPG3's FUN_00225C98). */
const exitStep = (dir: number): [number, number] => ([[0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][])[dir] ?? [0, -1];

/** The direction (0..3) of a facing byte; bytes that are none of the masks take 0, as RPG3's directions past 3. */
const dirOf = (byte: number): number => Math.max(0, LANAI_ROT_CODEC.decode(byte));

/** MapObject row -> the model's archive and entry (MapObject +0x00 / +0x04); null when it has none. */
export function lanaiObjectRef(mapObject: LanaiTable | undefined, row: number): LanaiPartRef | null {
  if (!mapObject || row <= 0 || row >= mapObject.rows) return null;
  const archive = mapObject.u32(row, 0), entry = mapObject.u32(row, 4);
  return archive && entry ? { archive, entry } : null;
}

/** Scale of a MapObject row's model (+0x1C: 1.5 / 1.6 for many NPCs, 0.8 for some stairs). */
export function lanaiObjectScale(mapObject: LanaiTable | undefined, row: number): number {
  if (!mapObject || row <= 0 || row >= mapObject.rows) return 1;
  return f32(mapObject.row(row), 0x1c) || 1;
}

/** The MapObject row of a character (MapChara row; 0 = none), or its MonsterDesign row for a monster. */
export function lanaiCharaObject(mapChara: LanaiTable | undefined, chara: number): number {
  return mapChara && chara > 0 && chara < mapChara.rows ? u16(mapChara.row(chara), LANAI_CHARA_OBJECT) : 0;
}

/** The kind of a character (MapChara +0x00 & 7; LANAI_CHARA_KIND), -1 when the row is not there. */
export function lanaiCharaKind(mapChara: LanaiTable | undefined, chara: number): number {
  return mapChara && chara > 0 && chara < mapChara.rows ? mapChara.u32(chara, 0) & 7 : -1;
}

/**
 * The effects the game puts for records (EffectData rows; the row names an entry of the archive 90ED0000, whose ZIP
 * name is the effect's: read from the code and the ROM, key-objects.md §3).
 */
export const LANAI_EFFECT_NAMES: Record<number, string> = {
  [LANAI_EFFECT_CLEAR_WARP]: 'fx_bg_f_warpzone_goal.ptcl',
  [LANAI_EFFECT_REPAIR_FIELD]: 'fx_bg_repair_field.ptcl',
  [LANAI_EFFECT_REPAIR_POINT]: 'fx_bg_repair_point.ptcl',
};

export interface LanaiLookContext {
  /** The master's MapObject. */
  mapObject: LanaiTable | undefined;
  /** The content's MapChara. */
  mapChara: LanaiTable | undefined;
  /** The EventObject table of the map's group. */
  events: LanaiTable | undefined;
  /** The map has indoor tiles (chests take the indoor models, stairs turn by their direction). */
  indoor: boolean;
}

/** The model of a record and its angle; null = the section places no model. */
export function lanaiRecordLook(section: number, raw: Uint8Array, ctx: LanaiLookContext): LanaiRecordLook | null {
  const mo = ctx.mapObject;
  /** A MapObject row that has a model, else 0. */
  const valid = (row: number): number => (lanaiObjectRef(mo, row) ? row : 0);
  /** The row of a MapObject row ID (RPG3's mapObject number), 0 when there is none. */
  const byId = (id: number): number => valid(mo?.find((ROW_ID | id) >>> 0) ?? -1);
  const object = (row: number, angle: number): LanaiRecordLook => ({ model: row ? { type: 'object', row } : null, angle });
  const evRow = section === 3 || section === 4 || section === 5 ? u32(raw, 4) : 0;
  const ev = evRow && ctx.events && evRow < ctx.events.rows ? ctx.events.row(evRow) : null;
  const evModel = ev ? u16(ev, LANAI_EO_MODEL) : 0;
  switch (section) {
    case 2: {
      const row = valid(u32(raw, 0));
      return row ? object(row, QUARTER[dirOf(raw[0x10]!)]!) : null;
    }
    case 3: {
      const kind = raw[0x15]!;
      // the clear warp: an effect in the cell, not turned (FUN_0021D744 places no MapObject for it)
      if (kind === LANAI_CLEAR_WARP) return { model: { type: 'effect', row: LANAI_EFFECT_CLEAR_WARP }, angle: 0 };
      const dir = dirOf(raw[0x14]!);
      const stairs = kind === LANAI_UP_STAIRS ? 1 : kind === LANAI_DOWN_STAIRS ? 2 : 0;
      const row = valid(evModel) || (stairs === 1 ? byId(STAIRS_UP_ID) : stairs === 2 ? byId(STAIRS_DOWN_ID) : kind === LANAI_WALL_DOOR ? byId(WALL_DOOR_ID) : 0);
      if (!row) return null;
      if (kind === LANAI_WALL_DOOR) return object(row, exitAngle(dir));
      // stairs (FUN_00365294 of RPG3): inside ±90° from the direction and 50 towards it, outside by a table
      if (stairs) {
        if (!ctx.indoor) return object(row, (stairs === 1 ? [HALF, 0, 3 * HALF, Math.PI] : [3 * HALF, Math.PI, HALF, 0])[dir]!);
        const [x, z] = exitStep(dir);
        return { ...object(row, exitAngle(dir) + (stairs === 1 ? -HALF : HALF)), offset: [x * 50, z * 50] };
      }
      // doors and gates stand 100 towards their direction
      const [x, z] = exitStep(dir);
      return { ...object(row, exitAngle(dir)), offset: [x * 100, z * 100] };
    }
    case 4: {
      // EventObject +0x5A, else the look (+0x00) picks one of the chests (looks past 3 take look 0); they are not turned
      const ids = ctx.indoor ? CHEST_IDS_INDOOR : CHEST_IDS;
      return object(valid(evModel) || byId(ids[u32(raw, 0)] ?? ids[0]), 0);
    }
    case 5: {
      const kind = u32(raw, 0);
      const angle = QUARTER[dirOf(raw[0x1c]!)]!;
      if (kind <= 2) {
        if (!ev) return null;
        const design = lanaiCharaObject(ctx.mapChara, evModel);
        if (lanaiCharaKind(ctx.mapChara, evModel) === LANAI_CHARA_MONSTER) return { model: design ? { type: 'monster', design } : null, angle, chara: evModel };
        return { ...object(valid(design), angle), chara: evModel };
      }
      // the recovery points (FUN_0021C844): an effect; only the field takes EventObject +0x5A when it has one
      if (kind === LANAI_REPAIR_POINT) return { model: { type: 'effect', row: LANAI_EFFECT_REPAIR_POINT }, angle };
      if (kind === LANAI_REPAIR_FIELD && !valid(evModel)) return { model: { type: 'effect', row: LANAI_EFFECT_REPAIR_FIELD }, angle };
      // EventObject +0x5A, else the kind's default (kind 3 gimk_04_heal_1; FUN_0021C844)
      const row = valid(evModel) || valid(SECTION5_DEFAULT_ROWS[kind] ?? 0);
      return row ? object(row, angle) : null;
    }
  }
  return null;
}
