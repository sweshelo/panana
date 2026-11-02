// The destinations of "ジャンプ" (the world map's jump screen, scene 0x23: FUN_00265f1c lists them, FUN_00265e28 warps)
// in mapJumpPoint.bin (master +0x6AC; docs/kahara/worldmap.md §10). A row is listed once save value 0x65[row] is set
// (FUN_0030472c sets it when the player goes in or out of the entrance whose ID is the row's +4) and its +0xC bit0 is
// clear. The game never looks at the entrance's appearance conditions there, so Panana's patch can hide a row while
// its entrance is not placed (the Panana flag +0x0D bit0).
import type { CodePatch } from './patch';
import { u32, w32 } from '../util/bytes';

export const JUMP_TABLE = 'mapJumpPoint.bin';
export const JUMP_ROW_SIZE = 0x10;
/** Rows the game's code takes (cmp #0x26 at 0x3047C8 / 0x266070, the list of 38 x 12 bytes at 0x265F58). */
export const JUMP_GAME_ROWS = 38;
/** Rows save value 0x65 has a bit for (1 bit x 40): what the table can grow to without moving the save. */
export const JUMP_MAX_ROWS = 40;
/** +0x0D bit0 (Panana; the game reads +0x0C bit0 only): not listed while the entrance is not placed. */
export const JUMP_FOLLOW = 0x0d;

export const JP = {
  /** Message ID of the name shown in the list. */
  name: (r: Uint8Array) => u32(r, 0x00),
  /** The entrance's ID (section 2 +0x04). */
  id: (r: Uint8Array) => u32(r, 0x04),
  /** World map: 0 = W01, 1 = W02 (+0x08 bit0, the only bit read). */
  world: (r: Uint8Array) => u32(r, 0x08) & 1,
  /** +0x0C bit0: never listed (row 34 "最後のほこら"). */
  hidden: (r: Uint8Array) => (r[0x0c]! & 1) !== 0,
  /** Panana: listed only while the entrance is placed (its appearance conditions hold). */
  follows: (r: Uint8Array) => (r[JUMP_FOLLOW]! & 1) !== 0,
};

/** The world map index (0 = W01, 1 = W02) a jump row can lead to, or -1 for W98 / W99. */
export const jumpWorld = (worldIndex: number): number => (worldIndex === 0 || worldIndex === 1 ? worldIndex : -1);

/** The row (1..) that leads to the entrance `id` of world map `world` (0 / 1), or -1. Row 0 is "なし". */
export function jumpRowOf(rows: Uint8Array[], world: number, id: number): number {
  for (let i = 1; i < rows.length; i++) if (JP.id(rows[i]!) === id && JP.world(rows[i]!) === world) return i;
  return -1;
}

export function newJumpRow(name: number, id: number, world: number, follows: boolean): Uint8Array {
  const r = new Uint8Array(JUMP_ROW_SIZE);
  w32(r, 0x00, name);
  w32(r, 0x04, id);
  w32(r, 0x08, world & 1);
  if (follows) r[JUMP_FOLLOW] = 1;
  return r;
}

export function setJumpFollows(r: Uint8Array, on: boolean): void {
  r[JUMP_FOLLOW] = on ? r[JUMP_FOLLOW]! | 1 : r[JUMP_FOLLOW]! & ~1;
}

// ---- the patch: more rows, and rows that follow their entrance

export const JUMP_PATCH_ID = 'jump-points';
export const JUMP_PATCH_TITLE = 'ジャンプの行き先';

/** The conditions a followed row is listed with: its entrance's row's +0x4B / +0x00 and +0x4C / +0x04. */
export interface JumpCheck {
  row: number;
  /** +0x4B and its value +0x00 (listed only when it holds; 0 = no condition). */
  show: [number, number];
  /** +0x4C and its value +0x04 (not listed when it holds). */
  hide: [number, number];
}

/** A kind FUN_0030b8a4 never takes (its jump table ends at 0xB5): "never holds", for rows whose entrance is gone. */
export const NEVER = 0xff;

/** What a followed row's entrance tells: its Wxx_EventObject row (0 = always placed), or null when it is not there. */
export type EntranceOf = (world: number, id: number) => { event: number } | null;
/** A Wxx_EventObject row of world map `world`, or null when the table is not loaded. */
export type EventRowOf = (world: number, row: number) => Uint8Array | null;

/**
 * The checks of the followed rows. A row whose entrance is not on its world map is never listed; one whose entrance
 * is always placed needs no check. `missing`: the rows whose event table was not loaded (their check cannot be made).
 */
export function jumpChecks(rows: Uint8Array[], entrance: EntranceOf, eventRow: EventRowOf): { checks: JumpCheck[]; missing: number[] } {
  const checks: JumpCheck[] = [];
  const missing: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (!JP.follows(r)) continue;
    const e = entrance(JP.world(r), JP.id(r));
    if (!e) {
      checks.push({ row: i, show: [NEVER, 0], hide: [0, 0] });
      continue;
    }
    if (!e.event) continue;
    const ev = eventRow(JP.world(r), e.event);
    if (!ev) {
      missing.push(i);
      continue;
    }
    checks.push({ row: i, show: [ev[0x4b]!, u32(ev, 0x00)], hide: [ev[0x4c]!, u32(ev, 0x04)] });
  }
  return { checks, missing };
}

/**
 * The patch, or null when the game's code takes the table as it is (38 rows, no checks).
 * - More rows (up to 40, the bits of save value 0x65): FUN_00265f1c's `cmp r4, #0x26` (0x266070) and its list of
 *   38 x 12 bytes (0x265F58), FUN_00304730's `cmp r5, #0x26` (0x3047C8; it sets 0x65[row] for the entrance the
 *   player goes in or out of).
 * - Checks: 0x26600C `beq 0x26606C` (skip a row not visited or without an entrance) to the cave, which also skips
 *   a followed row whose conditions do not hold (FUN_0030b8a4 like FUN_001e2ac4; r4 = row, r6 = the row's bytes;
 *   r0-r3 are free there).
 */
export function jumpPatchSource(rows: number, checks: JumpCheck[]): string | null {
  const n = Math.min(Math.max(rows, JUMP_GAME_ROWS), JUMP_MAX_ROWS);
  if (n === JUMP_GAME_ROWS && !checks.length) return null;
  const hex = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase()}`;
  const out = ['; ジャンプの行き先 (mapJumpPoint.bin)。docs/kahara/worldmap.md §10'];
  if (n !== JUMP_GAME_ROWS) {
    out.push(
      `; 行の数 ${JUMP_GAME_ROWS} → ${n} (セーブ 0x65 は 40 行ぶん)`,
      '@0x265F58',
      `  mov r0, #${hex(n * 12)}           ; 一覧の配列 (${n} 件 × 12 B)`,
      '@0x266070',
      `  cmp r4, #${n}                  ; 一覧を作るループ`,
      '@0x3047C8',
      `  cmp r5, #${n}                  ; 訪れた行き先の印 (0x65[行])`,
    );
  }
  if (checks.length) {
    out.push(
      '; 入口が出ていない行き先は一覧に出さない',
      '@0x26600C',
      '  b jp_hook                  ; beq 0x26606C',
      '@cave jump_points',
      'jp_hook:',
      '  beq 0x26606C               ; 訪れていない・入口がない: 飛ばす',
      '  mov r0, r4',
      '  bl jp_listed',
      '  cmp r0, #0',
      '  beq 0x26606C',
      '  b 0x266010                 ; 一覧に載せる',
      '; r0 = 行 → 1 = 載せる',
      'jp_listed:',
      '  push {r4, r5, r6, lr}',
      '  mov r5, r0',
      '  ldr r4, =jp_table',
      'jl_find:',
      '  ldr r0, [r4]',
      '  cmp r0, #0',
      '  beq jl_yes',
      '  cmp r0, r5',
      '  beq jl_check',
      '  add r4, r4, #0x14',
      '  b jl_find',
      'jl_check:',
      '  ldr r1, [r4, #0xc]         ; 入口の行の +0x4C (成り立つと消える)',
      '  cmp r1, #0',
      '  beq jl_show',
      '  ldr r0, [r4]',
      '  ldr r2, [r4, #0x10]',
      '  bl FUN_0030b8a4',
      '  ands r0, r0, #0xff',
      '  bne jl_no',
      'jl_show:',
      '  ldr r1, [r4, #4]           ; 入口の行の +0x4B (成り立つと出る)',
      '  cmp r1, #0',
      '  beq jl_yes',
      '  ldr r0, [r4]',
      '  ldr r2, [r4, #8]',
      '  bl FUN_0030b8a4',
      '  ands r0, r0, #0xff',
      '  beq jl_no',
      'jl_yes:',
      '  mov r0, #1',
      '  pop {r4, r5, r6, pc}',
      'jl_no:',
      '  mov r0, #0',
      '  pop {r4, r5, r6, pc}',
      '; {行き先の行, +0x4B, +0x00, +0x4C, +0x04} (0xFF = 入口がない)',
      'jp_table:',
      ...checks.flatMap((c) => [`  .word ${c.row}                 ; 行き先の行`, ...[c.show[0], c.show[1], c.hide[0], c.hide[1]].map((v) => `  .word ${hex(v)}`)]),
      '  .word 0',
    );
  }
  return out.join('\n') + '\n';
}

export function jumpPatch(rows: Uint8Array[], entrance: EntranceOf, eventRow: EventRowOf): { patch: CodePatch | null; missing: number[] } {
  const { checks, missing } = jumpChecks(rows, entrance, eventRow);
  const source = jumpPatchSource(rows.length, checks);
  return { patch: source ? { id: JUMP_PATCH_ID, title: JUMP_PATCH_TITLE, source, enabled: true } : null, missing };
}
