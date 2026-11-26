// Ported from lanai-custom-stages web/packages.test.ts (99304a5); the uwapo there is kept in parallel.
import { describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ipsRecords, masterBaseline, parsePananaZip, plainMessage } from './panana-zip';
import { enc, setup, stagePackage } from './test-fixtures';

describe('Panana ZIP parsing', () => {
  test('finds an added content with its master rows, CRR, patchList and condition scripts', async () => {
    const s = await parsePananaZip(stagePackage({ name: 'テストの島' }));
    expect(s.titleId).toBe('0004000000125D00');
    expect(s.warnings).toEqual([]);
    expect(s.sharedArchives).toEqual(['2135000A']);
    expect(s.codeIps?.records).toEqual([{ offset: '001FCD38', size: 4 }]);
    expect(s.conditionScripts).toEqual([1]);
    const [stage] = s.stages;
    expect(stage).toMatchObject({
      content: 127,
      archive: 'F0000000',
      kind: 'added',
      name: '島テストの島',
      cro: { name: 'contents0127.cro', hash: 'D32E7400', size: 16 },
      crr: 'romfs/.crr/contents0127.crr',
      contentsRow: true,
      inPatchList: true,
      files: ['romfs/F0000000', 'romfs/.crr/contents0127.crr'],
      warnings: [],
    });
    expect(stage!.stages).toEqual([
      {
        messageId: '800000A6',
        slot: 52,
        content: 127,
        stamina: 3,
        visibleKind: 0x72,
        visibleArg: 1,
        hiddenKind: 0,
        hiddenArg: 0,
        name: '島テストの島',
        mission: 'たからを探そう',
        integrationRow: 0,
        integrationId: '80000085',
      },
    ]);
    expect(s.files.map((f) => f.role).sort()).toEqual(['archive', 'archive', 'codeIps', 'crr', 'patchList']);
  });

  test('warns about a stage without its CRR, patchList entry or code.ips', async () => {
    const s = await parsePananaZip(stagePackage({ name: 'x', crr: false, ips: false }));
    expect(s.stages[0]!.warnings).toContain('追加コンテンツの CRR (.crr/contents0127.crr) がありません');
    expect(s.warnings.some((w) => w.includes('code.ips'))).toBe(true);
    const noList = await parsePananaZip(stagePackage({ name: 'x', patchList: false }));
    expect(noList.stages[0]!.inPatchList).toBeNull();
  });

  test('rejects what is not a Panana ZIP and reads message text and IPS records', async () => {
    await expect(parsePananaZip(new Uint8Array([1, 2, 3]))).rejects.toThrow('ZIP を読めません');
    await expect(parsePananaZip(zipSync({ 'readme.txt': enc.encode('hi') }))).rejects.toThrow('のファイルがありません');
    expect(plainMessage(new Uint8Array([0x41, 0, 1, 0, 0x37, 0, 1, 0, 2, 0, 1, 2, 3, 4, 0x42, 0, 0, 0]), 0)).toBe('AB');
    expect(() => ipsRecords(enc.encode('PATCH\0\0\0\0'))).toThrow('EOF');
  });
});

describe('package upload API', () => {
  test('stores an upload, lists, deduplicates and deletes it', async () => {
    const { packagesDir, request, upload } = await setup();
    expect(await (await request('/api/packages')).json()).toEqual({ packages: [], conflicts: [] });
    const zip = stagePackage({ name: 'テストの島' });
    const created = await upload(zip, 'island.zip');
    expect(created.status).toBe(201);
    const { package: stored, duplicate } = await created.json();
    expect(duplicate).toBe(false);
    expect(stored.id).toMatch(/^[0-9a-f]{16}$/);
    expect(stored.fileName).toBe('island.zip');
    expect(stored.size).toBe(zip.length);
    expect(stored.summary.stages[0].name).toBe('島テストの島');
    expect((await readdir(join(packagesDir, stored.id))).sort()).toEqual(['package.zip', 'summary.json']);
    expect(new Uint8Array(await Bun.file(join(packagesDir, stored.id, 'package.zip')).arrayBuffer())).toEqual(
      zip as Uint8Array<ArrayBuffer>,
    );

    const again = await upload(zip, 'other-name.zip');
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(true);
    const listed = await (await request('/api/packages')).json();
    expect(listed.packages.map((p: { id: string }) => p.id)).toEqual([stored.id]);
    expect((await (await request(`/api/packages/${stored.id}`)).json()).package.fileName).toBe('island.zip');

    expect((await request(`/api/packages/${stored.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await request(`/api/packages/${stored.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await request(`/api/packages/${stored.id}`)).status).toBe(404);
    expect((await (await request('/api/packages')).json()).packages).toEqual([]);
  });

  test('reports the collisions of two ZIPs that each added content 127', async () => {
    const { upload, request } = await setup();
    const a = (await (await upload(stagePackage({ name: 'A' }))).json()).package.id;
    const b = (await (await upload(stagePackage({ name: 'B', slot: 53 }))).json()).package.id;
    const { conflicts } = await (await request('/api/packages')).json();
    const kinds = conflicts.map((c: { kind: string; value: string }) => `${c.kind}:${c.value}`).sort();
    expect(kinds).toEqual([
      'archive:F0000000',
      'codeIps:exefs/code.ips',
      'content:127',
      'crr:romfs/.crr/contents0127.crr',
      'integration:80000085',
      'message:800000A6',
      'script:1',
    ]);
    for (const c of conflicts) expect(c.packages.sort()).toEqual([a, b].sort());
  });

  test('rejects empty, broken and foreign uploads without storing them', async () => {
    const { packagesDir, request, upload } = await setup();
    expect((await upload(new Uint8Array())).status).toBe(400);
    const broken = await upload(new Uint8Array([0x50, 0x4b, 1, 2]));
    expect(broken.status).toBe(422);
    expect((await broken.json()).error).toContain('ZIP');
    expect((await upload(zipSync({ 'a.txt': enc.encode('a') }))).status).toBe(422);
    expect((await (await request('/api/packages')).json()).packages).toEqual([]);
    expect(await readdir(packagesDir).catch(() => [])).toEqual([]);
    expect((await request('/api/packages/..%2f..%2fmessage.json')).status).toBe(404);
    expect((await request('/api/packages/0123456789abcdef')).status).toBe(404);
    expect((await request('/api/packages', { method: 'PUT' })).status).toBe(405);
  });
});

describe('master baseline', () => {
  test('attributes the added master rows to the stage and reports two ZIPs adding the same rows', async () => {
    const { baselinePath, request, upload } = await setup();
    await Bun.write(baselinePath, JSON.stringify(masterBaseline(stagePackage({ name: '', added: false }), 17408)));
    const { package: a } = await (await upload(stagePackage({ name: 'A' }))).json();
    const diff = a.summary.masterDiff.map((d: { name: string; added: { row: number; owner?: { by: string } }[] }) => [
      d.name,
      d.added.map((r) => `${r.row}:${r.owner?.by}`),
    ]);
    expect(diff).toEqual([
      ['Contents', ['127:own']],
      ['MapStageIntegration', ['0:own']],
      ['MessageMapStage', ['0:own']],
    ]);
    expect(a.summary.warnings).toEqual([]);
    await upload(stagePackage({ name: 'B' }));
    const { conflicts } = await (await request('/api/packages')).json();
    expect(
      conflicts.filter((c: { kind: string }) => c.kind === 'masterRow').map((c: { value: string }) => c.value),
    ).toEqual(['Contents 127', 'MapStageIntegration 0', 'MessageMapStage 0']);
  });
});

// A real Panana export (ROM-derived, not committed): put it at web/data/samples/ to run this.
const sample = join(import.meta.dir, 'data', 'samples', 'panana-lanai-mod-new-stage-sample.zip');
const sampleBaseline = join(import.meta.dir, 'data', 'master-baseline.json');
describe.skipIf(!existsSync(sample))('real Panana export sample', () => {
  test("finds content 127 copied from content 1 with content 99's CRO", async () => {
    const baseline = existsSync(sampleBaseline) ? await Bun.file(sampleBaseline).json() : null;
    const s = await parsePananaZip(new Uint8Array(await Bun.file(sample).arrayBuffer()), baseline);
    expect(s.files.map((f) => f.path)).toEqual([
      'romfs/.crr/contents0127.crr',
      'romfs/2135000A',
      'romfs/F0000000',
      'romfs/patchList.bin',
    ]);
    expect(s.codeIps).toBeNull();
    expect(s.patchList?.count).toBe(185);
    expect(s.stages).toHaveLength(1);
    expect(s.stages[0]).toMatchObject({
      content: 127,
      archive: 'F0000000',
      kind: 'added',
      name: '辛い誘惑',
      cro: { name: 'contents0001.cro', module: 'contents0099' },
      contentsRow: true,
      inPatchList: true,
    });
    expect(s.stages[0]!.stages[0]).toMatchObject({
      slot: 52,
      stamina: 5,
      messageId: '800000A6',
      integrationId: '80000085',
    });
    if (baseline) {
      const owned = s.masterDiff!.flatMap((d) =>
        [...d.added, ...d.changed].map((r) => `${d.name} ${r.row} ${r.owner?.by}`),
      );
      expect(owned.sort()).toEqual([
        'Contents 127 own',
        'ItemData 134 insert',
        'ItemDataCore 3232 link',
        'MapStageIntegration 132 own',
        'MessageMapName 193 value',
        'MessageMapStage 135 own',
      ]);
    }
  });
});
