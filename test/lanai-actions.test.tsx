// RPG FREE!'s action book (src/lanai/battleActions.ts, ActionPage.tsx; naauao lanai/actions.md): ActionData's rows and
// fields, who uses an action (monsters and equipment), the links of the boards, and making and removing an action.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LanaiActionPage } from '../src/lanai/ActionPage';
import {
  lanaiActionAdded,
  lanaiActionChanged,
  lanaiActionMessageRow,
  lanaiActionRefs,
  lanaiActionRemoveBlock,
  lanaiBattleActions,
  lanaiCopyAction,
  lanaiItemUseAction,
  lanaiRemoveAction,
} from '../src/lanai/battleActions';
import { lanaiItems } from '../src/lanai/items';
import { lanaiActionEntry, lanaiItemEntry } from '../src/lanai/pickers';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! actions (ROM)', () => {
  let session: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    session = await LanaiSession.open(dump, { fresh: true });
  });

  test('5017 rows; the fields read from the data', () => {
    const list = lanaiBattleActions(session);
    expect(list.length).toBe(5017);
    const rows = session.rows('ActionData');
    // つかまえる / つかまえる2ばい: system 21, the multiplier 10 / 20
    expect([142, 143].map((r) => [list[r]!.system, rows.get(r, 'scale')])).toEqual([
      [21, 10],
      [21, 20],
    ]);
    // ウインドロール is wind (3), 根っこをのばした earth (4)
    expect(rows.get(4000, 'element')).toBe(3);
    expect(rows.get(1000, 'element')).toBe(4);
    // the amounts: +0x16 below +0x04
    expect([rows.get(1000, 'min'), rows.get(1000, 'max')]).toEqual([40, 55]);
  });

  test('who uses an action: the monsters by ID and the equipment by row', () => {
    const refs = lanaiActionRefs(session);
    expect(refs.monsters.size).toBeGreaterThan(500);
    const heal = [...refs.items.entries()].find(([, es]) => es.some((e) => e.name === 'ハートのブローチ'));
    expect(heal?.[0]).toBeGreaterThanOrEqual(658);
    expect(heal?.[0]).toBeLessThanOrEqual(663);
    // the tools: UseItemInfo +0x04 is the row (キズぐすり 707 → system 14, もとどおりスプレー 748)
    expect(refs.items.get(707)?.map((e) => [e.name, e.how])).toEqual([['キズぐすり', '使う']]);
    expect(lanaiBattleActions(session)[707]!.system).toBe(14);
    expect(
      lanaiItemUseAction(
        session,
        lanaiItems(session).find((x) => x.name === 'もとどおりスプレー')!,
      ),
    ).toBe(748);
    const kizu = lanaiBattleActions(session)[707]!;
    expect(kizu.name).toBe(kizu.named ? kizu.name : 'キズぐすり の効果');
  });

  test('the two texts: the used text in +0x0C, the result in +0x10', () => {
    const list = lanaiBattleActions(session);
    expect(list[422]!.message).toBe('〈name〉は　ぼうはんたいさくをつかった');
    expect(list[1000]!.result).toBe('〈name〉に　〈value〉ダメージ与えた');
    expect(list[142]!.result).toBe('〈name〉を　捕まえた！');
  });

  test('the boards link to the item and action pages', () => {
    const a = session.need('ActionData');
    expect(lanaiActionEntry(session, a.rowId(142)).href).toBe('#/actions/142');
    const items = session.need('ItemData');
    expect(lanaiItemEntry(session, items.rowId(5)).href).toBe('#/items/5');
    expect(lanaiActionEntry(session, a.rowId(0)).href).toBeUndefined();
  });

  test('the page lists the actions and shows one with its users', () => {
    const html = renderToString(<LanaiActionPage session={session} arg="142" />);
    expect(html).toContain('ActionData の行 142');
    expect(html).toContain('つかまえる');
    expect(html).toContain('#/actions/');
  });

  test('a copy gets a new row ID and a text of its own; it can be removed again', () => {
    const a = session.need('ActionData');
    const rows = a.rows;
    const msgRows = session.need('MessageAction').rows;
    const copy = lanaiCopyAction(session, 422);
    session.edited();
    expect(copy).toBe(rows);
    expect(lanaiActionAdded(session, copy)).toBe(true);
    expect(lanaiActionChanged(session, copy)).toBe(true);
    expect(a.rowId(copy)).not.toBe(a.rowId(422));
    const own = lanaiActionMessageRow(session, copy)!;
    expect(own.row).toBe(msgRows);
    expect(session.plain(own.table, own.row, 'individual')).toBe(
      session.plain(own.table, lanaiActionMessageRow(session, 422)!.row, 'individual'),
    );
    expect(lanaiBattleActions(session)[copy]!.system).toBe(lanaiBattleActions(session)[422]!.system);
    expect(lanaiActionRemoveBlock(session, 422)).not.toBe('');
    lanaiRemoveAction(session, copy);
    session.edited();
    expect(a.rows).toBe(rows);
    expect(session.need('MessageAction').rows).toBe(msgRows);
  });
});
