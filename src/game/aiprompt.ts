// Text handed to an AI (or a person) about one event: what the game is, how events work, the row and its annotated
// code. The same text is the context of the AI features (explaining, writing patches). docs/event-list.md §5.
import type { EventEntry } from './eventlist';
import { kindName } from './eventkinds';
import { fnLabel, KNOWN_FUNCTIONS, listingText, type AsmFunction } from './scriptasm';

export const GAME_CONTEXT = `対象: ニンテンドー3DS「電波人間のRPG2」v1.1.0 の code.bin (ARM11 / ARMv6K、ARM モード、VFPv2。base 0x100000 の平らなバイナリ)。
関数名は Ghidra 風 (FUN_アドレス)。呼び出し規約は AAPCS (r0-r3 引数・r0 戻り値、float は hardfp で s0-)。

イベントの仕組み:
- マップのレコードがダンジョンの EventObject の行 (0x50 バイト) を指す。行の +0x4D が種類。種類 0x24 は「スクリプト」で、動作はダンジョン (セーブ変数 0x4F) と行番号ごとにコードに書かれている。
- ゲームは行ごとに「動作のクラス」を作る。vtable は 8 項目で [1] = 後始末、[2] = 毎フレームの処理 (多くはコルーチン)。
- 行ごとに 2 ビットの状態 (セーブ変数 0x8E) を持つ。FUN_0031AA2C(行) が行を完了させる (扉なら開く)。
- 出現条件: +0x4B (値 +0x00) が成り立つと置かれ、+0x4C (値 +0x04) が成り立つと置かれない。条件は FUN_0030B8A4。
- セーブ変数: 0x8D = 進行 (FUN_0031BAC4(n) = 0x8D[n-1])、0x91 = 値、0x92 = フラグ (ダンジョンごとの範囲は mapGroup +0x1E/+0x20 と +0x22/+0x24)。
- メッセージ ID 0x1BDF〜0x21AF は MessageField (会話)。

既知の関数:
${Object.entries(KNOWN_FUNCTIONS)
  .map(([a, k]) => `- ${fnLabel(Number(a))}: ${k.name}${k.args ? `(${k.args.join(', ')})` : ''}${k.guess ? ' (推定)' : ''}`)
  .join('\n')}`;

export interface EventDescription {
  dungeonName: string;
  entry: EventEntry;
  /** Map names where the row is placed. */
  places: string[];
  listing: AsmFunction[];
  /** Message text by ID. */
  message: (id: number) => string | undefined;
}

/** Everything about one event, as text. */
export function eventText(d: EventDescription): string {
  const e = d.entry;
  const lines = [
    `# イベント: ${d.dungeonName} (ダンジョン ${e.dungeon}) の行 ${e.row}`,
    `種類 0x${e.kind.toString(16).toUpperCase()} (${kindName(e.kind)})、状態の枠 ${e.slot}${e.model ? `、モデル ${e.model}` : ''}`,
    `置かれている場所: ${d.places.length ? d.places.join('、') : 'なし'}`,
    `出現条件: ${e.conditions.length ? e.conditions.map((c) => `${c.field === 0x4b ? '出る' : '消える'}: ${c.text}`).join('、') : 'なし'}`,
  ];
  for (const m of e.messages) lines.push(`行の欄 +0x${m.off.toString(16).toUpperCase()} のメッセージ 0x${m.id.toString(16).toUpperCase()}: ${d.message(m.id) ?? ''}`);
  for (const s of e.scripts) {
    lines.push(`スクリプト: ${fnLabel(s.make)} が作るクラス (vtable 0x${s.cls.vtable.toString(16).toUpperCase()})、完了させる行 ${s.cls.completes.join(', ') || 'なし'}`);
    for (const id of s.cls.messages) lines.push(`  メッセージ 0x${id.toString(16).toUpperCase()}: ${d.message(id) ?? ''}`);
  }
  if (d.listing.length) lines.push('', '## コード (注釈つき逆アセンブル)', '```asm', listingText(d.listing), '```');
  return lines.join('\n');
}

/** The whole text to paste into an AI chat. */
export function aiBundle(d: EventDescription): string {
  return `${GAME_CONTEXT}\n\n${eventText(d)}\n`;
}
