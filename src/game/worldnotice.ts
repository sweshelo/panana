// "〇〇が出現した！" on W01: when the world map loads and an entrance that Panana marked has just become visible (its
// W01_EventObject row's conditions hold and the row's state is still 0), the party is warped next to it, the message
// is shown once, the row's state is set to 1 and the party is warped back to where it stood. It also shows for a
// save that already met the conditions, on the first load after the MOD is put in.
// docs/integrations/panana/world-notice.md.
//
// The game has the place for it: every field load queues pseudo-row 0x1000000 ("on entering the map",
// FUN_00198450), and FUN_0019aa88 makes its action per dungeon; W01's branch tail-calls FUN_0017e08c at 0x19ABA0,
// which returns an action for the story's own world-map scenes (e.g. 0x4FB8C8, "[黄泉の門]が開いた！") or 0. The patch
// makes a notice action when that returns 0 and a notice is due. Its [2] runs in the queue's coroutine, so
// FUN_0030cc48 (the narration window; waits until closed) can be called for each notice in turn.
import type { CodePatch } from './patch';
import type { EventTable } from './events';
import { u16, u32, w32 } from '../util/bytes';
import { ENT } from './worldmap';

/** mapGroup row of W01: the only world map with the hook (FUN_0019aa88's branch at 0x19ABA0). */
export const NOTICE_DUNGEON = 0x34;
/** Kind of the rows of conditional entrances that behave as plain entrances (FUN_00319184 / FUN_002daac0). */
export const KIND_ENTRANCE = 0x11;
/** Row field Panana keeps the notice's message ID in (0 = no notice; kind 0x11 rows leave it 0). */
export const NOTICE_FIELD = 0x40;
/**
 * Row field Panana keeps the notice's sound in (a soundData row for FUN_00317524; 0 = none). Kind 0x11 rows leave
 * +0x08..+0x43 unused; +0x44 is the row's state slot (it was kept there before, which broke the notice).
 */
export const NOTICE_SOUND_FIELD = 0x3c;
const OLD_SOUND_FIELD = 0x44;
/** The sound new notices get: ME_GIMMICK, the jingle of "[黄泉の門]が開いた！" (FUN_001c0630). */
export const NOTICE_SOUND_DEFAULT = 0x2f;
/** "[黄泉の門]が開いた！": the game's own narration of a world-map change (FUN_001c0630); new notices copy its kind. */
export const NOTICE_TEMPLATE = 0x1bf6;

export const NOTICE_PATCH_ID = 'world-notice';
export const NOTICE_PATCH_TITLE = 'ワールドマップの出現の告知';

/** W01's map hash (the destination of FUN_00308d44). */
const W01_MAP = 0xa8654391;
/**
 * Where the notice keeps its state across the two loads it warps through: the unused end of .bss's last page
 * (.bss is 0x5E5D3C..0x63F4B4; nothing in code.bin points past it). Not cleared at boot, hence the mark.
 * +0 mark, +4 phase (1 = warped next to the entrance, 2 = warped back), +8 row, +0xC the leader's position, +0x18 its angle (written back to 0x5A[0] / 0x5B[0]).
 */
export const NOTICE_STATE = 0x63ff00;
const NOTICE_MARK = 0x4e574e50; // 'PNWN'

export interface Notice {
  row: number;
  message: number;
  /** soundData row played with the message (0 = none). */
  sound: number;
  /** +0x4B and its value +0x00 (appears when it holds). */
  show: [number, number];
  /** +0x4C and its value +0x04 (gone when it holds). */
  hide: [number, number];
  /** ID of the W01 entrance with this row (+0x10): the party is warped next to it. */
  entrance: number;
}

export const noticeMessage = (row: Uint8Array): number => u32(row, NOTICE_FIELD);
export function setNoticeMessage(row: Uint8Array, id: number): void {
  w32(row, NOTICE_FIELD, id);
}
export const noticeSound = (row: Uint8Array): number => u32(row, NOTICE_SOUND_FIELD);
export function setNoticeSound(row: Uint8Array, sound: number): void {
  w32(row, NOTICE_SOUND_FIELD, sound);
}

/**
 * Rows added before the sound moved to +0x3C had it written over their state slot (+0x44) and model (+0x46): the
 * slot then pointed past the table or at another row's state, so the notice never counted as due. Moves the sound
 * to +0x3C and gives the row a free slot again. Returns the rows fixed.
 */
export function repairNotices(events: EventTable | null | undefined): number[] {
  if (!events || events.dungeon !== NOTICE_DUNGEON) return [];
  const fixed: number[] = [];
  for (let row = 1; row < events.rows; row++) {
    const r = events.table.row(row);
    if (events.originalRow(row) || !noticeMessage(r) || u32(r, NOTICE_SOUND_FIELD)) continue;
    const slot = events.slot(row);
    const shared = Array.from({ length: events.rows }, (_, i) => i).some((i) => i !== row && events.slot(i) === slot);
    if (slot < events.capacity && !shared) continue;
    const free = events.freeSlot();
    if (free < 0) continue;
    w32(r, NOTICE_SOUND_FIELD, u16(r, OLD_SOUND_FIELD));
    w32(r, OLD_SOUND_FIELD, free); // the slot and model 0
    fixed.push(row);
  }
  return fixed;
}

/** The rows of W01's table that have a notice and an entrance (section 2 of W01) to show. */
export function notices(events: EventTable | null | undefined, entrances: readonly Uint8Array[]): Notice[] {
  if (!events || events.dungeon !== NOTICE_DUNGEON) return [];
  const out: Notice[] = [];
  for (let row = 1; row < events.rows && row < events.capacity; row++) {
    const r = events.table.row(row);
    const message = noticeMessage(r);
    const entrance = entrances.find((e) => ENT.event(e) === row);
    if (message && entrance) out.push({ row, message, sound: noticeSound(r), show: [r[0x4b]!, u32(r, 0x00)], hide: [r[0x4c]!, u32(r, 0x04)], entrance: ENT.id(entrance) });
  }
  return out;
}

/**
 * The patch with the notices in a table of 8 words each {row, +0x4B, +0x00, +0x4C, +0x04, message, sound, entrance}
 * ended by row 0.
 * - 0x19ABA0 (`b 0x17e08c`, after FUN_0019aa88's pop): to the cave, which calls FUN_0017e08c (r0 = handler, r1 = 4
 *   are still set) and returns its action; when it is 0, a notice action (0x10 bytes, FUN_0031b170(obj, 0x1000000),
 *   the vtable of 0x4FB8C8 with our [2]) when a notice is due (not while riding: FUN_00303c70, save 0x57 != 0; FUN_002e592c only says a ship is owned) or the party was just warped next to an entrance.
 * - Due: FUN_0031bff4(0x34, row) == 0, and the row's conditions let it be placed (FUN_0030b8a4 like FUN_001e2ac4).
 * - [2], first load: keeps the row and where the party's leader stands (FUN_00319a6c → T = obj+0x10: position
 *   T+0x14, angle T+0x30 after FUN_003063bc(T+0x2C, T+0x38) when T+0x10 bit 3 says quaternion) at NOTICE_STATE.
 *   Save 0x58 / 0x59 are the ship's and 0x51 is 0 after leaving a town, so neither tells where the party is. Then it fades to black and warps next to the entrance like
 *   黄泉の門's scene (FUN_00226064): FUN_00308d44(save, W01, entrance) → FUN_003014f0(4, 0) → FUN_00308bac(0, 0)
 *   (s0 = *0x4D07CC). The map is built at a load, so turning the camera or moving the party far does not show it.
 * - [2], next to the entrance: black at once, the party hidden like FUN_001c0630 does (FUN_0031ba8c(h,
 *   FUN_00319a6c()), FUN_0031c580 / FUN_0031c4bc / FUN_00301500(h, 0)), the follow camera kept (it shows the
 *   entrance's side; a camera pulled back 13 tiles shows tiles past the loaded area), 1 s to load, a fade in, the
 *   sound and FUN_0030cc48(message) (s0 = 0.2, like FUN_001c0630), FUN_003048f8(0x34, row, 1); then black and back:
 *   the kept place written to 0x5A[0] / 0x5B[0] and 0x5A[1..7] = 0 (FUN_003129bc(save, var, i, &v); the walking
 *   party is placed from them by FUN_00401568, members at 0 next to the leader), FUN_00308d44(save+0x404, W01, 0)
 *   and then the byte save+0x404 = 1, as after loading a save on W01 (FUN_00308d44 clears it, and with 0
 *   FUN_001e1fc4 overwrites 0x5A[0] with the default place). 0x58 / 0x59 are the ship's (FUN_004326a8 /
 *   FUN_0043281c) and are left alone.
 * - Back where it was: the phase is cleared; [4] (0x31713C) writes nothing for the pseudo-row.
 */
export function noticePatchSource(list: Notice[]): string {
  const hex = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase()}`;
  const table = list.flatMap((n) => [`  .word ${n.row}                 ; 行`, ...[n.show[0], n.show[1], n.hide[0], n.hide[1], n.message, n.sound, n.entrance].map((v) => `  .word ${hex(v)}`)]);
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
  bl wn_phase
  cmp r0, #1
  beq wh_make                ; 入口の隣に来た
  cmp r0, #2
  bne wh_check
  ldr r1, =${hex(NOTICE_STATE)}     ; 元の場所に戻った
  mov r0, #0
  str r0, [r1, #4]
  b wh_out
wh_check:
  bl FUN_00303c70            ; 乗り物に乗っている (0x57 != 0) 間は出さない
  cmp r0, #0
  movne r0, #0
  bne wh_out
  bl wn_pending
  cmp r0, #0
  beq wh_out
wh_make:
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
; 段階 (目印がなければ 0)
wn_phase:
  ldr r1, =${hex(NOTICE_STATE)}
  ldr r0, [r1]
  ldr r2, =${hex(NOTICE_MARK)}
  cmp r0, r2
  movne r0, #0
  ldreq r0, [r1, #4]
  bx lr
; キューのコルーチンの中: 1 回目は入口の隣へワープ、2 回目は告知して元の場所へワープ
wn_run:
  push {r4, r5, r6, lr}
  ldr r5, =${hex(NOTICE_STATE)}
  bl wn_phase
  cmp r0, #1
  beq wr_there
  ldr r4, =wn_table
wr_find:
  ldr r0, [r4]
  cmp r0, #0
  beq wr_out
  mov r0, r4
  bl wn_due
  cmp r0, #0
  bne wr_go
  add r4, r4, #0x20
  b wr_find
wr_go:
  bl FUN_00319a6c            ; パーティの先頭 (もう着地点にいる)
  cmp r0, #0
  beq wr_out
  ldr r6, [r0, #0x10]        ; 変換 T
  ldr r0, [r6, #0x10]
  tst r0, #8                 ; 四元数なら角度に直す (FUN_0043281c が 0x59 を書く前と同じ)
  addne r0, r6, #0x2c
  addne r1, r6, #0x38
  blne FUN_003063bc
  ldr r0, [r6, #0x14]        ; 今の位置 (セーブの 0x58 は船の位置)
  str r0, [r5, #0xc]
  ldr r0, [r6, #0x18]
  str r0, [r5, #0x10]
  ldr r0, [r6, #0x1c]
  str r0, [r5, #0x14]
  ldr r0, [r6, #0x30]        ; 今の角度 (y)
  str r0, [r5, #0x18]
  ldr r0, =${hex(NOTICE_MARK)}
  str r0, [r5]
  ldr r0, [r4]
  str r0, [r5, #8]           ; 行
  mov r0, #1
  str r0, [r5, #4]
  bl wn_black_out
  bl wn_save
  ldr r1, =${hex(W01_MAP)}
  ldr r2, [r4, #0x1c]        ; 入口の ID: その隣に出る
  bl FUN_00308d44            ; ワープ
  bl wn_switch
  b wr_out
wr_there:
  ldr r4, =wn_table
wr_row:
  ldr r0, [r4]
  cmp r0, #0
  beq wr_reset               ; 表にない (MOD が変わった)
  ldr r1, [r5, #8]
  cmp r0, r1
  beq wr_found
  add r4, r4, #0x20
  b wr_row
wr_found:
  mov r0, r4
  bl wn_due
  cmp r0, #0
  beq wr_back
  mov r0, r4
  bl wn_show                 ; カメラを入口へ向けてメッセージ
  mov r0, #0x34
  ldr r1, [r4]
  mov r2, #1
  bl FUN_003048f8            ; 告知済み
wr_back:
  bl wn_black_out
  ldr r0, =0x564638
  ldr r6, [r0]               ; セーブ
  mov r0, r6
  mov r1, #0x5a              ; 0x5A[0] = 先頭の位置 (歩くパーティ。0x58 / 0x59 は船なので触らない)
  mov r2, #0
  add r3, r5, #0xc
  bl FUN_003129bc
  mov r0, r6
  mov r1, #0x5b              ; 0x5B[0] = 先頭の向き
  mov r2, #0
  add r3, r5, #0x18
  bl FUN_003129bc
  sub sp, sp, #0x10
  mov r0, #0
  str r0, [sp]
  str r0, [sp, #4]
  str r0, [sp, #8]
  mov r4, #1
wb_members:
  mov r0, r6
  mov r1, #0x5a              ; 0x5A[1..7] = 0: 仲間は先頭の位置に置かれる (FUN_00401568)
  mov r2, r4
  mov r3, sp
  bl FUN_003129bc
  add r4, r4, #1
  cmp r4, #8
  blt wb_members
  add sp, sp, #0x10
  add r4, r6, #0x400
  add r4, r4, #4
  mov r0, r4
  ldr r1, =${hex(W01_MAP)}
  mov r2, #0                 ; 地点 0
  bl FUN_00308d44            ; ワープ (セーブ +0x404 のバイトを 0 にする)
  mov r0, #1
  strb r0, [r4]              ; 1 = セーブを読み込んだときと同じく 0x5A に置く (0 だと FUN_001e1fc4 が既定の場所で上書き)
  mov r0, #2
  str r0, [r5, #4]
  bl wn_switch
  b wr_out
wr_reset:
  mov r0, #0
  str r0, [r5, #4]
wr_out:
  pop {r4, r5, r6, pc}
; r0 = *0x564638 + 0x404 (セーブ)
wn_save:
  ldr r0, =0x564638
  ldr r0, [r0]
  add r0, r0, #0x400
  add r0, r0, #4
  bx lr
; シーンを切り替える (黄泉の門の FUN_00226064 と同じ)
wn_switch:
  push {r4, lr}
  mov r0, #4                 ; フィールド
  mov r1, #0
  bl FUN_003014f0
  ldr r0, =0x4D07CC          ; 0.3 秒
  vldr s0, [r0]
  mov r0, #0
  mov r1, #0
  bl FUN_00308bac
  pop {r4, pc}
; 黒へ 0.5 秒でフェードアウトし、終わるまで待つ
wn_black_out:
  push {r4, lr}
  mov r0, #0
  mov r1, #0
  mov r2, #0
  mov r3, #2
  bl FUN_003174e8            ; フェードの色
  vldr s0, =0.5
  bl FUN_00300dbc
  pop {r4, pc}
; r0 = 表の 1 件 (入口の隣に来たところ): すぐ黒にし、パーティを隠し (黄泉の門の FUN_001c0630 と同じ)、追従カメラの
; まま (入口の隣を写す) 待ってからフェードインして効果音とメッセージを出す。このあと元の場所へワープするので戻さない
wn_show:
  push {r4, r5, r6, lr}
  sub sp, sp, #0x30          ; +0 パーティのハンドル (0x2C)
  mov r4, r0
  mov r0, #0
  mov r1, #0
  mov r2, #0
  mov r3, #2
  bl FUN_003174e8
  vldr s0, =0.0
  mov r0, #2
  bl FUN_003174c8            ; すぐ黒
  bl FUN_00319a6c            ; パーティ
  mov r1, r0
  mov r0, sp
  bl FUN_0031ba8c            ; ハンドル
  mov r0, sp
  mov r1, #0
  bl FUN_0031c580            ; 隠す
  mov r0, sp
  mov r1, #0
  bl FUN_0031c4bc
  mov r0, sp
  mov r1, #0
  bl FUN_00301500
  vldr s0, =1.0
  bl FUN_003086e4            ; 地形の読み込みを待つ (黄泉の門は 0.5 秒)
  mov r0, #2
  vldr s0, =1.0
  bl FUN_0031745c            ; フェードイン
  bl FUN_0031747c            ; 終わるまで待つ
  vldr s0, =0.3
  bl FUN_00300854
  ldr r0, [r4, #0x18]        ; 効果音 (soundData の行、0 = 鳴らさない)
  cmp r0, #0
  blne FUN_00317524
  ldr r1, =0x3E4CCCCD        ; 0.2 (FUN_001c0630 と同じ)
  vmov s0, r1
  ldr r0, [r4, #0x14]        ; メッセージ
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_0030cc48            ; 地の文の窓 (閉じるまで待つ)
  vldr s0, =0.3
  bl FUN_003007c0
  mov r0, sp
  bl FUN_0031b67c            ; ハンドルを解放 (FUN_001c0630 と同じく最後に。表示は戻さない)
  add sp, sp, #0x30
  pop {r4, r5, r6, pc}
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
  add r4, r4, #0x20
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

/** The notice patch for the notices of W01's table (with W01's entrances), or null when there are none. */
export function noticePatch(events: EventTable | null | undefined, entrances: readonly Uint8Array[]): CodePatch | null {
  const list = notices(events, entrances);
  return list.length ? { id: NOTICE_PATCH_ID, title: NOTICE_PATCH_TITLE, source: noticePatchSource(list), enabled: true } : null;
}
