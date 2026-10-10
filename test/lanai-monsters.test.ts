// 電波人間のRPG FREE! (lanai) monsters: MonsterParameter → MonsterDesign → the model BCHs, and the monster page
// (naauao lanai/monsters.md). Needs the decrypted Base and Update CIAs (test/env.ts LANAI_BASE / LANAI_UPDATE).
import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { bchSummary, unwrapBch } from '../src/bch/bch';
import { lanaiDesignFiles } from '../src/lanai/monsterModels';
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

  test('MonsterParameter +0x10 → MonsterDesign → model, colour texture, battle motion', () => {
    expect(hex8(lanaiMonsters(s)[4]!.design)).toBe('80000004');
    expect(files(1)).toEqual(['enemy_59_05.bch', 'enemy_59_07_tex.bch', 'enemy_59_battle.bch']);
    expect(files(4)).toEqual(['enemy_02.bch', 'enemy_02_01_tex.bch', 'enemy_02_battle.bch']);
    expect(files(50)).toEqual(['enemy_02.bch', 'enemy_02_03_tex.bch', 'enemy_02_battle.bch']);
    expect(files(600)[0]).toBe('enemy_38.bch');
    // the Update's model of a later monster, with the Base's motion
    expect(files(1200)).toEqual(['enemy_03_07.bch', 'enemy_03_07_tex.bch', 'enemy_03_battle.bch']);
  });

  test('colour variants share the model', () => {
    const d = lanaiMonsterDesign(s, lanaiMonsters(s)[4]!.designRow)!;
    const same = monstersWithModel(s, d.model).map((m) => m.name);
    expect(same).toContain('おおくちばし');
    expect(same).toContain('アイスバード');
  });

  test('some rows name a MonsterDesign ID that the table does not have', () => {
    const missing = lanaiMonsters(s).filter((m) => m.designRow < 0);
    expect(missing.length).toBe(183);
    expect(missing.some((m) => m.name === 'レイクタートル')).toBe(true);
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
    const f = await lanaiDesignFiles(s, d);
    expect(f.errors).toEqual([]);
    expect(f.version).toBe(0x21);
    expect(f.models).toEqual(['enemy_02']);
    expect(f.modelTextures).toEqual([]);
    expect(f.textures.map((t) => t.name)).toEqual(['enemy_02_body', 'enemy_02_eye', 'enemy_02_eye_alpha']);
    expect(f.motions).toEqual(['005_E02_skillA', '006_E02_skillB', '007_E02_skillC', '008_E02_damage', '009_E02_down']);
    expect(f.modelAnimations).toContain('001_E02_wait');
    expect(bchSummary(unwrapBch(index.body(d.model)!)).models).toEqual(['enemy_02']);
  });

  test('the page', () => {
    const html = renderToString(createElement(LanaiMonsterPage, { session: s, arg: '50' }));
    for (const t of ['アイスバード', 'アイスバードたち', 'MonsterParameter の欄', 'MonsterDesign 行 8', '80000006', '同じモデルのモンスター', 'おおくちばし', 'モデルあり', '1231 / 1231'])
      expect(html).toContain(t);
    const missing = renderToString(createElement(LanaiMonsterPage, { session: s, arg: '120' }));
    expect(missing).toContain('MonsterDesign にない ID');
  });
});
