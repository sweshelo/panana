def rep(s,a,b):
    assert a in s, a[:70]
    return s.replace(a,b)
p='test/boss.test.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""import { BOSS_PATCH_ID, BOSS_PATCH_SOURCE, KIND_BOSS, decodeFix, encodeFix, ensureBossPatch, newBossRecord, newBossRow, readStages, writeStages, type BossStage } from '../src/game/boss';""","""import { BOSS_PATCH, BOSS_PATCH_ID, KIND_BOSS, decodeFix, encodeFix, newBossRecord, newBossRow, readStages, usesBoss, writeStages, type BossStage } from '../src/game/boss';
import { codeIps } from '../src/export/pack';
import { applyIps } from '../src/rom/ips';""")
i=s.index("  test('the patch is added once and kept up to date'")
j=s.index("});\n\ndescribe.skipIf")
s=s[:i].rstrip()+"\n"+s[j:]
s=rep(s,"""  let code: Uint8Array;
  let built: BuiltPatch;""","""  let game: Game;
  let code: Uint8Array;
  let built: BuiltPatch;""")
s=rep(s,"""    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    code = game.dump.code;
    built = buildPatches(code, ensureBossPatch([])).get(BOSS_PATCH_ID)!;""","""    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    code = game.dump.code;
    built = buildPatches(code, [BOSS_PATCH]).get(BOSS_PATCH_ID)!;""")
s=rep(s,"""  test('a range of kind 0x31""","""  test('exported in code.ips only when asked (a boss row exists)', async () => {
    expect(codeIps(game)).toBeNull();
    expect(applyIps(code, codeIps(game, [BOSS_PATCH])!)).toEqual(patched);
    const ev = (await game.eventTable(5))!;
    expect(usesBoss([ev])).toBe(false);
    const saved = ev.data.slice();
    ev.addRow(newBossRow(ev.table.rowSize, 9));
    expect(usesBoss([ev])).toBe(true);
    ev.restore(saved);
  });

  test('a range of kind 0x31""")
open(p,'w',encoding='utf-8').write(s)
