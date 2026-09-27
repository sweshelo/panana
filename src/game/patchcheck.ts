// Checking a code patch with the interpreter (game/arm.ts): run the functions it touches on the patched code.bin
// and see whether they come back with the stack as it was, and whether the event still builds its class.
// A "lost" run is not proof of a bug (the objects are made up), but a crash-like result is worth a look.
import { ArmMachine, ArmStop } from './arm';
import type { EventEntry } from './eventlist';
import { buildAction, CodeIndex, describeClasses, type ScriptClass } from './scripts';
import type { BuiltPatch } from './patch';

export interface RunCheck {
  entry: number;
  why: string;
  result: 'returned' | 'stack' | 'lost' | 'steps';
  detail: string;
}

export interface PatchCheck {
  runs: RunCheck[];
  /** The event's classes on the patched code (null when it has no script). */
  classes: ScriptClass[] | null;
}

const SP = 0x0f000000;

/** Run `entry` like a method call (r0 = a zeroed object) with calls followed two levels deep. */
export function runFunction(code: Uint8Array, entry: number, why: string): RunCheck {
  const m = new ArmMachine(code, { maxDepth: 2, maxSteps: 100000 });
  const self = m.alloc(0x1000);
  try {
    const r0 = m.run(entry, [self, 0, 0, 0], SP);
    if (m.r[13] !== SP) return { entry, why, result: 'stack', detail: `戻ったとき sp が 0x${m.r[13]!.toString(16)} (0x${SP.toString(16)} のはず): push / pop が対になっていません` };
    return { entry, why, result: 'returned', detail: `r0 = 0x${r0.toString(16)} で戻りました` };
  } catch (e) {
    if (!(e instanceof ArmStop)) throw e;
    return e.message === 'step limit'
      ? { entry, why, result: 'steps', detail: '10 万命令で終わりませんでした (待ちのループか、作り物のデータでの無限ループ)' }
      : { entry, why, result: 'lost', detail: `${e.message} (作り物のオブジェクトを辿った可能性があります)` };
  }
}

/** Check a built patch on `patched` code: its cave entries and the functions its in-place blocks change. */
export function checkPatch(patched: Uint8Array, built: BuiltPatch, event?: EventEntry, eventRow?: Uint8Array, allVtables: Iterable<number> = []): PatchCheck {
  const index = new CodeIndex(patched);
  const runs: RunCheck[] = [];
  const seen = new Set<number>();
  for (const b of built.blocks) {
    if (b.kind === 'cave') {
      if (!seen.has(b.addr)) {
        seen.add(b.addr);
        runs.push(runFunction(patched, b.addr, `@cave ${b.label ?? ''}`.trim()));
      }
      continue;
    }
    if (b.addr >= 0x4c0000) continue; // data
    // the function around the change: the nearest start at or before it
    let f = b.addr;
    while (f > 0x100000 && !index.isStart(f)) f -= 4;
    if (!seen.has(f)) {
      seen.add(f);
      runs.push(runFunction(patched, f, `0x${b.addr.toString(16).toUpperCase()} を含む関数`));
    }
  }
  let classes: ScriptClass[] | null = null;
  if (event && eventRow && event.scripts.length) {
    const built2 = event.scripts.map((s) => buildAction(patched, s.make, event.dungeon, event.row, eventRow, event.kind)).filter((x) => !!x);
    const described = describeClasses(patched, built2, allVtables);
    classes = built2.map((b) => described.get(b.vtable)!);
  }
  return { runs, classes };
}
