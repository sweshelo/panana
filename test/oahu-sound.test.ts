// 電波人間のRPG3 (oahu): sound/sound.bcsar (names of the soundData rows) and its streams (#80).
import { beforeAll, describe, expect, test } from 'bun:test';
import { parseArchive, findByName } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { BCSAR_PATH, bcsarSoundNames } from '../src/game/sound';
import { SoundArchive } from '../src/sound/formats';
import { SoundRenderer } from '../src/sound/render';
import { openImage, type Dump } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasOahuBase, OAHU_BASE } from './env';

describe.skipIf(!hasOahuBase)('RPG3 sounds (Base)', () => {
  let dump: Dump;
  let bcsar: Uint8Array;
  beforeAll(async () => {
    dump = await openImage(Bun.file(OAHU_BASE), 'base');
    bcsar = await dump.readRomfs(BCSAR_PATH);
  });

  test('names of the soundData rows (probe)', async () => {
    const names = bcsarSoundNames(bcsar);
    const arc = new SoundArchive(bcsar);
    const m = parseArchive(await dump.readRomfs('21350000'));
    const t = new GsTable(findByName(m, 'soundData.bin')!.body);
    const lines: string[] = [`bcsar sounds ${names.length}, soundData ${t.rows}`];
    for (let r = 0; r < t.rows; r++) {
      const id = u32(t.row(r), 0);
      const i = id & 0xffffff;
      const s = arc.sounds[i];
      lines.push(`${r}\t${id.toString(16)}\t${names[i] ?? ''}\t${s?.type ?? ''}\t${s?.volume ?? ''}\t${t.row(r)[8]}`);
    }
    lines.push('-- sounds not in soundData');
    const used = new Set(Array.from({ length: t.rows }, (_, r) => u32(t.row(r), 0) & 0xffffff));
    names.forEach((n, i) => used.has(i) || lines.push(`${i}\t${n}\t${arc.sounds[i]?.type}`));
    console.log(lines.join('\n'));
    console.log((dump.files!().filter((f) => f.path.startsWith('sound/')).map((f) => f.path)).join('\n'));
    expect(names.length).toBeGreaterThan(0);
  });

  test('a stream, a wave sound and a sequence render', async () => {
    const arc = new SoundArchive(bcsar);
    const r = new SoundRenderer(arc, (p) => dump.readRomfs(`sound/${p}`));
    for (const type of ['stream', 'wave', 'sequence'] as const) {
      const i = arc.sounds.findIndex((s) => s.type === type);
      const pcm = await r.render(i, 1);
      console.log(type, i, arc.sounds[i]!.name, pcm.rate, pcm.channels.length, pcm.channels[0]!.length);
      expect(pcm.channels[0]!.length).toBeGreaterThan(0);
    }
  });
});
