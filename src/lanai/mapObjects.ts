// What RPG FREE! places for the records of a map, as RPG3's (oahu/mapObjects.ts): the models of props (section 2),
// exits and doors (section 3), chests (section 4) and the characters and objects of section 5, and how they are turned
// and moved. The models are rows of the master's MapObject (784 × 0x30: +0x00 archive, +0x04 entry, +0x1C scale).
// Read from the data of every map (naauao lanai/map.md §5, §7.1), not from the code:
// - EventObject +0x5A is the model of a record (RPG3's +0x4E): a MapObject row number for exits, chests and objects,
//   a MapChara row of the content for the characters of section 5 (kinds 0 / 1 / 2).
// - MapChara (0x30 bytes a row) +0x2C (u16) is the MapObject row of the character's model (npc_NN, …).
// - MapObject keeps RPG3's mapObject numbering in its row IDs (0x80000034〜39 are the chests gimk_05_trebox_*,
//   0x80000001 / 2 the stairs, 0x80000004 / 5 the doors), so the defaults of a record without a model are RPG3's.
// The facings are 1 / 2 / 4 / 8 masks (§3.2) read as RPG3's directions 0..3 (maps.ts lanaiRecFacing).
// The defaults below were checked in the code (Update v17408; naauao lanai/key-objects.md):
// - chests (FUN_0044F9EC): looks 0〜2 take MapObject rows 0x40〜0x42 outside / 0x43〜0x45 inside (row IDs
//   0x80000034〜39), look 3 the goal chest row 0x46 (ID 0x80000274, gimk_05_trebox_goal) both ways, others the look 0;
// - the clear warp (section 3 kind 3, FUN_0021D744) is the effect EffectData row 0x22 (fx_bg_f_warpzone_goal.ptcl), not
//   a MapObject model, and EventObject +0x5A is not read;
// - section 5 (FUN_0021C844): kind 3 (heal) defaults to row 0x3F (gimk_04_heal_1), 9 to 0x72, 10 to 0x75; kinds 12 / 13
//   are the effects fx_bg_repair_field / fx_bg_repair_point (EffectData rows 0x26 / 0x27): kind 13 takes no model.
import { LANAI_ROT_CODEC } from '../game/sections';
import { f32, u16, u32 } from '../util/bytes';
import type { LanaiPartRef } from './maps';
import { ROW_ID, type LanaiTable } from './table';

/** What a record's model is: a MapObject row (number) of the master. */
export interface LanaiRecordModel {
  type: 'object';
  row: number;
}

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
/** MapChara +0x2C: the MapObject row of the character's model. */
export const LANAI_CHARA_OBJECT = 0x2c;
/** MapChara +0x00 (low 3 bits; RPG3's mapChara kinds): 0 NPC, 1 monster, 2 / 3 Denpa person (assumed, as RPG3's). */
export const LANAI_CHARA_KIND: Record<number, string> = { 0: 'NPC', 1: 'モンスター', 2: '電波人間', 3: '電波人間' };

/** Chest models (RPG3's mapObject numbers = MapObject row IDs) by the record's look (+0x00) outside / inside. */
const CHEST_IDS = [0x34, 0x35, 0x36] as const;
const CHEST_IDS_INDOOR = [0x37, 0x38, 0x39] as const;
/** The look of the goal chest (opening it clears the content) and its model (MapObject row ID; gimk_05_trebox_goal). */
export const LANAI_GOAL_CHEST_LOOK = 3;
const GOAL_CHEST_ID = 0x274;
/** Exit kinds (+0x15; map.md §5.1): 3 the clear warp (an effect), 5 / 6 up / down stairs (RPG3's 4 / 5), 100 the wall door. */
export const LANAI_CLEAR_WARP = 3;
export const LANAI_UP_STAIRS = 5;
export const LANAI_DOWN_STAIRS = 6;
export const LANAI_WALL_DOOR = 100;
/** Stairs and the default wall door (RPG3's mapObject 1 / 2 / 5). */
const STAIRS_UP_ID = 1, STAIRS_DOWN_ID = 2, WALL_DOOR_ID = 5;
/** Section 5 kinds (+0x00) whose model is an effect: 13 the recovery point (action 0x80000030), no MapObject model. */
export const LANAI_RECOVERY_POINT = 13;
/** MapObject rows (numbers) of section 5 kinds without EventObject +0x5A (FUN_0021C844): 3 gimk_04_heal_1, 9 / 10. */
const OBJECT_DEFAULT_ROWS: Record<number, number> = { 3: 0x3f, 9: 0x72, 10: 0x75 };

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

/** The MapObject row of a character (MapChara row; 0 = none). */
export function lanaiCharaObject(mapChara: LanaiTable | undefined, chara: number): number {
  return mapChara && chara > 0 && chara < mapChara.rows ? u16(mapChara.row(chara), LANAI_CHARA_OBJECT) : 0;
}

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
      // the clear warp shows an effect whatever +0x5A says
      if (kind === LANAI_CLEAR_WARP) return null;
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
      // EventObject +0x5A, else the look (+0x00) picks one of the chests; they are not turned
      const ids = ctx.indoor ? CHEST_IDS_INDOOR : CHEST_IDS;
      const look = u32(raw, 0);
      return object(valid(evModel) || byId(look === LANAI_GOAL_CHEST_LOOK ? GOAL_CHEST_ID : ids[look] ?? ids[0]), 0);
    }
    case 5: {
      const kind = u32(raw, 0);
      const angle = QUARTER[dirOf(raw[0x1c]!)]!;
      if (kind <= 2) {
        if (!ev) return null;
        return { ...object(valid(lanaiCharaObject(ctx.mapChara, evModel)), angle), chara: evModel };
      }
      if (kind === LANAI_RECOVERY_POINT) return null;
      const row = valid(evModel) || valid(OBJECT_DEFAULT_ROWS[kind] ?? 0);
      return row ? object(row, angle) : null;
    }
  }
  return null;
}
