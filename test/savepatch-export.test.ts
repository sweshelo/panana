import { describe, expect, test } from 'bun:test';
import type { Game } from '../src/game/game';
import { codeIps, exportedPatches } from '../src/export/pack';
import { applyRecords, buildPatches, patchRecords } from '../src/game/patch';
import { applyIps } from '../src/rom/ips';
import { SAVE_PATCH, SAVE_PATCH_ID, SAVE_PATCH_SITES } from '../src/game/savepatch';
import { w32 } from '../src/util/bytes';
import { BASE } from '../src/game/codeconst';

function game(): Game {
  const code = new Uint8Array(0x500000);
  for (const [a, word] of SAVE_PATCH_SITES) w32(code, a - BASE, word);
  return { dump: { code }, code: { addedMaps: () => [] }, codePatches: [], baseMod: null, extSave: false } as unknown as Game;
}
describe('ExtData patch export', () => {
  test('opt in writes the whole runtime and every hook, once', () => {
    const g = game(); expect(codeIps(g)).toBeNull();
    g.extSave = true;
    expect(exportedPatches(g, [SAVE_PATCH]).filter(p => p.id === SAVE_PATCH_ID).length).toBe(1);
    const built = buildPatches(g.dump.code, [SAVE_PATCH]).get(SAVE_PATCH_ID)!;
    expect(applyIps(g.dump.code, codeIps(g)!)).toEqual(applyRecords(g.dump.code, patchRecords([built])));
  });
  test('a conflicting original instruction refuses export instead of silently dropping saving', () => {
    const g = game(); g.extSave = true; w32(g.dump.code, 0x33789c - BASE, 0);
    expect(() => codeIps(g)).toThrow('ExtData');
  });
  test('cave exhaustion or another patch on a save hook refuses the package', () => {
    const g = game(); g.extSave = true;
    const conflict = { id: 'conflict', title: 'conflict', enabled: true, source: '@0x33789c\n mov r0, #0' };
    expect(() => codeIps(g, [conflict])).toThrow();
    w32(g.dump.code, 0x4bfe00 - BASE, 1);
    expect(() => codeIps(g)).toThrow('code cave');
  });
});
