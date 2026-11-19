// What the action types of RPG FREE!'s EventObject rows do (the three actions of a row, +0x10 / +0x28 / +0x40, with
// five arguments each; naauao lanai/map.md §5.1.1, §7.1, §7.3), as RPG2's EVENT_KINDS (game/eventkinds.ts): a name,
// which arguments are rows of the MapGroup's talk table (`*_msg` of MapGroup +0x24, else the content's MessageContents:
// maps.ts talkTable) and what is not known. The talking types were matched against the ROM's NPCs (section 5): their
// first argument is the row of the line the NPC says.
import { talkColumns } from './talk';
import type { LanaiTable } from './table';

/** The action type of no action (the row's other actions are 0x80000000 too when it has one action). */
export const LANAI_ACTION_NONE = 0x80000000;
/** The action type of a script: the content's CRO (native code) does what the NPC does and reads the arguments. */
export const LANAI_ACTION_SCRIPT = 0x8000002d;
/** The goal chest: opening it clears a content (key-objects.md §2). */
export const LANAI_ACTION_GOAL_CHEST = 0x8000002e;
/** The clear warp (key-objects.md §3). */
export const LANAI_ACTION_CLEAR_WARP = 0x80000031;

export interface LanaiActionInfo {
  name: string;
  /** Indices (0〜4) of the arguments that are rows of the group's talk table. */
  talk?: number[];
  /** Whether talk row 0 means no line (the conversation's four lines). */
  zeroIsNone?: boolean;
  /** Labels of the other arguments, by index (map.md §5.1, §5.2). */
  args?: Record<number, string>;
  note?: string;
  /** Arguments picked from a list instead of typed: a MonsterGroup row number of the content, or a content number. */
  pick?: Record<number, 'monsterGroupRow' | 'content'>;
  /** Whether a record can be given this type to say lines from data (no script needed). */
  talking?: boolean;
}

export const LANAI_ACTIONS: Record<number, LanaiActionInfo> = {
  [LANAI_ACTION_NONE]: { name: '動作なし' },
  0x80000001: {
    name: '一言 (向いたまま)',
    talk: [0],
    talking: true,
    args: { 1: '台詞に差し込む値 (推定)', 2: '台詞に差し込む値 (推定)' },
    note: '話しかけると NPC が主人公のほうを向き、引数 1 の台詞を言う。話し終えても向いたまま (NpcCommonTurn)',
  },
  0x80000002: {
    name: '一言 (元の向きに戻る)',
    talk: [0],
    talking: true,
    args: { 1: '台詞に差し込む値 (推定)', 2: '台詞に差し込む値 (推定)' },
    note: '0x01 と同じく引数 1 の台詞を言い、話し終えると置いたときの向きに戻る (NpcCommonTurn)',
  },
  0x80000003: {
    name: '一言 (振り向かない)',
    talk: [0],
    talking: true,
    args: { 1: '台詞に差し込む値 (推定)', 2: '台詞に差し込む値 (推定)' },
    note: '主人公だけが NPC のほうを向き、NPC は向きを変えずに引数 1 の台詞を言う (NpcCommon)',
  },
  0x8000000c: {
    name: 'ボス戦 (範囲に入ると戦う)',
    args: {
      0: 'MonsterGroup の番号',
      1: '勝つと 2 が入る数値フラグ (0x52) の番号',
      2: '敵の見た目を置くキャラ 1 (イベント番号、推定)',
      3: '敵の見た目を置くキャラ 2 (イベント番号、推定)',
      4: '敵の見た目を置くキャラ 3 (イベント番号、推定)',
    },
    pick: { 0: 'monsterGroupRow' },
    note: '区画 8 の範囲。入ると引数 1 の群れと戦い、勝つと引数 2 の番号の数値フラグ (ScriptByteFlag、0x52) に 2 が入る (ビットのフラグではない。CollisionEncountCommon)',
  },
  0x8000000e: { name: '宝箱 (見た目 0 / 2)', args: { 0: 'TreasureGroup の番号' } },
  0x80000010: {
    name: '宝箱 (見た目 1)',
    args: { 0: 'TreasureGroup の番号' },
    note: '開けるとレアアイテムの演出が入る (ItemRareCommon)',
  },
  0x8000000d: {
    name: '範囲に入るとマップを移る',
    args: {
      0: '行き先のマップ (ハッシュ、W01 = A8654391)',
      1: '行き先の地点 ID (ワールドの入口の ID)',
      2: '向き (1 / 2 / 4 / 8)',
    },
    note: '区画 8 の範囲。入るとすぐ行き先へ移る (村の端からワールドへ、など。CollisionMoveCommon)',
  },
  0x80000011: {
    name: '出入口 (歩いて入る)',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '隊列が出口へ歩いて入り、フェードして移る (GateCommon)',
  },
  0x80000012: {
    name: 'ワープゲート',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '0x11 と同じ流れで、向きを変えて色付きのフェードで移る (WarpGateCommon)',
  },
  0x80000013: {
    name: '階段',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '歩かせず、音を鳴らしてすぐ移る (StairsCommon)',
  },
  0x80000014: {
    name: 'ワープ',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '主人公のワープの動きと音で移り、移った後に位置を合わせる (WarpCommon)。ワールドへの出口にもある',
  },
  0x80000015: {
    name: '鍵つきの扉',
    args: { 0: '鍵のアイテム (0 = 鍵なし)', 1: '鍵を使うと減る (1 = 減る)', 2: '開く音 (SoundData の行。0x7A / 0x8C)' },
    note: '触れると開く。鍵 (引数 1) が 0 なら鍵なしで開き、鍵があるのに持っていなければ開かない。開くと状態が最後の段まで一気に進む (OpenCommon)',
  },
  0x80000016: {
    name: '鍵つきの扉 (行き先あり)',
    args: {
      0: '行き先のマップ (ハッシュ)',
      1: '行き先の地点 ID',
      2: '鍵のアイテム (0 = 鍵なし)',
      3: '鍵を使うと減る (1 = 減る)',
      4: '開く音 (SoundData の行。0x7A / 0x8C)',
    },
    note: '0x15 の扉を開けて行き先へ移る (OpenMoveCommon)',
  },
  0x80000017: {
    name: '外から開ける扉',
    talk: [0],
    zeroIsNone: true,
    note: 'スクリプトやスイッチが開ける扉。閉まっている間は触れると近づいて音が鳴り、引数 1 の台詞 (0 = 共通の文) が出るだけ (ExternalOpenCommon)',
  },
  0x80000018: {
    name: '外から開ける扉 (行き先あり)',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '閉まっていれば共通の文、開いていれば行き先へ移る (推定。ExternalOpenMoveCommon)',
  },
  0x80000019: {
    name: '施設の出入口',
    args: {
      0: '行き先のマップ (ハッシュ)',
      1: '行き先の地点 ID',
      2: '鍵のアイテム (0 = 鍵なし)',
      3: '鍵を使うと減る (1 = 減る)',
      4: '開く音 (SoundData の行。0x7A / 0x8C)',
    },
    note: '歩いて入り、フェードして移る。引数の並びは 0x16 と同じ (FacilityMoveCommon)',
  },
  0x8000001c: {
    name: '裏口',
    args: {
      0: '行き先のマップ (ハッシュ)',
      1: '行き先の地点 ID',
      2: '鍵のアイテム (0 = 鍵なし)',
      3: '鍵を使うと減る (1 = 減る)',
      4: '開く音 (SoundData の行。0x7A / 0x8C)',
    },
    note: '引数の並びは 0x16 と同じ。鍵を使う処理がある (BackdoorMoveCommon。ROM に 1 件)',
  },
  0x8000001d: {
    name: '穴 (落ちる)',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '隊列が穴へ歩き、透明になって落ち、フェードして移る (HoleFallCommon)',
  },
  0x8000001f: {
    name: 'ワールドの入口 (行き先あり)',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID 1', 2: '地点 ID 2', 3: '地点 ID 3', 4: '地点 ID 4' },
    note: 'ワールドマップの入口 (スロット 2) の EventObject の動作。地点 4 つの使い分けは未解析 (入る向きごとと推定。naauao lanai/worldmap.md §5)',
  },
  0x80000025: {
    name: '本・調べるもの',
    talk: [0],
    talking: true,
    args: { 2: '未解析 (40 が多い)' },
    note: '引数 1 の文を出す。引数 3 の意味は未解析',
  },
  0x8000002d: {
    name: 'スクリプト (CRO)',
    note: 'コンテンツの CRO (contentsNNNN.cro) のネイティブコードが動きを決める。引数は CRO が読む (0 とは限らない: ROM の 250 行で引数 1 が 0 以外)。台詞を変えるには、データで書ける型 (一言など) に付け替える',
  },
  0x8000002e: {
    name: 'ゴールの宝箱 (開けるとクリア)',
    talk: [2],
    zeroIsNone: true,
    args: {
      0: 'TreasureGroup の番号',
      1: 'クリアにするコンテンツ (0 = なし)',
      3: 'モーション (推定)',
      4: '未解析 (1 / 0x0E)',
    },
    pick: { 1: 'content' },
    note: '区画 4 の見た目 3。開けると引数 1 の中身を出し、引数 2 のコンテンツをクリア済みにする (セーブのグループ 0x53、FUN_002C1D90)。段 1 (初回) だけが引数 2 を持ち、段 2 / 3 (再挑戦) は 0。引数 3 は開けた後の台詞',
  },
  0x8000002f: { name: '看板', talk: [0], talking: true, note: '引数 1 の文を出す (区画 5 の種類 11)' },
  0x80000030: {
    name: '回復ポイント',
    note: '区画 5 の種類 13 (エフェクト fx_bg_repair_point)。調べると、全員の HP / MP が満タンで状態異常もなければそう言い、そうでなければ確かめてから全員を回復する (SafeAreaCommon、FUN_0020053C)。ステージのクリアとは関係ない。引数はすべて 0',
  },
  0x80000031: {
    name: 'クリアのワープ',
    talk: [1],
    zeroIsNone: true,
    args: {
      0: 'クリアにするコンテンツ',
      2: 'モーション (推定。0x15)',
      3: '未解析 (1)',
      4: '確認してからクリア (1 = 確認の「はい」のあと)',
    },
    pick: { 0: 'content' },
    note: '区画 3 の種類 3 (エフェクト fx_bg_f_warpzone_goal)。使うと引数 1 のコンテンツをクリア済みにする (セーブのグループ 0x53、FUN_00203AE0)。引数 5 が 1 なら確かめの台詞に「はい」と答えたときだけ。台詞 (引数 2) は推定',
  },
  0x80000032: {
    name: '店の人',
    talk: [0],
    args: {
      1: '店の番号 (推定)',
      2: '未解析 (0 以外で真。店を開く処理に渡る)',
      3: '店の後にフェードして位置を戻す (0 以外で真、推定)',
    },
    note: '引数 1 の台詞のあと店を開く。引数 2 が店の番号と推定 (店を開く処理に渡る。ShopCommon)',
  },
  0x80000033: {
    name: '範囲に入ると店',
    talk: [0],
    args: {
      1: '店の番号 (推定)',
      2: '未解析 (0 以外で真)',
      3: '店の後にフェードして位置を戻す (0 以外で真、推定)',
      4: '店の人のキャラ (区画 5 のイベント番号)',
    },
    note: '区画 8 の範囲。入ると引数 5 のキャラが引数 1 の台詞を言い、店を開く (CollisionShopCommon)',
  },
  0x80000034: {
    name: '崖 (降りる)',
    args: { 0: '行き先のマップ (ハッシュ)', 1: '行き先の地点 ID' },
    note: '隊列が順に崖から降りて移る (CliffCommon)',
  },
  0x80000035: {
    name: '範囲に入るとキャラが話す (振り向く)',
    talk: [0],
    args: {
      1: '台詞に差し込む値 (推定)',
      2: '台詞に差し込む値 (推定)',
      3: 'しゃべるキャラ (区画 5 のイベント番号)',
    },
    note: '区画 8 の範囲。入ると、引数 4 のキャラ (区画 5 の別のレコード) が振り向いて引数 1 の台詞を言い、元の向きに戻る (CollisionTalkCommonTurn)',
  },
  0x80000036: {
    name: '範囲に入るとキャラが話す (振り向かない)',
    talk: [0],
    args: {
      1: '台詞に差し込む値 (推定)',
      2: '台詞に差し込む値 (推定)',
      3: 'しゃべるキャラ (区画 5 のイベント番号)',
    },
    note: '0x35 と同じで、キャラは向きを変えない (CollisionTalkCommon)',
  },
  0x80000037: {
    name: '仲間になる NPC',
    talk: [0],
    args: {
      1: '仲間の表 (マスター +0x644) の行',
      2: '話し終えると元の向きに戻る (1 = 戻る)',
      3: '仲間の表の行 (2 つ目、用途は未解析)',
      4: '仲間の表の行 (3 つ目、用途は未解析)',
    },
    note: '引数 1 は連続する 7 行の台詞の先頭 (台詞の表で続けて並べる)。どの行を言うかは、仲間の表の行が持つ数値フラグ (0x52) で決まる: 0 でなければ 5 番目の台詞、など。選び分けの全体は未解析 (NpcJoinCommon)。「台詞 4 つ」ではない',
  },
  0x80000039: {
    name: '確認つきの扉 (行き先あり)',
    args: {
      0: '行き先のマップ (ハッシュ)',
      1: '行き先の地点 ID',
      2: '鍵のアイテム (0 = 鍵なし)',
      3: '鍵を使うと減る (1 = 減る)',
      4: '開く音 (SoundData の行。0x7A / 0x8C)',
    },
    note: '開ける前に確かめてから、0x16 と同じく扉を開けて行き先へ移る (OpenMoveCommonConfirm)。ワープではない',
  },
  0x8000003a: {
    name: '黒い妖精',
    note: '引数は使わない。ビットのフラグ 0x1AD が立っているか、このイベントの状態が 0 でなければ共通の文 0x8000002A、そうでなければ 0x80000029 を言う (NpcBlackFairy)。本編専用',
  },
  0x8000003b: {
    name: '像をはめる扉',
    args: { 0: 'はめる像のアイテム (0xB1〜0xB6)', 1: '像を使うと減る (1 = 減る)', 2: '開く音 (SoundData の行。0x7A)' },
    note: '引数の並びは 0x15 と同じ。像を減らし、置く演出のあと開く (OpenCommonIdol)',
  },
};

/** The types whose first two arguments are a map (hash) and a point of it: edited with the destination picker. */
// 0x0D has them too, but its destination is a world map's entrance, which the picker does not list.
export const LANAI_DESTINATION_ACTIONS: readonly number[] = [
  0x80000011, 0x80000012, 0x80000013, 0x80000014, 0x80000016, 0x80000018, 0x80000019, 0x8000001c, 0x8000001d,
  0x80000034, 0x80000039,
];

/**
 * The action types the event of a record takes, by section and (for section 5) the record's kind at +0: the event's
 * class is chosen by them and its factory knows only these types, so any other type does nothing there (lanai-custom-
 * stages 3ds/research/event-actions.md §3; section 8 is that document's 範囲). 0x2D (a script) is taken by all of them.
 */
const SECTION_ACTIONS: Record<number, number[]> = {
  3: [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1c, 0x1d, 0x1f, 0x31, 0x34, 0x39, 0x3b],
  4: [0x0e, 0x10, 0x2e],
  8: [0x0c, 0x0d, 0x33, 0x35, 0x36],
};
const NPC_ACTIONS = [0x01, 0x02, 0x03, 0x32, 0x37, 0x3a];
const GIMMICK_ACTIONS = [0x25, 0x2f];
const KIND_ACTIONS: Record<number, number[]> = {
  0: NPC_ACTIONS,
  1: NPC_ACTIONS,
  2: NPC_ACTIONS,
  3: [],
  4: GIMMICK_ACTIONS,
  5: GIMMICK_ACTIONS,
  6: GIMMICK_ACTIONS,
  8: [],
  9: [],
  11: GIMMICK_ACTIONS,
  12: [0x30],
  13: [0x30],
  14: GIMMICK_ACTIONS,
  15: GIMMICK_ACTIONS,
};

/**
 * The types to offer for a record of a section (`kind` = +0 of a section 5 record), in type order, or undefined when
 * what the record takes is not known (every type is offered then). Characters of the kinds 7 / 10 have no event: only
 * "none" is offered.
 */
export function lanaiActionTypesFor(section: number, kind?: number): number[] | undefined {
  if (section === 5 && (kind === 7 || kind === 10)) return [LANAI_ACTION_NONE];
  const own = section === 5 ? KIND_ACTIONS[kind ?? -1] : SECTION_ACTIONS[section];
  if (!own) return undefined;
  return [LANAI_ACTION_NONE, ...[...own, 0x2d].sort((a, b) => a - b).map((t) => (0x80000000 | t) >>> 0)];
}

/** Which run of the event an action is for: the row's state picks it, and the state counts the runs (event-actions.md §0). */
export const LANAI_ACTION_RUNS = ['1 回目', '2 回目', '3 回目以降'] as const;

/** "一言" or "型 8000001D" for an action type. */
export function lanaiActionName(type: number): string {
  return LANAI_ACTIONS[type]?.name ?? `型 ${(type >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** The types a record's action can be switched to with a name (the select of the map page), in type order. */
export const LANAI_ACTION_TYPES: number[] = Object.keys(LANAI_ACTIONS)
  .map((k) => Number(k) >>> 0)
  .sort((a, b) => a - b);

/** The offset of the message column of a talk table (`*_msg`), or undefined when the table is not one. */
export function talkMessageOffset(t: LanaiTable): number | undefined {
  return talkColumns({ table: t })?.message;
}
