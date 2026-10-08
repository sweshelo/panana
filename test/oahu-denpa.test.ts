import { beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { GsTable } from '../src/archive/gstable';
import { AnimatedModel } from '../src/cgfx/player';
import { ModelFactory } from '../src/cgfx/three';
import { denpaAppearance, denpaFaceUv, denpaPreviewRow, denpaSourceLabel, OahuDenpaModels } from '../src/oahu/denpaModels';
import { oahuCharaModel } from '../src/oahu/mapObjects';
import { OahuMessages } from '../src/oahu/messages';
import { OahuMaster } from '../src/oahu/master';
import { openImage, openUpdate, withUpdate, type Dump } from '../src/rom/dump';
import { w16, w32 } from '../src/util/bytes';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

describe('RPG3 Denpa character selectors', () => {
  test('all three variants keep the kind and selector; invalid variants and unknown kinds have no model', () => {
    const bytes = new Uint8Array(0x40 + 3 * 0x14);
    w32(bytes, 0, 3); w32(bytes, 4, 0x14); w32(bytes, 0x10, 0x40);
    const t = new GsTable(bytes);
    for (const kind of [2, 3] as const) {
      w32(t.row(1), 0, kind);
      [79, 82, 83].forEach((id, i) => w16(t.row(1), 8 + i * 2, id));
      [79, 82, 83].forEach((id, i) => expect(oahuCharaModel(t, 1, i)).toEqual({ type: 'denpa', kind, id }));
    }
    for (const variant of [-1, 0.5, 3, 0xffff]) expect(oahuCharaModel(t, 1, variant)).toBeNull();
    w32(t.row(1), 0, 4);
    expect(oahuCharaModel(t, 1, 0)).toBeNull();
    expect(oahuCharaModel(t, 0, 0)).toBeNull();
  });

  test('save selectors never index denpaCustom, including selectors within the table range', () => {
    expect(denpaPreviewRow({ type: 'denpa', kind: 2, id: 115 })).toBe(115);
    expect(denpaPreviewRow({ type: 'denpa', kind: 3, id: 115 })).toBe(92);
    expect(denpaPreviewRow({ type: 'denpa', kind: 3, id: 180 })).toBe(92);
    expect(denpaSourceLabel({ type: 'denpa', kind: 3, id: 115 })).toContain('セーブ未読込');
    expect(denpaSourceLabel({ type: 'denpa', kind: 2, id: 79 })).toContain('変更前');
  });

  test('atlas selections cover the brow wrap, mirrored hair, alternate skin layout and absent glasses', () => {
    expect(denpaFaceUv('Brow', 16)).toEqual([5 / 16, -4 / 16]);
    expect(denpaFaceUv('Eye', 47)).toEqual([2 / 16, -15 / 16]);
    expect(denpaFaceUv('Skin', 8)).toEqual([-7 / 8, -1 / 4]);
    expect(denpaFaceUv('Hair', 0)).toEqual([1 / 2, 1 / 4]);
    expect(denpaFaceUv('Hair', 35)).toEqual([3 / 8, -3 / 8]);
    expect(denpaFaceUv('Megane', 0)).toEqual([1 / 4, -0]);
    expect(() => denpaFaceUv('Eye', 48)).toThrow('範囲外');
    expect(() => denpaAppearance(new Uint8Array(4))).toThrow();
  });
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 Denpa ROM models', () => {
  let dump: Dump, master: OahuMaster, models: OahuDenpaModels;
  beforeAll(async () => {
    dump = withUpdate(await openImage(Bun.file(OAHU_BASE), 'base'), await openUpdate(Bun.file(OAHU_UPDATE), 'update'));
    master = await OahuMaster.load(dump);
    models = new OahuDenpaModels(dump, master);
  });

  test('every custom appearance assembles with the wait skeleton, attached parts and all textures', async () => {
    const custom = master.table('denpaCustom.bin');
    expect(custom.rows).toBe(126);
    for (let id = 0; id < custom.rows; id++) {
      const { set, hash } = await models.load({ type: 'denpa', kind: 2, id });
      const m = set.models.get(hash)!;
      expect(m.meshes.length).toBeGreaterThanOrEqual(10);
      expect(m.bones.some((b) => b.name.endsWith('/ante'))).toBe(true);
      for (const mat of m.materials) for (const u of mat.units) if (u.name) expect(set.textures.has(u.name)).toBe(true);
      for (const mesh of m.meshes) {
        expect(mesh.positions.every(Number.isFinite)).toBe(true);
        expect(mesh.skinIndices!.every((i) => i < m.bones.length)).toBe(true);
      }
      const factory = new ModelFactory(set);
      try {
        const pose = new AnimatedModel(factory, hash);
        pose.select('001_N_Stay');
        expect(pose.motions.some((a) => a.name === '001_N_Stay')).toBe(true);
        const box = new THREE.Box3().setFromObject(pose.group);
        expect(box.min.y).toBeGreaterThan(-10);
        expect(box.max.y).toBeGreaterThan(50);
        expect(box.max.y).toBeLessThan(400);
        pose.update(20);
        expect(pose.boneMatrix('head')!.elements.every(Number.isFinite)).toBe(true);
      } finally { factory.dispose(); }
    }
  }, 60_000);

  test('Akari and Michiru use their named ROM records, face atlas, heart antenna and independent head scale', async () => {
    const messages = await OahuMessages.load(dump);
    for (const [id, name, antennaGroup, head, body, color, brow, eye, nose, mouth, hairColor] of [
      [79, 'あかり', 6, 0, 26, 4, 0, 24, 4, 0, 3],
      [83, 'みちる', 5, 25, 13, 1, 4, 30, 6, 26, 0],
    ] as const) {
      const row = master.table('denpaCustom.bin').row(id);
      expect(messages.texts.preview(new DataView(row.buffer, row.byteOffset).getUint32(0, true), true)).toBe(name);
      const appearance = denpaAppearance(row);
      expect(appearance).toMatchObject({ antennaGroup, head, body, bodyColor: color, face: 1, hair: 17, brow, eye, nose, mouth, hairColor });
      const { set, hash } = await models.load({ type: 'denpa', kind: 2, id });
      const model = set.models.get(hash)!;
      expect(model.bones.some(b => b.name.endsWith(id === 79 ? '/antenna_01' : '/antenna_00'))).toBe(true);
      const antenna = model.materials.find(m => m.name === 'Antenna_alp')!;
      expect(antenna.units[0]!.translateU).toBeCloseTo(0);
      expect(antenna.units[0]!.translateV).toBe(0.25);
      const faceMaterial = model.materials.find(m => m.name === 'Hair')!;
      expect(faceMaterial.units[0]!.translateU).toBe(-0.5);
      expect(faceMaterial.units[0]!.translateV).toBe(0);
      const factory = new ModelFactory(set);
      try {
        const pose = new AnimatedModel(factory, hash);
        pose.select(null);
        const headRoot = model.bones.find(b => /\/hum_head_/.test(b.name))!;
        const actual = new THREE.Vector3().setFromMatrixScale(pose.boneMatrix(headRoot.name)!);
        const bodyRow = master.table('bodyData.bin').row(body);
        const expected = new DataView(bodyRow.buffer, bodyRow.byteOffset).getFloat32(0, true);
        for (const value of actual.toArray()) expect(value).toBeCloseTo(expected, 5);
      } finally { factory.dispose(); }
    }
  });

  test('fixed mapChara #89 resolves custom #115; save-dependent #36 previews custom #92', async () => {
    const chara = master.table('mapChara.bin');
    const fixed = oahuCharaModel(chara, 89, 0)!;
    expect(fixed).toEqual({ type: 'denpa', kind: 2, id: 115 });
    const saved = oahuCharaModel(chara, 36, 0)!;
    expect(saved).toEqual({ type: 'denpa', kind: 3, id: 166 });
    if (fixed.type !== 'denpa' || saved.type !== 'denpa') throw new Error('not Denpa');
    expect(denpaAppearance(master.table('denpaCustom.bin').row(115))).toMatchObject({ head: 0, body: 26, bodyColor: 4, face: 1, hair: 17, skinColor: 2 });
    expect((await models.load(saved)).set.models.get(0)!.name).toContain('/body0/color0');
    const base = await openImage(Bun.file(OAHU_BASE), 'base');
    const baseModels = new OahuDenpaModels(base, await OahuMaster.load(base));
    expect((await baseModels.load(fixed)).set.models.get(0)!.meshes.length).toBeGreaterThanOrEqual(10);
  });
});
