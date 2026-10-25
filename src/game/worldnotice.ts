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
 * - [2]: for each due notice, FUN_0030cc48(message, 0, 0, 0) (s0 = 0.2, like FUN_001c0630), then
 *   FUN_003048f8(0x34, row, 1). [4] (0x31713C) writes nothing for the pseudo-row.
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
  ldr r1, =0x3E4CCCCD        ; 0.2 (FUN_001c0630 と同じ)
  vmov s0, r1
  ldr r0, [r4, #0x14]        ; メッセージ
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_0030cc48            ; 地の文の窓 (閉じるまで待つ)
  mov r0, #0x34
  ldr r1, [r4]
  mov r2, #1
  bl FUN_003048f8            ; 告知済み
wr_next:
  add r4, r4, #0x18
  b wr_loop
wr_done:
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
