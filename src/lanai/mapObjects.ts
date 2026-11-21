// What RPG FREE! places for the records of a map, as RPG3's (oahu/mapObjects.ts): the models of props (section 2),
// exits and doors (section 3), chests (section 4) and the characters and objects of section 5, and how they are turned
// and moved. The models are rows of the master's MapObject (784 × 0x30: +0x00 archive, +0x04 entry, +0x1C scale).
// Read from the data of every map (naauao lanai/map.md §5, §7.1), not from the code:
// - EventObject +0x5A is the model of a record (RPG3's +0x4E): a MapObject row number for exits, chests and objects,
//   a MapChara row of the content for the characters of section 5 (kinds 0 / 1 / 2).
// - A character's model (FUN_0023CFAC, Update v17408; analysed by Codex 2026-11-21): EventObject +0x5C (0 / 1 / 2) picks
//   MapChara +0x2C (u16) / +0x10 (u32) / +0x2E (u16), and the MapChara kind (+0x00 & 7) says what it is: 0 a MapObject
//   row (npc_NN, …), 1 a MonsterDesign row (the bosses that fight after a talk; lanai/key-objects.md §1), 2 a
//   MonsterParameter row ID (its +0x00 bits 20..29 are the MonsterDesign row), 3 a DenpaCustom row (a Denpa person;
//   no save is read, an invalid row is row 0).
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
  | {
      type: 'object';
      row: number;
      /** The prefix ("010_") of a material animation of the model to show (the number of a level door), at its first frame. */
      material?: string;
    }
  /** A monster's model: a MonsterDesign row (monsterModels.ts). */
  | { type: 'monster'; design: number }
  /** A Denpa person: a DenpaCustom row of the master (animationModels.ts lanaiDenpaCustomModel). */
  | { type: 'denpa'; custom: number }
  /** An effect the game puts there instead of a model (EffectData row; the viewer draws a marker). */
  | { type: 'effect'; row: number };

export interface LanaiRecordLook {
  model: LanaiRecordModel | null;
  /** Angle about +Y (three.js rotation.y). */
  angle: number;
  /** MapChara row of a character (section 5 kinds 0〜2). */
  chara?: number;
  /** Moved by this much from the record's position (world units, +x east, +z south; the indoor stairs). */
  offset?: [number, number];
}

/** EventObject +0x5A: the record's model (RPG3's +0x4E). */
export const LANAI_EO_MODEL = 0x5a;
/** EventObject +0x5C of a character (section 5 kinds 0〜2): which MapChara field names the model (lanaiCharaModel). */
export const LANAI_EO_CHARA_SELECT = 0x5c;
/** MapChara +0x2C: the MapObject row of the character's model (a MonsterDesign row for a monster). */
export const LANAI_CHARA_OBJECT = 0x2c;
/** MapChara +0x00 (low 3 bits): 0 NPC, 1 monster (MonsterDesign), 2 monster (MonsterParameter), 3 Denpa person (DenpaCustom). */
export const LANAI_CHARA_KIND: Record<number, string> = { 0: 'NPC', 1: 'モンスター', 2: 'モンスター', 3: '電波人間' };
/** The MapChara kind of a monster: +0x2C is a MonsterDesign row. */
export const LANAI_CHARA_MONSTER = 1;
/** The MapChara kind of an NPC: +0x2C is a MapObject row. */
export const LANAI_CHARA_NPC = 0;
/** The MapChara kind of a monster named by a MonsterParameter row ID. */
export const LANAI_CHARA_MONSTER_PARAM = 2;
/** The MapChara kind of a Denpa person: the model is a DenpaCustom row. */
export const LANAI_CHARA_DENPA = 3;

/**
 * A new MapChara row (0x30 bytes) of a kind and model, as the rows of the 127 contents are (counted 2026-11-14): +0x00
 * u32 = 0x0D00 | flags | kind (NPCs 0x0D08, monsters 0x0D01), +0x04 / +0x08 the motions (row IDs; NPCs 0x80000075 /
 * 0x80000077 (also 79 / 7F), monsters 0x8000005C / 0x8000005E), +0x0C u32 0x00034000 (the low byte 0 on most rows,
 * 0x96 / 0xFA on some), +0x10〜+0x2B a second and third look that 821 of 840 rows leave empty (0, 0x80000000 ×2,
 * 0x00034000, 0x80000000 ×2, 0x00034000), +0x2C u16 the model, +0x2E u16 0. What the motions and +0x0C are is not
 * known: a new row takes them from `donor` (a row of the same kind of the content) when there is one.
 */
export function lanaiCharaRowBytes(kind: number, model: number, donor?: Uint8Array): Uint8Array {
  const b = new Uint8Array(0x30);
  const v = new DataView(b.buffer);
  const monster = kind === LANAI_CHARA_MONSTER;
  if (donor && donor.length >= 0x30 && (donor[0]! & 7) === kind) b.set(donor.subarray(0, 0x10));
  else {
    v.setUint32(0x00, 0x0d00 | (monster ? 0 : 8) | kind, true);
    v.setUint32(0x04, monster ? 0x8000005c : 0x80000075, true);
    v.setUint32(0x08, monster ? 0x8000005e : 0x80000077, true);
    v.setUint32(0x0c, 0x00034000, true);
  }
  for (const [o, x] of [
    [0x10, 0],
    [0x14, 0x80000000],
    [0x18, 0x80000000],
    [0x1c, 0x00034000],
    [0x20, 0x80000000],
    [0x24, 0x80000000],
    [0x28, 0x00034000],
  ] as const)
    v.setUint32(o, x, true);
  v.setUint16(LANAI_CHARA_OBJECT, model, true);
  return b;
}

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
const STAIRS_UP_ID = 1,
  STAIRS_DOWN_ID = 2,
  WALL_DOOR_ID = 5;

/**
 * The MapObject row (a row number) of a floor gimmick (section 1) by its kind (+0x0D): FUN_0021C534 @0x21C588〜0x21C5B0
 * of the Update v17408 picks 0 → 0x5A gimk_08_damg5_01, 1 → 0x59 gimk_07_damg3_01 (the poison floor), 2 / 3 → 0x71
 * gimk_16_frozen_3 (kind 3 is the frozen floor; only it also sets bit 1 of the cell's +0x0A, the slide by the
 * behaviour). No tileset or indoor switch; analysed by Codex, 2026-11-15.
 */
export const LANAI_FLOOR_ROWS: Record<number, number> = { 0: 90, 1: 89, 2: 113, 3: 113 };

/** MapObject rows of the level door gimk_03_gate_06 (the exit kind 16's default and its copy). */
export const LANAI_LEVEL_DOOR_ROWS: readonly number[] = [49, 59];

/**
 * The material animation that shows the number of a level door (EventObject +0x5C, its low 8 bits: FUN_0021D744
 * @0x21E610 passes them to FUN_00448444, which compares them with fixed values and picks the animation by the prefix of
 * its name, "010_" = 010_number_05): 5, 10〜50 by 5 and 60〜90 by 10 show their own number, 6 the eye, anything else
 * "99". Undefined for 0 (no number is set).
 */
export function lanaiLevelDoorNumber(level: number): string | undefined {
  const v = level & 0xff;
  if (!level) return undefined;
  if (v === 6) return '025_';
  const i = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90].indexOf(v);
  return `${String(i < 0 ? 24 : 10 + i).padStart(3, '0')}_`;
}

/** MapObject rows (row numbers) section 5 places for a kind when EventObject +0x5A is 0: 3 → 0x3F gimk_04_heal_1, 9 → 0x72, 10 → 0x75. */
const SECTION5_DEFAULT_ROWS: Record<number, number> = { 3: 0x3f, 9: 0x72, 10: 0x75 };

/**
 * The MapObject row (a row number, not an ID) an exit of a kind takes when EventObject +0x5A is 0: the table of
 * FUN_004334F8 (Update v17408, 0x433508, indexed by the kind). 0 = none here: the stairs (kinds 5 / 6, which depend on
 * the tileset and on indoor maps), the kinds whose row is obj_invisible (8 / 10 / 11 → 506, 19 → 507, 68 → 685) and
 * the clear warp (an effect). 0 / 1 / 4 → gimk_03_gate_1, 2 → gimk_11_warp_02, 9 → gimk_11_warp_01, 12〜18 →
 * gimk_03_gate_02〜, 7 → gimk_06_hole_1.
 */
export function lanaiExitDefaultRow(kind: number): number {
  if (kind >= 21 && kind <= 34) return 206 + (kind - 21);
  if (kind >= 39 && kind <= 65) return 227 + (kind - 39);
  return (
    (
      {
        0: 44,
        1: 44,
        2: 105,
        4: 44,
        7: 84,
        9: 104,
        12: 45,
        13: 46,
        14: 47,
        15: 48,
        16: 49,
        17: 50,
        18: 51,
        20: 224,
        35: 221,
        36: 222,
        37: 224,
        38: 226,
        66: 220,
        67: 254,
        69: 753,
      } as Record<number, number>
    )[kind] ?? 0
  );
}

/**
 * Exit kinds that are turned as the doors are (facing 4 → 0°, 2 → −90°, 1 → 180°, 8 → +90°; FUN_0021D744 @0x21E164 and
 * @0x21DC28); the other kinds (the warp hole 2, 3, 7, 9, …) face the other way (@0x21D9DC).
 */
const DOOR_TURNED = (kind: number): boolean =>
  kind === 0 ||
  kind === 1 ||
  kind === 4 ||
  kind === 10 ||
  (kind >= 12 && kind <= 19) ||
  (kind >= 21 && kind <= 67) ||
  kind === 69;

/**
 * The offset (+0x0C / +0x10, × 100 world units) the data's doors have for a facing byte: 1.0 towards the edge of the
 * cell (facing 1 → +y, 4 → −y, 2 → +x, 8 → −x; 131 of the 191 doors and 41 of the 75 warp gates), 1.46 with the model
 * gimk_03_gate_10 (MapObject row 53; 37 doors).
 */
export function lanaiDoorOffset(facing: number, model: number): [number, number] {
  const d = model === 53 ? 1.46 : 1;
  return facing === 1 ? [0, d] : facing === 4 ? [0, -d] : facing === 2 ? [d, 0] : facing === 8 ? [-d, 0] : [0, 0];
}

const HALF = Math.PI / 2;
/** Props, objects and characters: direction 0..3 → 180°, 90°, 0°, −90° (RPG3's FUN_00364B80 / FUN_00366F30). */
const QUARTER = [Math.PI, HALF, 0, -HALF];
/** Exits: c = direction + 1 → 1: 0°, 2: −90°, 3: 180°, 4: +90° (RPG3's FUN_00225B64). */
const exitAngle = (dir: number): number => [0, -HALF, Math.PI, HALF][dir] ?? 0;
/** The way an exit faces (x, z): 0 north, 1 east, 2 south, 3 west (RPG3's FUN_00225C98). */
const exitStep = (dir: number): [number, number] =>
  (
    [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as [number, number][]
  )[dir] ?? [0, -1];

/** The direction (0..3) of a facing byte; bytes that are none of the masks take 0, as RPG3's directions past 3. */
const dirOf = (byte: number): number => Math.max(0, LANAI_ROT_CODEC.decode(byte));

/** MapObject row -> the model's archive and entry (MapObject +0x00 / +0x04); null when it has none. */
export function lanaiObjectRef(mapObject: LanaiTable | undefined, row: number): LanaiPartRef | null {
  if (!mapObject || row <= 0 || row >= mapObject.rows) return null;
  const archive = mapObject.u32(row, 0),
    entry = mapObject.u32(row, 4);
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
 * The model of a character (MapChara row `chara`) as FUN_0023CFAC picks it: `select` (EventObject +0x5C) names the
 * field (0 → +0x2C u16, 1 → +0x10 u32, 2 → +0x2E u16, else 0) and the row's kind what it is. The value is looked up as
 * the game's tables are (FUN_0031C038): a row number below 0x80000000, else a row ID (the +0x10 of the data are IDs:
 * 8 NPCs and 8 bosses take them). Null when the row is not there or names no model.
 */
export function lanaiCharaModel(ctx: LanaiCharaContext, chara: number, select = 0): LanaiRecordModel | null {
  const mc = ctx.mapChara;
  if (!mc || chara <= 0 || chara >= mc.rows) return null;
  const c = mc.row(chara);
  const v = select === 0 ? u16(c, 0x2c) : select === 1 ? u32(c, 0x10) : select === 2 ? u16(c, 0x2e) : 0;
  const rowOf = (t: LanaiTable | undefined): number => (t && v ? t.find(v) : -1);
  switch (u32(c, 0) & 7) {
    case LANAI_CHARA_NPC: {
      const row = rowOf(ctx.mapObject);
      return row > 0 && lanaiObjectRef(ctx.mapObject, row) ? { type: 'object', row } : null;
    }
    case LANAI_CHARA_MONSTER: {
      // without the table a row number is taken as it is (the +0x2C of the data)
      const row = ctx.monsterDesign ? rowOf(ctx.monsterDesign) : v < ROW_ID ? v : -1;
      return row > 0 ? { type: 'monster', design: row } : null;
    }
    case LANAI_CHARA_MONSTER_PARAM: {
      const t = ctx.monsterParameter;
      const row = rowOf(t);
      return row > 0 ? { type: 'monster', design: (t!.u32(row, 0) >>> 20) & 0x3ff } : null;
    }
    case LANAI_CHARA_DENPA: {
      // an invalid row is row 0 (マネキン), as FUN_0031C038 gives it
      const row = ctx.denpaCustom ? rowOf(ctx.denpaCustom) : v < ROW_ID ? v : 0;
      return { type: 'denpa', custom: Math.max(0, row) };
    }
  }
  return null;
}

/** The tables a character's model is looked up in. */
export interface LanaiCharaContext {
  /** The master's MapObject. */
  mapObject: LanaiTable | undefined;
  /** The content's MapChara. */
  mapChara: LanaiTable | undefined;
  /** The master's MonsterDesign (MapChara kind 1; row IDs need it). */
  monsterDesign?: LanaiTable | undefined;
  /** The master's MonsterParameter (MapChara kind 2); without it those characters have no model. */
  monsterParameter?: LanaiTable | undefined;
  /** The master's DenpaCustom (MapChara kind 3; row IDs need it). */
  denpaCustom?: LanaiTable | undefined;
}

/** The master's tables of LanaiCharaContext. */
export function lanaiCharaTables(session: {
  table(name: string): LanaiTable | undefined;
}): Omit<LanaiCharaContext, 'mapChara'> {
  return {
    mapObject: session.table('MapObject'),
    monsterDesign: session.table('MonsterDesign'),
    monsterParameter: session.table('MonsterParameter'),
    denpaCustom: session.table('DenpaCustom'),
  };
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

export interface LanaiLookContext extends LanaiCharaContext {
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
  const object = (row: number, angle: number): LanaiRecordLook => ({
    model: row ? { type: 'object', row } : null,
    angle,
  });
  const evRow = section === 3 || section === 4 || section === 5 ? u32(raw, 4) : 0;
  const ev = evRow && ctx.events && evRow < ctx.events.rows ? ctx.events.row(evRow) : null;
  const evModel = ev ? u16(ev, LANAI_EO_MODEL) : 0;
  switch (section) {
    case 1: {
      // a floor gimmick: its kind's model on the cell, not turned (FUN_0021C534)
      const row = valid(LANAI_FLOOR_ROWS[raw[0x0d]!] ?? 0);
      return row ? object(row, 0) : null;
    }
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
      const row =
        valid(evModel) ||
        (stairs === 1
          ? byId(STAIRS_UP_ID)
          : stairs === 2
            ? byId(STAIRS_DOWN_ID)
            : kind === LANAI_WALL_DOOR
              ? byId(WALL_DOOR_ID)
              : valid(lanaiExitDefaultRow(kind)));
      if (!row) return null;
      if (kind === LANAI_WALL_DOOR) return object(row, exitAngle(dir));
      // stairs (FUN_00365294 of RPG3): inside ±90° from the direction and 50 towards it, outside by a table. RPG FREE!
      // turns the outside ones 90° counterclockwise from RPG3's table (seen in the game by the user, 2026-11-14: the
      // preview had them 90° clockwise)
      if (stairs) {
        if (!ctx.indoor)
          return object(row, (stairs === 1 ? [HALF, 0, 3 * HALF, Math.PI] : [3 * HALF, Math.PI, HALF, 0])[dir]! + HALF);
        const [x, z] = exitStep(dir);
        return { ...object(row, exitAngle(dir) + (stairs === 1 ? -HALF : HALF)), offset: [x * 50, z * 50] };
      }
      // doors, gates and warps stand where the record is: the cell's centre and the record's own offset (+0x0C / +0x10,
      // × 100), which the data's doors use to stand on the edge of their cell (± 1.0, 1.46 for gimk_03_gate_10). The
      // code adds nothing towards the direction (FUN_0021D744 @0x21D86C; only kinds 0x13 / 0x44 are moved along it).
      const look = object(row, exitAngle(dir) + (DOOR_TURNED(kind) ? 0 : Math.PI));
      // a level door shows the level of its EventObject +0x5C on the model
      const number = LANAI_LEVEL_DOOR_ROWS.includes(row) && ev ? lanaiLevelDoorNumber(u16(ev, 0x5c)) : undefined;
      if (number && look.model?.type === 'object') look.model.material = number;
      return look;
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
        return { model: lanaiCharaModel(ctx, evModel, u16(ev, LANAI_EO_CHARA_SELECT)), angle, chara: evModel };
      }
      // the recovery points (FUN_0021C844): an effect; only the field takes EventObject +0x5A when it has one
      if (kind === LANAI_REPAIR_POINT) return { model: { type: 'effect', row: LANAI_EFFECT_REPAIR_POINT }, angle };
      if (kind === LANAI_REPAIR_FIELD && !valid(evModel))
        return { model: { type: 'effect', row: LANAI_EFFECT_REPAIR_FIELD }, angle };
      // EventObject +0x5A, else the kind's default (kind 3 gimk_04_heal_1; FUN_0021C844)
      const row = valid(evModel) || valid(SECTION5_DEFAULT_ROWS[kind] ?? 0);
      return row ? object(row, angle) : null;
    }
  }
  return null;
}
