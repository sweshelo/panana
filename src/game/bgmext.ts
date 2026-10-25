// More BGMs for RPG2 (BGMs ported from other games, port/bgm.ts). The BGM fields hold a soundData row in one byte
// (mapData [4] / [5], the boss battles), and rows 1-255 are all sounds of the game; but the BGM fields only ever hold
// rows below 0x80 (BGMs and MEs), so the patch reads 0x80-0xFF there as the rows added after soundData's 418:
// value 0x80 + k = row 418 + k. The game takes the sound of a row through the table's header (any row count) and keeps
// the BGM playing as a u16 (naauao integrations/panana/bgm-port.md).
import type { CodePatch } from './patch';
import type { Master } from './master';
import type { SoundField } from './sound';

/** soundData rows in the game; the added rows come after. */
export const BGM_EXT_BASE = 418;
/** The first value of a BGM field that names an added row. */
export const BGM_EXT_FIRST = 0x80;
/** Added rows a BGM field can name (0x80-0xFF). */
export const BGM_EXT_SLOTS = 0x80;

/** soundData row of the value of a BGM field (with the patch). */
export const bgmRow = (value: number): number => (value >= BGM_EXT_FIRST && value < BGM_EXT_FIRST + BGM_EXT_SLOTS ? BGM_EXT_BASE + value - BGM_EXT_FIRST : value);

/** Value of a BGM field for a soundData row, or null when no BGM field can hold it. */
export function bgmValue(row: number): number | null {
  if (row >= 0 && row < BGM_EXT_FIRST) return row;
  const k = row - BGM_EXT_BASE;
  return k >= 0 && k < BGM_EXT_SLOTS ? BGM_EXT_FIRST + k : null;
}

/** RPG2's BGM fields (mapData [4] / [5], the boss battles) for the sound picker. */
export const BGM_FIELD: SoundField = { row: bgmRow, value: bgmValue };

/** soundData has added rows (the export then adds the patch). */
export const hasBgmRows = (master: Master): boolean => master.table('soundData.bin').rows > BGM_EXT_BASE;

export const BGM_EXT_PATCH_ID = 'bgm-ext';
export const BGM_EXT_PATCH_TITLE = 'BGM の追加枠 (0x80〜0xFF = soundData の行 418〜)';

/**
 * - FUN_0030378c (plays a BGM row, keeps it at 0x56FC08 +4), FUN_00308bac (changes the BGM unless the same row plays)
 *   and FUN_00303b44 (is a row playing) read 0x80-0xFF as the added rows; every BGM path goes through them.
 * - FUN_00317d04 (the BGM of a scene): in battle (scene 5) it leaves rows 27 / 28 / 29 / 32 playing; an added row
 *   playing is left too.
 */
export const BGM_EXT_PATCH_SOURCE = `; BGM の追加枠: BGM の欄の 1 バイトの値 0x80〜0xFF を soundData の行 418〜545 として鳴らす。
; BGM の欄 (mapData [4] / [5]・ボス戦) は 0x80 未満しか使わないので、元の値は変わらない。
@0x303798                    ; FUN_0030378c (BGM を鳴らす): mov r5, r0
  bl bgm_r5
@0x308BB0                    ; FUN_00308bac (BGM を変える。同じ行なら何もしない): mov r8, #0
  bl bgm_r0
@0x303B44                    ; FUN_00303b44 (行が鳴っているか): mov r1, r0
  b bgm_r1
@0x317D34                    ; FUN_00317d04 (場面の BGM): cmp r5, #5
  b bgm_battle
@cave bgm_ext
bgm_r5:
  mov r5, r0
  sub r12, r5, #0x80
  cmp r12, #0x80
  addlo r5, r12, #0x1A0      ; 0x80 + k → 418 + k
  addlo r5, r5, #2
  bx lr
bgm_r0:
  mov r8, #0
  sub r12, r0, #0x80
  cmp r12, #0x80
  addlo r0, r12, #0x1A0
  addlo r0, r0, #2
  bx lr
bgm_r1:
  mov r1, r0
  sub r12, r1, #0x80
  cmp r12, #0x80
  addlo r1, r12, #0x1A0
  addlo r1, r1, #2
  b 0x303B48
; 戦闘の場面: 追加の行が鳴っていれば、行 27 / 28 / 29 / 32 と同じく場面の BGM で上書きしない
bgm_battle:
  cmp r5, #5
  bne 0x317D38
  push {r0, r1, r2, r3, r12, lr}
  ldr r0, =0x56FC08
  ldrh r0, [r0, #4]          ; いま鳴らしている行
  ldr r1, =0x1A2
  cmp r0, r1
  blo bgm_battle_back
  bl 0x303B44
  cmp r0, #0
  bne bgm_battle_keep
bgm_battle_back:
  pop {r0, r1, r2, r3, r12, lr}
  cmp r5, #5
  b 0x317D38
bgm_battle_keep:
  pop {r0, r1, r2, r3, r12, lr}
  b 0x317E04
`;

export const BGM_EXT_PATCH: CodePatch = { id: BGM_EXT_PATCH_ID, title: BGM_EXT_PATCH_TITLE, source: BGM_EXT_PATCH_SOURCE, enabled: true };
