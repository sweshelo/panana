// TEMPORARY (#78): mesh priority / depth write of the monsters' eyes vs bodies in RPG2 and RPG3. Removed before the PR.
import { describe, expect, test } from 'bun:test';
import { findByName, findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { bchOffset, parseBch } from '../src/bch/bch';
import type { CgfxModel } from '../src/cgfx/cgfx';
import { Game } from '../src/game/game';
import { openImage, openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia, hasOahuBase, OAHU_BASE, OAHU_UPDATE, hasOahuUpdate } from './env';

const L = (...a: unknown[]): void => console.log('EXPLORE', ...a);

function summarize(tag: string, model: CgfxModel, stats: Map<string, number>, examples: Map<string, string>): void {
  const desc = (i: number): string => {
    const me = model.meshes[i]!;
    const m = model.materials[me.material];
    return `p${me.priority} L${m?.layer} dw${+!!m?.depthWrite} bl${+!!m?.blendFunc?.blend}`;
  };
  const isEye = (i: number): boolean => /eye/i.test(model.materials[model.meshes[i]!.material]?.name ?? '');
  const idx = model.meshes.map((_, i) => i);
  for (const i of idx.filter(isEye)) {
    const k = `${tag} eye ${desc(i)} | others ${[...new Set(idx.filter((j) => !isEye(j)).map(desc))].sort().join(' / ')}`;
    stats.set(k, (stats.get(k) ?? 0) + 1);
    if (!examples.has(k)) examples.set(k, model.name);
  }
}

describe.skipIf(!hasCia)('explore eyes', () => {
  test('eye vs body draw settings', async () => {
    const stats = new Map<string, number>();
    const examples = new Map<string, string>();
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await game.monsters();
    const { buildComposite } = await import('../src/cgfx/tileset');
    const { MONSTER_MODEL_ARCHIVE } = await import('../src/game/monsters');
    const arc = parseArchive(await game.dump.readRomfs(MONSTER_MODEL_ARCHIVE));
    const seen = new Set<number>();
    for (const mon of book.monsters) {
      const x = book.modelOf(mon);
      if (!x || seen.has(x.model)) continue;
      seen.add(x.model);
      const model = buildComposite(arc, x.model, x.texture).models.get(x.model);
      if (model) summarize('kahara', model, stats, examples);
    }
    if (hasOahuBase) {
      const dump = hasOahuUpdate ? await openImages([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], (f) => (f as unknown as { name: string }).name) : await openImage(Bun.file(OAHU_BASE), 'base');
      const oarc = parseArchive(await dump.readRomfs('28480000'));
      const table = new GsTable(findByName(parseArchive(await dump.readRomfs('402F0000')), 'monsterDesign.bin')!.body);
      const done = new Set<number>();
      for (let row = 0; row < table.rows; row++) {
        const h = u32(table.row(row), 0x0c);
        const e = h && !done.has(h) ? findEntry(oarc, h) : undefined;
        if (!e) continue;
        done.add(h);
        const b = unpackEntry(oarc, e).body;
        try {
          const m = parseBch(b.subarray(bchOffset(b))).models[0];
          if (m) summarize('oahu', m, stats, examples);
        } catch {
          /* skip */
        }
      }
    }
    for (const [k, n] of [...stats].sort((a, b) => b[1] - a[1])) L(`${n} x ${k}  (e.g. ${examples.get(k)})`);
    expect(seen.size).toBeGreaterThan(0);
  }, 300_000);
});
