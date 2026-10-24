// Panana's code MOD "ドロップ率の天井を撤廃" for the three titles: the bonuses of the drop classes (おたから / レア /
// 激レア) from the equipment and the skills are applied without being rounded down to the states' maximum.
//
// RPG2 (kahara, naauao kahara/battle.md §2.1, item-effects.md §2.3): the drop roll FUN_00283E68 takes the bonuses of the
//   states 0x50〜0x52 from FUN_00318148 (the party's value), which multiplies the party's state and each member's value
//   (FUN_0030AFF4: the base × the 6 equipment slots / 100, clamped to conditionData +0x04) in 64 bits and clamps the
//   product to 500 / 1000 / 5000. The patch calls its own function there instead: the same product in doubles, with no
//   clamp (FUN_00283E68 takes a 32-bit value: vcvt saturates at 0x7FFFFFFF). A negative factor (ぜったいおたから) gives -1
//   (always dropped) as before.
// RPG3 (oahu): the party's states 33〜35 (conditionData 37〜39) add up the equipment as "% の掛け算" (combine 6, used by
//   nothing else) at three places, each clamping to +0x2E − 1 (500 / 1000 / 5000): the effects of a member
//   (FUN_0019FD2C), the party's state (FUN_002B7674) and its value (FUN_004CED08); FUN_004CEEF4 says whether it is full
//   (the チャンス actions are refused then). The party's state is an s16 that both the equipment (at the battle's
//   start, FUN_0029BF64) and the actions (FUN_0029BE84) multiply into, so it cannot be recomputed from the members. The
//   patch keeps it in the same s16 in a wider form for these rows: values below 16384 % as they are, above it
//   16384 + (exponent − 14) × 512 + a 9-bit mantissa (up to 2^31 %, within 0.2 % per step); the product and the value
//   (× the temporary +0x0A) are computed in 32 bits and never full. A member's own product stays an s16 (5 slots of
//   300 % are 243 倍 at most) with its maximum made 0x7FFF and saturated instead of wrapped.
// RPG FREE! (lanai, naauao lanai/monsters.md §6): the states 93〜95 (ConditionData 71〜73, "おたから+" 500 / "レア+" 1000 /
//   "激レア+" 2000) are sums (combine 2, shared with the other "+" states). They are found by their +0x10 (0x8000006A〜
//   0x8000006C). Their maximum becomes 0x7FFF in the combining of a member's effects (FUN_0016518C), the party's state
//   (FUN_002EE8AC) and its value (FUN_002DC8C8, whose cap of 30000 after the extra +0x0E becomes 0x7FFF too);
//   FUN_0016518C's sum saturates instead of wrapping (for every state: the vanilla values never reach it).
import { BASE } from './codeconst';
import type { CodePatch } from './patch';
import type { TitleKey } from '../rom/titles';
import { u32 } from '../util/bytes';

export const DROP_CAP_ID = 'panana:drop-cap';
export const DROP_CAP_TITLE = 'ドロップ率の天井を撤廃';

/** The games the patch is written for (not yet the first game, honolulu). */
export type DropCapTitle = Exclude<TitleKey, 'honolulu'>;

/** What the patch does in each title, for the export dialogs. */
export const DROP_CAP_NOTE: Record<DropCapTitle, string> = {
  kahara: 'おたから・レア・激レアの倍率 (装備・ワザの「ドロップ率アップ」) を、5 倍・10 倍・50 倍で止めずにそのまま掛けます。',
  oahu: 'おたから・レア・激レアの倍率 (装備・ワザ) を、5 倍・10 倍・50 倍で止めずにそのまま掛けます (約 2147 万倍まで。164 倍を超えると 0.2 % ほどの誤差が出ます)。',
  lanai: 'おたから+・レア+・激レア+ (装備・ワザ) を、500 %・1000 %・2000 % で止めずにそのまま足します。値は 16 ビットで持つので、32767 % が限界です。',
};

const KAHARA = `; ${DROP_CAP_TITLE} (RPG2): ドロップの抽選 (FUN_00283E68) が読むおたから・レア・激レア (状態 0x50〜0x52) の補正を、
; パーティーの値 (FUN_00318148: 上限で丸める) の代わりに、丸めない掛け算で求める
@0x283F7C
  bl drop_bonus ; 0x50 おたから
@0x283F94
  bl drop_bonus ; 0x51 レア
@0x283FAC
  bl drop_bonus ; 0x52 激レア

; r0 = パーティー (global + 0x928), r1 = 状態の ID -> r0 = パーティーの状態 × 各メンバーの値 / 100 (%)
@cave drop_bonus
  push {r4, r5, r6, r7, r8, lr}
  vpush {d8, d9}
  mov r4, r0
  mov r5, r1
  mov r0, #100
  vmov s18, r0
  vcvt.f64.s32 d9, s18 ; d9 = 100.0
  mov r0, r4
  bl FUN_0030e5f8 ; パーティーの状態 (ない ID は 0: ゲームと同じく 0 を返す)
  cmp r0, #0
  beq db_end
  bl state_value
  vmov d8, d0
  ldrb r6, [r4] ; メンバーの数 (FUN_00318148 と同じ求め方)
  ldrb r0, [r4, #1]
  cmp r0, #0
  beq db_members
  ldr r0, =0x564638
  ldr r0, [r0]
  bl FUN_00309960
  mov r6, r0
db_members:
  mov r7, #0
db_loop:
  cmp r7, r6
  bge db_done
  ldr r0, =0x564638
  ldr r0, [r0]
  add r0, r0, #0xb00
  add r0, r0, #0xa8
  mov r1, r7
  bl FUN_0031d5b8 ; i 番目のメンバー
  ldrb r1, [r0, #0xc]
  cmp r1, #0
  beq db_next
  add r1, r5, r5, lsl #2
  add r0, r0, r1, lsl #2
  add r0, r0, #0xb0 ; メンバーの状態 (+0xB0 + ID × 20)
  bl state_value
  vmul.f64 d8, d8, d0
  vdiv.f64 d8, d8, d9
db_next:
  add r7, r7, #1
  b db_loop
db_done:
  vcmp.f64 d8, #0
  vmrs apsr_nzcv, fpscr
  mvnlt r0, #0 ; 負 (ぜったいおたから): -1 = 必ず落とす
  blt db_end
  vcvt.s32.f64 s0, d8 ; 0x7FFFFFFF で飽和する
  vmov r0, s0
db_end:
  vpop {d8, d9}
  pop {r4, r5, r6, r7, r8, pc}

; r0 = 状態 (20 バイト) -> d0 = 元の値 × 出どころ 6 つ / 100 ずつ (FUN_0030AFF4 の合わせ方 4。範囲に収めない)。d9 = 100.0
@cave state_value
  ldrsh r1, [r0]
  vmov s0, r1
  vcvt.f64.s32 d0, s0
  mov r2, #6
sv_loop:
  ldrsh r1, [r0, #6]
  vmov s2, r1
  vcvt.f64.s32 d1, s2
  vmul.f64 d0, d0, d1
  vdiv.f64 d0, d0, d9
  add r0, r0, #2
  subs r2, r2, #1
  bne sv_loop
  bx lr
`;

const OAHU = `; ${DROP_CAP_TITLE} (RPG3): 合わせ方 6 (% の掛け算。おたから・レア・激レア = conditionData 37〜39 だけが使う) を上限で止めない。
; パーティーの状態の値 (+0x08、s16) は 16383 % までそのまま、それより上は 16384 + 指数 × 512 + 仮数 (9 ビット) で持ち
; (2^31 % まで、誤差 0.2 % 以内)、掛け算と値の読み出しは 32 ビットで行う
@0x19FD4C
  bl max_r5_r0 ; FUN_0019FD2C (メンバーの効果): ldrsh r5, [r0, #0x2e]
@0x19FE1C
  ssat r4, #16, r0 ; 合わせ方 6 の積: sxth (桁あふれで負になる) の代わりに飽和 (装備 5 枠で 243 倍まで: s16 に収まる)
@0x2B7690
  bl dc_acc ; FUN_002B7674 (パーティーの状態に掛ける): ldrsh r4, [r2, #0x2e]
@0x4CED28
  bl dc_val ; FUN_004CED08 (状態の値): ldrsh r4, [r2, #0x2e]
@0x4CEF08
  bl dc_full ; FUN_004CEEF4 (満タンか): ldrsh r4, [r0, #0x2e]

; メンバーの効果の最大: 合わせ方 6 なら 0x7FFF。ip とフラグだけを壊す
@cave max_r5_r0
  ldrsh r5, [r0, #0x2e]
  ldrb ip, [r0, #0x36]
  and ip, ip, #0xf
  cmp ip, #6
  moveq r5, #0x7f00
  orreq r5, r5, #0xff
  bx lr

; FUN_002B7674 の中 (push {r4-r8, lr} のあと): r5 = 状態、r0 = +0x08、r1 = 掛ける値、r2 = conditionData の行、r3 = +0x36
@cave dc_acc
  and ip, r3, #0xf
  cmp ip, #6
  ldrshne r4, [r2, #0x2e]
  bxne lr
  ldrsh r6, [r2, #0x2c] ; 最小
  mov r4, r1
  bl dc_decode
  smull r2, r1, r0, r4
  mov r0, r2
  mov r2, #100
  mov r3, #0
  bl FUN_00129ae4 ; 64 ビットの符号つき割り算
  bl dc_sat
  cmp r0, r6
  movlt r0, r6
  bl dc_encode
  strh r0, [r5, #8]
  pop {r4, r5, r6, r7, r8, pc}

; FUN_004CED08 の中 (push {r4-r6, lr} のあと): r1 = 状態、r0 = +0x08、r2 = 行、r3 = +0x36 -> r0 = +0x08 × +0x0A / 100 (32 ビット)
@cave dc_val
  and ip, r3, #0xf
  cmp ip, #6
  ldrshne r4, [r2, #0x2e]
  bxne lr
  ldrsh r5, [r2, #0x2c] ; 最小
  mov r4, r1
  bl dc_decode
  ldrsh r1, [r4, #0xa] ; 一時的な倍率 (%)
  smull r2, r3, r0, r1
  mov r0, r2
  mov r1, r3
  mov r2, #100
  mov r3, #0
  bl FUN_00129ae4
  bl dc_sat
  cmp r0, r5
  movlt r0, r5
  pop {r4, r5, r6, pc}

; FUN_004CEEF4 の中 (push {r4-r6, lr} のあと): r0 = 行。合わせ方 6 は満タンにならない
@cave dc_full
  ldrb ip, [r0, #0x36]
  and ip, ip, #0xf
  cmp ip, #6
  ldrshne r4, [r0, #0x2e]
  bxne lr
  mov r0, #0
  pop {r4, r5, r6, pc}

; r0 = +0x08 の持ち方 (s16) -> r0 = % (ip を壊す)
@cave dc_decode
  cmp r0, #0x4000
  bxlt lr
  sub r0, r0, #0x4000
  lsr ip, r0, #9
  cmp ip, #16
  movgt ip, #16
  lsl r0, r0, #23
  lsr r0, r0, #23
  orr r0, r0, #0x200
  add ip, ip, #5
  lsl r0, r0, ip
  bx lr

; r0 = % -> r0 = +0x08 の持ち方 (ip を壊す)
@cave dc_encode
  cmp r0, #0x4000
  blt dc_small
  clz ip, r0
  rsb ip, ip, #22 ; (最上位ビット) − 9
  lsr r0, r0, ip
  sub r0, r0, #0x200
  sub ip, ip, #5
  add r0, r0, ip, lsl #9
  add r0, r0, #0x4000
  bx lr
dc_small:
  cmn r0, #0x8000
  movlt r0, #0
  sublt r0, r0, #0x8000
  bx lr

; r1:r0 (64 ビット) -> r0 (32 ビットに飽和)
@cave dc_sat
  cmp r1, r0, asr #31
  mvngt r0, #0x80000000
  movlt r0, #0x80000000
  bx lr
`;

const LANAI = `; ${DROP_CAP_TITLE} (RPG FREE!): おたから+・レア+・激レア+ (ConditionData 71〜73、+0x10 が 0x8000006A〜0x8000006C) の
; 上限を 0x7FFF にする (メンバーの効果・パーティーの状態・その値)
@0x1651AC
  bl max_r7_r0 ; FUN_0016518C: ldrsh r7, [r0, #0x1e]
@0x165240
  ssat r4, #16, r0 ; FUN_0016518C の和・積: sxth (桁あふれで負になる) の代わりに飽和
@0x2EE8C8
  bl max_r4_r2 ; FUN_002EE8AC: ldrsh r4, [r2, #0x1e]
@0x2DC8EC
  bl max_r5_r1 ; FUN_002DC8C8: ldrsh r5, [r1, #0x1e]
@0x2DCA34
  bl cap_r1_r4 ; FUN_002DC8C8: ldr r1, =30000 (おまけ +0x0E を足したあとの上限)

; rX = ConditionData +0x1E (最大)、ドロップの状態なら 0x7FFF。ip とフラグだけを壊す
@cave max_r7_r0
  ldrsh r7, [r0, #0x1e]
  ldr ip, [r0, #0x10]
  sub ip, ip, #0x80000000
  sub ip, ip, #0x6a
  cmp ip, #3
  movlo r7, #0x7f00
  orrlo r7, r7, #0xff
  bx lr
@cave max_r4_r2
  ldrsh r4, [r2, #0x1e]
  ldr ip, [r2, #0x10]
  sub ip, ip, #0x80000000
  sub ip, ip, #0x6a
  cmp ip, #3
  movlo r4, #0x7f00
  orrlo r4, r4, #0xff
  bx lr
@cave max_r5_r1
  ldrsh r5, [r1, #0x1e]
  ldr ip, [r1, #0x10]
  sub ip, ip, #0x80000000
  sub ip, ip, #0x6a
  cmp ip, #3
  movlo r5, #0x7f00
  orrlo r5, r5, #0xff
  bx lr
; r1 = 30000、r4 (状態) の行がドロップの状態なら 0x7FFF
@cave cap_r1_r4
  mov r1, #0x7500
  orr r1, r1, #0x30
  ldr ip, [r4]
  ldr ip, [ip, #0x10]
  sub ip, ip, #0x80000000
  sub ip, ip, #0x6a
  cmp ip, #3
  movlo r1, #0x7f00
  orrlo r1, r1, #0xff
  bx lr
`;

const SOURCES: Record<DropCapTitle, string> = { kahara: KAHARA, oahu: OAHU, lanai: LANAI };

/** The words the patch replaces, as in the game (RPG2 v1.1.0, RPG3 Update v4096, RPG FREE! Update v17408). */
const EXPECT: Record<DropCapTitle, [number, number][]> = {
  kahara: [[0x283F7C, 0xEB025071], [0x283F94, 0xEB02506B], [0x283FAC, 0xEB025065]],
  oahu: [[0x19FD4C, 0xE1D052FE], [0x19FE1C, 0xE6BF4070], [0x2B7690, 0xE1D242FE], [0x4CED28, 0xE1D242FE], [0x4CEF08, 0xE1D042FE]],
  lanai: [[0x1651AC, 0xE1D071FE], [0x165240, 0xE6BF4070], [0x2EE8C8, 0xE1D241FE], [0x2DC8EC, 0xE1D151FE], [0x2DCA34, 0xE59F100C]],
};

/** Why the patch cannot go on `code` (another version, or a base MOD that rewrote the same code), or null. */
export function dropCapProblem(code: Uint8Array, title: DropCapTitle): string | null {
  const bad = EXPECT[title].filter(([a, w]) => a - BASE + 4 > code.length || u32(code, a - BASE) !== w);
  return bad.length ? `code.bin の 0x${bad.map(([a]) => a.toString(16).toUpperCase()).join('・0x')} が元のゲームと違うので、「${DROP_CAP_TITLE}」を入れられません (別の版か、土台の MOD が同じ場所を書き換えています)` : null;
}

/** The patch for a title (always enabled: it is only built when the option is on). */
export const dropCapPatch = (title: DropCapTitle): CodePatch => ({ id: DROP_CAP_ID, title: DROP_CAP_TITLE, source: SOURCES[title], enabled: true });
