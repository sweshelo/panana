// Panana's debug mode for RPG2 (kahara), for trying a MOD out in Azahar: on the field, hold L + R for a moment
// to open a menu (a narration window that the patch writes its own text into):
// - アイテムを手に入れる: the game's shop (mode 7) as shop 18, which sells every item for 0 G.
// - ストーリーを進める: write the save values of the story milestones (game/storyconditions.ts) up to the chosen one.
// - セーブ変数を書きかえる: read and write any save variable (key, index, value).
// - ワープする: any row of the jump destinations (mapJumpPoint, visited or not): what the jump does
//   (FUN_00265e28: save +0x406 bit0, FUN_00308d44(save + 0x404, W01 / W02, entrance)), then mode 4 to the field.
// (naauao integrations/panana/debug-mode.md)
//
// - The key: FUN_003fef90 runs every frame while the party can move on the field (r4 = the field, +0x18 = the
//   queue of actions). At 0x3FF000 it calls our check; *0x57410C is the pad (+0 held, +4 pressed, +0x58 pressed
//   with key repeat). SELECT / START open the suspend / save dialog before the field sees them, so the key is L + R
//   held: when the key repeat fires for both (+0x58, and not a fresh press at +4, as L alone is the check button),
//   the patch clears L / R from this frame's repeat, registers its handler in the queue once per map (pseudo-row
//   0x1DEB000, FUN_0030cab8) and queues it (FUN_0030b7ac). The handler's action runs the menu in the queue's coroutine, like the world-map
//   notices (game/worldnotice.ts).
// - The window: FUN_00311384(1) opens the narration window (*0x56CEF8). The text is message 0x17D9 (SystemCommon's
//   font test, 98 characters, no reading), rewritten in memory before each FUN_0031cbec; the window's text speed
//   (+0x399) is set to 0 for that call, as the shop does, so it shows at once.
// - Shop 18: the shop takes its number from the mode's argument (*0x574148 +0xC) and turns 18 or more into 0
//   (0x1D4C44); the patch lets 18 through. The Shop table has 18 rows: row 18 reads as row 0 (FUN_0031cfb8 clamps),
//   so it talks like shop 0. Its list is added to ShopItem at export. FUN_002ea5b0 (the buying price) returns 0
//   while the mode (+0x8) is 7 and its argument is 18. Leaving the shop goes back to the field by the game's own
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
  'フィールドで立ち止まって L と R を一緒に押し続ける (0.3 秒ほど) と、デバッグメニューが開きます。全アイテムを 0 G で売る店、ストーリーの節目まで進める、セーブ変数の読み書き、ジャンプの行き先へのワープができます。コードを読み出し専用の領域に置くので、Azahar では動きますが実機では止まります。配布する MOD では外してください。';

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
  for (let i = 0; i < units.length; i += 2) words.push(`0x${((units[i + 1]! << 16) | units[i]!).toString(16).toUpperCase().padStart(8, '0')}`);
  return `${label}:\n${words.map((w) => `  .word ${w}`).join('\n')}`;
}

const STRINGS: [string, string][] = [
  ['s_title', 'デバッグメニュー'],
  ['s_menu0', 'アイテムを手に入れる (店)'],
  ['s_menu1', 'ストーリーを進める'],
  ['s_menu2', 'セーブ変数を書きかえる'],
  ['s_menu3', 'ワープする'],
  ['s_story', 'ストーリーの節目 '],
  ['s_hint_story', 'A:ここまで進める　B:もどる'],
  ['s_var', 'セーブ変数　今の値 '],
  ['s_var0', '変数 '],
  ['s_var1', '　位置 '],
  ['s_var2', '　値 '],
  ['s_hint_var', '←→:欄 ↑↓:±1 L/R:±10 A:書く'],
  ['s_done', '書きこみました'],
  ['s_warp', 'ワープ先 '],
  ['s_hint_warp', 'A:ワープする　B:もどる'],
  ['s_hint_menu', '↑↓:えらぶ　A:決定　B:とじる'],
  ['s_cur', '▶'],
  ['s_sp', '　'],
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
; 買値 (r1 = アイテム): 店 (モード 7) の 18 番なら 0
dbg_price:
  ldr r2, =0x574148
  ldr r2, [r2]
  ldr r3, [r2, #8]
  cmp r3, #7
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
  mov r0, #0x24
  bl FUN_0033d690
  cmp r0, #0
  popeq {r4, pc}
  ldr r1, =0x${DEBUG_ROW.toString(16).toUpperCase()}
  bl FUN_0031b170            ; 動作の基底
  ldr r1, =dbg_avt
  str r1, [r0]
  mov r1, #0
  str r1, [r0, #0x10]        ; +0x10 画面、+0x11 メニューの選択、+0x13 欄
  str r1, [r0, #0x14]        ; +0x14 ワープ先、+0x16 節目
  str r1, [r0, #0x18]        ; +0x18 変数、+0x1A 位置
  str r1, [r0, #0x1c]        ; +0x1C 値
  str r1, [r0, #0x20]        ; +0x20 「書きこみました」
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

; 動作 [2]: メニュー (キューのコルーチンの中)
dbg_run:
  push {r4, r5, r6, lr}
  mov r4, r0
  mov r0, #0
  strb r0, [r4, #0x10]
  strb r0, [r4, #0x20]
  mov r0, #1
  bl FUN_00311384            ; 地の文の窓
dr_draw:
  mov r0, r4
  bl dbg_render
  bl dbg_show
dr_wait:
  bl dbg_frame
  ldr r0, =0x57410C
  ldr r0, [r0]
  ldr r1, [r0, #0x58]        ; 押した (連続入力つき)
  orr r1, r1, r1, lsr #24    ; スライドパッドも十字キーに
  and r1, r1, #0xF0
  ldr r3, [r0, #0x58]
  and r3, r3, #0x300         ; L / R (連続入力つき)
  orr r1, r1, r3
  ldr r2, [r0, #4]           ; 押した瞬間
  ldr r3, =0xC0F
  and r2, r2, r3             ; A B SELECT START X Y
  orrs r5, r1, r2
  beq dr_wait
  mov r0, r4
  mov r1, r5
  bl dbg_input
  cmp r0, #0
  bgt dr_draw
  mov r5, r0                 ; 0 = 閉じる、-1 = 閉じて店へ、-2 = 閉じてワープ
  mov r0, #1
  mov r1, #0
  bl FUN_00307da8            ; 窓を閉じる
  cmp r5, #0
  popeq {r4, r5, r6, pc}
  ldr r0, =0x574148
  ldr r0, [r0]
  cmn r5, #1
  moveq r1, #7               ; 店 (モード 7)
  moveq r2, #${DEBUG_SHOP}
  movne r1, #4               ; 記録した場所からフィールドへ (モード 4)
  movne r2, #0
  bl FUN_00308d08
  pop {r4, r5, r6, pc}
; 1 フレーム待つ
dbg_frame:
  push {r4, lr}
  ldr r0, =0x5740E8
  ldr r0, [r0]
  bl FUN_0033d840
  pop {r4, pc}
; メッセージ 0x17D9 を窓に出し、文字送りが終わるまで待つ
dbg_show:
  push {r4, r5, lr}
  sub sp, sp, #0x14
  ldr r4, =0x56CEF8
  ldr r4, [r4]
  cmp r4, #0
  beq sh_out
  ldrb r5, [r4, #0x399]      ; 文字の速さ
  mov r0, #0
  strb r0, [r4, #0x399]      ; 0 = すぐ全部 (店と同じ)
  str r0, [sp]
  str r0, [sp, #4]
  str r0, [sp, #8]
  mov r2, #0
  mov r3, #0
  mov r0, r4
  ldr r1, =0x17D9
  bl FUN_0031cbec
  strb r5, [r4, #0x399]
sh_wait:
  mov r0, r4
  bl FUN_0031cba0            ; 文字送り中
  cmp r0, #0
  beq sh_out
  bl dbg_frame
  b sh_wait
sh_out:
  add sp, sp, #0x14
  pop {r4, r5, pc}
; r0 = 動作、r1 = ボタン -> r0 = 1 描き直す、0 閉じる、-1 店へ、-2 ワープ
dbg_input:
  push {r4, r5, r6, lr}
  mov r4, r0
  mov r5, r1
  mov r0, #0
  strb r0, [r4, #0x20]
  ldrb r6, [r4, #0x10]
  tst r5, #2                 ; B
  beq in_go
  cmp r6, #0
  moveq r0, #0
  popeq {r4, r5, r6, pc}     ; メニューで B: 閉じる
  mov r0, #0
  strb r0, [r4, #0x10]       ; メニューへもどる
  b in_ok
in_go:
  cmp r6, #2
  beq in_story
  cmp r6, #3
  beq in_var
  cmp r6, #4
  beq in_warp
  ldrb r0, [r4, #0x11]       ; メニュー
  mov r1, #4
  mov r2, r5
  bl dbg_updown
  strb r0, [r4, #0x11]
  tst r5, #1                 ; A
  beq in_ok
  cmp r0, #0
  mvneq r0, #0               ; アイテム: 店へ
  popeq {r4, r5, r6, pc}
  add r0, r0, #1
  strb r0, [r4, #0x10]
  b in_ok
in_story:
  ldrh r0, [r4, #0x16]
  mov r1, #${n}
  mov r2, r5
  bl dbg_updown
  strh r0, [r4, #0x16]
  tst r5, #1
  beq in_ok
  mov r6, #0                 ; 最初の節目から選んだ節目まで書く
is_loop:
  ldr r1, =story_table
  ldr r3, [r1, r6, lsl #2]   ; 変数 | 位置 << 8 | 値 << 16
  and r0, r3, #0xFF
  lsr r1, r3, #8
  and r1, r1, #0xFF
  lsr r2, r3, #16
  bl sv_write
  ldrh r0, [r4, #0x16]
  add r6, r6, #1
  cmp r6, r0
  bls is_loop
  b in_done
in_var:
  ldrb r0, [r4, #0x13]       ; 欄
  tst r5, #0x20
  subne r0, r0, #1
  tst r5, #0x10
  addne r0, r0, #1
  cmp r0, #0
  movlt r0, #2
  cmp r0, #3
  movge r0, #0
  strb r0, [r4, #0x13]
  add r6, r4, #0x18
  add r6, r6, r0, lsl #1
  ldrh r0, [r6]
  tst r5, #0x40
  addne r0, r0, #1
  tst r5, #0x80
  subne r0, r0, #1
  tst r5, #0x100
  addne r0, r0, #10
  tst r5, #0x200
  subne r0, r0, #10
  cmp r0, #0
  movlt r0, #0
  strh r0, [r6]
  tst r5, #1
  beq in_ok
  ldrh r0, [r4, #0x18]
  ldrh r1, [r4, #0x1a]
  ldrh r2, [r4, #0x1c]
  bl sv_write
  b in_done
in_warp:
  bl warp_count
  mov r1, r0
  ldrh r0, [r4, #0x14]
  mov r2, r5
  bl dbg_updown
  strh r0, [r4, #0x14]
  tst r5, #1
  beq in_ok
  bl warp_row                ; ジャンプと同じ (FUN_00265e28)
  ldr r1, [r0, #8]
  tst r1, #1
  ldrne r1, =0x09A1DA1B      ; W02
  ldreq r1, =0xA8654391      ; W01
  ldr r2, [r0, #4]           ; 入口
  ldr r0, =0x564638
  ldr r0, [r0]
  add r0, r0, #0x400
  add r0, r0, #4
  ldrb r3, [r0, #2]
  orr r3, r3, #1
  strb r3, [r0, #2]
  bl FUN_00308d44            ; 行き先を記録
  mvn r0, #1
  pop {r4, r5, r6, pc}
in_done:
  mov r0, #1
  strb r0, [r4, #0x20]
in_ok:
  mov r0, #1
  pop {r4, r5, r6, pc}
; r0 = 値、r1 = 数、r2 = ボタン: 上下で 1 ずつ、端で回る
dbg_updown:
  tst r2, #0x40
  subne r0, r0, #1
  tst r2, #0x80
  addne r0, r0, #1
  cmp r0, #0
  addlt r0, r0, r1
  cmp r0, r1
  subge r0, r0, r1
  bx lr
; ジャンプの行き先 (mapJumpPoint、行 0 は「なし」) の数 -> r0
warp_count:
  ldr r0, =0x520448
  ldr r0, [r0]
  ldr r0, [r0, #0x6b0]
  ldr r0, [r0]
  sub r0, r0, #1
  bx lr
; r0 番目の行き先 (行 r0 + 1) -> r0 = 行
warp_row:
  push {r4, lr}
  add r1, r0, #1
  ldr r0, =0x520448
  ldr r0, [r0]
  add r0, r0, #0x400
  add r0, r0, #0x2ac
  bl FUN_0031cfb8
  pop {r4, pc}
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

; 画面の文をメッセージ 0x17D9 (98 文字) に書く。r6 = 書く位置、r7 = 終わり
dbg_render:
  push {r4, r5, r6, r7, r8, lr}
  mov r4, r0
  ldr r0, =0x5742D0
  ldr r0, [r0]
  ldr r1, =0x17D9
  mvn r2, #0
  bl FUN_00310438            ; 本文
  cmp r0, #0
  popeq {r4, r5, r6, r7, r8, pc}
  mov r6, r0
  add r7, r6, #190           ; 95 文字まで
  ldrb r0, [r4, #0x10]
  cmp r0, #2
  beq rd_story
  cmp r0, #3
  beq rd_var
  cmp r0, #4
  beq rd_warp
  ldr r0, =s_title           ; メニュー
  bl tx_s
  bl tx_nl
  ldr r0, =s_cur
  bl tx_s
  ldrb r0, [r4, #0x11]
  ldr r1, =menu_names
  ldr r0, [r1, r0, lsl #2]
  bl tx_s
  bl tx_nl
  ldr r0, =s_hint_menu
  b rd_last
rd_story:
  ldrh r1, [r4, #0x16]
  ldr r3, =s_story0          ; 名前は順に並んでいる (4 バイト境界)
  mov r0, r1
rs_skip:
  subs r0, r0, #1
  bmi rs_name
rs_char:
  ldrh r2, [r3], #2
  cmp r2, #0
  bne rs_char
  add r3, r3, #3
  bic r3, r3, #3
  b rs_skip
rs_name:
  ldr r0, =s_story
  mov r2, #${n}
  bl rd_list
  ldr r0, =s_hint_story
  b rd_last
rd_warp:
  ldrh r0, [r4, #0x14]
  bl warp_row
  ldr r1, [r0]               ; 名前のメッセージ
  ldr r0, =0x5742D0
  ldr r0, [r0]
  mvn r2, #0
  bl FUN_00310438
  movs r5, r0
  ldreq r5, =s_sp
  bl warp_count
  mov r2, r0
  mov r3, r5
  ldrh r1, [r4, #0x14]
  ldr r0, =s_warp
  bl rd_list
  ldr r0, =s_hint_warp
  b rd_last
rd_var:
  ldr r0, =s_var
  bl tx_s
  ldrh r0, [r4, #0x18]
  ldrh r1, [r4, #0x1a]
  bl sv_read
  bl tx_n
  bl tx_nl
  mov r5, #0
rv_loop:
  ldrb r0, [r4, #0x13]
  cmp r0, r5
  ldreq r0, =s_cur
  ldrne r0, =s_sp
  bl tx_s
  ldr r0, =var_names
  ldr r0, [r0, r5, lsl #2]
  bl tx_s
  add r0, r4, #0x18
  add r0, r0, r5, lsl #1
  ldrh r0, [r0]
  bl tx_n
  add r5, r5, #1
  cmp r5, #3
  blt rv_loop
  bl tx_nl
  ldr r0, =s_hint_var
rd_last:
  ldrb r1, [r4, #0x20]
  cmp r1, #0
  ldrne r0, =s_done
  bl tx_s
  mov r0, #0
  strh r0, [r6]
  pop {r4, r5, r6, r7, r8, pc}
; 見出し r0、r1 番目 (0 から) / r2 個、選んでいる名前 r3
rd_list:
  push {r4, r5, r8, lr}
  mov r4, r1
  mov r5, r2
  mov r8, r3
  bl tx_s
  add r0, r4, #1
  bl tx_n
  mov r0, #0x2F
  bl tx_c
  mov r0, r5
  bl tx_n
  bl tx_nl
  ldr r0, =s_cur
  bl tx_s
  mov r0, r8
  bl tx_s
  bl tx_nl
  pop {r4, r5, r8, pc}
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

menu_names:
  .word s_menu0
  .word s_menu1
  .word s_menu2
  .word s_menu3
var_names:
  .word s_var0
  .word s_var1
  .word s_var2
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
