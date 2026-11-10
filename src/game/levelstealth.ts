// Panana's code MOD "レベルステルス" for RPG2 (kahara): a monster on the field does not notice the party (and so never
// starts to chase it) while the party's average Lv is far above the monster's, like RPG3 (oahu) does.
// (naauao integrations/panana/level-stealth.md)
//
// RPG3 (Update v4096): FUN_00227030 (the symbol monster, RPG2's FUN_001c4d88) sets the AI +0x50 bit3 when the monster's
// Lv − the party's Lv < −9 and its MonsterDesign +0x08 bit19 is clear; FUN_00268188 (RPG2's FUN_001eeaf0) returns at
// once while the bit is set. So the difference is 10, decided when the monster appears.
//
// RPG2 v1.1.0: a symbol monster's AI (the monster +0x18, made by FUN_001ef6d0 and
// FUN_001ee5e0 from its MonsterDesign row) notices the party in FUN_001eeaf0, from the states 1 (待機) and 3 (歩く) of
// FUN_001eee7c: range, angle and a ray against the walls, then the state 2 (気づいた) and the motion 0x66. Before all
// that, it asks FUN_00435380 whether the party hides (the state 0x5D ステルス on the party or a member) and returns
// when it does. The patch calls its own function there: the same question, and also "the average Lv of the members
// is at least the monster's Lv + the difference".
// - The monster: the monster +0x0C is its encounter slot (FUN_001c4d88 from FUN_002d6628); FUN_002d6998 (encounter,
//   slot) looks up its MonsterParameter row as the battle does and leaves the row at master +0x95C. Lv = w0 bit8-14.
// - The members: as FUN_00435380 counts them (party +0 or FUN_00309960) and gets them (FUN_0031d5b8 (global +0xBA8,
//   i)); a member's Lv is the unit +0x0C (0 = an empty slot, not counted). The average is floored:
//   floor(sum / n) >= Lv + d  <=>  sum >= (Lv + d) * n.
import { BASE } from './codeconst';
import type { CodePatch } from './patch';
import { u32 } from '../util/bytes';

export const LEVEL_STEALTH_ID = 'panana:level-stealth';
export const LEVEL_STEALTH_TITLE = 'レベルステルス';

/** The Lv difference by default. */
export const LEVEL_STEALTH_DEFAULT = 10;
/** The range of the difference (one byte of an immediate). */
export const LEVEL_STEALTH_MIN = 1;
export const LEVEL_STEALTH_MAX = 99;

/** What the patch does, for the export dialog. */
export const levelStealthNote = (diff: number): string =>
  `パーティーの平均 Lv がフィールドのモンスターの Lv より ${diff} 以上高いと、そのモンスターはパーティーに気づかず、追ってきません (RPG3 と同じ)。ぶつかれば戦闘になります。`;

const clampDiff = (diff: number): number => Math.min(LEVEL_STEALTH_MAX, Math.max(LEVEL_STEALTH_MIN, Math.round(diff) || LEVEL_STEALTH_DEFAULT));

const source = (diff: number): string => `; ${LEVEL_STEALTH_TITLE} (RPG2): フィールドのモンスターがパーティーに気づく判定 (FUN_001eeaf0) で、
; ステルス (状態 0x5D) のほかに「メンバーの平均 Lv ≧ モンスターの Lv + ${diff}」でも気づかない
@0x1EEB30
  bl level_stealth ; bl FUN_00435380 (パーティーがステルスか)

; r0 = パーティー (global + 0xB28)、r4 = モンスターの AI (モンスター + 0x18) -> r0 = 1 なら気づかない
@cave level_stealth
  push {r4, r5, r6, r7, r8, lr}
  mov r5, r0
  bl FUN_00435380 ; ステルス (ゲームの判定そのまま)
  cmp r0, #0
  popne {r4, r5, r6, r7, r8, pc}
  ldr r0, =0x564638
  ldr r0, [r0]
  add r0, r0, #0x54 ; エンカウント
  ldr r1, [r4, #-0xc] ; モンスター +0x0C: エンカウントの枠
  bl FUN_002d6998 ; MonsterParameter の行を引く (master +0x95C に残る)
  ldr r0, =0x520448
  ldr r0, [r0]
  ldr r0, [r0, #0x95c]
  ldr r0, [r0]
  lsr r6, r0, #8
  and r6, r6, #0x7f ; モンスターの Lv (w0 bit8-14)
  add r6, r6, #${diff}
  ldrb r7, [r5] ; メンバーの数 (FUN_00435380 と同じ求め方)
  ldrb r0, [r5, #1]
  cmp r0, #0
  beq ls_members
  ldr r0, =0x564638
  ldr r0, [r0]
  bl FUN_00309960
  mov r7, r0
ls_members:
  mov r4, #0 ; i
  mov r8, #0 ; Lv の合計
  mov r5, #0 ; 数えたメンバー
ls_loop:
  cmp r4, r7
  bge ls_done
  ldr r0, =0x564638
  ldr r0, [r0]
  add r0, r0, #0xb00
  add r0, r0, #0xa8
  mov r1, r4
  bl FUN_0031d5b8 ; i 番目のメンバー
  ldrb r0, [r0, #0xc] ; Lv (0 = 空き)
  cmp r0, #0
  addne r8, r8, r0
  addne r5, r5, #1
  add r4, r4, #1
  b ls_loop
ls_done:
  cmp r5, #0
  moveq r0, #0 ; メンバーがいない
  popeq {r4, r5, r6, r7, r8, pc}
  mul r0, r6, r5
  cmp r8, r0 ; 合計 ≧ (Lv + 差) × 数
  movge r0, #1
  movlt r0, #0
  pop {r4, r5, r6, r7, r8, pc}
`;

/** The word the patch replaces, as in the game (RPG2 v1.1.0): bl FUN_00435380. */
const EXPECT: [number, number][] = [[0x1eeb30, 0xeb091a12]];

/** Why the patch cannot go on `code` (another version, or a base MOD that rewrote the same code), or null. */
export function levelStealthProblem(code: Uint8Array): string | null {
  const bad = EXPECT.filter(([a, w]) => a - BASE + 4 > code.length || u32(code, a - BASE) !== w);
  return bad.length ? `code.bin の 0x${bad.map(([a]) => a.toString(16).toUpperCase()).join('・0x')} が元のゲームと違うので、「${LEVEL_STEALTH_TITLE}」を入れられません (別の版か、土台の MOD が同じ場所を書き換えています)` : null;
}

/** The patch with a Lv difference (always enabled: it is only built when the option is on). */
export const levelStealthPatch = (diff: number = LEVEL_STEALTH_DEFAULT): CodePatch => ({ id: LEVEL_STEALTH_ID, title: LEVEL_STEALTH_TITLE, source: source(clampDiff(diff)), enabled: true });
