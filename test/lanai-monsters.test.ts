// 電波人間のRPG FREE! (lanai) monsters: MonsterParameter → MonsterDesign → the model BCHs, and the monster page
// (naauao lanai/monsters.md). Needs the decrypted Base and Update CIAs (test/env.ts LANAI_BASE / LANAI_UPDATE).
import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { bchSummary, unwrapBch } from '../src/bch/bch';
import { lanaiMonsterSet } from '../src/lanai/monsterModels';
import { LanaiMonsterPage } from '../src/lanai/MonsterPage';
import { lanaiModelIndex, lanaiMonsterDesign, lanaiMonsters, lanaiVoice, monstersWithModel, type LanaiModelIndex } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hex8 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! monsters', () => {
  let s: LanaiSession;
  let index: LanaiModelIndex;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump);
    index = await lanaiModelIndex(s);
  });

  test('1231 rows with names and group names', () => {
    const list = lanaiMonsters(s);
    expect(list.length).toBe(1231);
    expect(list[1]).toMatchObject({ name: 'いちごおばけ', group: 'いちごおばけたち', design: 0x80000163 });
    expect(list[4]!.name).toBe('おおくちばし');
    expect(list[50]!.name).toBe('アイスバード');
    expect(list[600]!.name).toBe('だいまおう');
  });

  test('the model archives are version 10 and hold only BCHs', () => {
    expect([...index.archives.values()].map((a) => [a.version, a.entries.length])).toEqual([[10, 349], [10, 497]]);
    expect(index.name(0x78bfb000)).toBe('enemy_01.bch');
    expect(index.name(0xf8d5d800)).toBe('enemy_01_01_tex.bch');
    expect(index.name(0x5c4e3400)).toBe('enemy_01_battle.bch');
  });

  const files = (row: number): [string, string, string] => {
    const m = lanaiMonsters(s)[row]!;
    const d = lanaiMonsterDesign(s, m.designRow)!;
    return [index.name(d.model) ?? '', index.name(d.texture) ?? '', index.name(d.motion) ?? ''];
  };

  test('MonsterParameter +0x00 bit20-29 → MonsterDesign row → model, colour texture, battle motion', () => {
    // the look is the row number in +0x00 (code.bin 0x306E84), not the +0x10 value
    expect(lanaiMonsters(s)[55]!.designRow).toBe(73);
    expect(hex8(lanaiMonsters(s)[55]!.design)).toBe('80000028');
    expect(files(4)).toEqual(['enemy_02.bch', 'enemy_02_01_tex.bch', 'enemy_02_battle.bch']);
    expect(files(50)).toEqual(['enemy_02.bch', 'enemy_02_03_tex.bch', 'enemy_02_battle.bch']);
    // families land on their own models: dragons, trees, hogs, treasure chests
    expect(files(55)[0]).toBe('enemy_10_02.bch');
    expect(files(11)[0]).toBe('enemy_11.bch');
    expect(files(7)[0]).toBe('enemy_31.bch');
    expect(files(41)[0]).toBe('enemy_39.bch');
    expect(files(600)[0]).toBe('enemy_30.bch');
  });

  test('colour variants share the model', () => {
    const d = lanaiMonsterDesign(s, lanaiMonsters(s)[4]!.designRow)!;
    const same = monstersWithModel(s, d.model).map((m) => m.name);
    expect(same).toContain('おおくちばし');
    expect(same).toContain('アイスバード');
  });

  test('every row has a MonsterDesign row', () => {
    expect(lanaiMonsters(s).filter((m) => m.designRow < 0)).toEqual([]);
  });

  test('voice is a byte string of half-width kana', () => {
    const t = s.need('MonsterParameter');
    expect(lanaiVoice(t, 1).bytes.length).toBe(0);
    const voiced = lanaiMonsters(s).filter((m) => lanaiVoice(t, m.row).bytes.length);
    expect(voiced.length).toBe(72);
    const KANA = /^[｡-ﾟ'/>|.\-]+$/;
    expect(voiced.map((m) => lanaiVoice(t, m.row).text).filter((v) => !KANA.test(v))).toEqual([]);
    expect(lanaiVoice(t, 23).text).toBe("ﾊﾝﾏｰｱ'ﾝｺｰ"); // ハンマーアンコウ: ﾊﾝﾏｰｱ'ﾝｺｰ
  });

  test('the BCHs: H3D 0x21, textures from the colour BCH, motion names', async () => {
    const d = lanaiMonsterDesign(s, lanaiMonsters(s)[50]!.designRow)!;
    expect(bchSummary(unwrapBch(index.body(d.model)!)).header.backward).toBe(0x21);
    expect(bchSummary(unwrapBch(index.body(d.model)!)).models).toEqual(['enemy_02']);
    const set = await lanaiMonsterSet(s, d);
    expect(set.errors).toEqual([]);
    expect([...set.textures.keys()]).toEqual(['enemy_02_body', 'enemy_02_eye', 'enemy_02_eye_alpha']);
    const anims = [...set.models.values()][0]!.animations.map((a) => a.name);
    expect(anims).toEqual(expect.arrayContaining(['005_E02_skillA', '008_E02_damage']));
  });

  test('motions: wait / walk / run loop (H3DAnimation +0x04 bit 0), skills do not', async () => {
    const set = await lanaiMonsterSet(s, lanaiMonsterDesign(s, lanaiMonsters(s)[1]!.designRow)!);
    const anims = [...set.models.values()][0]!.animations.filter((a) => a.kind === 'skeletal');
    const loop = Object.fromEntries(anims.map((a) => [a.name, a.loop]));
    expect(loop['001_E74_wait']).toBe(true);
    expect(loop['004_E74_run']).toBe(true);
    expect(loop['005_E74_skillA']).toBe(false);
  });

  test('skin weights sum to 1: fixed bone indices take as many elements as the weights (いちごおばけ tongue)', async () => {
    const set = await lanaiMonsterSet(s, lanaiMonsterDesign(s, lanaiMonsters(s)[1]!.designRow)!);
    const model = [...set.models.values()][0]!;
    for (const mesh of model.meshes) {
      const w = mesh.skinWeights;
      if (!w) continue;
      for (let v = 0; v < w.length; v += 4) expect(Math.abs(w[v]! + w[v + 1]! + w[v + 2]! + w[v + 3]! - 1)).toBeLessThan(0.02);
    }
    // the tongue bones scale with segment scale compensate (Maya bone scaling, flag bit 22)
    expect(model.bones.filter((b) => b.ssc).map((b) => b.name)).toEqual(expect.arrayContaining(['tongue_1', 'tongue_2', 'tongue_3']));
  });

  test('the page', () => {
    const html = renderToString(createElement(LanaiMonsterPage, { session: s, arg: '50' }));
    for (const t of ['アイスバード', 'アイスバードたち', 'MonsterParameter の行', 'MonsterDesign 行 8', '同じモデルのモンスター', 'おおくちばし', 'モデルあり', '1231 / 1231'])
      expect(html).toContain(t);
  });
});
