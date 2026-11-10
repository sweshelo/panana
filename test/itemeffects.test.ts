// The item effects cut out of elpulse (src/game/itemeffects.ts): the patches assemble, items get the effects, and
// (with the base MOD in roms/mod/out) the routines are elpulse's instruction for instruction.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../src/game/game';
import { ItemBook } from '../src/game/items';
import {
  encodeModText,
  HOUSE_ITEM_FLAG,
  MOD_EFFECTS,
  modEffectOf,
  modEffectPatches,
  modEffectPatchesFor,
  usedModEffects,
  type ModEffectKey,
} from '../src/game/itemeffects';
import { applyRecords, buildPatches, CAVE_START, CAVE_END, patchRecords } from '../src/game/patch';
import { openImage } from '../src/rom/dump';
import { applyIps } from '../src/rom/ips';
import { u16, u32 } from '../src/util/bytes';
import { BASE_MOD, CIA, hasCia } from './env';

const ALL = new Map<ModEffectKey, number[]>([
  ['ap-all', [34]],
  ['full-all', [36]],
  ['fixate', [37]],
  ['teleporter-plus', [178]],
  ['fixate-all', [176]],
  ['unfix-all', [177]],
]);

describe('item effects (no ROM)', () => {
  test('every patch assembles and fits in the cave together', () => {
    const code = new Uint8Array(0x4e5000);
    const patches = [...modEffectPatchesFor(new Map([...ALL, ['teleporter-plus', [178, 301, 0x2c8]]])).values()];
    expect(patches.map((p) => p.id)).toEqual(['elp-effects', 'elp-healmsg', 'elp-farewell', 'elp-teleporter']);
    const built = buildPatches(code, patches);
    for (const b of built.values()) expect(b.errors).toEqual([]);
    const used = [...built.values()].reduce((n, b) => n + (b.cave ? b.cave[1] - b.cave[0] : 0), 0);
    expect(used).toBeLessThan(CAVE_END - CAVE_START);
  });

  test('only what the items use', () => {
    expect([...modEffectPatchesFor(new Map([['fixate', [37]]])).keys()]).toEqual(['effects', 'farewell']);
    expect([...modEffectPatchesFor(new Map([['ap-all', [34]]])).keys()]).toEqual(['healmsg']);
    expect([...modEffectPatchesFor(new Map([['teleporter-plus', [178]]])).keys()]).toEqual(['teleporter']);
    const full = modEffectPatchesFor(new Map([['full-all', [36]]])).get('effects')!.source;
    expect(full).toContain('FUN_002d8404');
    expect(full).not.toContain('elp_fixate');
    expect(full).not.toContain('elp_fixall');
  });

  test('message text', () => {
    expect([...encodeModText("[0011]あ[0001]'\n")]).toEqual([0x11, 0x3042, 1, 0x27, 0x0a, 0]);
  });
});

describe.skipIf(!hasCia)('item effects', () => {
  test('items get the effects; the export adds the patches', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const items = new ItemBook(game, new Map());
    const master = game.master;
    const made = new Map<ModEffectKey, number>();
    for (const e of MOD_EFFECTS) {
      const n = items.copyItem(e.key === 'teleporter-plus' ? 28 : 14);
      if (e.key !== 'teleporter-plus') items.setModEffect(n, e.key);
      made.set(e.key, n);
      expect(items.modEffect(n)?.key).toBe(e.key);
      const row = master.table('actionData.bin').row(items.item(n)!.action);
      expect(u16(row, 0x14)).toBe(n);
      if (e.w0 !== undefined) expect(u32(row, 0)).toBe(e.w0);
    }
    // テレポーター itself is not テレポーター+
    expect(modEffectOf(master, items.item(28)!.action)).toBeNull();
    // fixate: listed in the house, its result message added
    const fx = made.get('fixate')!;
    expect(u32(master.itemData.row(fx), 8) & HOUSE_ITEM_FLAG).toBe(HOUSE_ITEM_FLAG);
    const msg = u32(master.table('actionData.bin').row(items.item(fx)!.action), 0x0c);
    expect(master.texts.isAdded(msg)).toBe(true);
    // the item's own action is rewritten, not appended again
    const rows = master.table('actionData.bin').rows;
    items.setModEffect(fx, 'full-all');
    expect([master.table('actionData.bin').rows, items.modEffect(fx)?.key]).toEqual([rows, 'full-all']);
    items.setModEffect(fx, 'fixate');
    expect(usedModEffects(master).get('teleporter-plus')).toEqual([made.get('teleporter-plus')!]);
    const { patches, inBase } = modEffectPatches(master, game.dump.code);
    expect([patches.length, inBase]).toEqual([4, []]);
    const built = buildPatches(game.dump.code, patches);
    for (const b of built.values()) expect(b.errors).toEqual([]);
    // a base MOD with the same hooks: left out
    const patched = applyRecords(game.dump.code, patchRecords(built.values()));
    expect(modEffectPatches(master, patched).patches).toEqual([]);
  });

  const ips = join(BASE_MOD, 'code.ips');
  test.skipIf(!existsSync(ips))('the routines are those of elpulse (mod/out/code.ips)', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const vanilla = game.dump.code;
    const ref = applyIps(vanilla, new Uint8Array(readFileSync(ips)));
    const used = new Map([...ALL].filter(([k]) => !['fixate-all', 'unfix-all'].includes(k)));
    const built = buildPatches(vanilla, [...modEffectPatchesFor(used).values()]);
    const mine = applyRecords(vanilla, patchRecords(built.values()));
    const W = (c: Uint8Array, a: number): number => u32(c, a - 0x100000);
    // elpulse's routines, in its order, from the in-place hooks that call them
    const hooks: [number, string][] = [
      [0x310028, 'apply'],
      [0x2f4248, 'calc'],
      [0x318440, 'effective'],
      [0x24e3f0, 'healmsg1'],
      [0x24e360, 'healmsg2'],
      [0x220a58, 'packstore'],
      [0x290940, 'seedid'],
      [0x2d5300, 'recwrap'],
      [0x2c6600, 'tpcmp'],
      [0x2c66fc, 'tpok'],
      [0x2c6764, 'tprec'],
      [0x353480, 'tpesc'],
    ];
    const target = (c: Uint8Array, a: number): number => (a + 8 + (((W(c, a) & 0xffffff) << 8) >> 6)) >>> 0;
    const labels = new Map<string, number>();
    for (const b of built.values()) for (const [k, v] of b.labels) labels.set(k, v);
    const refAt = new Map(hooks.map(([a, n]) => [n, target(ref, a)]));
    // where elpulse's other routines start (item ID lookup, spring, switch), so each routine ends before them
    const others = [0x2f4c54, 0x1f0e8c, 0x1d1974, 0x2d7888].map((a) => target(ref, a));
    for (let a = CAVE_START; a < CAVE_END; a += 4) if (W(ref, a) === 0x57534e50) others.push(a);
    const sorted = [...refAt.values(), ...others].sort((a, b) => a - b);
    const routineOf = (starts: Map<string, number>, a: number): string => {
      let best = '';
      for (const [n, s] of starts) if (s <= a && (!best || s > starts.get(best)!)) best = n;
      return a >= CAVE_START && a < 0x4c0000 ? `${best}+${a - starts.get(best)!}` : a.toString(16);
    };
    const mineAt = new Map(hooks.map(([, n]) => [n, labels.get(`elp_${n}`)!]));
    let compared = 0;
    for (const [a, n] of hooks) {
      expect(routineOf(mineAt, target(mine, a))).toBe(`${n}+0`);
      expect(W(mine, a) >>> 24).toBe(W(ref, a) >>> 24);
    }
    for (const [n, ra] of refAt) {
      const ma = mineAt.get(n)!;
      const block = [...built.values()].flatMap((b) => b.blocks).find((b) => b.addr === ma)!;
      let end = sorted.find((s) => s > ra) ?? CAVE_END;
      while (end > ra && W(ref, end - 4) === 0) end -= 4;
      expect([n, block.lines.length]).toEqual([n, (end - ra) / 4]);
      for (let i = 0; i < block.lines.length; i++) {
        const r = W(ref, ra + i * 4),
          m = W(mine, ma + i * 4);
        compared++;
        if ((r & 0x0e000000) === 0x0a000000 && r >>> 0 !== 0) {
          expect([n, i, r >>> 24, routineOf(mineAt, target(mine, ma + i * 4))]).toEqual([
            n,
            i,
            m >>> 24,
            routineOf(refAt, target(ref, ra + i * 4)),
          ]);
        } else if ((r & 0x0f7f0000) === 0x051f0000) {
          const lit = (c: Uint8Array, a: number, w: number): number =>
            W(c, a + 8 + (w & 0x800000 ? w & 0xfff : -(w & 0xfff)));
          expect([n, i, m & 0xfff0f000, lit(mine, ma + i * 4, m)]).toEqual([
            n,
            i,
            r & 0xfff0f000,
            lit(ref, ra + i * 4, r),
          ]);
        } else if ((r & 0x0fff0000) === 0x028f0000) {
          expect(ma + i * 4 + 8 + (m & 0xff) - ma).toBe(ra + i * 4 + 8 + (r & 0xff) - ra);
        } else expect([n, i, m >>> 0]).toEqual([n, i, r >>> 0]);
      }
    }
    expect(compared).toBeGreaterThan(300);
  });
});
