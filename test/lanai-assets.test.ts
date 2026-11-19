import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { parseBch } from '../src/bch/bch';
import { lanaiItems, lanaiItemBody } from '../src/lanai/items';
import { lanaiModelIndex, lanaiMonsters } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import { replaceLanaiItemTexture, replaceLanaiMonsterTexture } from '../src/lanai/textures';
import { portLanaiBgm } from '../src/lanai/bgm';
import { bgmCandidates } from '../src/port/bgm';
import { openImages } from '../src/rom/dump';
import { hasLanai, hasOahuBase, hasOahuUpdate, LANAI_BASE, LANAI_UPDATE, OAHU_BASE, OAHU_UPDATE } from './env';
import { OahuSession } from '../src/oahu/session';
import type { Opened } from '../src/ui/workspace';
import { PortStore } from '../src/port/store';

describe.skipIf(!hasLanai)('FREE! custom assets', () => {
  let s: LanaiSession;
  let previous: Set<string>;
  beforeAll(async () => {
    previous = new Set((await PortStore.of('lanai')).list().map((e) => `${e.archive}/${e.hash}`));
    s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as File).name),
      { fresh: true },
    );
  });
  afterAll(async () => {
    const store = await PortStore.of('lanai');
    for (const e of [...store.list()]) {
      if (!previous.has(`${e.archive}/${e.hash}`)) store.remove(e.archive, [e.hash]);
    }
  });

  test('monster texture replacement isolates the design and exports the encoded BCH', async () => {
    const designs = s.need('MonsterDesign');
    const index = await lanaiModelIndex(s);
    const m = lanaiMonsters(s).find(
      (m) =>
        m.designRow >= 0 &&
        index.body(designs.u32(m.designRow, 0x0c)) &&
        parseBch(index.body(designs.u32(m.designRow, 0x0c))!).textures.length,
    );
    expect(m).toBeDefined();
    const old = designs.row(m!.designRow).slice();
    const oldHash = designs.u32(m!.designRow, 0x0c);
    const t = parseBch(index.body(oldHash)!).textures[0]!;
    const rgba = new Uint8Array(t.width * t.height * 4).fill(255);
    await replaceLanaiMonsterTexture(s, m!.row, t.name, { width: t.width, height: t.height, rgba });
    const next = s.need('MonsterParameter').bits(m!.row, 0, 20, 10);
    expect(next).not.toBe(m!.designRow);
    expect(designs.row(m!.designRow)).toEqual(old);
    const hash = designs.u32(next, 0x0c);
    const entry = (await lanaiModelIndex(s)).get(hash)!;
    const arc = parseArchive((await s.allModFiles()).get(entry.archive)!);
    const texture = parseBch(unpackEntry(arc, findEntry(arc, hash)!).body).textures.find((x) => x.name === t.name)!;
    expect(texture.rgba.every((v) => v >= 245)).toBe(true);
  });

  test('item texture replacement isolates shared core rows and persists the model reference', async () => {
    let chosen;
    for (const it of lanaiItems(s)) {
      const body = await lanaiItemBody(s, it);
      if (!body) continue;
      const t = parseBch(body).textures[0];
      if (t) {
        chosen = { it, t };
        break;
      }
    }
    expect(chosen).toBeDefined();
    const { it, t } = chosen!;
    const old = s.need('ItemDataCore').row(it.core).slice();
    await replaceLanaiItemTexture(s, it.row, t.name, {
      width: t.width,
      height: t.height,
      rgba: new Uint8Array(t.width * t.height * 4).fill(255),
    });
    const updated = lanaiItems(s).find((x) => x.row === it.row)!;
    expect(updated.core).not.toBe(it.core);
    expect(s.need('ItemDataCore').row(it.core)).toEqual(old);
    expect(parseBch((await lanaiItemBody(s, updated))!).textures[0]!.rgba.every((v) => v >= 245)).toBe(true);
    expect(s.saved().rows.some(([table]) => table.includes('/'))).toBe(true);
  });

  test.skipIf(!hasOahuBase || !hasOahuUpdate)(
    'BGM ports play, reuse rows, restore and export without changing the source',
    async () => {
      const oahu = await OahuSession.open(
        await openImages([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], (f) => (f as File).name),
      );
      const opened: Opened = { lanai: s, oahu };
      const c = (await bgmCandidates(opened, 'lanai'))[0]!;
      const original = await s.dump.readRomfs('sound/sound.bcsar');
      const before = s.need('SoundData').rows;
      await expect(portLanaiBgm(opened, s, c, before - 1)).rejects.toThrow();
      expect(s.need('SoundData').rows).toBe(before);
      const row = await portLanaiBgm(opened, s, c, 65535);
      expect(await portLanaiBgm(opened, s, c, 65535)).toBe(row);
      expect(s.need('SoundData').rows).toBe(before + 1);
      expect((await s.sounds()).name(row)).toContain(c.name);
      const renderer = await s.soundRendererFor(row);
      const index = s.need('SoundData').u32(row, 0) & 0xffffff;
      expect(await renderer.render(index, 0.1, false)).toBeDefined();
      const files = await s.allModFiles();
      expect(files.has('sound/patch.bcsar')).toBe(true);
      expect(await s.dump.readRomfs('sound/sound.bcsar')).toEqual(original);
      const saved = s.saved();
      s.revertAll();
      await s.restore(saved);
      expect((await s.sounds()).name(row)).toContain(c.name);
      expect((await s.allModFiles()).get('sound/patch.bcsar')).toEqual(files.get('sound/patch.bcsar'));
    },
  );

  test.skipIf(!hasOahuBase || !hasOahuUpdate)(
    'SE ports render internal sounds and keep same-named source sounds distinct',
    async () => {
      const target = await LanaiSession.open(
        await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as File).name),
        { fresh: true },
      );
      const oahu = await OahuSession.open(
        await openImages([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], (f) => (f as File).name),
      );
      const opened: Opened = { lanai: target, oahu };
      const renderer = await oahu.soundRenderer();
      const effects = (await bgmCandidates(opened, 'lanai')).filter(
        (c) => c.kind === 'se' && renderer.archive.sounds[c.index]?.type === 'wave',
      );
      expect(effects.length).toBeGreaterThan(1);
      const first = effects[0]!;
      const second = { ...effects[1]!, name: first.name };
      const row = await portLanaiBgm(opened, target, first, 65535);
      expect(await portLanaiBgm(opened, target, first, 65535)).toBe(row);
      const other = await portLanaiBgm(opened, target, second, 65535);
      expect(other).not.toBe(row);
      const sequence = (await bgmCandidates(opened, 'lanai')).find(
        (c) => c.kind === 'se' && renderer.archive.sounds[c.index]?.type === 'sequence',
      )!;
      const sequenceRow = await portLanaiBgm(opened, target, sequence, 65535);
      const names = await target.sounds();
      expect(names.kind(row)).toBe('se');
      expect(names.name(row)).not.toBe(names.name(other));
      expect(names.kind(sequenceRow)).toBe('se');
      await expect((await target.soundRendererFor(row)).render(names.index(row)!, 1, false)).resolves.toBeDefined();
      await expect(
        (await target.soundRendererFor(sequenceRow)).render(names.index(sequenceRow)!, 1, false),
      ).resolves.toBeDefined();
      const files = await target.allModFiles();
      expect(files.has('sound/patch.bcsar')).toBe(true);
      expect([...files.keys()].filter((n) => n.startsWith('sound/stream/')).length).toBe(3);
      const saved = target.saved();
      target.revertAll();
      await target.restore(saved);
      expect((await target.sounds()).name(row)).toBe(names.name(row));
    },
  );
});
