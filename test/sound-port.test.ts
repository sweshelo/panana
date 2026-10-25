// Porting BGMs of other games into RPG2 (src/sound/write.ts, src/port/sounds.ts, src/port/bgm.ts): a stream in RPG2's
// CSTM version and new stream sounds in sound.bcsar. The first part builds small files; the second needs the dumps
// (RPG2, and RPG3 / the first game for streams of other versions) and is skipped without them.
import { beforeAll, describe, expect, test } from 'bun:test';
import { Game } from '../src/game/game';
import { BCSAR_PATH, bcsarSoundNames } from '../src/game/sound';
import { bgmCandidates, originalSoundItem, portBgm, rowsPlaying } from '../src/port/bgm';
import { SoundPortStore } from '../src/port/sounds';
import { openImage, type Dump } from '../src/rom/dump';
import { Session } from '../src/session';
import { parseCstm, SoundArchive } from '../src/sound/formats';
import { addStreamSounds, cstmChannels, cstmForKahara, cstmVersion, trackInfo } from '../src/sound/write';
import { OahuSession } from '../src/oahu/session';
import type { Opened } from '../src/ui/workspace';
import { concat, s32, u16, u32, w16, w32 } from '../src/util/bytes';
import { CIA, HONOLULU_BASE, OAHU_BASE, hasCia, hasHonolulu, hasOahuBase } from './env';

const hexBytes = (s: string): Uint8Array => Uint8Array.from(s.split(' ').map((x) => parseInt(x, 16)));

/** A file of blocks after a 0x40 header (each block aligned to 0x20). */
function file(magic: string, version: number, blocks: [number, string, Uint8Array][]): Uint8Array {
  let at = 0x40;
  const placed = blocks.map(([type, m, body]) => {
    const size = Math.ceil((8 + body.length) / 0x20) * 0x20;
    const b = new Uint8Array(size);
    b.set(new TextEncoder().encode(m));
    w32(b, 4, size);
    b.set(body, 8);
    const p = { type, at, b };
    at += size;
    return p;
  });
  const out = new Uint8Array(at);
  out.set(new TextEncoder().encode(magic));
  w16(out, 4, 0xfeff);
  w16(out, 6, 0x40);
  w32(out, 8, version);
  w32(out, 0xc, at);
  w16(out, 0x10, placed.length);
  placed.forEach((p, i) => {
    w16(out, 0x14 + i * 12, p.type);
    w32(out, 0x18 + i * 12, p.at);
    w32(out, 0x1c + i * 12, p.b.length);
    out.set(p.b, p.at);
  });
  return out;
}

/** A stereo PCM16 stream laid out like RPG3's (version 2.2: no track, the region field after the stream info). */
function cstm22(samples: number): Uint8Array {
  const info = new Uint8Array(0x80);
  w16(info, 0, 0x4100);
  w32(info, 4, 0x18);
  w16(info, 8, 0);
  w32(info, 0x0c, -1);
  w16(info, 0x10, 0x0101);
  w32(info, 0x14, 0x5c);
  const si = 0x18;
  info[si] = 1; // PCM16
  info[si + 2] = 2;
  w32(info, si + 4, 32728);
  w32(info, si + 12, samples);
  w32(info, si + 16, 1);
  w32(info, si + 20, samples * 2);
  w32(info, si + 24, samples);
  w32(info, si + 28, samples * 2);
  w32(info, si + 32, samples);
  w32(info, si + 36, samples * 2);
  w32(info, si + 40, 4);
  w32(info, si + 44, samples);
  w16(info, si + 48, 0x1f00);
  w32(info, si + 52, 0x18);
  // the 2.2 region field
  w16(info, 0x50, 0x100);
  w32(info, 0x58, -1);
  // channel table: two channel infos without ADPCM info
  w32(info, 0x5c, 2);
  w16(info, 0x60, 0x4102);
  w32(info, 0x64, 0x14);
  w16(info, 0x68, 0x4102);
  w32(info, 0x6c, 0x1c);
  w32(info, 0x74, -1);
  w32(info, 0x7c, -1);
  const data = new Uint8Array(0x18 + samples * 4);
  for (let c = 0; c < 2; c++) for (let i = 0; i < samples; i++) w16(data, 0x18 + c * samples * 2 + i * 2, (c ? -1 : 1) * i * 100);
  return file('CSTM', 0x02020000, [[0x4000, 'INFO', info], [0x4001, 'SEEK', new Uint8Array(0x18)], [0x4002, 'DATA', data]]);
}

// RPG2's sound entry of BGM_TITLE (sound 0), as in sound.bcsar
const KAHARA_STREAM_SOUND = '00 00 00 00 00 00 00 04 55 00 00 00 01 22 00 00 3c 00 00 00 07 01 00 80 00 00 00 00 01 00 00 00 7f 00 00 00 2c 00 00 00 00 00 00 00 0f 00 00 00 00 00 00 3f 01 00 00 00 00 00 00 00 01 00 02 00 00 00 00 00';

/** A sound archive with two stream sounds (an external file and an internal one) and a stand-in lookup tree. */
function csar(): Uint8Array {
  // STRG: the string table and the tree
  const names = ['BGM_A', 'BGM_B'].map((n) => new TextEncoder().encode(`${n}\0`));
  const st = new Uint8Array(4 + 2 * 12);
  w32(st, 0, 2);
  let at = st.length;
  names.forEach((b, i) => {
    w16(st, 4 + i * 12, 0x1f01);
    w32(st, 8 + i * 12, at);
    w32(st, 12 + i * 12, b.length);
    at += b.length;
  });
  const table = concat([st, ...names]);
  const treeAt = 16 + Math.ceil(table.length / 4) * 4;
  const strg = new Uint8Array(treeAt + 16);
  w16(strg, 0, 0x2400);
  w32(strg, 4, 16);
  w16(strg, 8, 0x2401);
  w32(strg, 12, treeAt);
  strg.set(table, 16);
  strg.set(new TextEncoder().encode('TREE-NODES-HERE!'), treeAt);
  // INFO: sounds, five empty tables, files, project info
  const sound = (file: number, str: number): Uint8Array => {
    const e = hexBytes(KAHARA_STREAM_SOUND);
    w32(e, 0, file);
    w32(e, 0x18, str);
    return e;
  };
  const tableOf = (entries: Uint8Array[], refType: number): Uint8Array => {
    const head = 4 + entries.length * 8;
    const out = new Uint8Array(head + entries.reduce((n, e) => n + e.length, 0));
    w32(out, 0, entries.length);
    let o = head;
    entries.forEach((e, i) => {
      w16(out, 4 + i * 8, refType);
      w32(out, 8 + i * 8, o);
      out.set(e, o);
      o += e.length;
    });
    return out;
  };
  const ext = concat([hexBytes('0d 22 00 00 0c 00 00 00 00 00 00 00'), new TextEncoder().encode('stream/BGM_A.bcstm\0\0')]);
  const int = hexBytes('0c 22 00 00 0c 00 00 00 00 00 00 00 00 1f 00 00 00 00 00 00 08 00 00 00');
  const parts: [number, Uint8Array][] = [
    [0x2100, tableOf([sound(0, 0), sound(1, 1)], 0x2200)],
    ...[0x2104, 0x2101, 0x2103, 0x2105, 0x2102].map((t): [number, Uint8Array] => [t, new Uint8Array(4)]),
    [0x2106, tableOf([ext, int], 0x220a)],
    [0x220b, hexBytes('40 00 40 00 04 00 04 00 08 00 40 00 40 00 00 00 00 00 00 00')],
  ];
  let pos = 0x40;
  const head = new Uint8Array(0x40);
  parts.forEach(([t, b], i) => {
    w16(head, i * 8, t);
    w32(head, i * 8 + 4, pos);
    pos += b.length;
  });
  const info = concat([head, ...parts.map(([, b]) => b)]);
  return file('CSAR', 0x02020000, [[0x2000, 'STRG', strg], [0x2001, 'INFO', info], [0x2002, 'FILE', hexBytes('01 02 03 04 05 06 07 08')]]);
}

describe('sound files for a ported BGM', () => {
  test('a 2.2 stream gets a track table and plays the same', () => {
    const src = cstm22(100);
    const out = cstmForKahara(src);
    expect(cstmVersion(out)).toBe(0x02010000);
    expect(cstmChannels(out)).toBe(2);
    const a = parseCstm(src);
    const b = parseCstm(out);
    expect(b.rate).toBe(a.rate);
    expect(b.channels.map((c) => Array.from(c))).toEqual(a.channels.map((c) => Array.from(c)));
    // INFO: +0x08 track table at 0x50 = one track, right after the channel table (0x5c + 4 + 2 x 8 = 0x70)
    const body = u32(out, 0x18) + 8;
    expect(u16(out, body + 8)).toBe(0x0101);
    expect(s32(out, body + 0x0c)).toBe(0x50);
    expect(u32(out, body + 0x50)).toBe(1);
    expect(0x50 + s32(out, body + 0x58)).toBe(0x70);
    expect(Array.from(out.subarray(body + 0x70, body + 0x70 + 0x14))).toEqual(Array.from(trackInfo(2)));
    // a stream of RPG2's version is left as it is
    expect(cstmForKahara(out)).toBe(out);
  });

  test('sound.bcsar gets new stream sounds after its own, the rest unchanged', () => {
    const src = csar();
    const before = new SoundArchive(src);
    const out = addStreamSounds(src, 0, [{ name: 'BGM_OAHU_X', path: 'stream/BGM_OAHU_X.bcstm', volume: 0x60, channels: 1 }, { name: 'BGM_LANAI_Y', path: 'stream/BGM_LANAI_Y.bcstm', volume: 0x7f, channels: 2 }]);
    const a = new SoundArchive(out);
    expect(a.sounds.slice(0, 2)).toEqual(before.sounds);
    expect(a.sounds.slice(2).map((s) => [s.name, s.type, s.fileId, s.volume])).toEqual([['BGM_OAHU_X', 'stream', 2, 0x60], ['BGM_LANAI_Y', 'stream', 3, 0x7f]]);
    expect([0, 1, 2, 3].map((i) => a.file(i))).toEqual(['stream/BGM_A.bcstm', hexBytes('01 02 03 04 05 06 07 08'), 'stream/BGM_OAHU_X.bcstm', 'stream/BGM_LANAI_Y.bcstm']);
    expect(bcsarSoundNames(out)).toEqual(['BGM_A', 'BGM_B', 'BGM_OAHU_X', 'BGM_LANAI_Y']);
    expect(new TextDecoder().decode(out).includes('TREE-NODES-HERE!')).toBe(true);
    // the channels to allocate (stream detail +2)
    const info = u32(out, 0x24) + 8;
    const st = info + s32(out, info + 4);
    const e = st + s32(out, st + 8 + 2 * 8);
    expect(u16(out, e + s32(out, e + 0x10) + 2)).toBe(1);
    // nothing to add: the same file
    expect(addStreamSounds(src, 0, [])).toBe(src);
  });
});

describe.skipIf(!hasCia)('RPG2: ported BGMs (needs the dumps)', () => {
  let kahara: Dump;
  let bcsar: Uint8Array;
  beforeAll(async () => {
    kahara = await openImage(Bun.file(CIA), 'cia');
    bcsar = await kahara.readRomfs(BCSAR_PATH);
  });

  test('a new sound leaves every sound and file of sound.bcsar as it was', async () => {
    const before = new SoundArchive(bcsar);
    const title = await kahara.readRomfs('sound/stream/BGM_TITLE.bcstm');
    const out = addStreamSounds(bcsar, 0, [{ name: 'BGM_TEST_1', path: 'stream/BGM_TEST_1.bcstm', volume: 100, channels: 2 }]);
    const after = new SoundArchive(out);
    expect(after.sounds.length).toBe(before.sounds.length + 1);
    expect(after.sounds.slice(0, -1)).toEqual(before.sounds);
    expect(after.banks).toEqual(before.banks);
    expect(after.waveArchives).toEqual(before.waveArchives);
    for (let i = 0; i < 60; i++) expect(after.file(i)).toEqual(before.file(i));
    expect(after.file(60)).toBe('stream/BGM_TEST_1.bcstm');
    expect(bcsarSoundNames(out)).toEqual([...bcsarSoundNames(bcsar), 'BGM_TEST_1']);
    // the copy of BGM_TITLE's entry: the same player and stream detail
    expect(after.sounds.at(-1)).toMatchObject({ name: 'BGM_TEST_1', type: 'stream', fileId: 60, volume: 100 });
    // the game's sounds still play: a stream, a wave sound and a sequence; and the new one reads its file
    const { SoundRenderer } = await import('../src/sound/render');
    const r = new SoundRenderer(after, (p) => (p === 'stream/BGM_TEST_1.bcstm' ? Promise.resolve(title) : kahara.readRomfs(`sound/${p}`)));
    for (const type of ['stream', 'wave', 'sequence'] as const) {
      const pcm = await r.render(after.sounds.findIndex((s) => s.type === type), 1);
      expect(pcm.channels[0]!.length).toBeGreaterThan(0);
    }
    expect((await r.render(after.sounds.length - 1, 1)).channels.length).toBe(2);
  });

  test("RPG2's streams are already in its version", async () => {
    const title = await kahara.readRomfs('sound/stream/BGM_TITLE.bcstm');
    expect(cstmVersion(title)).toBe(0x02010000);
    expect(cstmForKahara(title)).toBe(title);
  });

  test.skipIf(!hasOahuBase)("an RPG3 stream: RPG2's version, the track info RPG2 writes, the same samples", async () => {
    const oahu = await openImage(Bun.file(OAHU_BASE), 'base');
    const src = await oahu.readRomfs('sound/stream/BGM_BATTLE_1.dspadpcm.bcstm');
    expect(cstmVersion(src)).toBe(0x02020000);
    const out = cstmForKahara(src);
    expect(cstmVersion(out)).toBe(0x02010000);
    // the track info of RPG2's own stereo streams
    const title = await kahara.readRomfs('sound/stream/BGM_TITLE.bcstm');
    const track = (d: Uint8Array): number[] => {
      const body = u32(d, 0x18) + 8;
      const table = body + s32(d, body + 0x0c);
      const t = table + s32(d, table + 8);
      return Array.from(d.subarray(t, t + trackInfo(2).length));
    };
    expect(track(out)).toEqual(track(title));
    const a = parseCstm(src);
    const b = parseCstm(out);
    expect([b.rate, b.loop, b.loopStart, b.loopEnd]).toEqual([a.rate, a.loop, a.loopStart, a.loopEnd]);
    expect(b.channels.every((c, i) => c.every((x, k) => x === a.channels[i]![k]))).toBe(true);
  }, 60000);

  test.skipIf(!hasHonolulu)('a stream of the first game (2.0, laid out as 2.1) is kept as it is', async () => {
    const h = await openImage(Bun.file(HONOLULU_BASE), 'base');
    const src = await h.readRomfs('sound/stream/BGM_SYS_MAIN.bcstm');
    expect(cstmForKahara(src)).toBe(src);
  });

  test.skipIf(!hasOahuBase)('porting from the picker: the row plays the new sound, the export writes it, and it can be put back', async () => {
    const dump = await openImage(Bun.file(CIA), 'cia');
    const game = await Game.load(dump);
    const store = SoundPortStore.fresh();
    store.attach(game.dump);
    game.soundPorts = store;
    const session = await Session.open(game, true);
    const oahu = await OahuSession.open(await openImage(Bun.file(OAHU_BASE), 'base'));
    const opened: Opened = { kahara: { session, editor: null as never }, oahu };
    const list = await bgmCandidates(opened);
    const c = list.find((x) => x.title === 'oahu' && x.name === 'BGM_BATTLE_1')!;
    expect(c).toBeTruthy();
    expect(list.some((x) => x.title === 'kahara')).toBe(false);
    // the store is the shared one in the app; the test gives its own to the game and patches `of`
    const of = SoundPortStore.of;
    SoundPortStore.of = () => Promise.resolve(store);
    try {
      const index = await portBgm(opened, session, c, 28);
      expect(index).toBe(430);
      const sounds = session.sounds!;
      expect(sounds.name(28)).toBe('BGM_OAHU_BATTLE_1');
      expect(sounds.index(28)).toBe(430);
      expect(await rowsPlaying(session, c)).toEqual([28]);
      // the second time it is reused
      expect(await portBgm(opened, session, c, 29)).toBe(430);
      expect(store.list().length).toBe(1);
      // it plays through RPG2's player (sound.bcsar and the stream read with the ported ones)
      const pcm = await (await game.soundRenderer()).render(430, 1);
      expect(pcm.channels.length).toBe(2);
      // the export: sound.bcsar and the stream
      const files = new Map(await store.files());
      expect([...files.keys()]).toEqual([BCSAR_PATH, 'sound/stream/BGM_OAHU_BATTLE_1.bcstm']);
      expect(cstmVersion(files.get('sound/stream/BGM_OAHU_BATTLE_1.bcstm')!)).toBe(0x02010000);
      expect(game.master.changedTables()).toContain('soundData.bin');
      // back to the game's sound
      const { setSoundItem } = await import('../src/port/bgm');
      for (const r of [28, 29]) setSoundItem(session, r, originalSoundItem(session, r));
      expect(sounds.name(28)).toBe('BGM_BATTLE_2');
      expect(game.master.changedTables()).not.toContain('soundData.bin');
    } finally {
      SoundPortStore.of = of;
    }
  }, 120000);
});
