// Panana's debug mode for RPG2 (kahara), for trying a MOD out in Azahar: on the field, hold L + R for a moment.
// The game's yes / no window (FUN_0030873c) asks in turn:
// - 全アイテムの店へ: the game's shop (mode 8) as shop 18, which sells every item for 0 G.
// - ワープ: the jump screen (scene 0x23) with every destination shown (mapJumpPoint; the visited marks 0x65 are set
//   while it is open and put back after). Choosing one records it as the jump does (FUN_00265e28: save +0x406 bit0,
//   FUN_00308d44), then mode 4 goes to the field there.
// - ストーリー: the story milestones (game/storyconditions.ts) one by one; yes writes the save values from the first
//   up to that one.
// (naauao integrations/panana/debug-mode.md)
//
// - The key: FUN_003fef90 runs every frame while the party can move on the field (r4 = the field, +0x18 = the
//   queue of actions). At 0x3FF000 it calls our check; *0x57410C is the pad (+0 held, +4 pressed, +0x58 pressed
//   with key repeat). SELECT / START open the suspend / save dialog before the field sees them, so the key is L + R
//   held: when the key repeat fires for both (+0x58, and not a fresh press at +4, as L alone is the check button),
//   the patch clears L / R from this frame's repeat, registers its handler in the queue once per map (pseudo-row
//   0x1DEB000, FUN_0030cab8) and queues it (FUN_0030b7ac). The handler's action runs the menu in the queue's
//   coroutine, like the world-map notices (game/worldnotice.ts).
// - The text: message 0x17D9 (SystemCommon's font test, 98 characters, no reading), rewritten in memory before each
//   question. The narration window shows 2 lines a page, and drawing a cursor in it by rewriting the text broke the
//   window (seen in Azahar), so the menu is questions. ▶ is not in the font (→ is).
// - The jump screen from the field: FUN_0031cdf4(*0x574210, 0x23, 0, 0, 0, 0), FUN_00265e28 (waits for the choice),
//   FUN_003175c0 / FUN_00317400 to remove it, as the world map does at 0x1D4784.
// - Shop 18: the shop takes its number from the mode's argument (*0x574148 +0xC) and turns 18 or more into 0
//   (0x1D4C44); the patch lets 18 through. The Shop table has 18 rows: row 18 reads as row 0 (FUN_0031cfb8 clamps),
//   so it talks like shop 0. Its list is added to ShopItem at export. FUN_002ea5b0 (the buying price) returns 0
//   while the mode (+0x8) is 8 and its argument is 18. Leaving the shop goes back to the field by the game's own
//   way (mode 4), at the place the game last recorded.
// - The code is in .rodata (`@emu`, patch.ts KAHARA_EMU_AREA: copies of the mapData key array that nothing uses):
//   Azahar runs it, the 3DS does not (the page is not executable there), so the MOD is for the emulator only.
import type { CodePatch } from './patch';
import { STORY_CONDITIONS, type StoryCondition } from './storyconditions';
import type { GsTable } from '../archive/gstable';
import { u32 } from '../util/bytes';

export const DEBUG_MODE_ID = 'panana:debug-mode';
export const DEBUG_MODE_TITLE = 'デバッグモード (Azahar 専用)';
export const DEBUG_MODE_NOTE =
  'フィールドで立ち止まって L と R を一緒に押し続ける (0.3 秒ほど) と、デバッグメニューが開きます。全アイテムを 0 G で売る店、ジャンプの行き先すべてへのワープ、ストーリーの節目まで進めることができます。コードを読み出し専用の領域に置くので、Azahar では動きますが実機では止まります。配布する MOD では外してください。';

/** The shop the menu opens (one past the game's 0..17). */
export const DEBUG_SHOP = 18;
/** The pseudo-row of the debug handler in the queue (rows of 0xFFFFFF or more have no state). */
const DEBUG_ROW = 0x1deb000;

/** The save value a milestone stands for: 0x91[n] = 2 for a boss, 0x8D[type - 0x18] = value for a dungeon's progress. */
export function milestoneWrite(c: StoryCondition): { key: number; index: number; value: number } | null {
  if (c.type === 0xb0) return { key: 0x91, index: c.value, value: 2 };
  if (c.type >= 0x18 && c.type <= 0x21) return { key: 0x8d, index: c.type - 0x18, value: c.value };
  return null;
}

/** Short label of a milestone for the window ("〇〇を倒したあと" -> "〇〇"). */
export const milestoneLabel = (c: StoryCondition): string => c.label.replace(/を倒したあと$/, '');

/** The items the debug shop sells: every row with a name that is not gold (category 2) or empty (0). */
export function debugShopItems(itemData: GsTable, name: (id: number) => string): number[] {
  const out: number[] = [];
  for (let id = 1; id < itemData.rows; id++) {
    const cat = itemData.row(id)[0x2c]! & 0xf;
    if (cat === 0 || cat === 2 || !name(id)) continue;
    out.push(id);
  }
  return out;
}

/** UTF-16 text as `.word` lines (two units a word, ended by 0). */
function utf16Words(label: string, text: string): string {
  const units = [...Array.from(text, (c) => c.charCodeAt(0)), 0];
  if (units.length & 1) units.push(0);
  const words: string[] = [];
  for (let i = 0; i < units.length; i += 2) words.push(`0x${(((units[i + 1]! << 16) | units[i]!) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`);
  return `${label}:\n${words.map((w) => `  .word ${w}`).join('\n')}`;
}

const STRINGS: [string, string][] = [
  ['s_q_shop', 'デバッグ: 全アイテムの店へ行きますか？'],
  ['s_q_warp', 'デバッグ: ワープしますか？\n(ジャンプの行き先がすべて出ます)'],
  ['s_q_story', 'デバッグ: ストーリーを進めますか？'],
  ['s_q_until', 'まで進めますか？'],
  ['s_done', 'ストーリーを進めました。'],
];

export function debugModeSource(conditions: StoryCondition[] = STORY_CONDITIONS): string {
  const story = conditions.flatMap((c) => {
    const w = milestoneWrite(c);
    return w ? [{ w, label: milestoneLabel(c) }] : [];
  });
  if (story.length > 255) throw new Error('ストーリーの節目が多すぎます');
  const table = story.map((s) => `  .word 0x${(s.w.key | (s.w.index << 8) | (s.w.value << 16)).toString(16).toUpperCase()} ; ${s.label}`).join('\n');
  const strings = [...STRINGS, ...story.map((s, i): [string, string] => [`s_story${i}`, s.label])].map(([l, t]) => utf16Words(l, t)).join('\n');
  const n = story.length;
  return `; ${DEBUG_MODE_TITLE}: フィールドで L + R を押し続けるとメニュー。naauao integrations/panana/debug-mode.md
; フィールドで操作できる間の毎フレーム処理 (FUN_003fef90)
@0x3FF000
  bl dbg_key                 ; ldr r0, =0x51BEBC
; 店の番号は 18 未満 → 18 (デバッグの店) も通す
@0x1D4C44
  cmp r0, #0x13
; 買値 (FUN_002ea5b0 の先頭 mov r0, r1)
@0x2EA5B0
  b dbg_price

@emu debug_mode
; r4 = フィールド。L + R を押し続けたら (連続入力が出たら) デバッグの動作をキューに積む。SELECT / START は中断セーブに取られる。r0 = 0x51BEBC を返す (上書きした命令)
dbg_key:
  push {r4, r5, r6, lr}
  ldr r3, =0x57410C
  ldr r3, [r3]
  ldr r1, [r3]               ; 押している: L + R
  and r1, r1, #0x300
  cmp r1, #0x300
  bne dk_out
  ldr r1, [r3, #0x58]        ; 連続入力: 同じボタンを押し続けると、少し待ってから出る
  and r1, r1, #0x300
  cmp r1, #0x300
  bne dk_out
  ldr r1, [r3, #4]           ; 押した瞬間ではない (L は調べる)
  tst r1, #0x300
  bne dk_out
  ldr r1, [r3, #0x58]        ; このフレームの連続入力から L / R を消す
  bic r1, r1, #0x300
  str r1, [r3, #0x58]
  ldr r5, [r4, #0x18]        ; 動作のキュー
  mov r0, r5
  bl dbg_handler
  mov r0, r5
  ldr r1, =0x${DEBUG_ROW.toString(16).toUpperCase()}
  bl FUN_0030b7ac
dk_out:
  ldr r0, =0x51BEBC
  pop {r4, r5, r6, pc}
; 買値 (r1 = アイテム): 店 (モード 8) の 18 番なら 0
dbg_price:
  ldr r2, =0x574148
  ldr r2, [r2]
  ldr r3, [r2, #8]
  cmp r3, #8
  ldreq r3, [r2, #0xc]
  cmpeq r3, #${DEBUG_SHOP}
  moveq r0, #0
  bxeq lr
  mov r0, r1
  b 0x2EA5B4
; r0 = キュー: デバッグの手札がまだなければ登録する (マップごと)
dbg_handler:
  push {r4, r5, r6, lr}
  mov r4, r0
  add r0, r4, #0x100
  ldrh r5, [r0, #0x9c]       ; 手札の数
  mov r6, #0
dh_loop:
  cmp r6, r5
  bhs dh_new
  add r0, r4, r6, lsl #2
  ldr r0, [r0, #0xc]
  ldr r0, [r0, #4]
  ldr r1, =0x${DEBUG_ROW.toString(16).toUpperCase()}
  cmp r0, r1
  popeq {r4, r5, r6, pc}
  add r6, r6, #1
  b dh_loop
dh_new:
  cmp r5, #100
  pophs {r4, r5, r6, pc}
  mov r0, #0x20
  bl FUN_0033d690            ; 確保
  cmp r0, #0
  popeq {r4, r5, r6, pc}
  ldr r1, =0x${DEBUG_ROW.toString(16).toUpperCase()}
  bl FUN_00309554            ; 手札の基底
  ldr r1, =dbg_hvt
  str r1, [r0]
  mov r1, r0
  mov r0, r4
  bl FUN_0030cab8            ; 登録 ([2] を呼ぶ)
  pop {r4, r5, r6, pc}
dbg_hvt:
  .word 0
  .word 0x1B0FB8             ; 解放 (動作も解放する)
  .word dbg_hinit
  .word dbg_hget
  .word 0x1C413C
  .word 0
  .word 0
; 手札 [2]: 動作を 1 つ作る (+0x10 から状態)
dbg_hinit:
  push {r4, lr}
  mov r4, r0
  ldr r0, [r4, #0xc]
  cmp r0, #0
  popne {r4, pc}
  mov r0, #0x40
  bl FUN_0033d690
  cmp r0, #0
  popeq {r4, pc}
  ldr r1, =0x${DEBUG_ROW.toString(16).toUpperCase()}
  bl FUN_0031b170            ; 動作の基底
  ldr r1, =dbg_avt
  str r1, [r0]
                             ; +0x10〜+0x3F: ワープの間、行ごとの訪れた印 (行は 40 まで)
  str r0, [r4, #0xc]
  pop {r4, pc}
; 手札 [3]: 積む動作
dbg_hget:
  ldr r0, [r0, #0xc]
  bx lr
dbg_avt:
  .word 0
  .word 0x1C0884             ; 後始末 (0x4FB8C8 と同じ)
  .word dbg_run
  .word 0x1B0FC8
  .word 0x31713C             ; 完了 (疑似行なので状態は書かない)
  .word 0x43C2CC
  .word 0
  .word 0

; 動作 [2]: メニュー (キューのコルーチンの中)。地の文の窓はカーソルを描けないので、ゲームのはい/いいえの窓
; (FUN_0030873c) で順に尋ねる。ワープはジャンプの画面 (シーン 0x23) を、全部の行き先を出して開く。
dbg_run:
  push {r4, r5, r6, r7, r8, lr}
  sub sp, sp, #8
  mov r4, r0
  ldr r0, =s_q_shop
  bl ask0
  cmp r0, #0
  bne dr_shop
  ldr r0, =s_q_warp
  bl ask0
  cmp r0, #0
  bne dr_warp
  ldr r0, =s_q_story
  bl ask0
  cmp r0, #0
  beq dr_out
  mov r5, #0                 ; 節目 (0 から)
  ldr r8, =s_story0          ; 名前は順に並んでいる (4 バイト境界)
ds_loop:
  cmp r5, #${n}
  bhs dr_out
  bl msg_begin
  add r0, r5, #1
  bl tx_n
  mov r0, #0x2F
  bl tx_c
  mov r0, #${n}
  bl tx_n
  mov r0, #0x20
  bl tx_c
  mov r0, r8
  bl tx_s
  bl tx_nl
  ldr r0, =s_q_until
  bl tx_s
  bl ask_end
  cmp r0, #0
  bne ds_write
ds_skip:
  ldrh r0, [r8], #2
  cmp r0, #0
  bne ds_skip
  add r8, r8, #3
  bic r8, r8, #3
  add r5, r5, #1
  b ds_loop
ds_write:
  mov r4, #0                 ; 最初の節目から選んだ節目まで書く
dw_loop:
  ldr r1, =story_table
  ldr r3, [r1, r4, lsl #2]   ; 変数 | 位置 << 8 | 値 << 16
  and r0, r3, #0xFF
  lsr r1, r3, #8
  and r1, r1, #0xFF
  lsr r2, r3, #16
  bl sv_write
  add r4, r4, #1
  cmp r4, r5
  bls dw_loop
  bl msg_begin
  ldr r0, =s_done
  bl tx_s
  mov r0, #0
  cmp r6, #0
  strhne r0, [r6]
  ldr r0, =0x17D9
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_0030cc48            ; 文を出す (泉の「効果が失われている」と同じ)
  b dr_out
dr_shop:
  ldr r0, =0x574148
  ldr r0, [r0]
  mov r1, #8                 ; 店 (モード 8。FUN_00174cb8 の 8 → FUN_0017e63c。7 は電波人間ハウス)
  mov r2, #${DEBUG_SHOP}
  bl FUN_00308d08
  b dr_out
dr_warp:
  mov r5, #1                 ; 行 1〜: 訪れた印 (0x65) を覚えて、全部立てる
wv_save:
  bl warp_last
  cmp r5, r0
  bhi wv_open
  mov r0, #0x65
  mov r1, r5
  bl sv_read
  add r1, r4, #0x10
  strb r0, [r1, r5]
  mov r0, #0x65
  mov r1, r5
  mov r2, #1
  bl sv_write
  add r5, r5, #1
  b wv_save
wv_open:
  ldr r8, =0x574210          ; 下画面のシーン (ワールドマップの 0x1D4784〜 と同じ並び)
  mov r0, #0
  str r0, [sp]
  str r0, [sp, #4]
  mov r7, #0
  ldr r0, [r8]
  mov r1, #0x23
  mov r2, #0
  mov r3, #0
  bl FUN_0031cdf4            ; ジャンプの画面を作る
  movs r6, r0
  beq wv_restore
  bl FUN_00265e28            ; 選ぶまで待つ。選べば行き先を記録 (FUN_00308d44) して r0 != 0
  mov r7, r0
  ldr r0, [r8]
  mov r1, r6
  mov r2, #1
  bl FUN_003175c0
  ldr r0, [r8]
  mov r1, #0x23
  bl FUN_00317400
wv_restore:
  mov r5, #1
wv_rest:
  bl warp_last
  cmp r5, r0
  bhi wv_done
  add r1, r4, #0x10
  ldrb r2, [r1, r5]
  mov r0, #0x65
  mov r1, r5
  bl sv_write
  add r5, r5, #1
  b wv_rest
wv_done:
  cmp r7, #0
  beq dr_out
  ldr r0, =0x574148
  ldr r0, [r0]
  mov r1, #4                 ; 記録した場所からフィールドへ (モード 4)
  mov r2, #0
  bl FUN_00308d08
dr_out:
  add sp, sp, #8
  pop {r4, r5, r6, r7, r8, pc}
; 文 r0 ひとつで尋ねる -> r0 = はい
ask0:
  push {r4, lr}
  mov r4, r0
  bl msg_begin
  mov r0, r4
  bl tx_s
  bl ask_end
  pop {r4, pc}
; メッセージ 0x17D9 (SystemCommon のフォントのテスト、98 文字) に書き始める: r6 = 書く位置、r7 = 終わり
msg_begin:
  push {r4, lr}
  ldr r0, =0x5742D0
  ldr r0, [r0]
  ldr r1, =0x17D9
  mvn r2, #0
  bl FUN_00310438            ; 本文
  movs r6, r0
  addne r7, r6, #190         ; 95 文字まで
  moveq r7, #0
  pop {r4, pc}
; 書いた文で、はい/いいえ -> r0 = はい
ask_end:
  push {r4, lr}
  mov r0, #0
  cmp r6, #0
  strhne r0, [r6]
  ldr r0, =0x17D9
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_0030873c
  pop {r4, pc}
; ジャンプの行き先 (mapJumpPoint、行 0 は「なし」) の最後の行 -> r0
warp_last:
  ldr r0, =0x520448
  ldr r0, [r0]
  ldr r0, [r0, #0x6b0]
  ldr r0, [r0]
  sub r0, r0, #1
  bx lr

; セーブ変数 r0 の r1 番目に r2 を書く
sv_write:
  push {r4, lr}
  sub sp, sp, #8
  str r2, [sp]
  mov r2, r1
  mov r1, r0
  ldr r0, =0x564638
  ldr r0, [r0]
  mov r3, sp
  bl FUN_00305b7c
  add sp, sp, #8
  pop {r4, pc}
; セーブ変数 r0 の r1 番目 -> r0
sv_read:
  push {r4, lr}
  sub sp, sp, #8
  mov r3, #0
  str r3, [sp]
  mov r2, r1
  mov r1, r0
  ldr r0, =0x564638
  ldr r0, [r0]
  mov r3, sp
  bl FUN_00304adc
  ldr r0, [sp]
  add sp, sp, #8
  pop {r4, pc}
; 1 文字 (r0)
tx_c:
  cmp r6, r7
  strhlo r0, [r6], #2
  bx lr
tx_nl:
  mov r0, #10
  b tx_c
; 文字列 (r0、0 で終わる)
tx_s:
  push {r4, lr}
  mov r4, r0
ts_loop:
  ldrh r0, [r4], #2
  cmp r0, #0
  popeq {r4, pc}
  bl tx_c
  b ts_loop
; 10 進の数 (r0)
tx_n:
  push {r4, r5, r8, lr}
  sub sp, sp, #16
  mov r4, sp
  ldr r5, =0xCCCCCCCD
tn_digit:
  umull r1, r2, r0, r5
  lsr r2, r2, #3             ; r0 / 10
  add r3, r2, r2, lsl #2
  sub r1, r0, r3, lsl #1     ; r0 % 10
  strb r1, [r4], #1
  movs r0, r2
  bne tn_digit
tn_out:
  ldrb r0, [r4, #-1]!
  add r0, r0, #0x30
  bl tx_c
  cmp r4, sp
  bhi tn_out
  add sp, sp, #16
  pop {r4, r5, r8, pc}

story_table:
${table}
${strings}
`;
}

export const debugModePatch = (): CodePatch => ({ id: DEBUG_MODE_ID, title: DEBUG_MODE_TITLE, source: debugModeSource(), enabled: true });

/** Why the debug mode cannot go into this code.bin (the places it rewrites are not the game's), or null. */
export function debugModeProblem(code: Uint8Array): string | null {
  const at = (a: number): number => u32(code, a - 0x100000);
  if (at(0x3ff000) !== 0xe59f02f8) return '0x3FF000 がゲームの命令ではありません (ほかの MOD が書き換えています)';
  if (at(0x1d4c44) !== 0xe3500012) return '0x1D4C44 がゲームの命令ではありません (ほかの MOD が書き換えています)';
  if (at(0x2ea5b0) !== 0xe1a00001) return '0x2EA5B0 がゲームの命令ではありません (ほかの MOD が書き換えています)';
  return null;
}
