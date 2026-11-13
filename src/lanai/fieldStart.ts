import { buildPatches, patchRecords, type CodePatch } from '../game/patch';
import { equalBytes, u32, w32 } from '../util/bytes';
import { LANAI_LAYOUT } from './code';
import { LANAI_MAP_NAME_OFFSET, LANAI_MAP_ROW } from './maps';

// The normal map reader (Update 0x2B164C) accepts slots 0–8. Only the world map
// format uses slot 9 for terrain. Marking an added normal row keeps the same guard
// usable after cloning or distributing its archive, regardless of the content ID.
export const LANAI_NO_FIELD_START = 0x504e4653;
const SLOT_9 = 9 * 4;
const HOOK = 0x18236c;
const RESOLVE_EXPORT = 0x2e7e4c;

/** Original Panana exports appended normal maps after the ROM maps. Only mark that suffix
 * when the original row hashes match, so renamed and edited original floors keep their events. */
export function markAddedLanaiFloors(table: Uint8Array, template: Uint8Array): Uint8Array {
  if (!template.length || template.length % LANAI_MAP_ROW || template.length >= table.length) return table;
  for (let row = 0; row < template.length; row += LANAI_MAP_ROW)
    if (u32(template, row) !== u32(table, row)) return table;
  let marked = table;
  for (let row = template.length; row + LANAI_MAP_ROW <= table.length; row += LANAI_MAP_ROW) {
    if (table[row + LANAI_MAP_NAME_OFFSET] === 0x57 || u32(table, row + SLOT_9) === LANAI_NO_FIELD_START) continue;
    if (marked === table) marked = table.slice();
    w32(marked, row + SLOT_9, LANAI_NO_FIELD_START);
  }
  return marked;
}

export function hasMarkedLanaiFloors(table: Uint8Array): boolean {
  for (let row = 0; row + LANAI_MAP_ROW <= table.length; row += LANAI_MAP_ROW)
    if (table[row + LANAI_MAP_NAME_OFFSET] !== 0x57 && u32(table, row + SLOT_9) === LANAI_NO_FIELD_START) return true;
  return false;
}

// The original constructor (0x182324) calls resolver(manager, 3), then invokes its
// result only if non-null. Keep its arguments intact and return a null callback for
// marked rows. The map row span is the same one used by the game's 0x2B164C.
// Use absolute literals for external calls so the body can be recognized at any placement.
export const LANAI_FIELD_START_PATCH: CodePatch = {
  id: 'lanai:added-floor-start',
  title: '追加階で元のマップの開始イベントを抑制',
  enabled: true,
  source: `@0x18236c
    bl field_start
  @cave field_start
    push {r0, r1, r4, lr}
    ldr ip, =0x2DDF6C
    blx ip
    ldr ip, =0x4EB098
    ldmia ip, {r1, r2}
  field_start_find:
    cmp r1, r2
    movhs r3, #0
    bhs field_start_check
    ldr r3, [r1], #0x4c
    cmp r3, r0
    bne field_start_find
    ldrb r3, [r1, #-0xc]
    cmp r3, #0x57
    ldrne r3, [r1, #-0x28]
  field_start_check:
    ldr ip, =${LANAI_NO_FIELD_START}
    cmp r3, ip
    pop {r0, r1, r4, lr}
    moveq r0, #0
    bxeq lr
    ldr pc, =${RESOLVE_EXPORT}`,
};

/** Reuse the exact guard when the base MOD or HTTP loader already installed it. */
export function fieldStartPatch(code: Uint8Array): CodePatch | null {
  const base = 0x100000;
  const instruction = u32(code, HOOK - base);
  if (instruction === 0xeb0596b6) return LANAI_FIELD_START_PATCH;
  if (instruction >>> 24 === 0xeb) {
    const target = HOOK + 8 + ((instruction << 8) >> 6) - base;
    const built = buildPatches(new Uint8Array(), [LANAI_FIELD_START_PATCH], LANAI_LAYOUT);
    const body = patchRecords(built.values()).find(([offset]) => offset !== HOOK - base)![1];
    if (target >= 0 && equalBytes(code.subarray(target, target + body.length), body)) return null;
  }
  throw new Error('フィールド開始イベントの呼び出しが既に変更されています');
}
