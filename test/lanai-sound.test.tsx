// 電波人間のRPG FREE! (lanai): the SoundData rows named from sound/sound.bcsar, the places of the data that name them
// (src/lanai/sound.ts) and the BGM / sound effect page. Needs the decrypted Base and Update; skipped when missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import type { SoundNames } from '../src/game/sound';
import { LANAI_BF, LANAI_MAP_SOUNDS } from '../src/lanai/battleField';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiSoundHref } from '../src/lanai/hrefs';
import { LanaiSession } from '../src/lanai/session';
import {
  LANAI_DOOR_SOUND_ARG,
  lanaiContentSoundUses,
  lanaiMasterSoundUses,
  type LanaiSoundUse,
} from '../src/lanai/sound';
import { LanaiSoundBook } from '../src/lanai/SoundPage';
import { openImages } from '../src/rom/dump';
import { LANAI_PAGES } from '../src/ui/LanaiShell';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

test('the sound page is one of RPG FREE!’s pages', () => {
  expect(LANAI_PAGES.some(([id, label]) => id === 'sounds' && label === 'BGM・効果音')).toBe(true);
  expect(lanaiSoundHref(12)).toBe('#/sounds/12');
  // the door actions with an opening sound: the argument after the key's two
  expect(LANAI_DOOR_SOUND_ARG[0x80000015]).toBe(2);
  expect(LANAI_DOOR_SOUND_ARG[0x80000016]).toBe(4);
});

describe.skipIf(!hasLanai)('RPG FREE! sounds', () => {
  let s: LanaiSession;
  let sounds: SoundNames;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
    sounds = await s.sounds();
  }, 300000);

  test('SoundData rows are named from sound.bcsar', () => {
    expect(sounds.rows).toBe(s.need('SoundData').rows);
    expect(sounds.named).toBe(true);
    const kinds = new Set(Array.from({ length: sounds.rows - 1 }, (_, i) => sounds.kind(i + 1)));
    expect(kinds.has('bgm')).toBe(true);
    expect(kinds.has('se')).toBe(true);
  });

  test('the master’s battle fields name their BGM', () => {
    const uses = lanaiMasterSoundUses(s);
    const t = s.need('BattleField');
    const row = Array.from({ length: t.rows }, (_, r) => r).find((r) => t.u32(r, LANAI_BF.bgm))!;
    const use = uses.get(t.u32(row, LANAI_BF.bgm))!;
    expect(use).toContainEqual({
      kind: 'battle',
      what: '戦闘の BGM',
      where: `BattleField 行 ${row}`,
      content: undefined,
    });
    expect(sounds.kind(t.u32(row, LANAI_BF.bgm))).toBe('bgm');
  });

  test('a content’s maps name their sounds, with a link to its maps', async () => {
    const c = lanaiContents(s)[1]!;
    const uses = new Map<number, LanaiSoundUse[]>();
    await lanaiContentSoundUses(s, c, uses);
    const md = (await s.tablesIn(c.archive)).find((x) => x.table.name === 'MapData')!.table;
    const field = LANAI_MAP_SOUNDS[0];
    const row = Array.from({ length: md.rows }, (_, r) => r).find((r) => md.u16(r, field.offset))!;
    const use = uses.get(md.u16(row, field.offset))!.find((u) => u.kind === 'map' && u.where === `MapData 行 ${row}`)!;
    expect(use.what).toBe(field.label);
    expect(use.content?.href).toBe('#/maps/1');
    expect(use.content?.label.startsWith('1: ')).toBe(true);
  });

  test('the page lists the rows and the uses of the selected one', () => {
    const uses = lanaiMasterSoundUses(s);
    const row = [...uses.keys()][0]!;
    const html = renderToString(<LanaiSoundBook session={s} sounds={sounds} arg={String(row)} uses={uses} />);
    expect(html).toContain(sounds.name(row));
    expect(html).toContain('戦闘の BGM');
    expect(html).toContain('BattleField 行');
  });
});
