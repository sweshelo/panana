// 電波人間のRPG FREE! (lanai) map records' models (src/lanai/mapObjects.ts): props, exits, chests and the characters of
// section 5 name MapObject rows whose models are there, the bosses' figures MonsterDesign rows, and the clear warp and
// recovery points effects (with the dumps).
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, unpackEntry } from '../src/archive/gsarc';
import { parseBch, unwrapBch } from '../src/bch/bch';
import { isIndoor } from '../src/game/objects';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiMaps } from '../src/lanai/maps';
import { LANAI_EFFECT_CLEAR_WARP, LANAI_EFFECT_REPAIR_POINT, lanaiEffectName, lanaiObjectRef, lanaiObjectScale, lanaiRecordLook } from '../src/lanai/mapObjects';
import { lanaiMonsterDesign } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hex8 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! map records', () => {
  let s: LanaiSession;
  let all: LanaiMaps[];
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
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
    const mapObject = s.table('MapObject');
    const rows = new Map<string, Set<number>>();
    const designs = new Set<number>(), effects = new Map<string, Set<number>>();
    let charas = 0, charaModels = 0;
    for (const maps of all) {
      const mapChara = maps.contentTable('MapChara');
      for (const info of maps.maps) {
        if (info.world) continue;
        const doc = maps.doc(info);
        const ctx = { mapObject, mapChara, events: maps.eventTable(info.dungeon), indoor: isIndoor(doc) };
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
            const key = k === 5 && look.chara !== undefined ? 'chara' : `s${k}`;
            rows.set(key, (rows.get(key) ?? new Set()).add(look.model.row));
          }
        }
      }
    }
    // every prop names a model (12200 props, map.md §4)
    expect(rows.get('s2')!.size).toBeGreaterThan(100);
    expect(charas).toBeGreaterThan(900);
    // about 1 in 10 characters has no MapChara row (EventObject +0x5A = 0): 89% of them have a model
    expect(charaModels / charas).toBeGreaterThan(0.85);
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

  test('the effects of the clear warp and the recovery point', () => {
    const fx = s.table('EffectData');
    expect(lanaiEffectName(fx, LANAI_EFFECT_CLEAR_WARP)).toBe('fx_bg_f_warpzone_goal.ptcl');
    expect(lanaiEffectName(fx, LANAI_EFFECT_REPAIR_POINT)).toBe('fx_bg_repair_point.ptcl');
  });

  test('NPCs are scaled by MapObject +0x1C', () => {
    const mo = s.table('MapObject')!;
    let npcScaled = 0;
    for (let r = 1; r < mo.rows; r++) if (lanaiObjectScale(mo, r) === 1.5) npcScaled++;
    expect(npcScaled).toBeGreaterThan(0);
  });
});
