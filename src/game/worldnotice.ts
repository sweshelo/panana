// "〇〇が出現した！" on W01: when the world map loads and an entrance that Panana marked has just become visible (its
// W01_EventObject row's conditions hold and the row's state is still 0), a message is shown once and the row's
// state is set to 1. It also shows for a save that already met the conditions, on the first load after the MOD is
// put in. docs/integrations/panana/world-notice.md.
//
// The game has the place for it: every field load queues pseudo-row 0x1000000 ("on entering the map",
// FUN_00198450), and FUN_0019aa88 makes its action per dungeon; W01's branch tail-calls FUN_0017e08c at 0x19ABA0,
// which returns an action for the story's own world-map scenes (e.g. 0x4FB8C8, "[黄泉の門]が開いた！") or 0. The patch
// makes a notice action when that returns 0 and a notice is due. Its [2] runs in the queue's coroutine, so
// FUN_0030cc48 (the narration window; waits until closed) can be called for each notice in turn.
import type { CodePatch } from './patch';
import type { EventTable } from './events';
import { u32, w32 } from '../util/bytes';

/** mapGroup row of W01: the only world map with the hook (FUN_0019aa88's branch at 0x19ABA0). */
export const NOTICE_DUNGEON = 0x34;
/** Kind of the rows of conditional entrances that behave as plain entrances (FUN_00319184 / FUN_002daac0). */
export const KIND_ENTRANCE = 0x11;
/** Row field Panana keeps the notice's message ID in (0 = no notice; kind 0x11 rows leave it 0). */
export const NOTICE_FIELD = 0x40;
/** "[黄泉の門]が開いた！": the game's own narration of a world-map change (FUN_001c0630); new notices copy its kind. */
export const NOTICE_TEMPLATE = 0x1bf6;

export const NOTICE_PATCH_ID = 'world-notice';
export const NOTICE_PATCH_TITLE = 'ワールドマップの出現の告知';

export interface Notice {
  row: number;
  message: number;
  /** +0x4B and its value +0x00 (appears when it holds). */
  show: [number, number];
  /** +0x4C and its value +0x04 (gone when it holds). */
  hide: [number, number];
}

export const noticeMessage = (row: Uint8Array): number => u32(row, NOTICE_FIELD);
export function setNoticeMessage(row: Uint8Array, id: number): void {
  w32(row, NOTICE_FIELD, id);
}

/** The rows of W01's table that have a notice. */
export function notices(events: EventTable | null | undefined): Notice[] {
  if (!events || events.dungeon !== NOTICE_DUNGEON) return [];
  const out: Notice[] = [];
  for (let row = 1; row < events.rows && row < events.capacity; row++) {
    const r = events.table.row(row);
    const message = noticeMessage(r);
    if (message) out.push({ row, message, show: [r[0x4b]!, u32(r, 0x00)], hide: [r[0x4c]!, u32(r, 0x04)] });
  }
  return out;
}

/**
 * The patch with the notices in a table of 6 words each {row, +0x4B, +0x00, +0x4C, +0x04, message} ended by row 0.
 * - 0x19ABA0 (`b 0x17e08c`, after FUN_0019aa88's pop): to the cave, which calls FUN_0017e08c (r0 = handler, r1 = 4
 *   are still set) and returns its action; when it is 0 and a notice is due, a notice action (0x10 bytes,
 *   FUN_0031b170(obj, 0x1000000), the vtable of 0x4FB8C8 with our [2]).
 * - Due: FUN_0031bff4(0x34, row) == 0, and the row's conditions let it be placed (FUN_0030b8a4 like FUN_001e2ac4).
 * - [2]: for each due notice, a fade to black, the vehicle (FUN_002e592c) or the party (FUN_00319a6c) moved 3 cells
 *   south of the entrance (its object FUN_0031c970(row): entrances keep their row at +0x5E) facing north, a fade
 *   in, FUN_0030cc48(message, 0, 0, 0) (s0 = 0.2, like FUN_001c0630), then the same back to where it was, and
 *   FUN_003048f8(0x34, row, 1). The move is the moving island's (FUN_002c4d98): turning the camera to a far place
 *   leaves the map there unloaded. No object (not on this map) = the message only. [4] (0x31713C) writes nothing
 *   for the pseudo-row.
 */
export function noticePatchSource(list: Notice[]): string {
  const hex = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase()}`;
  const table = list.flatMap((n) => [`  .word ${n.row}                 ; 行`, ...[n.show[0], n.show[1], n.hide[0], n.hide[1], n.message].map((v) => `  .word ${hex(v)}`)]);
  return `; ワールドマップの出現の告知 (W01)。docs/integrations/panana/world-notice.md
; FUN_0019aa88 の W01 の分岐 (pop のあとの末尾呼び出し)
@0x19ABA0
  b wn_hook                  ; b 0x17e08c
@cave world_notice
wn_hook:
  push {r4, lr}
  bl 0x17E08C                ; ゲームのワールドマップの演出
  cmp r0, #0
  bne wh_out
  bl wn_pending
  cmp r0, #0
  beq wh_out
  mov r0, #0x10
  bl FUN_0033d690            ; 確保
  cmp r0, #0
  beq wh_out
  mov r4, r0
  mov r1, #0x1000000         ; 疑似行 (マップに入ったとき)
  bl FUN_0031b170            ; 動作の基底
  ldr r1, =wn_vtable
  str r1, [r4]
  mov r0, r4
wh_out:
  pop {r4, pc}
wn_vtable:
  .word 0
  .word 0x1C0884             ; 後始末 (0x4FB8C8 と同じ)
  .word wn_run
  .word 0x1B0FC8
  .word 0x31713C             ; 完了 (疑似行なので状態は書かない)
  .word 0x43C2CC
  .word 0
  .word 0
; 告知を順に出す (キューのコルーチンの中)
wn_run:
  push {r4, lr}
  ldr r4, =wn_table
wr_loop:
  ldr r0, [r4]
  cmp r0, #0
  beq wr_done
  mov r0, r4
  bl wn_due
  cmp r0, #0
  beq wr_next
  mov r0, r4
  bl wn_show                 ; カメラを入口へ向けてメッセージ
  mov r0, #0x34
  ldr r1, [r4]
  mov r2, #1
  bl FUN_003048f8            ; 告知済み
wr_next:
  add r4, r4, #0x18
  b wr_loop
wr_done:
  pop {r4, pc}
; r0 = 表の 1 件: 暗転してプレイヤー (乗り物) を入口の 3 マス南へ移し、北を向かせてフェードインし、メッセージを出す。
; また暗転して元の位置と向きに戻し、フェードインする。動く島の演出 (FUN_002c4d98) の移し方と、黄泉の門の演出
; (FUN_001c0630) のメッセージの出し方。カメラを遠くへ向けると地形が読み込まれないので、カメラは動かさない
wn_show:
  push {r4, r5, r6, lr}
  sub sp, sp, #0x100         ; +0 カメラ、+0x9C 差分、+0xA8 元の位置、+0xB8 ハンドル、+0xD8 元の向き、+0xE4 移す先、+0xF0 北
  mov r4, r0
  ldr r0, [r4]
  bl FUN_0031c970            ; 入口のオブジェクト (0 = このマップにない)
  movs r5, r0
  beq ws_message
  mov r1, r5
  mov r2, #0
  add r0, sp, #0xb8
  bl FUN_0031c958            ; ハンドル
  bl FUN_002e592c            ; 乗り物 (乗っていなければ 0)
  movs r6, r0
  bne ws_mover
  bl FUN_00319a6c            ; パーティの先頭
  movs r6, r0
  bne ws_mover
  add r0, sp, #0xb8
  bl FUN_0031c89c            ; 動かす物がない: メッセージだけ
  mov r5, #0
  b ws_message
ws_mover:
  ldr r0, [r6, #0x10]        ; 変換ノード: +0x14 位置、+0x2C 向き
  ldr r1, [r0, #0x14]
  str r1, [sp, #0xa8]
  ldr r1, [r0, #0x18]
  str r1, [sp, #0xac]
  ldr r1, [r0, #0x1c]
  str r1, [sp, #0xb0]
  ldr r1, [r0, #0x2c]
  str r1, [sp, #0xd8]
  ldr r1, [r0, #0x30]
  str r1, [sp, #0xdc]
  ldr r1, [r0, #0x34]
  str r1, [sp, #0xe0]
  bl ws_fade_out
  mov r0, sp
  mov r1, #0
  mov r2, #1
  bl FUN_0031b1b4            ; カメラ
  mov r0, sp
  bl FUN_003179b8
  add r0, sp, #0xb8
  bl FUN_0031c948            ; 入口の位置
  mov r1, #0
  str r1, [sp, #0x9c]
  str r1, [sp, #0xa0]
  ldr r1, =0x43960000        ; + (0, 0, 300): 3 マス南
  str r1, [sp, #0xa4]
  add r1, sp, #0x9c
  add r2, sp, #0xe4
  bl FUN_00338450
  ldr r1, [sp, #0xac]        ; 高さは今のまま
  str r1, [sp, #0xe8]
  mov r0, r6
  add r1, sp, #0xe4
  bl FUN_0031b408            ; 位置
  mov r1, #0
  str r1, [sp, #0xf0]
  str r1, [sp, #0xf8]
  ldr r1, =0x40490FDB        ; π: 北を向く
  str r1, [sp, #0xf4]
  mov r0, r6
  add r1, sp, #0xf0
  bl FUN_00331ca8            ; 向き
  bl ws_fade_in
ws_message:
  vldr s0, =0.3
  bl FUN_00300854
  mov r0, #0x2f
  bl FUN_00317524            ; 効果音
  ldr r1, =0x3E4CCCCD        ; 0.2 (FUN_001c0630 と同じ)
  vmov s0, r1
  ldr r0, [r4, #0x14]        ; メッセージ
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_0030cc48            ; 地の文の窓 (閉じるまで待つ)
  vldr s0, =0.3
  bl FUN_003007c0
  cmp r5, #0
  beq ws_out
  bl ws_fade_out
  mov r0, r6
  add r1, sp, #0xa8
  bl FUN_0031b408            ; 元の位置
  mov r0, r6
  add r1, sp, #0xd8
  bl FUN_00331ca8            ; 元の向き
  bl ws_fade_in
  mov r0, sp
  bl FUN_00301764            ; カメラの後始末
  add r0, sp, #0xb8
  bl FUN_0031c89c            ; ハンドルを解放
ws_out:
  add sp, sp, #0x100
  pop {r4, r5, r6, pc}
; 黒へ 1 秒でフェードアウトし、終わるまで待つ
ws_fade_out:
  push {r4, lr}
  mov r0, #0
  mov r1, #0
  mov r2, #0
  mov r3, #2
  bl FUN_003174e8            ; フェードの色
  vldr s0, =1.0
  bl FUN_00300dbc
  pop {r4, pc}
; (呼び元の sp + 8 のカメラ) を移した先へすぐ合わせ、1 秒待って 1 秒でフェードインする
ws_fade_in:
  push {r4, lr}
  add r4, sp, #8             ; 呼び元のカメラ
  mov r0, r4
  vldr s0, =0.0
  bl FUN_002fc19c            ; カメラを追従に (すぐ)
  mov r0, r4
  bl FUN_00301888
  vldr s0, =1.0
  bl FUN_003086e4            ; 1 秒待つ
  mov r0, #2
  vldr s0, =1.0
  bl FUN_0031745c            ; フェードイン
  bl FUN_0031747c            ; 終わるまで待つ
  pop {r4, pc}
; 出すべき告知があるか
wn_pending:
  push {r4, lr}
  ldr r4, =wn_table
wp_loop:
  ldr r0, [r4]
  cmp r0, #0
  beq wp_out
  mov r0, r4
  bl wn_due
  cmp r0, #0
  bne wp_out
  add r4, r4, #0x18
  b wp_loop
wp_out:
  pop {r4, pc}
; r0 = 表の 1 件 → 1 = 出す
wn_due:
  push {r4, lr}
  mov r4, r0
  mov r0, #0x34
  ldr r1, [r4]
  bl FUN_0031bff4            ; 行の状態
  cmp r0, #0
  bne wd_no
  ldr r1, [r4, #0xc]         ; +0x4C (成り立つと消える)
  cmp r1, #0
  beq wd_show
  ldr r0, [r4]
  ldr r2, [r4, #0x10]
  bl FUN_0030b8a4
  ands r0, r0, #0xff
  bne wd_no
wd_show:
  ldr r1, [r4, #4]           ; +0x4B (成り立つと出る)
  cmp r1, #0
  beq wd_yes
  ldr r0, [r4]
  ldr r2, [r4, #8]
  bl FUN_0030b8a4
  ands r0, r0, #0xff
  beq wd_no
wd_yes:
  mov r0, #1
  pop {r4, pc}
wd_no:
  mov r0, #0
  pop {r4, pc}
wn_table:
${table.join('\n')}
  .word 0
`;
}

/** The notice patch for the notices of W01's table, or null when there are none. */
export function noticePatch(events: EventTable | null | undefined): CodePatch | null {
  const list = notices(events);
  return list.length ? { id: NOTICE_PATCH_ID, title: NOTICE_PATCH_TITLE, source: noticePatchSource(list), enabled: true } : null;
}
