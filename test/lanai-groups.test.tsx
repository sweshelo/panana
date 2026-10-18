// RPG FREE!'s group page (lanai/GroupPage.tsx): a content's MonsterGroup row with its monster slots and the maps that
// use it, the monster page's link to it, and a copied row saved with the content's tables. Needs the decrypted CIAs.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { LanaiGroupDetail } from '../src/lanai/GroupPage';
import { lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { LanaiMonsterPage } from '../src/lanai/MonsterPage';
import { LanaiSession } from '../src/lanai/session';
import { openImages, type Dump } from '../src/rom/dump';
import { equalBytes } from '../src/util/bytes';
import { LANAI_MG_LISTS, LANAI_MG_MATES, LANAI_MG_PATTERN, lanaiCountLabel, lanaiMgSlots } from '../src/lanai/monsterGroup';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! groups', () => {
  let dump: Dump;
  let s: LanaiSession;
  let content: LanaiContent;
  let maps: LanaiMaps;
  beforeAll(async () => {
    dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
    content = lanaiContents(s)[38]!;
    maps = await lanaiMaps(s, content);
  }, 300000);

  test('a group shows its monsters and the maps that use it', () => {
    const g = maps.monsterGroups()[1]!;
    const mp = s.need('MonsterParameter');
    const html = renderToString(<LanaiGroupDetail session={s} maps={maps} content={content} g={g} />);
    expect(html).toContain('群れ #1');
    expect(html).toContain('レイクタートル');
    expect(html).toContain(`#/monsters/${mp.find(g.monsters[0]!)}`);
    for (const u of maps.monsterGroupUses().get(1) ?? []) expect(html).toContain(`#/maps/38.${encodeURIComponent(u.map)}`);
  });

  test('the lists, weights and count codes of a row (content 3 row 4: leaders 91 / 8B with mates from B / C, D a formation)', async () => {
    const m = await lanaiMaps(s, lanaiContents(s)[3]!);
    const t = m.monsterGroup!;
    const row = t.find(0x8000001d);
    expect(row).toBe(4);
    expect([0, 1, 2, 3].map((i) => t.u8(row, LANAI_MG_PATTERN + i))).toEqual([1, 3, 2, 0]);
    const [a, , , d] = LANAI_MG_LISTS.map((l) => lanaiMgSlots(t, row, l));
    expect(a!.slice(0, 2)).toEqual([{ id: 0x80000091, weight: 3, count: 1 }, { id: 0x8000008b, weight: 1, count: 1 }]);
    expect([t.u8(row, LANAI_MG_MATES), t.u8(row, LANAI_MG_MATES + 1)]).toEqual([1, 2]);
    expect(d![0]!.id).toBe(0x800000b1);
    expect(lanaiCountLabel(d![0]!.count)).toBe('1〜2 体');
    const html = renderToString(<LanaiGroupDetail session={s} maps={m} content={lanaiContents(s)[3]!} g={m.monsterGroups()[row]!} />);
    expect(html).toContain('A: リーダー候補');
    expect(html).toContain('リーダー + お供');
  });

  test('the monster page links the groups of the contents read', () => {
    const row = s.need('MonsterParameter').find(maps.monsterGroups()[1]!.monsters[0]!);
    expect(renderToString(<LanaiMonsterPage session={s} arg={String(row)} />)).toContain('#/groups/38.1');
  });

  test('a copied group with another monster is saved with the content\'s tables', async () => {
    const t = maps.monsterGroup!;
    const rows = t.rows;
    const n = t.addRow(1);
    const mp = s.need('MonsterParameter');
    t.setU32(n, 4, mp.rowId(5));
    expect(maps.monsterGroups()[n]!.monsters[0]).toBe(mp.rowId(5));
    const other = await LanaiSession.open(dump, { fresh: true });
    await other.restore(s.saved());
    const om = await lanaiMaps(other, lanaiContents(other)[38]!);
    expect(om.monsterGroup!.rows).toBe(rows + 1);
    expect(equalBytes(om.monsterGroup!.row(n), t.row(n))).toBe(true);
    t.removeLastRow();
    expect(t.changed).toBe(false);
  }, 300000);
});
