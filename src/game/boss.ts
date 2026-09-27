// Boss battles (issue #43): EventObject kind 0x31, placed in an event range (section 8). Entering the range shows up
// to three messages and starts a fixed battle (a monsterFixGroup row); winning moves the row's state on, so the next
// stage (+0x4E / +0x4F, like the game's own multi-state events) or nothing comes next time. docs/events.md §8.
//
// The kind needs a code patch, which Panana adds to code.ips itself when a boss row exists (BOSS_PATCH below).
import type { Master } from './master';
import { u16, u32, w16, w32 } from '../util/bytes';
import type { CodePatch } from './patch';
import type { EventTable } from './events';

export const KIND_BOSS = 0x31;
/** monsterFixGroup (56562135): +0 u32 flags, +4 5 x {u16 monster, u8 count code, u8 (0xD0)}. */
export const FIX_TABLE = 'monsterFixGroup.bin';
export const FIX_SLOTS = 5;
/** Flags of the vanilla boss rows (bit0: FUN_002fc790 sets battle +0x3F9 / +0x3FA; the others are unknown). */
export const FIX_FLAGS_BOSS = 0x341;
/** Battle BGM of the boss scripts (soundData rows 27 / 28 / 29 = BGM_BATTLE_*). */
export const BOSS_BGMS = [0x1b, 0x1c, 0x1d];
export const BOSS_BGM_DEFAULT = 0x1c;

/** Stage n (0..2) is the action of +0x4D / +0x4E / +0x4F with its arguments at +0x08 / +0x1C / +0x30. */
export const STAGE_KIND = [0x4d, 0x4e, 0x4f];
export const STAGE_ARGS = [0x08, 0x1c, 0x30];
export const MAX_STAGES = 3;
/** Stage flags (args +2). */
export const STAGE_REPEAT = 1;

/** Arguments of a stage (0x14 bytes at STAGE_ARGS[n]). */
export interface BossStage {
  /** monsterFixGroup row (1..255). */
  fix: number;
  /** soundData row of the battle BGM (0 = BOSS_BGM_DEFAULT). */
  bgm: number;
  /** Don't record the win: the stage comes back every time. */
  repeat: boolean;
  /** Messages shown before the battle (0 = none). */
  messages: [number, number, number];
}

export function readStages(row: Uint8Array): BossStage[] {
  const out: BossStage[] = [];
  for (let n = 0; n < MAX_STAGES && row[STAGE_KIND[n]!] === KIND_BOSS; n++) {
    const a = STAGE_ARGS[n]!;
    out.push({ fix: row[a]!, bgm: row[a + 1]!, repeat: !!(row[a + 2]! & STAGE_REPEAT), messages: [u32(row, a + 4), u32(row, a + 8), u32(row, a + 12)] });
  }
  return out;
}

/** Write the stages (1..3) of a boss row; the kinds of unused stages are cleared. */
export function writeStages(row: Uint8Array, stages: BossStage[]): void {
  if (!stages.length || stages.length > MAX_STAGES) throw new Error(`ボス戦の段階は 1〜${MAX_STAGES} 個です`);
  for (let n = 0; n < MAX_STAGES; n++) {
    const a = STAGE_ARGS[n]!;
    const s = stages[n];
    row.fill(0, a, a + 0x14);
    row[STAGE_KIND[n]!] = s ? KIND_BOSS : 0;
    if (!s) continue;
    row[a] = s.fix & 0xff;
    row[a + 1] = s.bgm & 0xff;
    row[a + 2] = s.repeat ? STAGE_REPEAT : 0;
    s.messages.forEach((m, i) => w32(row, a + 4 + i * 4, m));
  }
}

/** A new boss row: one stage (the row template's other fields are kept, e.g. its conditions). */
export function newBossRow(size: number, fix: number): Uint8Array {
  const row = new Uint8Array(size);
  writeStages(row, [{ fix, bgm: BOSS_BGM_DEFAULT, repeat: false, messages: [0, 0, 0] }]);
  return row;
}

/**
 * Section-8 record of a new boss range: {row, x, y} + the bytes of the vanilla battle ranges (kind 9, e.g. the
 * D05F01003 Pawn battle and F07OUT000): +8 = 9, +9 = 2, +10 = 1, +11 = 1.
 */
export function newBossRecord(row: number): Uint8Array {
  const raw = new Uint8Array(16);
  w32(raw, 0, row);
  raw.set([9, 2, 1, 1], 8);
  return raw;
}

// monsterFixGroup ---------------------------------------------------------------------------------------------

export interface FixSlot {
  monster: number;
  /** Count code (monsters.ts countLabel: 0..3 = 1..4, 4 = 8, 5.. = random). */
  count: number;
}

export interface FixGroup {
  flags: number;
  slots: FixSlot[];
}

/** A monsterFixGroup row: the slots up to the first empty one (FUN_00190b6c stops there). */
export function decodeFix(r: Uint8Array): FixGroup {
  const slots: FixSlot[] = [];
  for (let k = 0; k < FIX_SLOTS; k++) {
    const monster = u16(r, 4 + k * 4);
    if (!monster) break;
    slots.push({ monster, count: r[6 + k * 4]! });
  }
  return { flags: u32(r, 0), slots };
}

export function encodeFix(r: Uint8Array, g: FixGroup): void {
  if (g.slots.length > FIX_SLOTS) throw new Error(`固定の組のモンスターは ${FIX_SLOTS} 体までです`);
  w32(r, 0, g.flags);
  for (let k = 0; k < FIX_SLOTS; k++) {
    const s = g.slots[k];
    w16(r, 4 + k * 4, s?.monster ?? 0);
    r[6 + k * 4] = s ? s.count & 0xff : 0;
    r[7 + k * 4] = 0xd0;
  }
}

export function fixGroup(master: Master, row: number): FixGroup | null {
  const t = master.table(FIX_TABLE);
  return row > 0 && row < t.rows ? decodeFix(t.row(row)) : null;
}

export function setFixGroup(master: Master, row: number, g: FixGroup): void {
  encodeFix(master.table(FIX_TABLE).row(row), g);
}

/** Append a monsterFixGroup row (the battle slot keeps the row in a byte: up to 255). Returns its number. */
export function addFixGroup(master: Master, g: FixGroup): number {
  const t = master.table(FIX_TABLE);
  if (t.rows >= 0x100) throw new Error('固定の組 (monsterFixGroup) は 255 行までです');
  const rows = Array.from({ length: t.rows }, (_, i) => t.row(i).slice());
  const r = new Uint8Array(t.rowSize);
  encodeFix(r, g);
  t.data = t.withRows([...rows, r]);
  return t.rows - 1;
}

// The code patch ------------------------------------------------------------------------------------------------

export const BOSS_PATCH_ID = 'boss';
export const BOSS_PATCH_TITLE = 'ボス戦 (種類 0x31)';

/**
 * - FUN_001f41c8 (makes the actions of a section-8 range from +0x4D / +0x4E / +0x4F): kind 0x31 -> a boss action
 *   (base FUN_0031b170, 0x18 bytes: +0x10 its arguments, +0x14 its stage).
 * - The action (vtable [2], run in a coroutine when the range is entered): nothing when the row's state is past its
 *   stage; else the messages, then, unless the stage repeats, "on a win, set the state to stage + 1" in the battle's
 *   end word (+0xA44, which the game's scripts use for 0x91[n] = 2), and FUN_002fc790 (fixed battle, BGM).
 * - The end of battle (FUN_001ce2e8): +0xA44 with bit 15 = 0x8000 | state << 13 | row is not a 0x91 index; on a win
 *   (the path that writes 0x91), FUN_003048f8(dungeon, row, state).
 * [4] (complete) does nothing, so entering the range never moves the state on by itself.
 */
export const BOSS_PATCH_SOURCE = `; ボス戦 (issue #43, docs/events.md §8)。区画 8 の範囲のイベントの種類 0x31。
; FUN_001f41c8 (範囲の動作を作る): 種類 0x31 ならボス戦の動作を作る
@0x1F41DC
  b boss_make                ; cmp r1, #0xb
@cave boss_make
  cmp r1, #0x31
  beq bm_make
  cmp r1, #0xb
  b 0x1F41E0
bm_make:
  mov r0, #0x18
  bl FUN_0033d690            ; 確保
  cmp r0, #0
  beq bm_out
  mov r6, r0
  ldr r1, [r4, #4]           ; 行
  bl FUN_0031b170            ; 動作の基底
  ldr r1, =boss_vtable
  str r1, [r6]
  str r5, [r6, #0x10]        ; 引数 (行 +0x08 / +0x1C / +0x30)
  ldr r2, [r4, #8]
  sub r2, r5, r2
  mov r1, #0
  cmp r2, #0x1c
  moveq r1, #1
  cmp r2, #0x30
  moveq r1, #2
  strb r1, [r6, #0x14]       ; 段階
  mov r0, r6
bm_out:
  pop {r4, r5, r6, pc}
boss_vtable:
  .word 0
  .word 0x1B0FCC             ; 後始末 (解放)
  .word boss_run
  .word 0x1B0FC8
  .word 0x1B0FC8             ; 完了: 何もしない (勝ったときだけ状態を進める)
  .word 0x43C2CC
  .word 0
  .word 0
; 範囲に入ったとき (コルーチンの中)
boss_run:
  push {r4, r5, r6, lr}
  mov r4, r0
  ldr r0, [r4, #4]
  bl FUN_0031b10c            ; 行の状態
  ldrb r6, [r4, #0x14]
  cmp r0, r6
  bhi br_done                ; この段階は勝った
  ldr r5, [r4, #0x10]
  ldr r0, [r5, #4]
  bl boss_msg
  ldr r0, [r5, #8]
  bl boss_msg
  ldr r0, [r5, #0xc]
  bl boss_msg
  ldrb r1, [r5, #2]
  tst r1, #1
  bne br_fight               ; くり返す段階: 勝っても記録しない
  ldr r0, =0x564638
  ldr r0, [r0]
  add r0, r0, #0xa00
  ldr r1, [r4, #4]
  add r2, r6, #1
  orr r1, r1, r2, lsl #13
  orr r1, r1, #0x8000
  strh r1, [r0, #0x44]       ; 勝ったら 状態 = 段階 + 1
br_fight:
  ldrb r0, [r5]              ; monsterFixGroup の行
  ldrb r1, [r5, #1]          ; BGM
  cmp r1, #0
  moveq r1, #0x1c
  pop {r4, r5, r6, lr}
  b FUN_002fc790             ; 固定の戦闘
br_done:
  pop {r4, r5, r6, pc}
boss_msg:
  cmp r0, #0
  bxeq lr
  push {r4, lr}
  ldr r1, =0x3E4CCCCD        ; 0.2 (スクリプトと同じ)
  vmov s0, r1
  mov r1, #0
  mov r2, #0
  mov r3, #0
  bl FUN_00310798            ; メッセージ (閉じるまで待つ)
  pop {r4, pc}
; 戦闘の終わり (FUN_001ce2e8): +0xA44 の bit15 はボス戦の印 (0x91 の添字にしない)
@0x1CE320
  bl boss_end_index          ; and r4, r1, #0xff
@0x1CE358
  bl boss_end_win            ; cmp r4, #0 (勝ったとき)
@cave boss_end
boss_end_index:
  and r4, r1, #0xff
  tst r1, #0x8000
  movne r4, #0
  bx lr
boss_end_win:
  push {r4, lr}
  ldr r0, [r8]
  add r0, r0, #0xa00
  ldrh r4, [r0, #0x44]
  tst r4, #0x8000
  beq bw_done
  bl FUN_0030b788            ; ダンジョン
  ldr r1, =0x1FFF
  and r1, r4, r1             ; 行
  mov r2, r4, lsr #13
  and r2, r2, #3             ; 状態
  bl FUN_003048f8            ; 状態を書く
bw_done:
  pop {r4, lr}
  cmp r4, #0
  bx lr
`;

/** The boss patch: exported in code.ips whenever an event table has a boss row (it is Panana's, not in the patch list). */
export const BOSS_PATCH: CodePatch = { id: BOSS_PATCH_ID, title: BOSS_PATCH_TITLE, source: BOSS_PATCH_SOURCE, enabled: true };

/** A boss row in any of the tables (kind 0x31 in +0x4D / +0x4E / +0x4F). */
export function usesBoss(tables: Iterable<EventTable>): boolean {
  for (const t of tables)
    for (let row = 0; row < t.rows; row++) if (STAGE_KIND.some((o) => t.table.row(row)[o] === KIND_BOSS)) return true;
  return false;
}
