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
