// What the action types of RPG FREE!'s EventObject rows do (the three actions of a row, +0x10 / +0x28 / +0x40, with
// five arguments each; naauao lanai/map.md §5.1.1, §7.1, §7.3), as RPG2's EVENT_KINDS (game/eventkinds.ts): a name,
// which arguments are rows of the MapGroup's talk table (`*_msg` of MapGroup +0x24, else the content's MessageContents:
// maps.ts talkTable) and what is not known. The talking types were matched against the ROM's NPCs (section 5): their
// first argument is the row of the line the NPC says.
import { talkColumns } from './talk';
import type { LanaiTable } from './table';

/** The action type of no action (the row's other actions are 0x80000000 too when it has one action). */
export const LANAI_ACTION_NONE = 0x80000000;
/** The action type of a script: the content's CRO (native code) does what the NPC does; its arguments are 0. */
export const LANAI_ACTION_SCRIPT = 0x8000002d;

export interface LanaiActionInfo {
  name: string;
  /** Indices (0〜4) of the arguments that are rows of the group's talk table. */
  talk?: number[];
  /** Whether talk row 0 means no line (the conversation's four lines). */
  zeroIsNone?: boolean;
  /** Labels of the other arguments, by index (map.md §5.1, §5.2). */
  args?: Record<number, string>;
  note?: string;
  /** Whether a record can be given this type to say lines from data (no script needed). */
  talking?: boolean;
}

export const LANAI_ACTIONS: Record<number, LanaiActionInfo> = {
  [LANAI_ACTION_NONE]: { name: '動作なし' },
  0x80000001: { name: '一言', talk: [0], talking: true, note: '引数 1 の台詞を言う。0x02 / 0x03 との違い (振り向くか) は未確認' },
  0x80000002: { name: '一言 (0x02)', talk: [0], talking: true, note: '0x01 と同じく引数 1 の台詞。違いは未確認 (RPG2 では振り向く)' },
  0x80000003: { name: '一言 (0x03)', talk: [0], talking: true, note: '0x01 と同じく引数 1 の台詞。違いは未確認 (RPG2 では振り向かない)' },
  0x8000000e: { name: '宝箱 (見た目 0 / 2)', args: { 0: 'TreasureGroup の行' } },
  0x80000010: { name: '宝箱 (見た目 1)', args: { 0: 'TreasureGroup の行' } },
  0x80000011: { name: '出入口 (行き先あり)', args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' } },
  0x80000013: { name: '階段 (行き先あり)', args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' } },
  0x80000017: { name: '扉 (推定)' },
  0x80000025: { name: '本・調べるもの', talk: [0], talking: true, args: { 2: '未解析 (40 が多い)' }, note: '引数 1 の文を出す。引数 3 の意味は未解析' },
  0x8000002d: { name: 'スクリプト (CRO)', note: 'コンテンツの CRO (contentsNNNN.cro) のネイティブコードが動きを決める。データでは書けない (引数はすべて 0)。台詞を変えるには、データで書ける型 (一言など) に付け替える' },
  0x8000002f: { name: '看板', talk: [0], talking: true, note: '引数 1 の文を出す (区画 5 の種類 11)' },
  0x80000030: { name: '未解析 (0x30)', note: '区画 5 の種類 13 専用。引数はすべて 0' },
  0x80000032: { name: '店の人', talk: [0], note: '引数 1 の台詞のあと店を開く。どの店 (Shop の表) かは引数になく、未解析' },
  0x80000037: { name: '会話 (台詞 4 つ)', talk: [0, 1, 2, 3], zeroIsNone: true, talking: true, note: '4 つの台詞 (0 = なし) から 1 つを出す。どれを出すかの条件 (仲間になる前後・依頼の前後など) は未解析' },
};

/** "一言" or "型 8000001D" for an action type. */
export function lanaiActionName(type: number): string {
  return LANAI_ACTIONS[type]?.name ?? `型 ${(type >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** The types a record's action can be switched to with a name (the select of the map page), in type order. */
export const LANAI_ACTION_TYPES: number[] = Object.keys(LANAI_ACTIONS).map((k) => Number(k) >>> 0).sort((a, b) => a - b);

/** The offset of the message column of a talk table (`*_msg`), or undefined when the table is not one. */
export function talkMessageOffset(t: LanaiTable): number | undefined {
  return talkColumns({ table: t })?.message;
}
