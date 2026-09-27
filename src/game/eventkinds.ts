// EventObject kinds (+0x4D) and what their fields mean (elpulse docs/events.md §4).

import { KIND_BOSS } from './boss';

export const KIND_SWITCH = 0x30; // generic switch (elpulse mod/build_code.py)

export interface KindInfo {
  name: string;
  /** Offsets of message IDs among +0x08.. */
  messages?: number[];
  /** Offset of a treasureGroup row. */
  treasure?: number;
  note?: string;
}

export const EVENT_KINDS: Record<number, KindInfo> = {
  0x00: { name: '動作なし', note: '見た目だけのオブジェクト、またはスイッチ・スクリプトの対象' },
  0x01: { name: 'キャラ (一言)', messages: [0x08], note: '振り向く。+0x0C / +0x10 は書式の引数' },
  0x02: { name: 'キャラ (一言)', messages: [0x08], note: '振り向く。+0x0C / +0x10 は書式の引数' },
  0x03: { name: 'キャラ (一言)', messages: [0x08], note: '振り向かない。+0x0C / +0x10 は書式の引数' },
  0x04: { name: 'キャラ (条件つき)', messages: [0x0c, 0x10], note: '+0x08 の下位 16 bit の条件 (FUN_002dba28) が偽なら +0x0C、真なら +0x10' },
  0x05: { name: 'キャラ (条件つき)', messages: [0x0c, 0x10], note: '+0x08 の下位 16 bit の条件 (FUN_002dba28) が偽なら +0x0C、真なら +0x10' },
  0x06: { name: 'キャラ (条件つき)', messages: [0x0c, 0x10], note: '+0x08 の下位 16 bit の条件 (FUN_002dba28) が偽なら +0x0C、真なら +0x10' },
  0x07: { name: '会話', messages: [0x08, 0x0c, 0x10, 0x14], note: '振り向く。ストーリーの進行で 4 つから選ぶ' },
  0x08: { name: '会話', messages: [0x08, 0x0c, 0x10, 0x14], note: '振り向いて演出あり。ストーリーの進行で 4 つから選ぶ' },
  0x09: { name: '会話', messages: [0x08, 0x0c, 0x10, 0x14], note: '振り向かない。ストーリーの進行で 4 つから選ぶ' },
  0x0a: { name: 'キャラ (スクリプト)', note: '0x24 と同じくコードに書かれた動作' },
  0x0b: { name: '範囲', note: '+0x04 / +0x08 / +0x0C の意味は未解析' },
  0x0c: { name: '宝箱', treasure: 0x08 },
  0x0d: { name: '宝箱 (別の演出)', treasure: 0x08 },
  0x0e: { name: '宝箱 (推定: 鍵つき)', treasure: 0x08 },
  0x0f: { name: '出入口 (推定: 専用の出口)' },
  0x10: { name: '出入口' },
  0x11: { name: '区画 3 の種類 18' },
  0x12: { name: 'ワープの模様' },
  0x14: { name: '扉', note: '+0x08 鍵のアイテム ID (0 = なし)、+0x0C = 1 で鍵を使い切る、+0x10 / +0x24 効果音、+0x4A。文面はコードに固定 (0x1BE5〜0x1BE7)' },
  0x15: { name: '扉 (推定: 鍵つき)', note: '+0x08 鍵のアイテム ID、+0x0C = 1 で鍵を使い切る、+0x10 効果音。文面はコードに固定 (0x1BE5〜0x1BE7)' },
  0x16: { name: '扉 (スイッチなどで開く)' },
  0x17: { name: '建物の出入口' },
  0x18: { name: '建物の出入口' },
  0x19: { name: '建物の出入口' },
  0x1a: { name: '建物の出入口' },
  0x1b: { name: '調べるもの (区画 5 の種類 1)' },
  0x1c: { name: '穴' },
  0x1d: { name: '床スイッチ (離れると戻る)', note: 'ほかの行とのつながりはない' },
  0x1e: { name: '床スイッチ (押されたまま)', note: 'ほかの行とのつながりはない' },
  0x1f: { name: '看板・調べる', messages: [0x08] },
  0x21: { name: 'ワールドマップ用', messages: [0x08] },
  0x24: { name: 'スクリプト', note: 'ダンジョンと行番号ごとにコードに書かれた動作 (データでは変えられない)' },
  [KIND_SWITCH]: { name: '汎用スイッチ (MOD)', note: '踏むと対象の行 (同じマップの扉・門) を開ける。土台の MOD に汎用スイッチの code.ips が要る' },
  [KIND_BOSS]: { name: 'ボス戦 (MOD)', messages: [0x0c, 0x10, 0x14, 0x20, 0x24, 0x28, 0x34, 0x38, 0x3c], note: '区画 8 の範囲に入ると、メッセージのあと決まった敵と戦う。Panana が code.ips にパッチ「ボス戦」を入れる' },
};

export const kindName = (k: number): string => EVENT_KINDS[k]?.name ?? `種類 0x${k.toString(16).toUpperCase()}`;

/**
 * Switch -> target pairs that the game hard-codes in kind 0x24 scripts (docs/events.md §5).
 * dungeon -> switch row -> target rows.
 */
export const SCRIPT_LINKS: Record<number, Record<number, number[]>> = {
  1: { 2: [10], 3: [11], 4: [13], 9: [1] },
};

/** Target presets of the generic switch: animations when loaded open / when opening, and the sound. */
export const SWITCH_PRESETS = [
  { label: '柵・門 (gate_08 など)', loadAnim: 0x55, openAnim: 0x53, sound: 0x6f },
  { label: '扉 (gate_02 など)', loadAnim: 0x52, openAnim: 0x53, sound: 0x5c },
];

/** Section-3 kinds usable as switch targets (doors / gates that open when their event is done). */
export const GATE_KINDS = new Set([11, 16, 17]);
