// Appearance conditions of EventObject rows (+0x4B with the value +0x00, +0x4C with +0x04), checked by
// FUN_0030B8A4(row, type, value) when a map places the row (FUN_001c6108 and the other section loaders):
//   the object is placed when (+0x4B = 0 or the +0x4B condition holds) and (+0x4C = 0 or the +0x4C one does not).
// What each type reads is found by running FUN_0030B8A4 with game/arm.ts and the save-variable getters stubbed,
// so the table comes from the ROM. docs/event-list.md §4.
import { ArmMachine, ArmStop } from './arm';

export const F_CONDITION = 0x30b8a4;

/** Save-variable getters (docs/event-list.md §4). */
const GETTERS = {
  progress: 0x31bac4, // FUN_0031BAC4(n): 0x8D[n - 1] (story progress)
  value91: 0x31d774, // FUN_0031D774(i): 0x91[i]
  flag92: 0x319744, // FUN_00319744(i): 0x92[i] == 1
  dungeonFlag: 0x31c3d8, // FUN_0031C3D8(d, i): 0x92[mapGroup[d] +0x22 + i] == 1 (i < +0x24)
  hereFlag: 0x319b68, // FUN_00319B68(i): the same for the current dungeon
  hereValue: 0x2df540, // FUN_002DF540(i): 0x91[mapGroup[here] +0x1E + i] (i < +0x20)
  rowState: 0x31b10c, // FUN_0031B10C(row): the row's state (docs/events.md §2)
  other: 0x281e30, // FUN_00281E30(table, i): not analysed
} as const;
type Getter = keyof typeof GETTERS;
const GETTER_OF = new Map(Object.entries(GETTERS).map(([k, v]) => [v, k as Getter]));

export interface ConditionType {
  type: number;
  getter: Getter;
  /** progress index (0x8D[index]) or dungeon of dungeonFlag; undefined when the value picks the index. */
  index?: number;
  /** How the getter's result r is compared: r >= value / r == eq / r != 0 / r == 0. */
  test: 'atLeast' | 'equals' | 'set' | 'clear';
  /** For 'equals': the constant. */
  eq?: number;
}

/**
 * The condition types of FUN_0030B8A4 (1..255; missing = always false). Each type is run with the getter
 * returning 0..5 and the value 1 / 3, and classified by the results.
 */
export function readConditionTypes(code: Uint8Array): Map<number, ConditionType> {
  const out = new Map<number, ConditionType>();
  for (let type = 1; type < 0x100; type++) {
    const rows: { getter: Getter; args: number[]; results: number[] }[] = [];
    for (const value of [1, 3]) {
      const results: number[] = [];
      let seen: { getter: Getter; args: number[] } | null = null;
      for (let ret = 0; ret <= 5; ret++) {
        const stubs = new Map<number, (m: ArmMachine) => number>();
        for (const [addr, getter] of GETTER_OF)
          stubs.set(addr, (m) => {
            seen ??= { getter, args: [m.r[0]!, m.r[1]!] };
            return ret;
          });
        stubs.set(0x30b788, () => 1);
        const m = new ArmMachine(code, { stubs, maxDepth: 3, maxSteps: 20000 });
        try {
          results.push(m.run(F_CONDITION, [0, type, value]) & 0xff);
        } catch (e) {
          if (!(e instanceof ArmStop)) throw e;
          results.push(-1);
        }
      }
      if (seen) rows.push({ ...(seen as { getter: Getter; args: number[] }), results });
    }
    if (rows.length !== 2) continue;
    const [a, b] = rows as [(typeof rows)[0], (typeof rows)[0]];
    const pat = (x: number[]) => x.map((v) => (v < 0 ? 'E' : v ? '1' : '0')).join('');
    const pa = pat(a.results), pb = pat(b.results);
    let c: ConditionType | null = null;
    if (pa === '011111' && pb === '000111') c = { type, getter: a.getter, test: 'atLeast' };
    else if (pa === pb && /^0*10*$/.test(pa) && !(a.getter === 'other' && pa === '100000')) c = { type, getter: a.getter, test: 'equals', eq: pa.indexOf('1') };
    else if (pa.startsWith('01') && pb.startsWith('01')) c = { type, getter: a.getter, test: 'set' };
    else if (pa.startsWith('10') && pb.startsWith('10')) c = { type, getter: a.getter, test: 'clear' };
    if (!c) continue;
    // an index fixed by the type (not the value)
    if (c.getter === 'progress') c.index = a.args[0]! - 1;
    if (c.getter === 'dungeonFlag') c.index = a.args[0]!;
    out.set(type, c);
  }
  return out;
}

/** Plain description of one condition ("0x8D[0x08] ≥ 2" ...), `value` = +0x00 / +0x04. */
export function describeCondition(c: ConditionType | undefined, type: number, value: number): string {
  if (!c) return `種類 0x${type.toString(16).toUpperCase()} (値 ${value})`;
  const v = value & 0xffff;
  const x = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  switch (c.getter) {
    case 'progress':
      return `進行 0x8D[${x(c.index!)}] ≥ ${value}`;
    case 'rowState':
      return `この行の状態 ≥ ${value}`;
    case 'value91':
      return `0x91[${x(v)}] = ${c.eq}`;
    case 'hereValue':
      return `このダンジョンの値 ${v} = ${c.eq}`;
    case 'flag92':
      return `フラグ 0x92[${x(v)}] が${c.test === 'set' ? '立っている' : '立っていない'}`;
    case 'hereFlag':
      return `このダンジョンのフラグ ${v} が${c.test === 'set' ? '立っている' : '立っていない'}`;
    case 'dungeonFlag':
      return `ダンジョン ${c.index} のフラグ ${v} が${c.test === 'set' ? '立っている' : '立っていない'}`;
    default:
      return `FUN_00281E30(${value}) が${c.test === 'set' ? '真' : '偽'}`;
  }
}
