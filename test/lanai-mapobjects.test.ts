// 電波人間のRPG FREE! (lanai) map records' models (src/lanai/mapObjects.ts): props, exits, chests and the characters of
// section 5 name MapObject rows whose models are there, the bosses' figures MonsterDesign rows, and the clear warp and
// recovery points effects (with the dumps).
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, unpackEntry } from '../src/archive/gsarc';
import { parseBch, unwrapBch } from '../src/bch/bch';
import { isIndoor } from '../src/game/objects';
import { lanaiContents } from '../src/lanai/contents';
import { LANAI_ACTION_CLEAR_WARP, LANAI_ACTION_GOAL_CHEST } from '../src/lanai/actions';
import { LANAI_EVENT_ACTIONS, LanaiMaps } from '../src/lanai/maps';
import {
  LANAI_CLEAR_WARP,
  LANAI_EFFECT_CLEAR_WARP,
  LANAI_EFFECT_REPAIR_POINT,
  LANAI_GOAL_CHEST,
  LANAI_REPAIR_POINT,
  lanaiCharaModel,
  lanaiCharaTables,
  lanaiObjectRef,
  lanaiObjectScale,
  lanaiRecordLook,
} from '../src/lanai/mapObjects';
import {
  lanaiAntennaAtlas,
  lanaiDenpaColors,
  lanaiDenpaCustomLook,
  lanaiDenpaCustomModel,
  lanaiDenpaCustomName,
} from '../src/lanai/animationModels';
import { LANAI_GLASSES, lanaiDenpaEquipment, lanaiDenpaGlasses } from '../src/lanai/denpaEquipment';
import { lanaiItems } from '../src/lanai/items';
import { lanaiMonsterDesign } from '../src/lanai/monsters';
import { lanaiChestFields } from '../src/lanai/treasure';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hex8, u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! map records', () => {
  let s: LanaiSession;
  let all: LanaiMaps[];
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump);
    all = [];
    for (const c of lanaiContents(s)) {
      try {
        all.push(await LanaiMaps.load(s, c));
      } catch {
        /* a content without maps */
      }
    }
  }, 300000);

  const modelName = async (row: number): Promise<string> => {
    const ref = lanaiObjectRef(s.table('MapObject'), row)!;
    const arc = await s.archive(hex8(ref.archive));
    return parseBch(unwrapBch(unpackEntry(arc, findEntry(arc, ref.entry)!).body)).models[0]?.name ?? '';
  };

  test('the records of every map name MapObject rows; characters are npc_ models, chests trebox', async () => {
    const rows = new Map<string, Set<number>>();
    const designs = new Set<number>(),
      effects = new Map<string, Set<number>>();
    let charas = 0,
      charaModels = 0,
      denpas = 0;
    for (const maps of all) {
      const mapChara = maps.contentTable('MapChara');
      for (const info of maps.maps) {
        if (info.world) continue;
        const doc = maps.doc(info);
        const ctx = {
          ...lanaiCharaTables(s),
          mapChara,
          events: maps.eventTable(info.dungeon),
          indoor: isIndoor(doc),
        };
        for (const k of [2, 3, 4, 5]) {
          for (const r of doc.recs[k] ?? []) {
            const look = lanaiRecordLook(k, r.raw, ctx);
            if (k === 5 && look?.chara !== undefined) {
              charas++;
              if (look.model) charaModels++;
            }
            if (!look?.model) continue;
            if (look.model.type === 'monster') {
              designs.add(look.model.design);
              continue;
            }
            if (look.model.type === 'effect') {
              effects.set(`s${k}`, (effects.get(`s${k}`) ?? new Set()).add(look.model.row));
              continue;
            }
            if (look.model.type === 'denpa') {
              denpas++;
              continue;
            }
            const key = k === 5 && look.chara !== undefined ? 'chara' : `s${k}`;
            rows.set(key, (rows.get(key) ?? new Set()).add(look.model.row));
          }
        }
      }
    }
    // every prop names a model (12200 props, map.md §4)
    expect(rows.get('s2')!.size).toBeGreaterThan(100);
    expect(charas).toBeGreaterThan(900);
    // every character has a model: EventObject +0x5A = 0 is MapChara row 0, as the game reads it (FUN_0023CFAC)
    expect(charaModels).toBe(charas);
    // the Denpa people (MapChara kind 3: DenpaCustom rows; 141 placements, Codex 2026-11-21)
    expect(denpas).toBeGreaterThan(130);
    const names = async (key: string): Promise<string[]> => Promise.all([...rows.get(key)!].map(modelName));
    expect((await names('chara')).filter((n) => /^npc_/i.test(n)).length).toBeGreaterThan(20);
    expect((await names('s4')).filter((n) => n.startsWith('gimk_05_trebox')).length).toBeGreaterThanOrEqual(3);
    expect((await names('s3')).some((n) => n.startsWith('gimk_01_stair'))).toBe(true);
    // the goal chest (look 3)
    expect(await names('s4')).toContain('gimk_05_trebox_goal');
    // the models of every row the records use can be read
    for (const key of rows.keys()) for (const n of await names(key)) expect(n).not.toBe('');
    // the bosses' figures (MapChara kind 1) are MonsterDesign rows with a model
    expect(designs.size).toBeGreaterThan(10);
    for (const d of designs) expect(lanaiMonsterDesign(s, d)?.model).toBeGreaterThan(0);
    // the clear warps (section 3 kind 3) and the recovery points (section 5 kind 13) are effects
    expect([...(effects.get('s3') ?? [])]).toEqual([LANAI_EFFECT_CLEAR_WARP]);
    expect(effects.get('s5')?.has(LANAI_EFFECT_REPAIR_POINT)).toBe(true);
  }, 300000);

  test('a character whose EventObject +0x5A is 0 takes MapChara row 0 (an NPC and a boss)', () => {
    const look = (content: number, name: string, rec: number) => {
      const maps = all.find((m) => m.content.index === content)!;
      const info = maps.maps.find((m) => m.name === name)!;
      const doc = maps.doc(info);
      const raw = doc.recs[5]![rec]!.raw;
      return lanaiRecordLook(5, raw, {
        ...lanaiCharaTables(s),
        mapChara: maps.contentTable('MapChara'),
        events: maps.eventTable(info.dungeon),
        indoor: isIndoor(doc),
      });
    };
    expect(look(1, 'D01001B01', 3)).toMatchObject({ chara: 0, model: { type: 'object', row: 418 } });
    expect(look(48, 'D01001F01', 0)).toMatchObject({ chara: 0, model: { type: 'monster', design: 377 } });
  });

  // the defaults the code picks (FUN_0044F9EC, FUN_0021D744, FUN_0021C844; naauao lanai/key-objects.md)
  test('every goal chest, clear warp and recovery point takes its model or effect; heals gimk_04_heal', async () => {
    const mapObject = s.table('MapObject');
    let goals = 0,
      warps = 0,
      recovery = 0;
    const goalRows = new Set<number>(),
      healRows = new Set<number>();
    for (const maps of all) {
      const mapChara = maps.contentTable('MapChara');
      for (const info of maps.maps) {
        if (info.world) continue;
        const doc = maps.doc(info);
        const ctx = { mapObject, mapChara, events: maps.eventTable(info.dungeon), indoor: isIndoor(doc) };
        for (const r of doc.recs[4] ?? []) {
          if (u32(r.raw, 0) !== LANAI_GOAL_CHEST) continue;
          goals++;
          const m = lanaiRecordLook(4, r.raw, ctx)?.model;
          if (m?.type === 'object') goalRows.add(m.row);
        }
        for (const r of doc.recs[3] ?? []) {
          if (r.raw[0x15] !== LANAI_CLEAR_WARP) continue;
          warps++;
          expect(lanaiRecordLook(3, r.raw, ctx)?.model).toEqual({ type: 'effect', row: LANAI_EFFECT_CLEAR_WARP });
        }
        for (const r of doc.recs[5] ?? []) {
          const kind = u32(r.raw, 0);
          if (kind === LANAI_REPAIR_POINT) {
            recovery++;
            expect(lanaiRecordLook(5, r.raw, ctx)?.model).toEqual({ type: 'effect', row: LANAI_EFFECT_REPAIR_POINT });
          }
          if (kind === 3) {
            const m = lanaiRecordLook(5, r.raw, ctx)?.model;
            if (m?.type === 'object') healRows.add(m.row);
          }
        }
      }
    }
    // 75 goal chests, 46 clear warps, 71 recovery points (key-objects.md §2〜§3)
    expect(goals).toBeGreaterThan(50);
    expect(warps).toBeGreaterThan(40);
    expect(recovery).toBeGreaterThan(50);
    expect((await Promise.all([...goalRows].map(modelName))).filter((n) => n === 'gimk_05_trebox_goal').length).toBe(1);
    if (healRows.size)
      expect((await Promise.all([...healRows].map(modelName))).some((n) => n.startsWith('gimk_04_heal'))).toBe(true);
  }, 300000);

  test('goal chests and clear warps clear their own content', () => {
    let chests = 0,
      warps = 0;
    for (const maps of all)
      for (const info of maps.maps) {
        if (info.world) continue;
        const ev = maps.eventTable(info.dungeon);
        if (!ev) continue;
        for (const k of [3, 4])
          for (const r of maps.doc(info).recs[k] ?? []) {
            const row = u32(r.raw, 4);
            if (!row || row >= ev.rows) continue;
            if (k === 4) {
              const stages = lanaiChestFields(ev, row);
              if (!stages.length || ev.u32(row, stages[0]!.field - 4) !== LANAI_ACTION_GOAL_CHEST) continue;
              const clears = ev.u32(row, stages[0]!.field + 4);
              if (!clears) continue;
              chests++;
              expect(clears).toBe(maps.content.index);
              for (const x of stages.slice(1)) expect(ev.u32(row, x.field + 4)).toBe(0);
            } else {
              const o = LANAI_EVENT_ACTIONS.find((o) => ev.u32(row, o) === LANAI_ACTION_CLEAR_WARP);
              if (o === undefined) continue;
              warps++;
              expect(ev.u32(row, o + 4)).toBe(maps.content.index);
            }
          }
      }
    expect(chests).toBeGreaterThan(50);
    expect(warps).toBeGreaterThan(30);
  });

  // FUN_0023CFAC: EventObject +0x5C picks the MapChara field, the kind what it names (Codex, 2026-11-21)
  test('MapChara kind 3 is a DenpaCustom row and kind 2 a MonsterParameter row; every Denpa person is built', async () => {
    const ctxOf = (content: number) => {
      const maps = all.find((m) => m.content.index === content)!;
      return {
        mapChara: maps.contentTable('MapChara'),
        ...lanaiCharaTables(s),
      };
    };
    expect(lanaiCharaModel(ctxOf(16), 7)).toEqual({ type: 'denpa', custom: 11 });
    expect(lanaiDenpaCustomName(s, 11)).toBe('かしたろう');
    expect(lanaiCharaModel(ctxOf(17), 1)).toEqual({ type: 'denpa', custom: 4 });
    expect(lanaiDenpaCustomName(s, 4)).toBe('あかり');
    // +0x10 = 0x8000026D → MonsterParameter 348 あんこくのつかい → MonsterDesign 108
    expect(lanaiCharaModel(ctxOf(58), 18, 1)).toEqual({ type: 'monster', design: 108 });
    expect(lanaiCharaModel(ctxOf(58), 18, 0)).toBeNull();

    // かしたろう: head 29, body 5, face 10, hair 4, eye 44, mouth 39 (one-based in the row but the hair)
    const look = lanaiDenpaCustomLook(s, 11);
    expect([look.headRow, look.bodyRow]).toEqual([28, 4]);
    expect([look.appearance.face, look.appearance.hair, look.appearance.eye, look.appearance.mouth]).toEqual([
      9, 4, 43, 38,
    ]);
    // the party of content 16 (a screenshot of the game, 2015): all level 220; the antenna is the last level reached
    const sk = s.need('SkillData');
    const antennas = [11, 12, 13, 14, 15, 16, 17, 18].map((row) =>
      s.plain(sk, lanaiDenpaCustomLook(s, row).antennaSkill, 'name'),
    );
    expect(antennas).toEqual([
      'じごくのごうか', // 火 (71 of 10 / 31 / 71 / 251 / 401)
      'ならくのそこ', // 闇
      'マグニチュード12', // 土
      'みんなかんぜんふっかつ', // 蘇生
      'みんなわざアップ',
      'みんなムキムキ', // 強化
      'みんなたたり', // 耐性降下
      'みんなぜんぶかいふく', // 回復
    ]);
    // every skill with an icon (+0x11 & 0x3F) takes the icon atlas 75F22000 (はるお showed ねむらせる's sheet when
    // SkillData +0x10 & 3 picked it); the models with their own look take the sheet 33945C00
    expect(lanaiAntennaAtlas(s, lanaiDenpaCustomLook(s, 12).antennaSkill)).toBe(0x75f22000);
    expect(lanaiAntennaAtlas(s, lanaiDenpaCustomLook(s, 11).antennaSkill)).toBe(0x75f22000);
    let icons = 0;
    for (let row = 0; row < sk.rows; row++) {
      if (!(sk.u8(row, 0x11) & 0x3f)) continue;
      icons++;
      expect(lanaiAntennaAtlas(s, row)).toBe(0x75f22000);
    }
    expect(icons).toBeGreaterThan(150);
    const sleep = [...Array(sk.rows).keys()].find((row) => s.plain(sk, row, 'name') === 'ねむらせる')!;
    expect(lanaiAntennaAtlas(s, sleep)).toBe(0x33945c00);
    // the equipment of the screenshot: かしたろう's geta and big gloves, りゅう's dragon scales, さなこ's wings
    const worn = (row: number) => lanaiDenpaEquipment(s, s.need('DenpaCustom').row(row)).map((it) => it.name);
    expect(worn(11)).toEqual([
      'くろドラゴンのかざり',
      'クリティカルグラブ',
      'げた',
      'チャンピオンベルト',
      'ナンバーワン',
    ]);
    expect(worn(13)).toContain('ドラゴンのうろこ');
    expect(worn(18)).toEqual(['サングラス', 'ジュエリーネックレス', 'パイレーツブーツ', 'てんしのはね', 'APプリント']);
    // glasses (0x82) are no model but a cell of the face: equipInfo_face +0x00 & 31, the 23 glasses 1〜23
    const glasses = lanaiItems(s).filter((it) => it.kind === LANAI_GLASSES);
    expect(glasses.map((it) => lanaiDenpaGlasses(s, [it])).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 23 }, (_, i) => i + 1),
    );
    const sanako = lanaiDenpaCustomLook(s, 18);
    expect(sanako.appearance.glasses).toBe(
      lanaiDenpaGlasses(
        s,
        glasses.filter((it) => it.name === 'サングラス'),
      ),
    );
    expect(sanako.appearance.glasses).toBeGreaterThan(0);
    const sanakoModel = (await lanaiDenpaCustomModel(s, 18).load())!.set.models.get(0)!;
    expect(sanakoModel.materials.some((m) => m.name.startsWith('M_equ_face'))).toBe(false);
    // はるお's おおきめサングラス is a head item (0x81): a model on the head
    expect(
      (await lanaiDenpaCustomModel(s, 12).load())!.set.models
        .get(0)!
        .materials.some((m) => m.name === 'M_equ_face_048'),
    ).toBe(true);
    const kashitarou = (await lanaiDenpaCustomModel(s, 11).load())!.set.models.get(0)!;
    const names = kashitarou.materials.map((m) => m.name);
    for (const part of ['M_equ_neck_070', 'M_equ_hand_007', 'M_equ_foot_037', 'M_equ_back_105'])
      expect(names).toContain(part);
    // the Body materials of the body and the head (both hum_base): c0 / c1 (tex × c0 + (1 − tex) × c1) are the person's
    // colours; clothes take the body's place only, shown as they are with white / black there
    const bodyColors = (m: typeof kashitarou) => {
      const bodies = m.materials.filter((x) => x.name === 'Body');
      expect(bodies).toHaveLength(2);
      return bodies.map((body) => ({
        texture: body.units[0]!.name,
        colors: [0, 1].map((c) => body.tev![body.tevConstants!.indexOf(c)]!.color),
      }));
    };
    const cd = s.need('ColorData');
    const rgb = (row: number) => [...[6, 7, 8].map((o) => cd.u8(row, o) / 255), 1];
    const white = [1, 1, 1, 1],
      black = [0, 0, 0, 1];
    // かしたろう in ナンバーワン: the clothes on the body, the head red
    const kashitarouSet = (await lanaiDenpaCustomModel(s, 11).load())!.set;
    expect(bodyColors(kashitarou)).toEqual([
      { texture: 'hum_base/clothes', colors: [white, black] },
      { texture: 'hum_base', colors: [rgb(6), rgb(6)] },
    ]);
    expect(kashitarouSet.textures.get('hum_base/clothes')).toBeDefined();
    expect(kashitarouSet.textures.get('hum_base')).toBeDefined();
    // a person without clothes has the pattern and the colours on both
    const dc = s.need('DenpaCustom');
    const bare = [...Array(dc.rows).keys()].find(
      (row) => row > 0 && !lanaiDenpaEquipment(s, dc.row(row)).some((it) => it.kind >= 0xd0),
    )!;
    const bareLook = lanaiDenpaCustomLook(s, bare);
    const bareColors = [rgb(bareLook.colors[0]), rgb(bareLook.colors[1])];
    expect(bodyColors((await lanaiDenpaCustomModel(s, bare).load())!.set.models.get(0)!)).toEqual([
      { texture: 'hum_base', colors: bareColors },
      { texture: 'hum_base', colors: bareColors },
    ]);
    // しんたろう: あお / みずいろ on the marble (pattern 6) on the head, in his アロハ
    const shintarou = lanaiDenpaCustomLook(s, 14);
    expect([shintarou.pattern, ...shintarou.colors]).toEqual([6, 21, 9]);
    expect(bodyColors((await lanaiDenpaCustomModel(s, 14).load())!.set.models.get(0)!)[1]!.colors).toEqual([
      rgb(21),
      rgb(9),
    ]);
    // しょう: くろ with the second レア, no pattern: black all over and rare (the screenshot's shining black)
    const shou = lanaiDenpaCustomLook(s, 16);
    expect([shou.pattern, ...shou.colors, shou.rare]).toEqual([0, 3, 3, true]);
    // かしたろう is red all over (あか, no pattern)
    expect(look.colors).toEqual([6, 6]);
    expect(look.pattern).toBe(0);
    // the same two colours drop the pattern; a pattern turns a second colour 0 / 2 into black (3)
    expect(lanaiDenpaColors(4, 9, 9)).toEqual({ pattern: 0, colors: [9, 9], rare: false });
    expect(lanaiDenpaColors(4, 9, 0)).toEqual({ pattern: 4, colors: [9, 3], rare: false });
    expect(lanaiDenpaColors(4, 9, 2)).toEqual({ pattern: 4, colors: [9, 3], rare: false });
    expect(lanaiDenpaColors(0, 9, 2)).toEqual({ pattern: 0, colors: [9, 9], rare: true });
    expect(lanaiDenpaColors(0, 9, 21)).toEqual({ pattern: 0, colors: [9, 9], rare: false });
    // レア (ColorData 2, +4 = 0x1000) is only ever a second colour; with a pattern (#169 ゆう, pattern 5) it is black
    expect(lanaiDenpaCustomLook(s, 169).colors).toEqual([28, 3]);

    const customs = new Set<number>();
    for (const maps of all) {
      const mc = maps.contentTable('MapChara');
      for (let r = 1; r < (mc?.rows ?? 0); r++) {
        const m = lanaiCharaModel({ mapObject: undefined, mapChara: mc }, r);
        if (m?.type === 'denpa') customs.add(m.custom);
      }
    }
    expect(customs.size).toBeGreaterThan(80);
    for (const custom of customs) {
      const { set, hash } = (await lanaiDenpaCustomModel(s, custom).load())!;
      const model = set.models.get(hash)!;
      expect(model.meshes.length).toBeGreaterThan(5);
      expect(model.animations.some((a) => a.name === '001_N_Stay')).toBe(true);
    }
  }, 300000);

  test('NPCs are scaled by MapObject +0x1C', () => {
    const mo = s.table('MapObject')!;
    let npcScaled = 0;
    for (let r = 1; r < mo.rows; r++) if (lanaiObjectScale(mo, r) === 1.5) npcScaled++;
    expect(npcScaled).toBeGreaterThan(0);
  });
});
