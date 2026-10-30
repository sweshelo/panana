// Transformations that change the model (RPG2). A transformation (the boss condition's next form +0x50, or a skill of
// kind 3 type 5) rebuilds the battle unit from the new row (FUN_00199c00), but the battle's model stays the one
// FUN_00289524 made from the first row's MonsterDesign at the start; the game's own transformations never change the
// design. RPG3 swaps the model behind a white screen for ドローンＺ → じしょう・まおう (action type 22, @0x219F3C); the
// patch does the same in RPG2 where the performance shows the new form (naauao kahara/battle.md §3.4).
import type { CodePatch } from './patch';
import type { Master } from './master';
import { u16, u32 } from '../util/bytes';

export interface LookChange {
  /** MonsterParameter row that transforms, and the row it turns into. */
  from: number;
  to: number;
  /** By the boss condition (+0x50) or by a skill (the action). */
  by: 'next' | number;
}

/** Transformations into a row of another MonsterDesign (the export then needs TRANSFORM_PATCH). */
export function lookChanges(master: Master): LookChange[] {
  const mp = master.table('monsterParameter.bin');
  const actions = master.table('actionData.bin');
  const design = (row: number): number => mp.row(row)[0x4c]!;
  const out: LookChange[] = [];
  for (let r = 0; r < mp.rows; r++) {
    const row = mp.row(r);
    const next = row[0x50]!;
    if (next && next < mp.rows && design(next) !== design(r)) out.push({ from: r, to: next, by: 'next' });
    for (let s = 0; s < 6; s++) {
      const a = u16(row, 0x3c + s * 2);
      if (!a || a >= actions.rows) continue;
      const w0 = u32(actions.row(a), 0);
      if (((w0 >> 1) & 3) !== 3 || ((w0 >> 3) & 15) !== 5) continue;
      const to = u16(actions.row(a), 0x16);
      if (to && to < mp.rows && design(to) !== design(r)) out.push({ from: r, to, by: a });
    }
  }
  return out;
}

export const needsTransformPatch = (master: Master): boolean => lookChanges(master).length > 0;

export const TRANSFORM_PATCH_ID = 'transform-look';
export const TRANSFORM_PATCH_TITLE = '見た目の変わる変身 (白くフェードしてモデルを差し替える)';

/**
 * - FUN_00289524 (a monster's battle model from its unit's row) also keeps the design it used at display +0x2F7, a byte
 *   no other code of a monster's display touches.
 * - Where a performance shows a transformation (the step that shows the new row's line +0x38 and sets the idle motion:
 *   step 0x14 of FUN_0022f430 / FUN_00230040 / FUN_00250fcc / FUN_002519c4 / FUN_00252610 / FUN_00253480, step 10 of
 *   FUN_00255828, and the end of FUN_0022e498 for a skill), tf_step compares the unit's design (+0x02) with it. When
 *   they differ, it whitens the screen (FUN_003174e8 colour, FUN_003174c8 fade out; the fader at **0x574114) and keeps
 *   the step waiting (the step's timer = 1, or the step returns 0) until the fade is done; then it builds the new model
 *   through FUN_00289524 with the same unit, puts it where the old one stands, hides the old one and fades back in
 *   (FUN_0031745c). The battle's per-frame steps cannot wait on the fade (FUN_0031747c is for the event threads).
 * - The new model gets what the battle start gives a monster's model after FUN_00289524 (FUN_0040f3b4): the anchor of the
 *   damage numbers and the cursor (FUN_002f98d4, FUN_0042ded8 + MonsterDesign +0x60 / +0x62 / +0x64, FUN_002f9848).
 *   The old model is only hidden (vtable +0xC), not released: effects already put on it keep their model.
 */
export const TRANSFORM_PATCH_SOURCE = `; 見た目の変わる変身: 変身を見せる段で画面を白くフェードアウトし、モデルを変身先のデザインで作り直してフェードインする。
; 戦闘のモデルを作るとき、使ったデザインを表示ユニット +0x2F7 に覚えておく
@0x2895E0                    ; FUN_00289524: cmp r8, #0 (r5 = monsterParameter の行、r4 = 表示ユニット)
  bl tf_mark
; 攻撃を受けて変身した対象を見せる段 (0x14)。待つあいだはタイマーを 1 にして戻る
@0x22FD68                    ; FUN_0022f430 (モンスターの遠隔の単体攻撃): mov r6, r0
  bl tf_at_22f430
@0x230E70                    ; FUN_00230040 (モンスターの遠隔の全体攻撃): mov r4, r0
  bl tf_at_230040
@0x2517F4                    ; FUN_00250fcc (電波人間の単体の状態異常): mov r6, r0
  bl tf_at_250fcc
@0x25243C                    ; FUN_002519c4 (電波人間の全体の状態異常): mov r4, r0
  bl tf_at_2519c4
@0x2531CC                    ; FUN_00252610 (電波人間の単体の攻撃): mov r6, r0
  bl tf_at_252610
@0x254530                    ; FUN_00253480 (電波人間の全体の攻撃): mov r4, r0
  bl tf_at_253480
@0x256874                    ; FUN_00255828 (電波人間たちの総攻撃) の段 10: mov r4, r0
  bl tf_at_255828
; ワザで変身した (カテゴリ 3・種別 5) 自分を見せる演出 FUN_0022e498: メッセージを出し終えたところ
@0x22E6E4                    ; beq 0x22E6F4 (終わる)
  beq tf_self
@cave transform_look
tf_mark:
  ldrb r12, [r5, #0x4C]
  strb r12, [r4, #0x2F7]
  cmp r8, #0
  bx lr
tf_at_22f430:
  mov r6, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  mov r0, r6
  pop {r4, lr}
  bxeq lr
  mov r0, #2                 ; 0x22F5F4: タイマー = r0 - 1 にして 0 を返す
  b 0x22F5F4
tf_at_230040:
  mov r4, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  pop {r4, lr}
  mov r0, r4
  bxeq lr
  mov r0, #2
  b 0x230218
tf_at_250fcc:
  mov r6, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  mov r0, r6
  pop {r4, lr}
  bxeq lr
  mov r0, #2
  b 0x251198
tf_at_2519c4:
  mov r4, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  pop {r4, lr}
  mov r0, r4
  bxeq lr
  mov r0, #2
  b 0x251BA0
tf_at_252610:
  mov r6, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  mov r0, r6
  pop {r4, lr}
  bxeq lr
  mov r0, #2
  b 0x2527F8
tf_at_253480:
  mov r4, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  pop {r4, lr}
  mov r0, r4
  bxeq lr
  mov r0, #2
  b 0x253670
tf_at_255828:
  mov r4, r0
  push {r4, lr}
  bl tf_step
  cmp r0, #0
  pop {r4, lr}
  mov r0, r4
  bxeq lr
  b 0x256B1C                 ; 0 を返す (段 10 のまま)
tf_self:
  mov r0, r4
  bl tf_step
  cmp r0, #0
  bne 0x22E6E8               ; 0 を返す (段 1 のまま)
  b 0x22E6F4
; r0 = 表示ユニット。モデルが変身先のデザインなら 0、白くしているあいだは 1 を返す
tf_step:
  push {r4, r5, r6, lr}
  mov r4, r0
  ldr r0, [r4, #0x2F0]
  cmp r0, #0
  beq tf_same
  ldrh r1, [r0, #2]          ; ユニットのデザイン (電波人間は 0xFFFF)
  ldr r2, =0xFFFF
  cmp r1, r2
  beq tf_same
  ldrb r2, [r4, #0x2F7]      ; モデルを作ったときのデザイン
  cmp r1, r2
  beq tf_same
  ldr r5, =0x574114
  ldr r5, [r5]
  ldr r5, [r5]               ; フェード (画面 0 の欄: +0 動いている、+1 向き 1 = 色へ、+8 経過、+0xC 長さ)
  ldrb r0, [r5]
  cmp r0, #0
  ldrbne r0, [r5, #1]
  cmpne r0, #0
  beq tf_start
  vldr s0, [r5, #8]
  vldr s1, [r5, #0xC]
  vcmp.f32 s0, s1
  vmrs APSR_nzcv, fpscr
  blt tf_wait
  mov r0, r4                 ; 真っ白: モデルを差し替えてフェードイン
  bl tf_swap
  mov r0, #2
  vldr s0, =0.3
  bl 0x31745C
tf_same:
  mov r0, #0
  pop {r4, r5, r6, pc}
tf_start:
  mov r0, #0xFF
  mov r1, #0xFF
  mov r2, #0xFF
  mov r3, #2
  bl 0x3174E8                ; フェードの色を白に
  mov r0, #2
  vldr s0, =0.3
  bl 0x3174C8                ; フェードアウト (両画面、0.3 秒)
tf_wait:
  mov r0, #1
  pop {r4, r5, r6, pc}
; r0 = 表示ユニット。ユニットの今の行でモデルを作り直し、前のモデルの位置・向きに置いて前のモデルを隠す
tf_swap:
  push {r4, r5, r6, r7, r8, lr}
  sub sp, sp, #0x10
  mov r4, r0
  ldr r5, [r4, #4]           ; 前のモデル
  ldr r6, [r4, #8]           ; その影
  mov r0, r4
  bl tf_build
  ldr r7, [r4, #4]           ; 新しいモデル
  ldr r1, [r5, #0x10]
  add r1, r1, #0x14
  mov r0, r7
  bl 0x31B408                ; 位置
  ldr r1, [r5, #0x10]
  add r1, r1, #0x2C
  mov r0, r7
  bl 0x331CA8                ; 向き
  ; 戦闘の始め (FUN_0040f3b4) と同じく、ダメージの数字・カーソルの位置を付ける
  mov r0, r7
  mov r1, #0
  bl 0x2F98D4
  ldr r0, =0x520448
  ldr r0, [r0]
  add r0, r0, #0x900
  add r0, r0, #0x14          ; マスター +0x914 (MonsterDesign)
  ldr r1, [r4, #0x2F0]
  ldrh r1, [r1, #2]
  bl 0x31CFB8
  mov r8, r0
  mov r0, r7
  mov r1, sp
  bl 0x42DED8
  ldrsh r0, [r8, #0x60]
  bl tf_add
  ldrsh r0, [r8, #0x62]
  add r1, sp, #4
  bl tf_add_at
  ldrsh r0, [r8, #0x64]
  add r1, sp, #8
  bl tf_add_at
  mov r0, r7
  mov r1, sp
  bl 0x2F9848
  ; 前のモデルと影を隠す (vtable +0xC)
  ldr r0, [r5]
  ldr r2, [r0, #0xC]
  mov r0, r5
  mov r1, #0
  blx r2
  cmp r6, #0
  beq tf_swap_end
  ldr r0, [r6]
  ldr r2, [r0, #0xC]
  mov r0, r6
  mov r1, #0
  blx r2
tf_swap_end:
  add sp, sp, #0x10
  pop {r4, r5, r6, r7, r8, pc}
; [r1] (f32) += r0 (整数)。tf_add は r1 = 呼んだ側の sp (位置の x)
tf_add:
  add r1, sp, #0
tf_add_at:
  vmov s2, r0
  vcvt.f32.s32 s2, s2
  vldr s0, [r1]
  vadd.f32 s0, s0, s2
  vstr s0, [r1]
  bx lr
; FUN_00289524 を、表示ユニットがすでに持つユニットで呼ぶ (先頭で新しいユニットを取る FUN_00234cb0 を飛ばす)。
; 第 3 引数 1 (戦闘の始めと同じく、すぐに見える)
tf_build:
  push {r4, r5, r6, r7, r8, sb, sl, lr}
  mov r4, r0
  mov r8, #1
  vpush {d8}
  ldr r7, =0x520448
  ldr r0, [r4, #0x2F0]
  b 0x28954C
`;

export const TRANSFORM_PATCH: CodePatch = { id: TRANSFORM_PATCH_ID, title: TRANSFORM_PATCH_TITLE, source: TRANSFORM_PATCH_SOURCE, enabled: true };
