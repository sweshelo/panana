// Putting a stage of the ROM back as it was (stageEdit.ts revertLanaiContent) and finding the edited ones
// (lanaiChangedContents): rows added to the content's tables stay when only its map is reverted, and a MOD with them
// carries the content's archive (uwapo refuses it: "コンテンツ 1 の CRR がありません").
import { beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { lanaiChangedContents, revertLanaiContent } from '../src/lanai/stageEdit';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! stage revert', () => {
  let s: LanaiSession;
  let c: LanaiContent;
  beforeAll(async () => {
    s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (file) => (file as File).name),
      { fresh: true },
    );
    c = lanaiContents(s)[1]!;
  });

  test('table rows, the map table and the stage rows of a content are found and put back', async () => {
    expect(lanaiChangedContents(s, lanaiContents(s)).size).toBe(0);
    const maps = await lanaiMaps(s, c);
    const chara = maps.contentTable('MapChara')!;
    const charaRows = chara.rows;
    // an NPC added to the map and the map put back: the MapChara row stays
    chara.addRow(0);
    for (const m of maps.maps) if (maps.isChanged(m)) maps.revert(m);
    s.edited();
    expect([...lanaiChangedContents(s, lanaiContents(s))]).toEqual([1]);
    const archive = (zip: Record<string, Uint8Array>) => Object.keys(zip).some((k) => k.endsWith(`/${c.archive}`));
    expect(archive(unzipSync(await s.modZip()))).toBe(true);

    // a stage row of the master alone marks the content too
    const msi = s.need('MapStageIntegration');
    const row = c.stages[0]!.row;
    const stamina = msi.u8(row, 0x49);
    msi.setBits(row, 0x48, 8, 8, stamina + 1);
    s.edited();
    expect(lanaiChangedContents(s, lanaiContents(s)).has(1)).toBe(true);

    revertLanaiContent(s, lanaiContents(s)[1]!);
    expect(chara.rows).toBe(charaRows);
    expect(msi.u8(row, 0x49)).toBe(stamina);
    expect(lanaiChangedContents(s, lanaiContents(s)).size).toBe(0);
    expect(s.changed).toBe(false);
    expect(archive(unzipSync(await s.modZip()))).toBe(false);
  });
});
