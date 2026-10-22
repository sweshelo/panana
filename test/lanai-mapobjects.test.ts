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
import { LANAI_CLEAR_WARP, LANAI_EFFECT_CLEAR_WARP, LANAI_EFFECT_REPAIR_POINT, LANAI_GOAL_CHEST, LANAI_REPAIR_POINT, lanaiObjectRef, lanaiObjectScale, lanaiRecordLook } from '../src/lanai/mapObjects';
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

  // the defaults the code picks (FUN_0044F9EC, FUN_0021D744, FUN_0021C844; naauao lanai/key-objects.md)
  test('every goal chest, clear warp and recovery point takes its model or effect; heals gimk_04_heal', async () => {
    const mapObject = s.table('MapObject');
    let goals = 0, warps = 0, recovery = 0;
    const goalRows = new Set<number>(), healRows = new Set<number>();
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
    if (healRows.size) expect((await Promise.all([...healRows].map(modelName))).some((n) => n.startsWith('gimk_04_heal'))).toBe(true);
  }, 300000);

  test('goal chests and clear warps clear their own content', () => {
    let chests = 0, warps = 0;
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

  test('NPCs are scaled by MapObject +0x1C', () => {
    const mo = s.table('MapObject')!;
    let npcScaled = 0;
    for (let r = 1; r < mo.rows; r++) if (lanaiObjectScale(mo, r) === 1.5) npcScaled++;
    expect(npcScaled).toBeGreaterThan(0);
  });
});
