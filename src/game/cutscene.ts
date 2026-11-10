// Scripted events (演出): a list of commands run when a boss row's range is entered, before its battle (or alone,
// with no battle). The commands make the hero / the party / an event's object walk, turn and animate, show the
// lines of a speaker, move the camera, fade and play sounds — the parts the game's own pre-boss scripts are built
// from (docs/kahara/cutscene.md). The game has no such data: the commands are interpreted by Panana's code patch
// (CUTSCENE_SOURCE, part of the boss patch, docs/integrations/panana/event-mods.md §9).
//
// Storage: a stage of a boss row (game/boss.ts) with the STAGE_SCRIPT flag keeps, at its arguments +4 / +6, the
// first "data row" and the number of data rows. A data row is an EventObject row of the same dungeon that no map
// places: +0x00..+0x3F hold 8 commands of 8 bytes, +0x40 the mark "PNCS", +0x44 the owner's state slot (so it uses
// no slot of its own), +0x4D = 0 (no action). The data rows of a script are consecutive.
import { u16, u32, w16, w32 } from '../util/bytes';
import type { EventTable } from './events';

export const OP = {
  END: 0,
  /** Speaker (actor) says message p: speaker plays animation `arg` (0: hero 0x1F) and q after (0: hero 1). */
  MSG: 1,
  /** Actor walks to fine coordinates (p, q) in arg × 0.1 s (0: by distance). The party moves together. */
  WALK: 2,
  /** Actor turns to direction arg (0 S, 1 E, 2 N, 3 W) in p × 0.1 s (0: 0.3 s). */
  TURN: 3,
  /** Actor plays animation p (arg = 1: loop). The party: every member. */
  ANIM: 4,
  /** Wait p × 0.1 s. */
  WAIT: 5,
  /** Sound effect p (soundData row). */
  SE: 6,
  /** A mark over the actor's head (arg = mark 0..4, with sound 0x66), shown 0.7 s. */
  MARK: 7,
  /** Camera to the actor (or to fine coordinates (p, q) when there is no actor) in arg × 0.1 s (0: at once). */
  CAMERA: 8,
  /** Camera back to the hero in arg × 0.1 s (0: 1.5 s). */
  CAMERA_BACK: 9,
  /** Fade out (arg = 0) / in (arg = 1) in p × 0.1 s (0: 0.5 s). */
  FADE: 10,
  /** Put the actor at fine coordinates (p, q) at once, facing arg (0 S, 1 E, 2 N, 3 W; the party only). */
  PLACE: 11,
} as const;
export type Op = (typeof OP)[keyof typeof OP];

/** Actor ids (command +2). Others: an EventObject row of the dungeon (its object on the map). */
export const ACTOR_NONE = 0;
export const ACTOR_HERO = 0xffff;
export const ACTOR_PARTY = 0xfffe;

export interface Command {
  op: number;
  arg: number;
  actor: number;
  /** +4 (u16 / s16): message, animation, time, sound, x. */
  p: number;
  /** +6 (u16 / s16): animation after, y. */
  q: number;
}

export const CMD_SIZE = 8;
export const CMDS_PER_ROW = 8;
export const DATA_MARK = 0x53434e50; // "PNCS"
export const DATA_MARK_AT = 0x40;

/** Ops whose p / q are signed fine coordinates. */
const SIGNED_PQ = new Set<number>([OP.WALK, OP.CAMERA, OP.PLACE]);

export function decodeCommand(b: Uint8Array, at: number): Command {
  const op = b[at]!;
  const p = u16(b, at + 4),
    q = u16(b, at + 6);
  const s = SIGNED_PQ.has(op);
  return { op, arg: b[at + 1]!, actor: u16(b, at + 2), p: s ? (p << 16) >> 16 : p, q: s ? (q << 16) >> 16 : q };
}

export function encodeCommand(b: Uint8Array, at: number, c: Command): void {
  b[at] = c.op & 0xff;
  b[at + 1] = c.arg & 0xff;
  w16(b, at + 2, c.actor & 0xffff);
  w16(b, at + 4, c.p & 0xffff);
  w16(b, at + 6, c.q & 0xffff);
}

export function isDataRow(row: Uint8Array): boolean {
  return u32(row, DATA_MARK_AT) === DATA_MARK && row[0x4d] === 0 && row[0x4e] === 0 && row[0x4f] === 0;
}

export function rowsFor(commands: number): number {
  return Math.max(1, Math.ceil((commands + 1) / CMDS_PER_ROW)); // + the END
}

/** The commands kept in `count` data rows from `first` (up to the first END). */
export function readCommands(ev: EventTable, first: number, count: number): Command[] {
  const out: Command[] = [];
  for (let k = 0; k < count; k++) {
    if (!ev.has(first + k)) break;
    const r = ev.table.row(first + k);
    for (let i = 0; i < CMDS_PER_ROW; i++) {
      const c = decodeCommand(r, i * CMD_SIZE);
      if (c.op === OP.END) return out;
      out.push(c);
    }
  }
  return out;
}

/** Fill data rows from `first` with the commands and an END. */
export function writeCommands(ev: EventTable, first: number, count: number, cmds: Command[], slot: number): void {
  if (rowsFor(cmds.length) > count) throw new Error('演出の行が足りません');
  for (let k = 0; k < count; k++) {
    const r = ev.table.row(first + k);
    r.fill(0);
    w32(r, DATA_MARK_AT, DATA_MARK);
    w16(r, 0x44, slot);
    for (let i = 0; i < CMDS_PER_ROW; i++) {
      const c = cmds[k * CMDS_PER_ROW + i];
      if (c) encodeCommand(r, i * CMD_SIZE, c);
    }
  }
}

/** A blank data row (no slot of its own). */
export function dataRow(size: number, slot: number): Uint8Array {
  const r = new Uint8Array(size);
  w32(r, DATA_MARK_AT, DATA_MARK);
  w16(r, 0x44, slot);
  return r;
}

/**
 * Rows the script needs that the table can still take: data rows use no state slot, but rows stay below the
 * dungeon's capacity (mapGroup +0x1C) like every other row Panana adds.
 */
export function dataRoomLeft(ev: EventTable): number {
  return Math.max(0, ev.capacity - ev.rows);
}

/** Append `n` data rows; returns the first. Throws when the dungeon has no room. */
export function addDataRows(ev: EventTable, n: number, slot: number): number {
  if (dataRoomLeft(ev) < n)
    throw new Error(`このダンジョンのイベントの行は ${ev.capacity} 行までです (演出に ${n} 行要ります)`);
  const first = ev.rows;
  for (let k = 0; k < n; k++) ev.table.append(dataRow(ev.table.rowSize, slot));
  return first;
}

// Ranges (section 8, docs/kahara/cutscene.md §1) -------------------------------------------------------------------

/** +0x0A: the range's size in world units (500 = a cell). */
export const RANGE_SIZES = [200, 400, 600, 800, 1000];
export const RANGE_SIZE_AT = 0x0a;
/** +0x0B: 1 = when the hero is inside (every frame), 0 = when the hero examines the point 80 in front (A button). */
export const RANGE_MODE_AT = 0x0b;
/** +0x0C (low byte): 0 = a sphere of diameter = size, else an axis-aligned square of side = size. */
export const RANGE_SHAPE_AT = 0x0c;

export interface RangeInfo {
  /** World units (0 = the range never fires). */
  size: number;
  square: boolean;
  /** Fires when the hero steps in (vs. when the hero examines it). */
  step: boolean;
}

export function rangeInfo(raw: Uint8Array): RangeInfo {
  return {
    size: RANGE_SIZES[raw[RANGE_SIZE_AT]!] ?? 0,
    square: raw[RANGE_SHAPE_AT] !== 0,
    step: raw[RANGE_MODE_AT] === 1,
  };
}

/** Fine coordinate (sections 4 / 5 / 8) -> world. */
export const fineToWorld = (v: number): number => 50 + v * 100;

// The interpreter --------------------------------------------------------------------------------------------------
// cs_run(r0 = the boss action, r1 = the stage's arguments), called from the action's [2] (boss_run, in the event's
// coroutine, so the waiting helpers can be used). Frame (sl = sp): +0x00 outgoing arguments, +0x10 camera (0x9C),
// +0xB0 the hero's actor handle, +0xD0 a row object's actor handle, +0xEC the current actor's object, +0xF0 / +0x100 /
// +0x110 vectors, +0x120 the party's handles (8 x 0x1C), +0x200 party size, +0x204 faded out.
// Registers: r4 action, r5 command, r6 data rows left, r7 actor handle (0 = none), r8 camera taken, sb = r7 is the
// row handle (release after the command), fp = command in the row.
export const CUTSCENE_SOURCE = `; 演出 (docs/integrations/panana/event-mods.md §9、docs/kahara/cutscene.md)。ボス戦の段階の +2 bit1
@cave cutscene
cs_run:
  push {r3, r4, r5, r6, r7, r8, r9, r10, r11, lr}
  vpush {d8}                 ; s16 (フェードの秒)
  sub sp, sp, #0x210
  mov sl, sp
  mov r4, r0
  ldr r2, [r4, #0x18]        ; この行 (EventObject) の先頭
  ldrh r3, [r1, #4]          ; 演出の最初の行
  ldr r0, [r4, #4]
  sub r3, r3, r0
  mov r0, #0x50
  mla r5, r3, r0, r2         ; 演出の行の先頭 (行は 0x50 バイトずつ並ぶ)
  ldrh r6, [r1, #6]          ; 行の数
  mov fp, #0
  mov r8, #0
  mov r0, #0
  str r0, [sl, #0x204]
  bl FUN_003024f8            ; 操作を止める
  bl FUN_00319a6c            ; 主人公
  mov r1, r0
  add r0, sl, #0xb0
  bl FUN_0031ba8c            ; 主人公のハンドル
cs_loop:
  cmp r6, #0
  beq cs_end
  ldrb r0, [r5]
  cmp r0, #0
  beq cs_end
  ldrh r0, [r5, #2]
  bl cs_handle
  mov r7, r0
  mov sb, r1
  ldrb r0, [r5]
  cmp r0, #1
  beq cs_msg
  cmp r0, #2
  beq cs_walk
  cmp r0, #3
  beq cs_turn
  cmp r0, #4
  beq cs_anim
  cmp r0, #5
  beq cs_wait
  cmp r0, #6
  beq cs_se
  cmp r0, #7
  beq cs_mark
  cmp r0, #8
  beq cs_cam
  cmp r0, #9
  beq cs_camback
  cmp r0, #10
  beq cs_fade
  cmp r0, #11
  beq cs_place
cs_next:
  cmp sb, #0
  beq cn_step
  add r0, sl, #0xd0
  bl FUN_0031b67c            ; 行のオブジェクトのハンドルを解放
cn_step:
  add r5, r5, #8
  add fp, fp, #1
  cmp fp, #8
  bne cs_loop
  mov fp, #0
  add r5, r5, #0x10          ; 次の行 (+0x40〜+0x4F は飛ばす)
  sub r6, r6, #1
  b cs_loop
cs_end:
  ldr r0, [sl, #0x204]
  cmp r0, #0
  beq ce_cam
  mov r0, #2
  vldr s0, =0.3
  bl FUN_0031745c            ; 暗いままならフェードイン
  bl FUN_0031747c
ce_cam:
  cmp r8, #0
  beq ce_ctl
  add r0, sl, #0x10
  mov r1, #3
  mov r2, #0
  vldr s0, =1.0
  bl FUN_00301a44            ; カメラを主人公へ戻す
  add r0, sl, #0x10
  bl FUN_00301d9c
  add r0, sl, #0x10
  bl FUN_00301888            ; 追従に戻す
  add r0, sl, #0x10
  bl FUN_00301764            ; カメラの後始末
ce_ctl:
  add r0, sl, #0xb0
  bl FUN_0031b67c
  mov r0, #1
  bl FUN_003024f8            ; 操作を戻す
  add sp, sp, #0x210
  vpop {d8}
  pop {r3, r4, r5, r6, r7, r8, r9, r10, r11, pc}

; セリフ: 話者 (r7) に話すアニメ → メッセージ (ボタンで閉じる) → あとのアニメ
cs_msg:
  cmp r7, #0
  beq cm_say
  ldrb r1, [r5, #1]
  cmp r1, #0
  bne cm_anim
  add r0, sl, #0xb0
  cmp r7, r0
  bne cm_say
  mov r1, #0x1f              ; 主人公の話すアニメ
cm_anim:
  mov r0, r7
  mov r2, #1
  vldr s0, =1.0
  vldr s1, =0.0
  bl FUN_0030cca4
cm_say:
  ldrh r0, [r5, #4]
  mov r1, #0
  mov r2, #0
  mov r3, #0
  vldr s0, =0.2
  bl FUN_00310798            ; メッセージ (閉じるまで待つ)
  cmp r7, #0
  beq cs_next
  ldrh r1, [r5, #6]
  cmp r1, #0
  bne cm_after
  add r0, sl, #0xb0
  cmp r7, r0
  bne cs_next
  mov r1, #1                 ; 主人公は立ち姿に戻す
cm_after:
  mov r0, r7
  mov r2, #1
  vldr s0, =1.0
  vldr s1, =0.0
  bl FUN_0030cca4
  b cs_next

@cave cutscene_walk
; 歩く: 主人公・行のオブジェクトはそれだけ、パーティは先頭と同じだけ全員が動く
cs_walk:
  cmp r7, #0
  beq cs_next
  ldr r0, [sl, #0xec]
  add r1, sl, #0x100
  bl cs_objpos               ; 行き先 = 今の位置 (高さはそのまま)
  ldrsh r0, [r5, #4]
  bl cs_world
  vstr s0, [sl, #0x100]
  ldrsh r0, [r5, #6]
  bl cs_world
  vstr s0, [sl, #0x108]
  ldrh r0, [r5, #2]
  ldr r1, =0xFFFE
  cmp r0, r1
  beq cw_party
  add r0, sl, #0xb0
  subs r2, r7, r0
  movne r2, #0
  moveq r2, #1               ; 主人公は歩くアニメ
  mov r0, r7
  add r1, sl, #0x100
  bl cs_move
  mov r0, r7
  bl FUN_00308068            ; 着くまで待つ
  add r0, sl, #0xb0
  cmp r7, r0
  bne cs_next
  mov r0, r7
  mov r1, #1
  bl cs_anim1
  b cs_next
cw_party:
  ldr r0, [sl, #0xec]
  add r1, sl, #0xf0
  bl cs_objpos               ; 先頭の位置
  vldr s0, [sl, #0x100]
  vldr s1, [sl, #0xf0]
  vsub.f32 s0, s0, s1
  vstr s0, [sl, #0x110]      ; 差 x
  vldr s0, [sl, #0x108]
  vldr s1, [sl, #0xf8]
  vsub.f32 s0, s0, s1
  vstr s0, [sl, #0x118]      ; 差 z
  bl FUN_0031bb10            ; 人数
  cmp r0, #8
  movhi r0, #8
  str r0, [sl, #0x200]
  mov r7, #0
cwp_start:
  ldr r0, [sl, #0x200]
  cmp r7, r0
  bge cwp_wait
  mov r0, r7
  bl FUN_00303db0            ; i 人目
  mov r9, r0
  mov r1, r0
  bl cs_party_handle
  bl FUN_0031ba8c
  mov r0, r9
  add r1, sl, #0xf0
  bl cs_objpos
  vldr s0, [sl, #0xf0]
  vldr s1, [sl, #0x110]
  vadd.f32 s0, s0, s1
  vstr s0, [sl, #0xf0]
  vldr s0, [sl, #0xf8]
  vldr s1, [sl, #0x118]
  vadd.f32 s0, s0, s1
  vstr s0, [sl, #0xf8]
  bl cs_party_handle
  add r1, sl, #0xf0
  mov r2, #1
  bl cs_move
  add r7, r7, #1
  b cwp_start
cwp_wait:
  mov r7, #0
cwp_wait_loop:
  ldr r0, [sl, #0x200]
  cmp r7, r0
  bge cwp_done
  bl cs_party_handle
  bl FUN_00308068            ; 着くまで待つ
  bl cs_party_handle
  mov r1, #1
  bl cs_anim1                ; 立ち姿
  bl cs_party_handle
  bl FUN_0031b67c
  add r7, r7, #1
  b cwp_wait_loop
cwp_done:
  mov sb, #0
  b cs_next

@cave cutscene_turn
; 向く: 0 南、1 東、2 北、3 西
cs_turn:
  cmp r7, #0
  beq cs_next
  ldrh r0, [r5, #4]
  cmp r0, #0
  moveq r0, #3
  bl cs_tenths
  vmov s1, s0                ; 秒
  ldrb r0, [r5, #1]
  and r0, r0, #3
  vmov s0, r0
  vcvt.f32.s32 s0, s0
  vldr s2, =1.5707964
  vmul.f32 s0, s0, s2        ; 角度
  mov r0, #1
  str r0, [sp]               ; 近い回り
  mov r0, r7
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_00319a7c
  mov r0, r7
  bl FUN_00308068
  b cs_next

; アニメ: p = アニメ、arg = くり返す
cs_anim:
  ldrh r0, [r5, #2]
  ldr r1, =0xFFFE
  cmp r0, r1
  beq ca_party
  cmp r7, #0
  beq cs_next
  mov r0, r7
  ldrh r1, [r5, #4]
  ldrb r2, [r5, #1]
  vldr s0, =1.0
  vldr s1, =0.0
  bl FUN_0030cca4
  b cs_next
ca_party:
  ldrh r0, [r5, #4]
  ldrb r1, [r5, #1]
  mov r2, #0
  mov r3, #1
  vldr s0, =1.0
  vldr s1, =0.0
  bl FUN_0030250c            ; パーティ全員
  b cs_next

cs_wait:
  ldrh r0, [r5, #4]
  bl cs_tenths
  bl FUN_003086e4
  b cs_next

cs_se:
  ldrh r0, [r5, #4]
  bl FUN_00317524
  b cs_next

; 頭上のマーク (組 2、番号 arg) を 0.7 秒
cs_mark:
  cmp r7, #0
  beq cs_next
  mov r0, #0x66
  bl FUN_00317524
  mov r0, #0
  str r0, [sl, #0xf0]
  str r0, [sl, #0xf8]
  ldr r0, =0x43340000        ; 180.0
  str r0, [sl, #0xf4]
  add r0, sl, #0xf0
  str r0, [sp]
  mov r0, r7
  mov r1, #2
  ldrb r2, [r5, #1]
  mov r3, #1
  vldr s0, =0.7
  bl FUN_0031bc08
  vldr s0, =0.7
  bl FUN_003086e4
  add r0, sl, #0xf0
  str r0, [sp]
  mov r0, r7
  mov r1, #2
  ldrb r2, [r5, #1]
  mov r3, #0
  vldr s0, =0.0
  bl FUN_0031bc08            ; 消す
  b cs_next

@cave cutscene_camera
; カメラ: 対象 (なければ座標) + (0, 50, 0) を注視点、+ (0, 1187.5, 1300) を視点に (汎用スイッチと同じ)
cs_cam:
  cmp r8, #0
  bleq cs_camtake
  mov r8, #1
  cmp r7, #0
  beq cc_point
  ldr r0, [sl, #0xec]
  add r1, sl, #0xf0
  bl cs_objpos
  b cc_go
cc_point:
  mov r0, #0
  str r0, [sl, #0xf4]
  ldrsh r0, [r5, #4]
  bl cs_world
  vstr s0, [sl, #0xf0]
  ldrsh r0, [r5, #6]
  bl cs_world
  vstr s0, [sl, #0xf8]
cc_go:
  vldr s0, [sl, #0xf0]
  vstr s0, [sl, #0x100]
  vstr s0, [sl, #0x110]
  vldr s1, [sl, #0xf4]
  vldr s2, =50.0
  vadd.f32 s2, s1, s2
  vstr s2, [sl, #0x104]      ; 注視点
  vldr s2, =1187.5
  vadd.f32 s2, s1, s2
  vstr s2, [sl, #0x114]      ; 視点
  vldr s1, [sl, #0xf8]
  vstr s1, [sl, #0x108]
  vldr s2, =1300.0
  vadd.f32 s2, s1, s2
  vstr s2, [sl, #0x118]
  ldrb r0, [r5, #1]
  bl cs_tenths
  add r0, sl, #0x10
  add r1, sl, #0x110
  add r2, sl, #0x100
  mov r3, #3
  bl FUN_00317210
  add r0, sl, #0x10
  bl FUN_00301d9c            ; 着くまで待つ
  b cs_next

cs_camback:
  cmp r8, #0
  beq cs_next
  ldrb r0, [r5, #1]
  cmp r0, #0
  moveq r0, #15
  bl cs_tenths
  add r0, sl, #0x10
  mov r1, #3
  mov r2, #0
  bl FUN_00301a44
  add r0, sl, #0x10
  bl FUN_00301d9c
  b cs_next

cs_fade:
  ldrh r0, [r5, #4]
  cmp r0, #0
  moveq r0, #5
  bl cs_tenths
  vmov s16, s0
  ldrb r0, [r5, #1]
  cmp r0, #0
  bne cf_in
  mov r0, #1
  str r0, [sl, #0x204]
  mov r1, #0
  mov r2, #0
  mov r3, #2
  mov r0, #0
  bl FUN_003174e8            ; 黒
  vmov s0, s16
  bl FUN_00300dbc            ; フェードアウトして待つ
  b cs_next
cf_in:
  mov r0, #0
  str r0, [sl, #0x204]
  mov r0, #2
  vmov s0, s16
  bl FUN_0031745c
  bl FUN_0031747c
  b cs_next

; その場に置く: パーティは隊列で (FUN_0030150c)、行のオブジェクトはそれだけ
cs_place:
  cmp r7, #0
  beq cs_next
  ldr r0, [sl, #0xec]
  add r1, sl, #0xf0
  bl cs_objpos
  ldrsh r0, [r5, #4]
  bl cs_world
  vstr s0, [sl, #0xf0]
  ldrsh r0, [r5, #6]
  bl cs_world
  vstr s0, [sl, #0xf8]
  cmp sb, #0
  bne cp_object
  add r0, sl, #0xf0
  ldrb r1, [r5, #1]
  and r1, r1, #3
  eor r1, r1, #1             ; 0 南 1 東 2 北 3 西 → FUN_0030150c の 1 0 3 2
  mov r2, #1
  mov r3, #1
  vldr s0, =100.0
  bl FUN_0030150c
  b cs_next
cp_object:
  ldr r0, [sl, #0xec]
  add r1, sl, #0xf0
  bl FUN_0031b408
  b cs_next

@cave cutscene_helpers
; ---- 下請け (sl = 演出のフレーム)
; r0 = 役者の番号 → r0 = ハンドル (0 = いない)、r1 = 1 なら行のオブジェクト (あとで解放)、[sl + 0xEC] = オブジェクト
cs_handle:
  push {r4, lr}
  cmp r0, #0
  beq ch_none
  ldr r1, =0xFFFE
  cmp r0, r1
  bhs ch_hero                ; 主人公・パーティ
  bl FUN_0031c970            ; 行のオブジェクト (このマップになければ 0)
  cmp r0, #0
  beq ch_none
  str r0, [sl, #0xec]
  mov r1, r0
  add r0, sl, #0xd0
  bl FUN_0031ba8c
  add r0, sl, #0xd0
  mov r1, #1
  pop {r4, pc}
ch_hero:
  bl FUN_00319a6c
  str r0, [sl, #0xec]
  add r0, sl, #0xb0
  mov r1, #0
  pop {r4, pc}
ch_none:
  mov r0, #0
  mov r1, #0
  pop {r4, pc}
; r7 番目のパーティのハンドル → r0
cs_party_handle:
  mov r0, #0x1c
  mul r0, r7, r0
  add r0, r0, #0x120
  add r0, sl, r0
  bx lr
; r0 = オブジェクト、r1 = 出力 (f32 x 3): 変換ノード +0x14 の位置
cs_objpos:
  ldr r0, [r0, #0x10]
  ldr r2, [r0, #0x14]
  str r2, [r1]
  ldr r2, [r0, #0x18]
  str r2, [r1, #4]
  ldr r2, [r0, #0x1c]
  str r2, [r1, #8]
  bx lr
; r0 = 細かい座標 → s0 = ワールド (50 + 値 × 100)
cs_world:
  mov r1, #100
  mul r0, r1, r0
  add r0, r0, #50
  vmov s0, r0
  vcvt.f32.s32 s0, s0
  bx lr
; r0 = 0.1 秒の数 → s0 = 秒
cs_tenths:
  vmov s0, r0
  vcvt.f32.s32 s0, s0
  vldr s1, =0.1
  vmul.f32 s0, s0, s1
  bx lr
; r0 = ハンドル、r1 = アニメ: くり返しで再生
cs_anim1:
  push {r4, lr}
  mov r2, #1
  vldr s0, =1.0
  vldr s1, =0.0
  bl FUN_0030cca4
  pop {r4, pc}
; r0 = ハンドル、r1 = 行き先、r2 = 1 なら歩くアニメ。時間は命令の arg (0 = 距離から)
cs_move:
  push {r4, r5, r6, lr}
  sub sp, sp, #8
  mov r4, r0
  mov r6, r1
  cmp r2, #0
  beq cmv_go
  bl FUN_00305f98            ; 浮くキャラなら 0x26
  cmp r0, #0
  mov r1, #3
  movne r1, #0x26
  mov r0, r4
  bl cs_anim1
cmv_go:
  ldrb r0, [r5, #1]
  bl cs_tenths
  vldr s1, =0.0
  mov r0, #0
  str r0, [sp]
  mov r0, r4
  mov r1, r6
  mov r2, #0
  mov r3, #0
  bl FUN_003080e4            ; 動かす (待たない)
  add sp, sp, #8
  pop {r4, r5, r6, pc}
; カメラを作って制御を取る (最初のカメラの命令で)
cs_camtake:
  push {r4, lr}
  add r0, sl, #0x10
  mov r1, #0
  mov r2, #1
  bl FUN_0031b1b4
  add r0, sl, #0x10
  bl FUN_003179b8
  add r0, sl, #0x10
  bl FUN_00301f80
  pop {r4, pc}
`;
