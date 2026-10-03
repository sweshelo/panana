// 電波人間のRPG3's event scripts (naauao oahu/map.md §5.3), read the way RPG2's are (game/scripts.ts): a map record
// builds a handler, the handler's "make the action" (vtable[4]) builds the class of the row's behaviour. Running it
// with game/arm.ts on the Update's code.bin, with the current dungeon chosen, gives the class; its own functions give
// the messages it shows. Kind 0x2E is the script kind (RPG2's 0x24): its class is chosen by dungeon and row in code.
import { ArmMachine, ArmStop } from '../game/arm';
import { BASE } from '../game/codeconst';
import type { BuiltAction, CodeProfile } from '../game/scripts';
import { u32 } from '../util/bytes';

/** FUN_004EE968: the current dungeon (save value 0x55 = mapGroup row). */
export const OAHU_F_DUNGEON = 0x4ee968;
/** FUN_00122B14: operator new. */
export const OAHU_F_ALLOC = 0x122b14;
/** End of .text and its padding (OAHU_SECTIONS.text; the patch cave ends at .rodata). */
export const OAHU_TEXT_END = 0x556000;
/** .rodata (where the vtables are). */
const RODATA = [0x556000, 0x597000] as const;

/** The script kind (EventObject +0x55). */
export const OAHU_SCRIPT_KIND = 0x2e;

/**
 * "Make the action" (vtable[4] of the handler a record builds) by section and record: §3.4 (exits, FUN_004BCF30),
 * §3.5 (chests, FUN_004BC4EC), §3.6 (characters and objects by +0x00), §3.7 (ranges, FUN_002724E8).
 */
export function oahuMakeFunction(section: number, raw: Uint8Array): number | null {
  if (section === 3) return 0x4bc7c8;
  if (section === 4) return 0x4bc3c0;
  if (section === 8) return u32(raw, 0) >= 100 ? null : 0x272034;
  if (section === 5) {
    const kind = u32(raw, 0);
    if (kind <= 2) return 0x4a9000;
    if (kind === 3) return 0x26b9c0;
    if ([4, 5, 6, 0x0b, 0x0d, 0x0e].includes(kind)) return 0x22fe14;
    if (kind >= 7 && kind <= 9) return 0x19e1a0;
    if (kind === 0x0c) return 0x2239c8;
  }
  return null;
}

/** Every "make the action" function, tried for rows no map places. */
export const OAHU_MAKE_FUNCTIONS = [0x4bc7c8, 0x4bc3c0, 0x272034, 0x4a9000, 0x26b9c0, 0x22fe14, 0x19e1a0, 0x2239c8];

/** RPG3's code.bin for the code index (messages: MessageField_JP's range, given by the caller). */
export function oahuCodeProfile(msgFirst: number, msgLast: number): CodeProfile {
  return { textEnd: OAHU_TEXT_END, msgFirst, msgLast, complete: 0 };
}

/**
 * Run `make` for one EventObject row (0x58 bytes) as if the game loaded it in `dungeon` (mapGroup row): the class it
 * builds, or null. The handler holds the row at +4; the make function gets the handler, the kind (+0x55) and the
 * row's arguments (+0x10).
 */
export function oahuBuildAction(code: Uint8Array, make: number, dungeon: number, row: number, eventRow: Uint8Array): BuiltAction | null {
  const allocs: { depth: number; p: number }[] = [];
  const stubs = new Map([
    [OAHU_F_ALLOC, (m: ArmMachine) => {
      const p = m.alloc(m.r[0]!);
      allocs.push({ depth: m.depth, p });
      return p;
    }],
    [OAHU_F_DUNGEON, () => dungeon],
  ]);
  const m = new ArmMachine(code, { stubs, maxDepth: 4, textEnd: OAHU_TEXT_END });
  const handler = m.alloc(0x40), ev = m.alloc(0x60), ctx = m.alloc(0x400);
  eventRow.forEach((b, k) => m.wb(ev + k, b));
  m.write(handler + 4, row, 4);
  m.write(handler + 8, ev, 4);
  m.write(handler + 0x18, ctx, 4);
  let vtable = 0;
  try {
    const obj = m.run(make, [handler, eventRow[0x55] ?? 0, ev + 0x10]);
    vtable = obj ? m.read(obj, 4) : 0;
  } catch (e) {
    if (!(e instanceof ArmStop)) throw e;
    const first = allocs.find((a) => a.depth === 0)?.p;
    for (const [a, v] of m.writes) if (a === first && v >= RODATA[0] && v < RODATA[1]) vtable = v;
  }
  if (vtable < RODATA[0] || vtable >= RODATA[1]) return null;
  const pointers = new Set<number>();
  for (const c of m.calls) if (c.target !== OAHU_F_ALLOC) for (const v of c.args) if (v >= BASE && v < OAHU_TEXT_END) pointers.add(v);
  for (const [a, v] of m.writes) if (a >= 0x30000000 && v >= BASE && v < OAHU_TEXT_END) pointers.add(v);
  return { make, vtable, pointers: [...pointers] };
}
