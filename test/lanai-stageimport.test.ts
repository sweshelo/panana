// Importing a custom-stage distribution zip into another session (src/lanai/stageImport.ts), with the ROM: the stage
// comes in numbered after the session's own, its added item gets a new ID (and the script's number of it follows), the
// script keeps its comments, a ROM row both changed is skipped unless asked, and a release zip brings the built CRO.
import { beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { lanaiContents } from '../src/lanai/contents';
import { addLanaiEmptyStage } from '../src/lanai/emptyStage';
import { scriptDocCode, scriptDocFromSource } from '../src/lanai/eventScript';
import { LanaiSession } from '../src/lanai/session';
import { applyLanaiImport, readLanaiImport } from '../src/lanai/stageImport';
import { lanaiContentRemoveBlock, lanaiCrrName, removeLanaiContent } from '../src/lanai/stageEdit';
import { LANAI_STAGE_MANIFEST, LANAI_STAGE_SOURCE } from '../src/lanai/stageScript';
import { openImages } from '../src/rom/dump';
import { LANAI } from '../src/rom/titles';
import { hex8 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! stage import (ROM)', () => {
  let dump: Awaited<ReturnType<typeof openImages>>;
  let a: LanaiSession;
  let zip: Uint8Array;
  let release: Uint8Array;
  let itemA: number;
  const code = (item: number) =>
    [
      '// the stage made in A',
      'var SEEN: bit reset // set when the hero has seen it',
      '/* plays the sound of the item */',
      'function ring() {',
      '  // the item made in A',
      `  ScriptSound.Play(0x${hex8(item)}, 0)`,
      '  SEEN = true',
      '}',
      '// done',
      '',
    ].join('\n');
  beforeAll(async () => {
    dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    a = await LanaiSession.open(dump, { fresh: true });
    const index = await addLanaiEmptyStage(a, 'Aのステージ');
    const c = lanaiContents(a)[index]!;
    const items = a.need('ItemData');
    itemA = items.rowId(items.addRow(1));
    items.setU32(0, 8, items.u32(0, 8) ^ 1);
    const stored = a.stageScripts.get(c.archive.toUpperCase())!;
    a.setStageScriptDoc(c.archive, { ...scriptDocFromSource(code(itemA)), bindings: stored.doc.bindings });
    a.edited();
    zip = await a.distributionZip();
    release = await a.distributionZip({ release: true });
  }, 300_000);

  test('the distribution zip carries the script as edited, the release zip does not', () => {
    const files = unzipSync(zip);
    const json = JSON.parse(new TextDecoder().decode(files[`${LANAI.titleId}/${LANAI_STAGE_SOURCE}`]!));
    const doc = json.stages['127'].doc;
    expect(scriptDocCode(doc)).toBe(code(itemA));
    expect(unzipSync(release)[`${LANAI.titleId}/${LANAI_STAGE_SOURCE}`]).toBeUndefined();
    expect(unzipSync(release)[`${LANAI.titleId}/${LANAI_STAGE_MANIFEST}`]).toBeDefined();
  });

  test('a session with a stage and an item of its own takes the stage in after them', async () => {
    const b = await LanaiSession.open(dump, { fresh: true });
    const own = await addLanaiEmptyStage(b, 'Bのステージ');
    const items = b.need('ItemData');
    const itemB = items.rowId(items.addRow(2));
    expect(itemB).toBe(itemA);
    items.setU32(0, 8, items.u32(0, 8) ^ 2);
    const slots = (s: LanaiSession) => {
      const t = s.need('MapStageIntegration');
      return Array.from({ length: t.rows }, (_, r) => t.u16(r, 0x40));
    };
    const before = Math.max(...slots(b));

    const imp = await readLanaiImport(b, zip);
    expect(imp.stages).toMatchObject([{ content: 127, archive: 'F0000000', names: ['Aのステージ'], script: 'source' }]);
    expect(imp.extras).toEqual([{ table: 'ItemData', rows: 1 }]);
    expect(imp.edits.filter((e) => e.conflict).map((e) => e.key)).toEqual(['ItemData/0']);

    const done = await applyLanaiImport(b, imp);
    expect(done.contents).toEqual([own + 1]);
    const c = lanaiContents(b)[own + 1]!;
    expect(c.archive).toBe('F0010000');
    expect(c.stages.map((st) => st.name)).toEqual(['Aのステージ']);
    expect(lanaiContents(b)[own]!.stages.map((st) => st.name)).toEqual(['Bのステージ']);
    expect(c.stages[0]!.messageId).not.toBe(lanaiContents(b)[own]!.stages[0]!.messageId);
    expect(Math.max(...slots(b))).toBe(before + 1);
    const def = (await b.tablesIn(c.archive)).find((t) => t.table.name === 'ContentsDef')!.table;
    expect([def.u32(0, 0), def.u32(1, 0)]).toEqual([own + 1, own + 1]);
    const stage = (await b.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')!.table;
    const local = Array.from({ length: stage.rows }, (_, r) => r).find(
      (r) => stage.u32(r, 0x0c) === c.stages[0]!.messageId,
    );
    expect(local).toBeDefined();
    expect(stage.u16(local!, 0x38)).toBe(own + 1);

    // the item: a new ID after B's, the script's number of it follows, the comments stay
    const itemNew = items.rowId(items.rows - 1);
    expect(itemNew).toBe(itemB + 1);
    const doc = b.stageScripts.get(c.archive)!.doc;
    expect(scriptDocCode(doc)).toBe(code(itemNew));
    expect(done.warnings.join('\n')).toContain('アイテムの番号 1 か所');
    // the row both changed: B's stays
    expect(items.u32(0, 8) ^ a.need('ItemData').u32(0, 8)).toBe(3);

    // the session writes its zips with both stages (the script builds)
    const files = unzipSync(await b.distributionZip());
    expect(files[`${LANAI.titleId}/romfs/F0010000`]).toBeDefined();
    expect(files[`${LANAI.titleId}/romfs/.crr/contents${String(own + 1).padStart(4, '0')}.crr`]).toBeDefined();
    const manifest = JSON.parse(new TextDecoder().decode(files[`${LANAI.titleId}/${LANAI_STAGE_MANIFEST}`]!));
    expect(Object.keys(manifest.stages)).toEqual([String(own), String(own + 1)]);
  }, 300_000);

  test('asked to, the row both changed is overwritten; a release zip brings the built CRO and its key', async () => {
    const b = await LanaiSession.open(dump, { fresh: true });
    const items = b.need('ItemData');
    items.setU32(0, 8, items.u32(0, 8) ^ 2);
    const imp = await readLanaiImport(b, release);
    expect(imp.stages.map((st) => st.script)).toEqual(['compiled']);
    const done = await applyLanaiImport(b, imp, { overwrite: new Set(['ItemData/0']) });
    expect(items.u32(0, 8)).toBe(a.need('ItemData').u32(0, 8));
    const c = lanaiContents(b)[done.contents[0]!]!;
    expect(c.archive).toBe('F0000000');
    expect(b.stageScripts.has(c.archive)).toBe(false);
    const key = b.importedStages.get(c.archive)!.key;
    expect(key).toBe(a.stageScripts.get(c.archive)!.key);
    const files = unzipSync(await b.distributionZip());
    const manifest = JSON.parse(new TextDecoder().decode(files[`${LANAI.titleId}/${LANAI_STAGE_MANIFEST}`]!));
    expect(manifest.stages[String(done.contents[0])].stageKey).toBe(key);
    // saved and restored, the import stays
    const again = await LanaiSession.open(dump, { fresh: true });
    await again.restore(b.saved());
    expect(again.importedStages.get(c.archive)?.key).toBe(key);
  }, 300_000);
  test('a stage added before others is removed: the ones after it move down, and are put back so after a reload', async () => {
    const b = await LanaiSession.open(dump, { fresh: true });
    const x = await addLanaiEmptyStage(b, 'X');
    const [y] = (await applyLanaiImport(b, await readLanaiImport(b, zip))).contents;
    const z = await addLanaiEmptyStage(b, 'Z');
    expect([x, y, z]).toEqual([127, 128, 129]);
    const yc = lanaiContents(b)[y!]!;
    const zc = lanaiContents(b)[z]!;
    const slots = [yc, zc].map((c) => b.need('MapStageIntegration').u16(c.stages[0]!.row, 0x40));
    const docY = b.stageScripts.get(yc.archive)!.doc;
    const crrZ = b.createdFiles.get(lanaiCrrName(z))!;
    expect(lanaiContentRemoveBlock(b, lanaiContents(b)[x]!)).toBeNull();
    await removeLanaiContent(b, lanaiContents(b)[x]!);

    const check = async (s: LanaiSession) => {
      const list = lanaiContents(s);
      expect(list.length).toBe(129);
      expect(list.slice(127).map((c) => [c.archive, c.stages.map((st) => st.name)])).toEqual([
        [yc.archive, ['Aのステージ']],
        [zc.archive, ['Z']],
      ]);
      const msi = s.need('MapStageIntegration');
      const msg = s.need('MessageMapStage');
      expect(msg.rows).toBe(msg.originalRows + 2);
      for (const [k, c] of list.slice(127).entries()) {
        const row = c.stages[0]!.row;
        expect([msi.u32(row, 0x34), msi.u16(row, 0x44)]).toEqual([127 + k, 127 + k]);
        expect(msi.u16(row, 0x40)).toBe(slots[k]!);
        const tables = await s.tablesIn(c.archive);
        const def = tables.find((t) => t.table.name === 'ContentsDef')!.table;
        expect([def.u32(0, 0), def.u32(1, 0)]).toEqual([127 + k, 127 + k]);
        const stage = tables.find((t) => t.table.name === 'MapStage')!.table;
        const local = Array.from({ length: stage.rows }, (_, r) => r).filter(
          (r) => stage.u32(r, 0x0c) === c.stages[0]!.messageId,
        );
        expect(local.length).toBe(1);
        expect(stage.u16(local[0]!, 0x38)).toBe(127 + k);
      }
      expect(s.createdFiles.has(lanaiCrrName(129))).toBe(false);
      expect(s.createdFiles.get(lanaiCrrName(128))).toEqual(crrZ);
      expect(s.stageScripts.get(yc.archive)!.doc).toEqual(docY);
    };
    await check(b);
    const again = await LanaiSession.open(dump, { fresh: true });
    await again.restore(b.saved());
    await check(again);
    const files = unzipSync(await again.distributionZip());
    const manifest = JSON.parse(new TextDecoder().decode(files[`${LANAI.titleId}/${LANAI_STAGE_MANIFEST}`]!));
    expect(Object.keys(manifest.stages)).toEqual(['127', '128']);
  }, 300_000);
});
