// 電波人間のRPG (初代)'s BGM and sound effects (#176): soundData (252 × 0xC) named from sound/sound.bcsar, the sounds
// played, and the page. Needs the decrypted Base CIA (test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import type { SoundNames } from '../src/game/sound';
import { HonoluluSession } from '../src/honolulu/session';
import { honoluluSoundUses } from '../src/honolulu/sound';
import { HonoluluSoundBook } from '../src/honolulu/SoundPage';
import { openImage } from '../src/rom/dump';
import { hasHonolulu, HONOLULU_BASE } from './env';

describe.skipIf(!hasHonolulu)('初代の BGM・効果音 (ROM)', () => {
  let s: HonoluluSession;
  let sounds: SoundNames;
  beforeAll(async () => {
    s = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
    sounds = await s.sounds();
  });

  test('soundData: 252 rows, each a sound of sound.bcsar with its name', () => {
    expect(sounds.rows).toBe(252);
    expect(sounds.named).toBe(true);
    const unnamed: number[] = [];
    const kinds = { bgm: 0, me: 0, se: 0, other: 0 };
    for (let r = 1; r < sounds.rows; r++) {
      if (!sounds.name(r)) unnamed.push(r);
      kinds[sounds.kind(r)]++;
    }
    // the layout for naauao#55: the rows of each kind and the first names
    console.log('honolulu soundData kinds', kinds, 'unnamed', unnamed, 'first', Array.from({ length: 12 }, (_, i) => sounds.label(i + 1)));
    expect(unnamed).toEqual([]);
    expect(kinds.bgm).toBeGreaterThan(0);
    expect(kinds.se).toBeGreaterThan(0);
    expect(sounds.kind(1)).toBe('bgm');
  });

  test('a stream and a wave sound render', async () => {
    const r = await s.soundRenderer();
    for (const type of ['stream', 'wave'] as const) {
      const i = r.archive.sounds.findIndex((x) => x.type === type);
      expect(i).toBeGreaterThanOrEqual(0);
      const pcm = await r.render(i, 1);
      expect(pcm.channels[0]!.length).toBeGreaterThan(0);
    }
  });

  test('the sequenced BGMs (all but 2) play at their timebase (96) to their loop', async () => {
    const r = await s.soundRenderer();
    expect(r.archive.sounds.filter((x) => x.name.startsWith('BGM_') && x.type === 'stream').map((x) => x.name)).toEqual(['BGM_SYS_MAIN', 'BGM_SYS_ENDING']);
    const cave = r.archive.sounds.findIndex((x) => x.name === 'BGM_FLD_CAVE');
    const pcm = await r.render(cave, 300, true);
    // the loop as rendered at timebase 96 (at 48 it would be twice as long): 11.7 s to 140.1 s
    expect(pcm.loop).toBe(true);
    expect(pcm.loopStart / pcm.rate).toBeCloseTo(11.7, 0);
    expect(pcm.loopEnd / pcm.rate).toBeCloseTo(140.1, 0);
  });

  test('mapData +0x07 points at soundData rows (a guess)', () => {
    const md = s.master.rows('mapData.bin');
    const values = Array.from({ length: md.rows }, (_, r) => md.get(r, 'sound'));
    console.log('honolulu mapData +0x07', values.map((v) => (v ? sounds.label(v) : 0)));
    for (const v of values) expect(v).toBeLessThan(sounds.rows);
    const uses = honoluluSoundUses(s.master);
    expect([...uses.values()].flat().length).toBe(values.filter(Boolean).length);
  });

  test('the page lists the rows and the selected one', () => {
    const html = renderToString(<HonoluluSoundBook session={s} sounds={sounds} arg="1" />);
    expect(html).toContain(sounds.name(1));
    expect(html).toContain('使われている場所');
  });
});
