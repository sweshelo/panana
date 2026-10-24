// 初代's monster book (honolulu/monsters.ts, MonsterPage.tsx): monsterBattleParameter's bit-packed fields (naauao
// honolulu/monsters.md), the looks and models of 2713402F / 470D2848, the groups, and the edits of both archives. The
// tests with the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { findByName, parseArchive } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { buildComposite } from '../src/cgfx/tileset';
import { readField, writeField } from '../src/game/tabledef';
import { HonoluluMonsterPage } from '../src/honolulu/MonsterPage';
import {
  attackName, battleRows, designRows, HONOLULU_MONSTER_ARCHIVE, HONOLULU_MONSTER_MODELS, honoluluMonsterModel, honoluluMonsters, monsterChanged,
  monsterGroups, monsterRowName, previousForms, revertMonster,
} from '../src/honolulu/monsters';
import { HonoluluSession } from '../src/honolulu/session';
import { openImage } from '../src/rom/dump';
import { HONOLULU } from '../src/rom/titles';
import { equalBytes } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';

describe.skipIf(!hasHonolulu)('初代の monster book (ROM)', () => {
  let session: HonoluluSession;
  beforeAll(async () => {
    session = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
  });

  test('the monsters: every row of monsterBattleParameter but row 0, named by their look', () => {
    const ms = honoluluMonsters(session);
    expect(ms).toHaveLength(110);
    expect(ms.every((m) => m.name)).toBe(true);
    expect(ms[0]).toMatchObject({ row: 1, name: 'ぶたばなウサギ', level: 1, hp: { min: 12, max: 15 } });
    const t = battleRows(session);
    // the rows of naauao monsters.md §2's example
    expect([t.get(4, 'level'), t.get(4, 'hpMin'), t.get(4, 'hpMax'), t.get(4, 'atk1'), t.get(4, 'def1'), t.get(4, 'spd1'), t.get(4, 'exp'), t.get(4, 'gold')])
      .toEqual([5, 119, 140, 35, 10, 16, 63, 150]);
    expect(monsterRowName(session, 'itemData.bin', 1)).toBeUndefined();
    expect(session.master.context().rowName!('itemData.bin', t.get(1, 'drop1'))).toBe('キズぐすり');
    expect([t.get(1, 'drop1Rate'), t.get(1, 'drop2Rate')]).toEqual([4, 0]);
    expect(session.master.context().rowName!('itemData.bin', t.get(1, 'drop2'))).toBe('トランプクラブ');
    // the stats other than HP have two equal values
    for (const m of ms) for (const k of ['atk', 'def', 'spd']) expect(t.get(m.row, `${k}1`)).toBe(t.get(m.row, `${k}2`));
  });

  test('forms: まおう 22 → 23, しんまおう 106 → 107; the first form has no exp, gold or drops', () => {
    const t = battleRows(session);
    expect(t.get(22, 'next')).toBe(23);
    expect(t.get(106, 'next')).toBe(107);
    expect(previousForms(session, 23)).toEqual([22]);
    expect([t.get(22, 'exp'), t.get(22, 'gold'), t.get(22, 'drop1')]).toEqual([0, 0, 0]);
    expect([t.get(23, 'exp'), t.get(23, 'gold')]).toEqual([3000, 1000]);
    expect(monsterRowName(session, 'monsterBattleParameter.bin', 106)).toBe('しんまおう');
  });

  test('skills by their battle message; groups by monsterGroup and monsterFixGroup', () => {
    expect(attackName(session, 1)).toBe('たいあたり');
    // "〈モンスター〉は　ちからをためている。"
    expect(attackName(session, 133)).toBe('ちからをためている');
    const t = battleRows(session);
    expect(attackName(session, t.get(1, 'skill0'))).toBeTruthy();
    const groups = monsterGroups(session);
    // group 1 = きばコウモリ・ぶたばなウサギ; fixed group 1 = ウルフベア (row 4)
    expect(groups.get(1)?.groups).toContain(1);
    expect(groups.get(4)?.fixed).toContain(1);
  });

  test('every look has a model in 470D2848 that converts with its motions', async () => {
    const arc = parseArchive(await session.dump.readRomfs(HONOLULU_MONSTER_MODELS));
    const d = designRows(session);
    const used = new Set(honoluluMonsters(session).map((m) => m.design));
    for (const design of used) {
      expect(honoluluMonsterModel(session, design)?.key).toStartWith('honolulu-monster/');
      const set = buildComposite(arc, d.get(design, 'model'), d.get(design, 'texture'));
      expect(set.errors).toEqual([]);
      const model = set.models.get(d.get(design, 'model'))!;
      expect(model.animations.length).toBeGreaterThan(0);
    }
  });

  test('every field writes back the bytes it reads', () => {
    for (const rows of [battleRows(session), designRows(session)]) {
      for (let r = 0; r < rows.rows; r++) {
        const row = rows.row(r).slice();
        for (const f of rows.def.fields) writeField(row, f, readField(row, f));
        expect(equalBytes(row, rows.row(r))).toBe(true);
      }
    }
  });

  test('the page: photos, the 110 rows, the entry with its stats, drops, skills and groups', () => {
    const html = renderToString(<HonoluluMonsterPage session={session} arg="22" />);
    expect(html).toContain('110 / 110 件');
    expect(html.match(/photo-cell/g)!.length).toBe(110);
    expect(html).toContain('まおう');
    expect(html).toContain('次の形態');
    expect(html).toContain('href="#/monsters/23"');
    expect(html).toContain('ドロップ');
  });

  test('edits of the stats and of the name go into the master and 2713402F; reverted, the export is empty', async () => {
    expect(session.modFiles().size).toBe(0);
    const t = battleRows(session);
    const d = designRows(session);
    t.set(1, 'hpMax', 999);
    t.set(1, 'drop1', 2);
    const nameId = d.get(t.get(1, 'design'), 'name');
    session.messages.texts.setText(nameId, 'ぶたばなウサギX');
    d.set(t.get(1, 'design'), 'battleScale', d.get(t.get(1, 'design'), 'battleScale') + 1);
    session.edited();
    expect(monsterChanged(session, 1)).toBe(true);
    expect(honoluluMonsters(session)[0]).toMatchObject({ name: 'ぶたばなウサギX', hp: { min: 12, max: 999 } });
    const files = session.modFiles();
    expect(files.has(HONOLULU.master)).toBe(true);
    expect(files.has(HONOLULU_MONSTER_ARCHIVE)).toBe(true);
    const master = new GsTable(findByName(parseArchive(files.get(HONOLULU.master)!), 'monsterBattleParameter.bin')!.body);
    expect(master.row(1)).toEqual(t.row(1));
    const design = new GsTable(findByName(parseArchive(files.get(HONOLULU_MONSTER_ARCHIVE)!), 'monsterData.bin')!.body);
    expect(design.row(t.get(1, 'design'))).toEqual(d.row(t.get(1, 'design')));
    revertMonster(session, 1);
    expect(monsterChanged(session, 1)).toBe(false);
    expect(session.modFiles().size).toBe(0);
    expect(equalBytes(session.design.export(), await session.dump.readRomfs(HONOLULU_MONSTER_ARCHIVE))).toBe(true);
    expect(equalBytes(session.master.export(), await session.dump.readRomfs(HONOLULU.master))).toBe(true);
  });
});
