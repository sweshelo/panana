// 電波人間のRPG3 (oahu): sound/sound.bcsar (names of the soundData rows), its streams and the BGM page (#80,
// naauao oahu/sound.md). Needs the decrypted Base (and the Update for the uses in code.bin); skipped when missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import type { SoundNames } from '../src/game/sound';
import { OAHU_SECTIONS } from '../src/oahu/code';
import { OahuSession } from '../src/oahu/session';
import { OahuSoundBook } from '../src/oahu/SoundPage';
import { codeCalls, OAHU_SOUND_CODE, oahuSoundUses } from '../src/oahu/sound';
import { openImage, openImages } from '../src/rom/dump';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

const TEXT_END = OAHU_SECTIONS.text[0] + OAHU_SECTIONS.text[1];

describe.skipIf(!hasOahuBase)('RPG3 sounds (Base)', () => {
  let s: OahuSession;
  let sounds: SoundNames;
  beforeAll(async () => {
    s = await OahuSession.open(await openImage(Bun.file(OAHU_BASE), 'base'));
    sounds = await s.sounds();
  });

  test('soundData: 597 rows named from sound.bcsar (611 sounds)', () => {
    expect(sounds.rows).toBe(597);
    expect(sounds.named).toBe(true);
    expect([1, 7, 8, 24, 37, 59, 88].map((r) => sounds.name(r))).toEqual(['BGM_TITLE', 'BGM_BATTLE_1', 'BGM_BATTLE_2', 'BGM_CAVE_NORMAL', 'ME_ITEMGET', 'SE_SYS_SELECT', 'SE_FLD_STEPS1']);
    expect([7, 37, 59].map((r) => sounds.kind(r))).toEqual(['bgm', 'me', 'se']);
    expect(sounds.volume(7)).toBe(100);
  });

  test('a stream, a wave sound and a sequence render', async () => {
    const r = await s.soundRenderer();
    for (const type of ['stream', 'wave', 'sequence'] as const) {
      const i = r.archive.sounds.findIndex((x) => x.type === type);
      const pcm = await r.render(i, 1);
      expect(pcm.channels[0]!.length).toBeGreaterThan(0);
    }
  });

  test('uses without the Update: mapData and the dungeons, the default BGM of the boss groups', () => {
    const uses = oahuSoundUses(s.master, s.battle, null, TEXT_END);
    const cave = uses.get(24)!;
    expect(cave.some((u) => u.kind === 'map' && u.where === 'mapData 行 1' && u.links?.some((l) => l.label === 'ドローンのどうくつ'))).toBe(true);
    const boss = uses.get(8)!.filter((u) => u.kind === 'battle');
    // 24 groups in the Base's master, 22 in the Update's
    expect(boss.length).toBe(24);
    expect(boss.some((u) => u.where.startsWith('群れ #19 ') && u.links?.[0]?.href === '#/groups/19')).toBe(true);
    expect(uses.get(23)?.some((u) => u.kind === 'code')).toBeFalsy();
    // the steps
    expect(uses.get(88)!.every((u) => u.what === '足音')).toBe(true);
  });

  test('the page lists the rows and shows where the selected one is used', () => {
    const html = renderToString(<OahuSoundBook session={s} sounds={sounds} arg="24" />);
    expect(html).toContain('596 / 596 件');
    expect(html).toContain('BGM_CAVE_NORMAL');
    expect(html).toContain('ドローンのどうくつ');
    expect(html).toContain('play-button large');
    expect(html).toContain('Update を追加すると');
  });
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 sounds (Base + Update)', () => {
  let s: OahuSession;
  beforeAll(async () => {
    s = await OahuSession.open(await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia'));
  });

  test('BGM rows written in code.bin: the ending, the fixed battles', () => {
    const code = s.code!;
    expect(codeCalls(code, OAHU_SOUND_CODE.playBgm, TEXT_END).filter((c) => c.r0 === 23).map((c) => c.at)).toEqual([0x1d7ae8, 0x1d8cb8, 0x1d9ac8]);
    const uses = oahuSoundUses(s.master, s.battle, code, TEXT_END);
    expect(uses.get(23)!.filter((u) => u.kind === 'code').length).toBe(3);
    // FUN_0021112C(&hash of group 19, 0) at 0x2BAE18: BGM_BATTLE_2 by the group's bit
    expect(uses.get(8)!.some((u) => u.where.startsWith('@0x2BAE18') && u.links?.[0]?.href === '#/groups/19')).toBe(true);
    expect(uses.get(9)!.filter((u) => u.kind === 'battle').length).toBe(5);
    expect(uses.get(8)!.filter((u) => u.kind === 'battle' && u.where.startsWith('群れ')).length).toBe(22);
    const html = renderToString(<OahuSoundBook session={s} sounds={{ rows: 597, name: () => '', kind: () => 'bgm', item: () => 0, volume: () => 0, named: true, index: () => null, label: () => '' } as unknown as SoundNames} arg="23" />);
    expect(html).toContain('FUN_00213970');
    expect(html).not.toContain('Update を追加すると');
  });
});
