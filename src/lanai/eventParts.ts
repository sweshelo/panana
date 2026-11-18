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
import { LANAI_FACING_OFFSET, LANAI_FLOOR_ICE, LANAI_FLOOR_KIND, LANAI_FLOOR_POISON, LANAI_LAYOUTS } from './maps';
import {
  LANAI_CHARA_MONSTER,
  LANAI_CHARA_NPC,
  LANAI_CLEAR_WARP,
  LANAI_FLOOR_ROWS,
  LANAI_REPAIR_FIELD,
  LANAI_REPAIR_POINT,
  lanaiCharaKind,
  lanaiCharaObject,
  lanaiExitDefaultRow,
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
  /** Which CRO button class and trigger to create when this part is placed. */
  switchTrigger?: 'switch' | 'button';
  /** Optionally open this door's EventObject row from the generated switch function. */
  buttonDoor?: number;
  destination?: { map: number; point: number };
  /**
   * Add a line to the group's talk table when placed and name it in the action's first argument: its text (the text
   * form of message.ts) and the speaker kind of its row (talk.ts TALK_SPEAKER).
   */
  talk?: { text: string; speaker: number; arg?: number };
  /** More lines added when placed, each named in an argument of an action (stage 0〜2) of the row (a ROM part's). */
  lines?: { stage: number; arg: number; text: string; speaker: number }[];
  /** Start from these bytes of an EventObject row (romParts.ts romEventRow) instead of row 0; `action` is its first. */
  from?: Uint8Array;
  /** The part opens the content's shop (the dialog and the inspector link to its stock). */
  shop?: boolean;
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
  iconLabel?: string;
  description?: string;
}

/** A new record that has no EventObject row (a floor gimmick). */
export interface LanaiPlainPart {
  section: number;
  raw: Uint8Array;
  label: string;
  source: string;
  category: string;
  /** The model the game places for it (the add panel's thumbnail). */
  model: LanaiRecordModel | null;
  description?: string;
}

/** The sign: section 5 kind 11 with the action 0x2F, whose 9 records of the ROM all look like MapObject #223. */
export const LANAI_SIGN_KIND = 11;
export const LANAI_ACTION_SIGN = 0x8000002f;
const SIGN_LOOK = 223;
/** An NPC that says one line and turns back (actions.ts 0x02), and the clerk (0x32: a line, then the content's shop). */
export const LANAI_ACTION_TALK = 0x80000002;
export const LANAI_ACTION_SHOP = 0x80000032;
/** The speaker kinds (talk table +0x08) of the ROM's lines: 0 on every sign's, 18 on most NPCs' and clerks'. */
export const LANAI_SPEAKER_NONE = 0;
export const LANAI_SPEAKER_NPC = 18;

/**
 * Floor gimmicks (section 1) made from nothing. A record is 16 bytes: the cell at +0x00 / +0x02, +0x0C = 1 and the
 * kind at +0x0D, everything else 0 (all 439 records of the ROM are so: 29 / 18 / 173 / 219 of kinds 0〜3), and it names
 * no EventObject row, so a new one is the same bytes as the ROM's. Kind 1 is the poison floor and kind 3 the frozen
 * floor (seen in the game by the user); placing a new one was not tried in the game.
 */
export function lanaiFloorParts(): LanaiPlainPart[] {
  const floor = (kind: number): Uint8Array => {
    const raw = new Uint8Array(LANAI_LAYOUTS[1]!.size);
    raw[0x0c] = 1;
    raw[LANAI_FLOOR_KIND] = kind;
    return raw;
  };
  return [
    {
      section: 1,
      raw: floor(LANAI_FLOOR_POISON),
      label: '毒床',
      description: '上を歩くとダメージを受けます。',
      source: '新規毒床',
      category: '床のギミック',
      model: { type: 'object', row: LANAI_FLOOR_ROWS[LANAI_FLOOR_POISON]! },
    },
    {
      section: 1,
      raw: floor(LANAI_FLOOR_ICE),
      label: '凍った床',
      description: '上を歩くとすべります。',
      source: '新規凍った床',
      category: '床のギミック',
      model: { type: 'object', row: LANAI_FLOOR_ROWS[LANAI_FLOOR_ICE]! },
    },
  ];
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
  for (const [trigger, label, source, description] of [
    ['switch', '保持スイッチ', '新規保持スイッチ', '一度踏むと押したままになります。'],
    ['button', 'プッシュスイッチ', '新規プッシュスイッチ', '離れると元に戻ります。'],
  ] as const)
    part({
      section: 5,
      raw: record(5, 4),
      label,
      description,
      source,
      category: 'スイッチ',
      event: { action: LANAI_ACTION_SCRIPT, look: switchLook, switchTrigger: trigger },
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
      label: monster ? 'モンスター' : 'NPC',
      description: '話しかけるとスクリプトを実行します。見た目は配置後に選べます。',
      source: `新規キャラ ${kind}`,
      category: '人物・敵',
      event: { action: LANAI_ACTION_SCRIPT, look: row, chara: row ? undefined : { kind, model } },
      model: monster ? { type: 'monster', design: model } : { type: 'object', row: model },
    });
  }
  part({
    section: 3,
    raw: record(3, LANAI_DOOR_KIND),
    label: '通路をふさぐ扉',
    description: 'スクリプトから開く扉です。',
    source: '新規扉',
    category: '扉・移動',
    event: { action: LANAI_ACTION_EXTERNAL_DOOR, look: lanaiObjectRef(mapObject, 53) ? 53 : 0 },
    model: lanaiObjectRef(mapObject, 53) ? { type: 'object', row: 53 } : null,
  });
  for (const [kind, label, action, source] of [
    [LANAI_DOOR_KIND, '場所を移動する扉', 0x80000016, '新規移動扉'],
    [4, 'ワープゲート', 0x80000012, '新規ワープゲート'],
    [2, 'ワープホール', 0x80000014, '新規ワープホール'],
    [5, '上り階段', 0x80000013, '新規上り階段'],
    [6, '下り階段', 0x80000013, '新規下り階段'],
  ] as const) {
    const defaultLook = kind === 4 || kind === 2 ? lanaiExitDefaultRow(kind) : 0;
    const warpModel = defaultLook && lanaiObjectRef(mapObject, defaultLook) ? defaultLook : 0;
    part({
      section: 3,
      raw: record(3, kind),
      label,
      description: '行き先は配置時か配置後に指定できます。',
      source,
      category: '扉・移動',
      event: {
        action,
        look: kind === LANAI_DOOR_KIND && lanaiObjectRef(mapObject, 53) ? 53 : 0,
        destination: { map: 0, point: 0 },
      },
      model: warpModel
        ? { type: 'object', row: warpModel }
        : kind === LANAI_DOOR_KIND && lanaiObjectRef(mapObject, 53)
          ? { type: 'object', row: 53 }
          : null,
      iconLabel: (kind === 4 || kind === 2) && !warpModel ? '◉' : undefined,
    });
  }
  // lines said from the data (no script): a sign, an NPC with one line, a clerk who opens the content's shop
  const signLook = lanaiObjectRef(mapObject, SIGN_LOOK) ? SIGN_LOOK : 0;
  part({
    section: 5,
    raw: record(5, LANAI_SIGN_KIND),
    label: '看板',
    description: '調べるとメッセージを表示します。',
    source: '新規看板',
    category: 'メッセージ・店',
    event: { action: LANAI_ACTION_SIGN, look: signLook, talk: { text: '', speaker: LANAI_SPEAKER_NONE } },
    model: signLook ? { type: 'object', row: signLook } : null,
  });
  {
    const row = lanaiCharaOfKind(mapChara, mapObject, LANAI_CHARA_NPC);
    const model = row ? lanaiCharaObject(mapChara, row) : defaults.npcModel;
    if (model)
      for (const shop of [false, true])
        part({
          section: 5,
          raw: record(5, LANAI_CHARA_NPC),
          label: shop ? '店の人' : '話す NPC',
          description: shop ? '話しかけるとショップを開きます。' : '話しかけるとメッセージを表示します。',
          source: shop ? '新規店の人' : '新規話す NPC',
          category: 'メッセージ・店',
          event: {
            action: shop ? LANAI_ACTION_SHOP : LANAI_ACTION_TALK,
            look: row,
            chara: row ? undefined : { kind: LANAI_CHARA_NPC, model },
            talk: { text: '', speaker: LANAI_SPEAKER_NPC },
            shop: shop || undefined,
          },
          model: { type: 'object', row: model },
        });
  }
  for (const goal of [false, true]) {
    const raw = record(4, goal ? 3 : 0);
    part({
      section: 4,
      raw,
      label: goal ? 'クリア宝箱' : '通常の宝箱',
      description: goal ? '初回と再挑戦の報酬を配置時に設定します。' : '報酬を配置時に設定します。',
      source: goal ? '新規クリア宝箱' : '新規宝箱',
      category: '宝箱・ゴール',
      event: { action: goal ? LANAI_ACTION_GOAL_CHEST : 0x8000000e, look: 0, chest: goal ? 'goal' : 'normal' },
      model: null,
    });
  }
  part({
    section: 8,
    raw: lanaiRangeRecord('rect'),
    label: 'イベントの範囲・矩形',
    description: '矩形の範囲に入るとスクリプトを実行します。',
    source: '新規範囲 矩形',
    category: '範囲イベント',
    event: { action: LANAI_ACTION_SCRIPT, look: 0 },
    model: null,
  });
  part({
    section: 8,
    raw: lanaiRangeRecord('circle'),
    label: 'イベントの範囲・円',
    description: '円の範囲に入るとスクリプトを実行します。',
    source: '新規範囲 円',
    category: '範囲イベント',
    event: { action: LANAI_ACTION_SCRIPT, look: 1 },
    model: null,
  });
  return out;
}
