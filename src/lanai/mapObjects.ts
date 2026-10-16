// What RPG FREE! places for the records of a map, as RPG3's (oahu/mapObjects.ts): the model of props (section 2: a
// MapObject row of the master, naauao lanai/map.md §5.4) and how it is turned. The facings are 1 / 2 / 4 / 8 masks
// (§3.2) read as RPG3's turns 0..3 (maps.ts lanaiRecFacing), so the angles are RPG3's.
import { LANAI_ROT_CODEC } from '../game/sections';
import { u32 } from '../util/bytes';
import type { LanaiPartRef } from './maps';
import type { LanaiTable } from './table';

/** What a record's model is. */
export type LanaiRecordModel =
  /** A MapObject row of the master (its archive and entry, lanaiObjectRef). */
  { type: 'object'; row: number };

export interface LanaiRecordLook {
  model: LanaiRecordModel | null;
  /** Angle about +Y (three.js rotation.y). */
  angle: number;
}

const HALF = Math.PI / 2;
/** Props: turn 0..3 (RPG3's direction) → 180°, 90°, 0°, −90° (oahu FUN_00364B80; RPG2's table). */
const PROP_ANGLE = [Math.PI, HALF, 0, -HALF];

/** The turn (0..3) of a facing byte; bytes that are none of the masks take 0, as RPG3's directions past 3. */
const turn = (byte: number): number => Math.max(0, LANAI_ROT_CODEC.decode(byte));

/** MapObject row -> the model's archive and entry (MapObject +0x00 / +0x04); null when it has none. */
export function lanaiObjectRef(mapObject: LanaiTable | undefined, row: number): LanaiPartRef | null {
  if (!mapObject || row <= 0 || row >= mapObject.rows) return null;
  const archive = mapObject.u32(row, 0), entry = mapObject.u32(row, 4);
  return archive && entry ? { archive, entry } : null;
}

export interface LanaiLookContext {
  /** The master's MapObject. */
  mapObject: LanaiTable | undefined;
}

/** The model of a record and its angle; null = the section places no model. */
export function lanaiRecordLook(section: number, raw: Uint8Array, ctx: LanaiLookContext): LanaiRecordLook | null {
  switch (section) {
    case 2: {
      const row = u32(raw, 0);
      return lanaiObjectRef(ctx.mapObject, row) ? { model: { type: 'object', row }, angle: PROP_ANGLE[turn(raw[0x10]!)]! } : null;
    }
  }
  return null;
}
