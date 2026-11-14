// New records that start an event, for the add panel of the map page, by what starts them: a button stepped on
// (section 5 kind 4 / 6), a character talked to (section 5 kind 0 = an NPC, 1 = a monster), a range walked into
// (section 8) and a door opened from outside (section 3 kind 12, action 17: openDoor()). Each gets an EventObject row
// of its own. What it looks like is not part of the choice: it is the row's +0x5A, picked afterwards from every model
// (LookField.tsx) — a MapObject row for a button or a door, a MapChara row for a character (a new MapChara row can be
// made for any NPC model or any monster: LanaiMaps.addCharaRow).
//
// What the records and rows are, read from the data of every map (Update v17408; naauao lanai/map.md §5, §7.1,
// key-objects.md, lanai-custom-stages event-actions.md; the 127 contents counted 2026-11-14):
// - Section 5 +0x00 = kind, +0x04 = EventObject row, +0x1C = facing (1 / 2 / 4 / 8). Kinds 0〜2 are characters whose
//   look is EventObject +0x5A = a MapChara row (276 / 147 / 65 records of kinds 0 / 1 / 2 have the action 2D "a
//   script"); kinds 4 / 6 are the buttons (all 64 have 2D, a GimmickEvent: the CRO's event 4 = "stepped on") whose look
//   is +0x5A = a MapObject row (the data uses 74 / 75 / 76 / 83 for kind 4 and 699 / 71 for kind 6; the kind, not the
//   model, makes it a button).
// - Section 3 +0x00 = point ID, +0x14 = facing, +0x15 = kind. Kind 12 with action 17 (外から開ける扉) is the door of
//   177 records (look 0 on 139, 53 on 36); ScriptMap::SetDoorOpenFlag takes its EventObject row (= the row ID's number
//   in every table).
// - Section 8 +0x00 = kind (0 / 1 / 2 a range, 100〜102 a prop), +0x14 / +0x18 = f32 size, +0x1C = facing, +0x1D =
//   shape (equal to the kind in all 795 ranges). Kind 1 ranges (342) are rectangles of 3 × 1, 5 × 1 …; kind 0 (circle)
//   ranges keep a radius in EventObject +0x5A (1〜3) and no size. lanaiRange (rangeShape.ts) draws them.
// - An EventObject row (100 bytes): the action types at +0x10 / +0x28 / +0x40 (0x80000000 = none), +0x58 the state
//   slot, +0x5A the look, the conditions at +0x5F / +0x60, and 0xD0 padding at the end. A new row is a copy of the
//   table's row 0 (the empty row: no action, the padding) with the first action and the look.
import { LANAI_ROT_CODEC } from '../game/sections';
import { u32, w32, wf32 } from '../util/bytes';
import { LANAI_ACTION_GOAL_CHEST, LANAI_ACTION_SCRIPT } from './actions';
import { LANAI_FACING_OFFSET, LANAI_LAYOUTS } from './maps';
import {
  LANAI_CHARA_MONSTER,
  LANAI_CHARA_NPC,
  LANAI_CLEAR_WARP,
  LANAI_REPAIR_FIELD,
  LANAI_REPAIR_POINT,
  lanaiCharaKind,
  lanaiCharaObject,
  lanaiObjectRef,
  type LanaiRecordModel,
} from './mapObjects';
import type { LanaiTable } from './table';
import type { LanaiTreasureSlot } from './treasure';

/** EventObject +0x5A: the look (a MapObject row, a MapChara row, the radius of a circle range). */
export const EO_LOOK = 0x5a;
/** Action 17: a door opened from outside (by openDoor() / ScriptMap::SetDoorOpenFlag). */
export const LANAI_ACTION_EXTERNAL_DOOR = 0x80000017;
/** Section 3 kind (+0x15) of the doors of action 17. */
export const LANAI_DOOR_KIND = 12;
/** The tile kind of a doorway (an edge with an opening): 177 of the 191 doors of kind 12 stand on one. */
export const LANAI_DOORWAY_TILE = 9;
/**
 * The facing mask (+0x14) of a door on a doorway tile, by the tile's turn: the data has rot 0 → 4 (84 doors), rot 2 →
 * 1 (89), rot 3 → 8 (3); rot 1 → 2 by the same rule (none in the data).
 */
export const LANAI_DOOR_FACING = [4, 2, 1, 8] as const;

/** A character a new record makes when the content has none of its kind: a MapChara row of that kind and model. */
export interface NewChara {
  kind: number;
  /** A MapObject row (an NPC) or a MonsterDesign row (a monster). */
  model: number;
}

/** The EventObject row a new record gets: its first action and its look; the rest is the table's row 0. */
export interface NewEventRow {
  action: number;
  look: number;
  /** Create private TreasureGroup rows for every opening state when placed. */
  chest?: 'normal' | 'goal';
  /** First opening, then the two retry states of a goal chest. */
  rewards?: LanaiTreasureSlot[][];
  clears?: number;
  /** A verified persistent switch opens this door's EventObject row through on switch. */
  buttonDoor?: number;
  destination?: { map: number; point: number };
  /** Make this MapChara row when placed and take it as the look (in place of `look`). */
  chara?: NewChara;
}

export interface LanaiEventPart {
  section: number;
  raw: Uint8Array;
  label: string;
  /** Distinguishes parts with the same record. */
  source: string;
  event: NewEventRow;
  model: LanaiRecordModel | null;
  category: string;
}

/** What a record's look (EventObject +0x5A) is a row of, for the inspector. */
export type LanaiLookKind =
  /** A MapObject row (0 = the kind's own model). */
  | 'object'
  /** A MapChara row of the content. */
  | 'chara'
  /** The radius of a circle range (rangeShape.ts). */
  | 'radius'
  /** Not read: the game puts an effect there (the clear warp, the recovery points). */
  | 'effect';

export function lanaiLookKind(section: number, raw: Uint8Array): LanaiLookKind {
  if (section === 8) return 'radius';
  if (section === 3) return raw[0x15] === LANAI_CLEAR_WARP ? 'effect' : 'object';
  if (section === 5) {
    const kind = u32(raw, 0);
    if (kind <= 2) return 'chara';
    if (kind === LANAI_REPAIR_FIELD || kind === LANAI_REPAIR_POINT) return 'effect';
  }
  return 'object';
}

/** A section's record of a kind, facing south (turn 0), its event row filled in when placed. */
function record(section: number, kind: number): Uint8Array {
  const raw = new Uint8Array(LANAI_LAYOUTS[section]!.size);
  if (section === 3) raw[0x15] = kind;
  else w32(raw, 0, kind);
  const o = LANAI_FACING_OFFSET[section];
  if (o !== undefined && section !== 8) raw[o] = LANAI_ROT_CODEC.encode(0);
  return raw;
}

/** A section 8 range: a rectangle (kind 1) of w × h, or a circle (kind 0; its radius is the event row's look). */
export function lanaiRangeRecord(shape: 'rect' | 'circle', w = 3, h = 1): Uint8Array {
  const raw = record(8, shape === 'rect' ? 1 : 0);
  if (shape === 'rect') {
    wf32(raw, 0x14, w);
    wf32(raw, 0x18, h);
    raw[0x1d] = 1;
  }
  return raw;
}

/** The first MapChara row (1…) of a kind whose model is there, or 0. */
export function lanaiCharaOfKind(
  mapChara: LanaiTable | undefined,
  mapObject: LanaiTable | undefined,
  kind: number,
): number {
  for (let row = 1; row < (mapChara?.rows ?? 0); row++) {
    if (lanaiCharaKind(mapChara, row) !== kind) continue;
    const model = lanaiCharaObject(mapChara, row);
    if (model && (kind === LANAI_CHARA_MONSTER || lanaiObjectRef(mapObject, model))) return row;
  }
  return 0;
}

export interface LanaiEventPartDefaults {
  /** The NPC model of a new MapChara row when the content has no NPC (a MapObject row). */
  npcModel: number;
  /** The monster of a new MapChara row when the content has no monster (a MonsterDesign row). */
  monsterDesign: number;
}

/** The blue switch model #75 was checked in Azahar; the other commonly used rows have not been checked as buttons. */
const VERIFIED_SWITCH_LOOK = 75;

/** Purpose-based parts that can be made without copying a record. */
export function lanaiEventParts(
  mapObject: LanaiTable | undefined,
  mapChara: LanaiTable | undefined,
  defaults: LanaiEventPartDefaults,
): LanaiEventPart[] {
  const out: LanaiEventPart[] = [];
  const part = (p: LanaiEventPart): void => void out.push(p);
  const switchLook = lanaiObjectRef(mapObject, VERIFIED_SWITCH_LOOK) ? VERIFIED_SWITCH_LOOK : 0;
  part({
    section: 5,
    raw: record(5, 4),
    label: '踏むボタン（保持式はスクリプトの「押したまま」を選ぶ）',
    source: '新規ボタン',
    category: 'スイッチ',
    event: { action: LANAI_ACTION_SCRIPT, look: switchLook },
    model: switchLook ? { type: 'object', row: switchLook } : null,
  });
  for (const kind of [LANAI_CHARA_NPC, LANAI_CHARA_MONSTER]) {
    const monster = kind === LANAI_CHARA_MONSTER;
    const row = lanaiCharaOfKind(mapChara, mapObject, kind);
    const model = row ? lanaiCharaObject(mapChara, row) : monster ? defaults.monsterDesign : defaults.npcModel;
    if (!model) continue;
    part({
      section: 5,
      raw: record(5, kind),
      label: `${monster ? 'モンスター' : 'NPC'} (話しかけるとスクリプト。見た目は置いてから選ぶ)`,
      source: `新規キャラ ${kind}`,
      category: '人物・敵',
      event: { action: LANAI_ACTION_SCRIPT, look: row, chara: row ? undefined : { kind, model } },
      model: monster ? { type: 'monster', design: model } : { type: 'object', row: model },
    });
  }
  part({
    section: 3,
    raw: record(3, LANAI_DOOR_KIND),
    label: '通路をふさぐ扉（スクリプトから開く）',
    source: '新規扉',
    category: '扉・移動',
    event: { action: LANAI_ACTION_EXTERNAL_DOOR, look: lanaiObjectRef(mapObject, 53) ? 53 : 0 },
    model: lanaiObjectRef(mapObject, 53) ? { type: 'object', row: 53 } : null,
  });
  for (const [kind, label, action, source] of [
    [LANAI_DOOR_KIND, '場所を移動する扉', 0x80000016, '新規移動扉'],
    [5, '上り階段', 0x80000013, '新規上り階段'],
    [6, '下り階段', 0x80000013, '新規下り階段'],
  ] as const) {
    part({
      section: 3,
      raw: record(3, kind),
      label,
      source,
      category: '扉・移動',
      event: {
        action,
        look: kind === LANAI_DOOR_KIND && lanaiObjectRef(mapObject, 53) ? 53 : 0,
        destination: { map: 0, point: 0 },
      },
      model: kind === LANAI_DOOR_KIND && lanaiObjectRef(mapObject, 53) ? { type: 'object', row: 53 } : null,
    });
  }
  for (const goal of [false, true]) {
    const raw = record(4, goal ? 3 : 0);
    part({
      section: 4,
      raw,
      label: goal ? 'クリア宝箱（初回・再挑戦の報酬を設定）' : '通常の宝箱（報酬を設定）',
      source: goal ? '新規クリア宝箱' : '新規宝箱',
      category: '宝箱・ゴール',
      event: { action: goal ? LANAI_ACTION_GOAL_CHEST : 0x8000000e, look: 0, chest: goal ? 'goal' : 'normal' },
      model: null,
    });
  }
  part({
    section: 8,
    raw: lanaiRangeRecord('rect'),
    label: 'イベントの範囲 (矩形、入るとスクリプト)',
    source: '新規範囲 矩形',
    category: '範囲イベント',
    event: { action: LANAI_ACTION_SCRIPT, look: 0 },
    model: null,
  });
  part({
    section: 8,
    raw: lanaiRangeRecord('circle'),
    label: 'イベントの範囲 (円、入るとスクリプト)',
    source: '新規範囲 円',
    category: '範囲イベント',
    event: { action: LANAI_ACTION_SCRIPT, look: 1 },
    model: null,
  });
  return out;
}
