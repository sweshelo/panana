// Ported from lanai-custom-stages web/publish.test.ts (99304a5); the uwapo there is kept in parallel.
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { masterBaseline } from './panana-zip';
import { rowOrderProblem } from './publish';
import { extractStages } from './stage-files';
import { ruby, setup, stagePackage, utf16 } from './test-fixtures';

/** Reads an LCSR file back into its records (and checks that it ends where the last record ends). */
function readRows(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(new TextDecoder().decode(b.subarray(0, 4))).toBe('LCSR');
  expect(v.getUint16(4, true)).toBe(1);
  const out = [];
  let o = 8;
  for (let i = 0; i < v.getUint16(6, true); i++) {
    const rowSize = v.getUint32(o + 0x30, true);
    const row = b.slice(o + 0x34, o + 0x34 + rowSize);
    let p = o + 0x34 + ((rowSize + 3) & ~3);
    const n = v.getUint32(p, true);
    const fields = Array.from({ length: n }, (_, k) => v.getUint32(p + 4 + k * 4, true));
    p += 4 + n * 4;
    const size = v.getUint32(p, true);
    out.push({
      entry: v.getUint32(o, true),
      table: new TextDecoder().decode(b.subarray(o + 4, o + 0x24)).replace(/\0+$/, ''),
      id: v.getUint32(o + 0x24, true),
      row: v.getUint32(o + 0x28, true),
      op: b[o + 0x2c],
      by: b[o + 0x2d],
      guess: b[o + 0x2e],
      pad: b[o + 0x2f],
      rowBytes: row,
      fields,
      strings: b.slice(p + 4, p + 4 + size),
    });
    o = p + 4 + size;
  }
  expect(o).toBe(b.length);
  return out;
}

const sha = (b: Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');
const baselineOf = () => JSON.stringify(masterBaseline(stagePackage({ name: '', added: false }), 17408));

async function publishing() {
  const env = await setup();
  const publish = (packages: unknown, options: Record<string, unknown> = {}) =>
    env.request('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packages, ...options }),
    });
  return { ...env, publish };
}

describe('stage publishing', () => {
  test("clears the conditions of the stage's list row when asked, and warns about them otherwise", async () => {
    const { baselinePath, request, upload, publish } = await publishing();
    await Bun.write(baselinePath, baselineOf());
    const zip = stagePackage({
      name: '条件',
      script: false,
      ips: false,
      enable: [0x16, 151, 1],
      disable: [0x53, 7, 0],
    });
    const { package: p } = await (await upload(zip)).json();
    const rowsOf = async (id: string) => {
      const rows = readRows(new Uint8Array(await (await request(`/api/stages/${id}/rows`)).arrayBuffer()));
      const row = new DataView(rows.find((r) => r.table === 'MapStageIntegration')!.rowBytes.buffer);
      return [
        row.getUint32(0x1c, true),
        row.getUint32(0x20, true),
        row.getUint8(0x24),
        row.getUint32(0x28, true),
        row.getUint8(0x30),
      ];
    };
    const kept = (await (await publish([p.id])).json()).manifest;
    expect(kept.stages[0]).toMatchObject({
      conditionsCleared: false,
      conditions: { enable: { kind: 0x16, v1: 151, v2: 1 }, disable: { kind: 0x53, v1: 7, v2: 0 } },
    });
    expect(kept.warnings.join()).toContain('出現・無効化の条件があります (種類 0x16 / 0x53)');
    expect(await rowsOf(kept.stages[0].id)).toEqual([151, 1, 0x16, 7, 0x53]);
    const cleared = (await (await publish([p.id], { clearConditions: true })).json()).manifest;
    expect(cleared.stages[0].conditionsCleared).toBe(true);
    expect(cleared.warnings.join()).not.toContain('条件があります');
    expect(await rowsOf(cleared.stages[0].id)).toEqual([0, 0, 0, 0, 0]);
    expect(cleared.stages[0].files[2].sha256).not.toBe(kept.stages[0].files[2].sha256); // only the rows change
    expect(cleared.stages[0].files[0].sha256).toBe(kept.stages[0].files[0].sha256);
    expect((await publish([p.id], { clearConditions: 'yes' })).status).toBe(400);
  });

  test('serves an empty LCSM manifest before anything is published', async () => {
    const { request } = await setup();
    const bin = await request('/api/stages.bin');
    expect(bin.headers.get('cache-control')).toBe('no-store');
    expect(bin.headers.get('content-length')).toBe('16');
    expect([...new Uint8Array(await bin.arrayBuffer())]).toEqual([
      0x4c, 0x43, 0x53, 0x4d, 1, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x44, 0, 0,
    ]);
    expect((await (await request('/api/stages')).json()).stages).toEqual([]);
    expect((await request('/api/stages/00000000/archive')).status).toBe(404);
    expect((await request('/api/publish')).status).toBe(405);
  });

  test('publishes one stage: manifest layout, files with ETag, rows with relative string offsets', async () => {
    const { baselinePath, request, upload, publish } = await publishing();
    const { package: p } = await (await upload(stagePackage({ name: 'テストの島', script: false, ips: false }))).json();
    const noBaseline = await publish([p.id]);
    expect(noBaseline.status).toBe(422);
    expect((await noBaseline.json()).error).toContain('master-baseline.json');

    await Bun.write(baselinePath, baselineOf());
    const created = await publish([p.id]);
    expect(created.status).toBe(201);
    const { manifest } = await created.json();
    expect(manifest.revision).toBe(1);
    const [stage] = manifest.stages;
    expect(stage).toMatchObject({
      revision: 1,
      name: '島テストの島',
      content: 127,
      archive: 'F0000000',
      slots: [52],
      signature: null,
    });
    expect(stage.rows.map((r: { table: string; op: string; by: string }) => `${r.table}:${r.op}:${r.by}`)).toEqual([
      'Contents:add:own',
      'MapStageIntegration:add:own',
      'MessageMapStage:add:own',
    ]);

    const files: Record<string, Uint8Array> = {};
    for (const f of stage.files) {
      const r = await request(`/api/stages/${stage.id}/${f.name}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('etag')).toBe(`"${f.sha256}"`);
      expect(r.headers.get('content-length')).toBe(String(f.size));
      files[f.name] = new Uint8Array(await r.arrayBuffer());
      expect(sha(files[f.name]!)).toBe(f.sha256);
      const again = await request(`/api/stages/${stage.id}/${f.name}`, {
        headers: { 'if-none-match': `"${f.sha256}"` },
      });
      expect(again.status).toBe(304);
    }
    expect(stage.id).toBe(stage.files[0].sha256.slice(0, 8).toUpperCase());
    expect(new TextDecoder().decode(files.crr)).toBe('CRR0');

    const bin = new Uint8Array(await (await request('/api/stages.bin')).arrayBuffer());
    const v = new DataView(bin.buffer);
    expect(bin.length).toBe(0x10 + 0x100);
    expect(new TextDecoder().decode(bin.subarray(0, 4))).toBe('LCSM');
    expect([v.getUint16(4, true), v.getUint16(6, true), v.getUint32(8, true), v.getUint32(12, true)]).toEqual([
      1, 1, 1, 17408,
    ]);
    const o = 0x10;
    expect(v.getUint32(o, true)).toBe(parseInt(stage.id, 16));
    expect([
      v.getUint32(o + 4, true),
      v.getUint16(o + 8, true),
      v.getUint16(o + 10, true),
      v.getUint32(o + 12, true),
    ]).toEqual([1, 127, 52, 0xf0000000]);
    stage.files.forEach((f: { size: number; sha256: string }, k: number) => {
      const at = o + 0x10 + k * 0x28;
      expect(v.getUint32(at, true)).toBe(f.size);
      expect(Buffer.from(bin.subarray(at + 4, at + 0x24)).toString('hex')).toBe(f.sha256);
      expect(v.getUint32(at + 0x24, true)).toBe(0);
    });
    const name = String.fromCharCode(...Array.from({ length: 6 }, (_, k) => v.getUint16(o + 0x88 + k * 2, true)));
    expect(name).toBe('島テストの島');
    expect(v.getUint16(o + 0x88 + 12, true)).toBe(0);
    expect(bin.subarray(o + 0xc8, o + 0x100).every((x) => x === 0)).toBe(true);

    const rows = readRows(files.rows!);
    expect(rows.map((r) => [r.table, r.row, r.id.toString(16), r.op, r.by, r.guess, r.pad])).toEqual([
      ['Contents', 127, 'ffffffff', 0, 0, 0, 0],
      ['MapStageIntegration', 0, '80000085', 0, 0, 0, 0],
      ['MessageMapStage', 0, '800000a6', 0, 0, 0, 0],
    ]);
    expect(rows[0]!.entry).toBe(0x2d8fcc00);
    expect(new DataView(rows[0]!.rowBytes.buffer).getUint32(0, true)).toBe(0xf0000000);
    const mms = rows[2]!;
    expect(mms.fields).toEqual([4, 0x0c]);
    const rel = mms.fields.map((f) => new DataView(mms.rowBytes.buffer).getUint32(f, true));
    const encodedName = ruby('テストの島');
    expect(rel).toEqual([0, (encodedName.length + 3) & ~3]);
    expect(mms.strings.subarray(0, encodedName.length)).toEqual(encodedName);
    expect(mms.strings.subarray(rel[1]!, rel[1]! + 16)).toEqual(utf16('たからを探そう'));

    // the same files again: a new revision, the stage keeps its revision; [] withdraws everything
    expect((await (await publish([p.id])).json()).manifest.stages[0].revision).toBe(1);
    const emptied = (await (await publish([])).json()).manifest;
    expect([emptied.revision, emptied.stages.length]).toEqual([3, 0]);
    expect(new DataView(await (await request('/api/stages.bin')).arrayBuffer()).getUint16(6, true)).toBe(0);
    expect((await request(`/api/stages/${stage.id}/rows`)).status).toBe(404);
  });

  test('refuses condition scripts and unknown packages (colliding ZIPs are renumbered: merge.test.ts)', async () => {
    const { baselinePath, request, upload, publish } = await publishing();
    await Bun.write(baselinePath, baselineOf());
    const a = (await (await upload(stagePackage({ name: 'A', script: false, ips: false }))).json()).package.id;
    const scripted = (await (await upload(stagePackage({ name: 'C' }))).json()).package.id;
    const refused = await publish([scripted]);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain('条件スクリプト');
    expect((await publish(['0123456789abcdef'])).status).toBe(404);
    expect((await publish('x')).status).toBe(400);
    expect((await publish([a, a])).status).toBe(400);
    expect((await (await request('/api/stages')).json()).revision).toBe(0);
  });
});

// A real Panana export and the ROM baseline (neither committed): run when both are in web/data/.
const sample = join(import.meta.dir, 'data', 'samples', 'panana-lanai-mod-new-stage-sample.zip');
const sampleBaseline = join(import.meta.dir, 'data', 'master-baseline.json');
describe.skipIf(!existsSync(sample) || !existsSync(sampleBaseline))('real sample stage files', () => {
  test('cuts content 127 with its six master rows out of the sample', async () => {
    const zip = new Uint8Array(await Bun.file(sample).arrayBuffer());
    const { stages } = await extractStages(zip, await Bun.file(sampleBaseline).json());
    expect(stages).toHaveLength(1);
    const s = stages[0]!;
    expect([s.archive.length, s.crr.length, s.rows.length]).toEqual([105360, 4096, 900]);
    expect(sha(s.archive)).toBe('c64dc4335a5661df4daa638c76b91ab44a48462e6690883a8d07b120d6340ec5');
    expect(sha(s.rows)).toBe('d078c2d8ec8ae175efd51a2e75d13dd834f41dedfa0f676da40c1503f334d0fc');
    const rows = readRows(s.rows);
    expect(rows.map((r) => `${r.table} ${r.row} ${r.op} ${r.by} ${r.guess}`)).toEqual([
      'ItemDataCore 3232 0 3 1',
      'Contents 127 0 0 0',
      'ItemData 134 1 1 0',
      'MapStageIntegration 132 0 0 0',
      'MessageMapName 193 0 2 1',
      'MessageMapStage 135 0 0 0',
    ]);
    expect(rows.map((r) => r.fields)).toEqual([[], [], [0, 4], [0x10, 0x14, 0x18], [0, 4], [4, 8, 0x0c, 0x10]]);
  });
});

test('the added master rows of the stages continue each other in manifest order (the 3DS applies them as one patch)', () => {
  const baseline = { titleVersion: 17408, tables: [{ entry: 'AAAA0000', name: 'Contents', rows: 127, rowHashes: [] }] };
  const add = (row: number) => ({
    entry: 'AAAA0000',
    table: 'Contents',
    row,
    id: null,
    op: 'add' as const,
    by: 'own' as const,
    stringFields: [],
    rowSize: 4,
    stringBytes: 0,
  });
  const stage = (content: number, ...rows: number[]) => ({ id: String(content), content, rows: rows.map(add) });
  expect(rowOrderProblem([stage(127, 127), stage(128, 128)], baseline)).toBeNull();
  expect(rowOrderProblem([stage(128, 128)], baseline)).toContain('コンテンツ 128');
  expect(rowOrderProblem([stage(127, 128), stage(128, 127)], baseline)).toContain('行 128');
  expect(rowOrderProblem([stage(127, 127), stage(128, 127)], baseline)).toContain('行数 128');
  // replaced rows do not count
  expect(
    rowOrderProblem([{ ...stage(127, 127), rows: [{ ...add(3), op: 'replace' as const }, add(127)] }], baseline),
  ).toBeNull();
});
