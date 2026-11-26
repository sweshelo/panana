// Ported from lanai-custom-stages web/merge.test.ts (99304a5); the uwapo there is kept in parallel.
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractMerged, MergeError } from './merge';
import { allTables, masterBaseline, parseArchive, type MasterBaseline, type PackageSummary } from './panana-zip';
import { deliveryLimitProblem, rowOrderProblem } from './publish';
import { emptyRenumber, isIdentity, planMerge, renumberArchive } from './renumber';
import { extractStages, type RowRecord } from './stage-files';
import { archive as fixtureArchive, setup, stagePackage, table as fixtureTable } from './test-fixtures';

const baseline = (): MasterBaseline => masterBaseline(stagePackage({ name: '', added: false }), 17408);
const plain = (name: string, extra: Parameters<typeof stagePackage>[0] = { name }) =>
  stagePackage({ script: false, ips: false, ...extra, name });
const le32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const le16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o, true);
/** The row bytes of the records of an LCSR rows file, by table name. */
function lcsrRows(b: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let o = 8;
  for (let i = 0; i < le16(b, 6); i++) {
    const size = le32(b, o + 0x30);
    out[new TextDecoder().decode(b.subarray(o + 4, o + 0x24)).replace(/\0+$/, '')] = b.slice(o + 0x34, o + 0x34 + size);
    let p = o + 0x34 + ((size + 3) & ~3);
    p += 4 + le32(b, p) * 4;
    o = p + 4 + le32(b, p);
  }
  return out;
}
const KEY_A = 'c42bfd09-dfe2-41a7-8610-38bd99f27f27';
const KEY_B = 'c9e15302-0405-4415-9c6c-797130808689';

/** A table of a stage archive by name. */
function tableIn(archive: Uint8Array, name: string) {
  const t = allTables(parseArchive(archive)).find((x) => x.table.name === name)!.table;
  return { t, at: (r: number, o: number) => t.dataOffset + r * t.rowSize + o };
}

describe('renumbering two ZIPs that each added content 127', () => {
  test('the first keeps its numbers, the second moves to the next content, archive, slot, IDs and rows', async () => {
    const { packages, warnings } = await extractMerged(
      [
        { name: 'a.zip', bytes: plain('A', { name: 'A', stageKey: KEY_A }) },
        { name: 'b.zip', bytes: plain('B', { name: 'B', stageKey: KEY_B }) },
      ],
      baseline(),
    );
    expect(isIdentity(packages[0]!.plan)).toBe(true);
    const [a, b] = packages.map((p) => p.stages[0]!);
    expect(a!.stage).toMatchObject({ content: 127, archive: 'F0000000', crr: 'romfs/.crr/contents0127.crr' });
    expect(b!.stage).toMatchObject({ content: 128, archive: 'F0010000', crr: 'romfs/.crr/contents0128.crr' });
    expect(b!.stage.stages[0]).toMatchObject({
      slot: 53,
      content: 128,
      messageId: '800000A7',
      integrationId: '80000086',
      integrationRow: 1,
    });
    expect(b!.original).toEqual({ content: 127, archive: 'F0000000' });
    expect(warnings).toContain('b.zip: 番号を振り直しました (コンテンツ 127 → 128、アーカイブ F0000000 → F0010000)');
    // the first ZIP's files are what extractStages gives alone
    const alone = (await extractStages(plain('A', { name: 'A', stageKey: KEY_A }), baseline())).stages[0]!;
    expect(a!.archive).toEqual(alone.archive);
    expect(a!.rows).toEqual(alone.rows);
    // master rows of the second: new rows and IDs, and the numbers inside them
    expect(b!.rowRecords.map((r) => `${r.table} ${r.row} ${r.id}`)).toEqual([
      'Contents 128 null',
      'MapStageIntegration 1 80000086',
      'MessageMapStage 1 800000A7',
    ]);
    const rows = lcsrRows(b!.rows);
    expect(le32(rows.Contents!, 0)).toBe(0xf0010000);
    const i = rows.MapStageIntegration!;
    expect([le32(i, 0x0c), le32(i, 0x34), le32(i, 0x38), le16(i, 0x40), le16(i, 0x44)]).toEqual([
      0x800000a7, 128, 0xf0010000, 53, 128,
    ]);
    // its archive: name in the header, ContentsDef (stored entry), MapStage (an LZ10 entry packed again)
    expect(parseArchive(b!.archive).hash).toBe(0xf0010000);
    const def = tableIn(b!.archive, 'ContentsDef');
    expect([le32(def.t.data, def.at(0, 0)), le32(def.t.data, def.at(1, 0))]).toEqual([128, 128]);
    const stage = tableIn(b!.archive, 'MapStage');
    expect([
      le32(stage.t.data, stage.at(0, 0x0c)),
      le16(stage.t.data, stage.at(0, 0x34)),
      le16(stage.t.data, stage.at(0, 0x38)),
    ]).toEqual([0x800000a7, 53, 128]);
    // the 3DS appends the rows in delivery order
    expect(
      rowOrderProblem(
        [...packages.flatMap((p) => p.stages.map((s) => ({ id: '', content: s.stage.content, rows: s.rowRecords })))],
        baseline(),
      ),
    ).toBeNull();
    // the LCSE (stageKey) stays with its stage
    expect(b!.events?.stageKey).toBe(KEY_B);
  });

  test('refuses two stages with one stageKey, or with one save file (its first 8 bytes)', async () => {
    for (const other of [KEY_A, `${KEY_A.slice(0, 19)}0000-000000000000`]) {
      const merged = extractMerged(
        [
          { name: 'a.zip', bytes: plain('A', { name: 'A', stageKey: KEY_A }) },
          { name: 'b.zip', bytes: plain('B', { name: 'B', stageKey: other }) },
        ],
        baseline(),
      );
      await expect(merged).rejects.toBeInstanceOf(MergeError);
      await expect(merged).rejects.toMatchObject({ problems: [{ kind: 'stageKey', packages: [0, 1] }] });
    }
  });

  test('plans: unresolvable collisions are reported, the rest renumbered', () => {
    const summary = (changed: string[], added: [string, string | null, string][]): PackageSummary =>
      ({
        stages: [{ content: 127, archive: 'F0000000', kind: 'added', stages: [{ slot: 52 }], files: [] }],
        conditionScripts: [],
        masterDiff: [
          {
            entry: '2D8FCC00',
            name: 'Contents',
            baseRows: 127,
            rows: 128,
            added: [{ row: 127, id: null, owner: { content: 127, by: 'own' } }],
            changed: [],
          },
          {
            entry: '11111111',
            name: 'ItemData',
            baseRows: 100,
            rows: 100 + added.length,
            added: added
              .filter(([t]) => t === 'ItemData')
              .map(([, id, by], k) => ({ row: 100 + k, id, owner: { content: 127, by } })),
            changed: changed.map((r) => ({ row: Number(r), id: null, owner: { content: 127, by: 'insert' } })),
          },
        ],
      }) as unknown as PackageSummary;
    const ok = planMerge([
      summary([], [['ItemData', '80000100', 'insert']]),
      summary([], [['ItemData', '80000101', 'value']]),
    ]);
    expect(ok.problems).toEqual([]);
    expect([...ok.plans[1]!.rows]).toEqual([
      ['Contents 127', 128],
      ['ItemData 100', 101],
    ]);
    const bad = planMerge([
      summary(['5'], [['ItemData', '80000100', 'insert']]),
      summary(['5'], [['ItemData', '80000100', 'value']]),
    ]);
    expect(bad.problems.map((p) => `${p.kind} ${p.value} ${p.packages}`).sort()).toEqual([
      'masterRow ItemData 5 0,1',
      'rowId ItemData 80000100 0,1',
    ]);
  });
});

describe('publishing two colliding ZIPs', () => {
  test('201 with both stages renumbered in the order chosen, and a note of what moved', async () => {
    const env = await setup();
    await Bun.write(env.baselinePath, JSON.stringify(baseline()));
    const a = (await (await env.upload(plain('A', { name: 'A', stageKey: KEY_A }), 'a.zip')).json()).package.id;
    const b = (await (await env.upload(plain('B', { name: 'B', stageKey: KEY_B }), 'b.zip')).json()).package.id;
    const { conflicts } = await (await env.request('/api/packages')).json();
    expect(conflicts.every((c: { resolvable: boolean }) => c.resolvable)).toBe(true);
    const post = (path: string, packages: string[]) =>
      env.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packages }),
      });
    const published = await post('/api/publish', [a, b]);
    expect(published.status).toBe(201);
    const { manifest } = await published.json();
    expect(manifest.warnings).toContain(
      'b.zip: 番号を振り直しました (コンテンツ 127 → 128、アーカイブ F0000000 → F0010000)',
    );
    expect(
      manifest.stages.map((s: { content: number; archive: string; slots: number[]; stageKey: string }) => [
        s.content,
        s.archive,
        s.slots,
        s.stageKey,
      ]),
    ).toEqual([
      [127, 'F0000000', [52], KEY_A],
      [128, 'F0010000', [53], KEY_B],
    ]);
    // the other order: b keeps 127
    const swapped = await (await post('/api/publish', [b, a])).json();
    expect(swapped.manifest.stages.map((s: { name: string; content: number }) => `${s.name} ${s.content}`)).toEqual([
      '島B 127',
      '島A 128',
    ]);
  });
});

// The two samples of the stage script (bun web/tools/script-zip.ts; not committed) and the ROM baseline.
const samples = [
  join(import.meta.dir, '.tmp', 'script', 'stage-script-28.zip'),
  join(import.meta.dir, '.tmp', 'script', 'stage-scene-28.zip'),
];
const realBaseline = join(import.meta.dir, 'data', 'master-baseline.json');
describe.skipIf(!samples.every(existsSync) || !existsSync(realBaseline))('real Panana ZIPs', () => {
  test("the two samples together: the second renumbered, its rows continue the first's", async () => {
    const base = (await Bun.file(realBaseline).json()) as MasterBaseline;
    const inputs = await Promise.all(
      samples.map(async (p) => ({ name: p, bytes: new Uint8Array(await Bun.file(p).arrayBuffer()) })),
    );
    const { packages } = await extractMerged(inputs, base);
    const stages = packages.flatMap((p) => p.stages);
    expect(stages.map((s) => [s.stage.content, s.stage.archive, s.stage.stages.map((r) => r.slot)])).toEqual([
      [127, 'F0000000', [52]],
      [128, 'F0010000', [53]],
    ]);
    expect(
      rowOrderProblem(
        stages.map((s) => ({ id: '', content: s.stage.content, rows: s.rowRecords })),
        base,
      ),
    ).toBeNull();
    // the first is what it is alone; the second's archive reads with its new name and content
    const alone = (await extractStages(inputs[0]!.bytes, base)).stages[0]!;
    expect([stages[0]!.archive, stages[0]!.rows]).toEqual([alone.archive, alone.rows]);
    expect(parseArchive(stages[1]!.archive).hash).toBe(0xf0010000);
    const def = tableIn(stages[1]!.archive, 'ContentsDef');
    expect(le32(def.t.data, def.at(0, 0))).toBe(128);
    const stage = tableIn(stages[1]!.archive, 'MapStage');
    expect([le16(stage.t.data, stage.at(0, 0x34)), le16(stage.t.data, stage.at(0, 0x38))]).toEqual([53, 128]);
  });
});

describe('review fixes', () => {
  test('EventObject references to another content of the same ZIP follow its new number', () => {
    const plan = {
      ...emptyRenumber(),
      content: new Map([
        [127, 128],
        [128, 129],
      ]),
      archive: new Map([['F0000000', 'F0020000']]),
    };
    const events = fixtureTable('M01_EventObject', 0x64, [
      (r) => {
        r.setUint32(0x10, 0x8000002e, true);
        r.setUint32(0x18, 128, true); // clears the other stage of the ZIP
        r.setUint32(0x28, 0x80000031, true);
        r.setUint32(0x2c, 127, true); // its own
        r.setUint32(0x08, 5, true); // a ROM content, condition kind 2
        r.setUint8(0x60, 2);
      },
    ]);
    const out = renumberArchive(plan, fixtureArchive(0xf0000000, [[0x12340000, 11, 6, events]]), 127);
    expect(parseArchive(out).hash).toBe(0xf0020000);
    const { t, at } = tableIn(out, 'M01_EventObject');
    expect([le32(t.data, at(0, 0x18)), le32(t.data, at(0, 0x2c)), le32(t.data, at(0, 0x08))]).toEqual([129, 128, 5]);
  });

  test('the 3DS limits: 8 stages, 64 master rows, 16 tables', () => {
    const row = (entry: string) => ({ entry }) as RowRecord;
    expect(
      deliveryLimitProblem(Array.from({ length: 8 }, () => ({ rows: Array.from({ length: 8 }, () => row('A')) }))),
    ).toBeNull();
    expect(deliveryLimitProblem(Array.from({ length: 9 }, () => ({ rows: [] })))).toContain('8 件まで');
    expect(deliveryLimitProblem([{ rows: Array.from({ length: 65 }, () => row('A')) }])).toContain('64 行まで');
    expect(deliveryLimitProblem([{ rows: Array.from({ length: 17 }, (_, i) => row(String(i))) }])).toContain(
      '16 個まで',
    );
  });
});
