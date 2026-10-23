// Battle backgrounds and BGM: RPG3's map inspector (the dungeon's mapData [5] and mapResource +0x10, oahu/battleField.ts)
// and group bit, RPG FREE!'s BattleField / BattleFieldContents rows picked by a group and the map's sounds
// (lanai/battleField.ts). naauao oahu/sound.md §3.5, lanai/battle-field.md. Needs the decrypted CIAs.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { OahuMapBattlePanel } from '../src/oahu/BattleParts';
import { OAHU_BATTLE_BACKGROUNDS, OAHU_RESOURCE_BATTLE_BG, oahuBattleRows, setOahuResourceBackground } from '../src/oahu/battleField';
import { OahuGroupPage } from '../src/oahu/GroupPage';
import { OahuEditState } from '../src/oahu/mapedit';
import { OahuSession } from '../src/oahu/session';
import { LanaiGroupBattleField, LanaiMapBattlePanel } from '../src/lanai/BattleParts';
import { LANAI_BF, LANAI_MAP_SOUNDS, lanaiBackgroundName, lanaiBattleFieldTable, lanaiGroupBattleField } from '../src/lanai/battleField';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiEditState } from '../src/lanai/mapedit';
import { lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { openImage, openImages, openUpdate, withUpdate } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, hasOahuBase, hasOahuUpdate, LANAI_BASE, LANAI_UPDATE, OAHU_BASE, OAHU_UPDATE } from './env';

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 battle background and BGM', () => {
  let s: OahuSession;
  beforeAll(async () => {
    const base = await openImage(Bun.file(OAHU_BASE), 'base');
    s = await OahuSession.open(withUpdate(base, await openUpdate(Bun.file(OAHU_UPDATE), 'update')));
  });

  test('every mapResource +0x10 is none or one of the 22 btmp entries (row 13 = caveD, 31 = arena)', () => {
    const t = s.master.table('mapResource.bin');
    expect(t.rows).toBe(34);
    const known = new Set(OAHU_BATTLE_BACKGROUNDS.map(([h]) => h));
    for (let r = 0; r < t.rows; r++) {
      const v = u32(t.row(r), OAHU_RESOURCE_BATTLE_BG);
      expect(v === 0 || known.has(v)).toBe(true);
    }
    expect(u32(t.row(13), 0x10)).toBe(0x59e9a400);
    expect(u32(t.row(31), 0x10)).toBe(0x5acb5000);
  });

  test('a dungeon map reads its dungeon\'s row; the panel edits the background with an undo point', async () => {
    const m = s.maps.maps.find((x) => !x.world && s.maps.dungeonOf(x)?.mapData)!;
    const st = new OahuEditState(s.maps);
    st.open(m);
    const rows = oahuBattleRows(s.maps, m, st.current!);
    expect(rows.fromDungeon).toBe(true);
    expect(rows.mapData).toBe(s.maps.dungeonOf(m)!.mapData);
    expect(rows.resource).toBe(s.master.table('mapData.bin').row(rows.mapData)[1]!);
    const html = renderToString(<OahuMapBattlePanel session={s} st={st} info={m} />);
    expect(html).toContain('戦闘の BGM・背景');
    expect(html).toContain(`mapResource 行 ${rows.resource}`);
    if (rows.resource > 0) {
      const before = rows.background;
      st.editTables(() => setOahuResourceBackground(s.master, rows.resource, 0x5acb5000));
      expect(oahuBattleRows(s.maps, m, st.current!).background).toBe(0x5acb5000);
      st.undo();
      expect(oahuBattleRows(s.maps, m, st.current!).background).toBe(before);
    }
  });

  test('the group page toggles the boss BGM bit (+0x32 bit2)', () => {
    const html = renderToString(<OahuGroupPage session={s} arg="19" />);
    expect(html).toContain('ボスの曲 (+0x32 bit2)');
    expect(html).toContain('BGM_BATTLE_2 が鳴る');
  });
});

describe.skipIf(!hasLanai)('RPG FREE! battle field and BGM', () => {
  let s: LanaiSession;
  let maps: LanaiMaps;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
    maps = await lanaiMaps(s, lanaiContents(s)[38]!);
  }, 300000);

  test('master BattleField: 26 rows, row 0 = caveA with BGM 2; SoundData names the battle BGMs', async () => {
    const t = lanaiBattleFieldTable(s, maps, false)!;
    expect(t.rows).toBe(26);
    expect(lanaiBackgroundName(t.u32(0, LANAI_BF.archive), t.u32(0, LANAI_BF.entry))).toBe('btmp_01_caveA');
    expect(t.u32(0, LANAI_BF.bgm)).toBe(2);
    expect(t.u32(23, LANAI_BF.bgm)).toBe(676);
    const sounds = await s.sounds();
    expect(sounds.rows).toBe(896);
    expect([2, 3, 4, 676].map((r) => sounds.name(r))).toEqual(['BGM_BATTLE_NORMAL', 'BGM_BATTLE_BOSS', 'BGM_BATTLE_GOAL', 'BGM_BATTLE_HONOLULU']);
  });

  test('a group\'s row of BattleFieldContents (content 38 row 1: 80000009) shows on the group page', () => {
    const f = lanaiGroupBattleField(s, maps, 1);
    expect(f.contents).toBe(true);
    expect(f.value).toBe(0x80000009);
    expect(f.found).toBe(true);
    const html = renderToString(<LanaiGroupBattleField session={s} maps={maps} row={1} edited={() => {}} />);
    expect(html).toContain('BattleFieldContents');
    expect(html).toContain('btmp_');
  });

  test('the map panel edits MapData +0x04 with an undo point', () => {
    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    const src = st.source!;
    const md = maps.contentTable('MapData')!;
    const before = md.u16(src.mapData, LANAI_MAP_SOUNDS[0].offset);
    const html = renderToString(<LanaiMapBattlePanel session={s} maps={maps} mapData={src.mapData} resource={src.resource} edit={(f) => st.editTables(f)} />);
    expect(html).toContain('フィールドの BGM');
    st.editTables(() => md.setU16(src.mapData, 0x04, 19));
    expect(md.u16(src.mapData, 0x04)).toBe(19);
    st.undo();
    expect(md.u16(src.mapData, 0x04)).toBe(before);
    expect(md.rowChanged(src.mapData)).toBe(false);
  });
});
