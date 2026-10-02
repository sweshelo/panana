// BCH (H3D) models of 電波人間のRPG3: every BCH of the Base reads, and a monster comes out whole (src/bch/).
// Needs the decrypted Base CIA (test/env.ts OAHU_BASE); skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { bchOffset, bchSummary, parseBch } from '../src/bch/bch';
import { bchModelSet } from '../src/bch/models';
import { OahuSession } from '../src/oahu/session';
import { openImage, type Dump } from '../src/rom/dump';
import { viewsFor } from '../src/romfs/formats';
import { asArchive } from '../src/romfs/sniff';
import { hasOahuBase, OAHU_BASE } from './env';

describe.skipIf(!hasOahuBase)('RPG3 BCH', () => {
  let dump: Dump;
  beforeAll(async () => {
    dump = await openImage(Bun.file(OAHU_BASE), 'base');
  });

  test('every BCH of the Base (types 2, 5, 8, 10) is version 8 and reads', async () => {
    const byType = new Map<number, number>();
    let models = 0, textures = 0, motions = 0;
    for (const n of dump.names()) {
      const a = asArchive(await dump.readRomfs(n), n);
      if (!a) continue;
      for (const e of a.entries) {
        const body = unpackEntry(a, e).body;
        const o = bchOffset(body);
        if (o < 0) continue;
        byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
        const bch = body.subarray(o);
        expect(bchSummary(bch).header.backward).toBe(8);
        const f = parseBch(bch);
        models += f.models.length;
        textures += f.textures.length;
        motions += f.models[0]?.animations.filter((x) => x.kind === 'skeletal').length ?? 0;
        for (const m of f.models)
          for (const me of m.meshes) {
            expect(me.indices.length % 3).toBe(0);
            expect(me.indices.every((i) => i < me.positions.length / 3)).toBe(true);
          }
      }
    }
    expect(Object.fromEntries(byType)).toEqual({ 2: 2468, 5: 2, 8: 646, 10: 125 });
    expect([models, textures]).toEqual([2352, 3453]);
    expect(motions).toBeGreaterThan(1000);
  }, 120_000);

  test('a monster (enemy_03_01): meshes on its skeleton, textures, looping motions; the RomFS viewer shows it as a model', async () => {
    const arc = parseArchive(await dump.readRomfs('28480000'));
    const body = unpackEntry(arc, findEntry(arc, 0x5044d400)!).body;
    expect(viewsFor(body, null)[0]!.id).toBe('bch');
    const f = parseBch(body);
    const m = f.models[0]!;
    expect(m.name).toBe('enemy_03_01');
    expect([m.meshes.length, m.materials.length, m.bones.length]).toEqual([4, 3, 23]);
    expect(m.meshes.reduce((n, x) => n + x.indices.length / 3, 0)).toBe(1046);
    expect(m.materials[0]!.textures[0]).toBe('enemy_03_body');
    expect(m.materials[0]!.tev).toHaveLength(6);
    // Smooth skinning on the body: weights per vertex sum to 1.
    const w = m.meshes[0]!.skinWeights!;
    for (let i = 0; i < w.length; i += 4) expect(Math.abs(w[i]! + w[i + 1]! + w[i + 2]! + w[i + 3]! - 1)).toBeLessThan(1e-3);
    expect(f.textures.map((t) => [t.name, t.width, t.height])).toEqual([['enemy_03_body', 512, 512], ['enemy_03_eye', 128, 128]]);
    const motions = m.animations.filter((a) => a.kind === 'skeletal');
    expect(motions.map((a) => [a.name, a.frames, a.loop])).toEqual([['001_E03_wait', 120, true], ['003_E03_walk', 60, true], ['004_E03_run', 44, true]]);
    expect(motions[0]!.skeletal.every((t) => m.bones.some((b) => b.name === t.bone))).toBe(true);
    expect(bchModelSet(body).models.get(0)?.name).toBe('enemy_03_01');
  });

  test('type 8 (map parts): the BCH after the 0x180-byte header, with its textures', async () => {
    const arc = parseArchive(await dump.readRomfs('07E40000'));
    const body = unpackEntry(arc, findEntry(arc, 0x07f71400)!).body;
    expect(bchOffset(body)).toBe(0x180);
    const set = bchModelSet(body);
    expect(set.models.get(0)?.name).toBe('bgpt_15_green_26');
    expect([...set.textures.keys()]).toContain('twn_flower');
  });

  test('item models: every model hash of itemData is found, and the textures its materials name come with it', async () => {
    const s = await OahuSession.open(dump);
    const hashes = [...new Set(s.items.items.map((it) => it.model).filter((h) => h))];
    expect(hashes.length).toBe(804);
    const kinds = new Map<string, number>();
    for (const h of hashes) {
      const m = (await s.itemModels.model(h))!;
      expect(m).not.toBeNull();
      const k = `${m.archive} ${m.kind}`;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (m.kind !== 'model') continue;
      const { set } = (await m.ref.load())!;
      for (const model of set.models.values())
        for (const mat of model.materials) for (const t of mat.textures) if (t) expect(set.textures.has(t)).toBe(true);
    }
    expect(Object.fromEntries(kinds)).toEqual({
      '838B0000 model': 239, '96EB0000 model': 229, 'D4270000 model': 142, '982C0000 model': 10, '980C0000 texture': 95, '21350000 texture': 89,
    });
    const potion = (await s.itemModels.model(s.items.item(1)!.model))!;
    expect(potion.kind === 'model' && (await potion.ref.load())!.set.models.get(0)!.name).toBe('item');
  }, 120_000);
});
