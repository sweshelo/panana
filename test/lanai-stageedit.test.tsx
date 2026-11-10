import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';
import { ArmMachine } from '../src/game/arm';
import { buildPatches, patchRecords } from '../src/game/patch';
import { LANAI_LAYOUT } from '../src/lanai/code';
import { parseConditionScript, conditionScriptPatch } from '../src/lanai/conditionScript';
import { lanaiContents, readContent } from '../src/lanai/contents';
import { crsExports } from '../src/lanai/scriptApi';
import { LanaiSession } from '../src/lanai/session';
import { cloneLanaiContent, editLanaiStage } from '../src/lanai/stageEdit';
import { LanaiTable } from '../src/lanai/table';
import { LanaiStagePage } from '../src/lanai/StagePage';
import { parseLanaiText } from '../src/lanai/message';
import { openImages, overlayDump, parsePatchList, type Dump } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

test('condition language validates syntax, ranges and precedence without evaluating JavaScript', () => {
  expect(parseConditionScript('flag(17) || cleared(1) && !timer(102)').op).toBe('or');
  for (const text of [
    '',
    'flag(1);alert(1)',
    'true garbage',
    'valueGe(1)',
    'flag(-1)',
    'flag(65536)',
    'valueEq(1,4294967296)',
    'flag(1.5)',
    'constructor(1)',
    'toString(1)',
    '__proto__(1)',
  ])
    expect(() => parseConditionScript(text)).toThrow();
  expect(parseConditionScript('valueGe(0xffff,0xffffffff)')).toEqual({
    op: 'test',
    kind: 6,
    v1: 65535,
    v2: 4294967295,
  });
});

describe.skipIf(!hasLanai)('Lanai stage authoring, native condition scripts and MOD round trips', () => {
  let dump: Dump;
  beforeAll(async () => {
    dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as File).name);
  });
  const fresh = () => LanaiSession.open(dump, { fresh: true });

  test('CRS uses the Update exports and preserves overloads and argument types', async () => {
    const exports = crsExports(await dump.readUpdateRomfs!('app/lanai.crs'));
    expect(exports.find((s) => s.symbol === '_ZN10ScriptFlag16GetScriptBitFlagEt')?.address).toBe(0x2e7df4);
    expect(exports.filter((s) => s.name === 'ScriptFlag::GetScriptState').length).toBeGreaterThan(1);
    expect(() => crsExports(new Uint8Array(100))).toThrow();
    const overlaid = overlayDump(dump, { label: 'empty', romfs: new Map(), ips: null });
    expect(crsExports(await overlaid.readUpdateRomfs!('app/lanai.crs'))).toEqual(exports);
  });

  test('generated A32 executes real vanilla leaves, short circuits, preserves vanilla defaults and survives save/restore', async () => {
    const s = await fresh();
    s.setConditionScript(1, 'flag(17) && (!cleared(1) || valueGe(2, 3))');
    s.setConditionScript(2, 'true || eventGe(2, 1)');
    s.setConditionScript(3, 'false && timer(102)');
    const built = buildPatches(dump.code, [conditionScriptPatch(s)!], LANAI_LAYOUT);
    expect([...built.values()].flatMap((b) => b.errors)).toEqual([]);
    const code = dump.code.slice();
    for (const [offset, bytes] of patchRecords(built.values())) code.set(bytes, offset);
    const run = (kind: number, id: number, flags: number, cleared: number, byte: number, defaultValue = 0) => {
      const m = new ArmMachine(code, {
        textEnd: 0x49a000,
        maxDepth: 20,
        stubs: new Map([
          [
            0x2e7df4,
            (m) => {
              expect(m.r[0]).toBe(17);
              return flags;
            },
          ],
          [
            0x2f4b58,
            (m) => {
              expect(m.r[0]).toBe(1);
              return cleared;
            },
          ],
          [
            0x2ff158,
            (m) => {
              expect(m.r[0]).toBe(2);
              return byte;
            },
          ],
          [
            0x2c7028,
            () => {
              throw Error('short circuit failed');
            },
          ],
          [
            0x2be834,
            () => {
              throw Error('short circuit failed');
            },
          ],
        ]),
      });
      return m.run(0x2fcd38, [kind, id, 0, defaultValue]);
    };
    expect(run(0x72, 1, 1, 0, 0)).toBe(1);
    expect(run(0x72, 1, 0, 0, 0)).toBe(0);
    expect(run(0x72, 1, 1, 1, 2)).toBe(0);
    expect(run(0x72, 1, 1, 1, 3)).toBe(1);
    expect(run(0x72, 2, 0, 0, 0)).toBe(1);
    expect(run(0x72, 3, 0, 0, 0)).toBe(0);
    expect(run(0x72, 999, 0, 0, 0)).toBe(0);
    expect(run(0, 0, 0, 0, 0, 1)).toBe(1);
    expect(run(0, 0, 0, 0, 0, 0)).toBe(0);
    const restored = await fresh();
    await restored.restore(s.saved());
    expect(restored.conditionScripts).toEqual(s.conditionScripts);
    expect(restored.codeIps()).not.toBeNull();
    restored.dropCap = true;
    expect(() => restored.codeIps()).not.toThrow();
    restored.dropCap = false;
    restored.revertAll();
    expect(restored.codeIps()).toBeNull();
  });

  test('oversized conditions and conflicting hooks cannot be exported', async () => {
    const s = await fresh();
    s.setConditionScript(1, Array.from({ length: 48 }, (_, i) => `flag(${i})`).join(' && '));
    expect(() => s.codeIps()).toThrow(/cave/);
    const code = dump.code.slice();
    code[0x2fcd38 - 0x100000] = 0;
    const modified = await LanaiSession.open({ ...dump, code }, { fresh: true });
    modified.setConditionScript(1, 'true');
    expect(() => modified.codeIps()).toThrow('変更');
  });

  test('the ROM converts MapStage to display conditions with a twelve-byte prefix, then evaluates both sides', async () => {
    const s = await fresh();
    const c = lanaiContents(s)[2]!;
    const t = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')!.table;
    let flag = 0;
    const m = new ArmMachine(dump.code, {
      textEnd: 0x49a000,
      maxDepth: 20,
      stubs: new Map([
        [0x2c1c7c, () => 0],
        [
          0x2e7df4,
          (m) => {
            expect(m.r[0]).toBe(17);
            return flag;
          },
        ],
      ]),
    });
    const root = m.alloc(0x1000),
      input = m.alloc(0x40),
      row = t.row(0).slice();
    // Use the text-copy path and slot zero to isolate the condition conversion.
    row[0xc] = 0x11;
    row[0xd] = 0;
    row[0xe] = 0;
    row[0xf] = 0x80;
    row[0x34] = 0;
    row[0x35] = 0;
    row[0x3c] = 0;
    row.forEach((v, i) => m.wb(input + i, v));
    m.run(0x1d6cd4, [root, input, 0]);
    const record = root + 12;
    expect(m.read(record + 0x118, 4)).toBe(17);
    expect(m.read(record + 0x120, 1)).toBe(3);
    expect(m.read(record + 0x12c, 1)).toBe(0);
    m.write(record + 0x134, 1, 4); // presence of a display entry, normally initialized by its constructor
    expect(m.run(0x2a9024, [0, record])).toBe(0);
    flag = 1;
    expect(m.run(0x2a9024, [0, record])).toBe(1);
    m.write(record + 0x12c, 9, 1); // hide when always true
    expect(m.run(0x2a9024, [0, record])).toBe(0);
  });

  test('stage edits update both tables, keep padding, save strings, and provide a message-editor link', async () => {
    const s = await fresh(),
      c = lanaiContents(s)[2]!,
      stage = c.stages[0]!;
    const table = s.need('MapStageIntegration'),
      before = table.row(stage.row).slice();
    await editLanaiStage(s, c, stage, {
      order: 1234,
      stamina: 7,
      visible: { kind: 6, v1: 23, v2: 3 },
      hidden: { kind: 0, v1: 0, v2: 0 },
    });
    const local = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')!.table;
    expect(table.u32(stage.row, 0)).toBe(1234);
    expect(local.u32(0, 0)).toBe(1234);
    expect(table.u8(stage.row, 0x49)).toBe(7);
    expect(local.u8(0, 0x3d)).toBe(7);
    expect(table.u32(stage.row, 0x20)).toBe(3);
    expect(local.u32(0, 0x20)).toBe(3);
    expect([...table.row(stage.row).slice(0x25, 0x28)]).toEqual([...before.slice(0x25, 0x28)]);
    const html = renderToString(createElement(LanaiStagePage, { session: s, arg: '2' }));
    expect(html).toContain('名前・ミッション・説明を編集');
    expect(html).toContain('#/messages/');
    const restored = await fresh();
    await restored.restore(s.saved());
    expect(restored.need('MapStageIntegration').u8(stage.row, 0x49)).toBe(7);
  });

  test('copy appends independent archive, definition, integration and message; reload, edit, export and revert', async () => {
    const s = await fresh(),
      source = lanaiContents(s)[1]!;
    const originalRows = s.need('Contents').rows;
    const index = await cloneLanaiContent(s, source, 'テストの島');
    expect(index).toBe(originalRows);
    const c = lanaiContents(s)[index]!;
    expect(c.archive).not.toBe(source.archive);
    expect(c.stages[0]!.name).toBe('テストの島');
    const a = await readContent(s, c);
    expect(a.def.slice(0, 2)).toEqual([index, index]);
    expect(a.cro?.info.module).toBe((await readContent(s, source)).cro?.info.module);
    const files = s.modFiles();
    expect(parseArchive(files.get(c.archive)!).hash).toBe(parseInt(c.archive, 16));
    expect(c.stages[0]!.row).toBeGreaterThan(source.stages[0]!.row);
    expect(parsePatchList(files.get('patchList.bin')!)).toContain(c.archive);
    expect(files.has(`.crr/contents${index.toString().padStart(4, '0')}.crr`)).toBe(true);
    const restored = await fresh();
    await restored.restore(s.saved());
    const other = lanaiContents(restored)[index]!;
    expect(other.stages[0]!.name).toBe('テストの島');
    await editLanaiStage(restored, other, other.stages[0]!, {
      order: 199,
      stamina: 1,
      visible: { kind: 0, v1: 0, v2: 0 },
      hidden: { kind: 0, v1: 0, v2: 0 },
    });
    const rebuilt = parseArchive(restored.modFiles().get(c.archive)!);
    const ref = (await restored.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')!;
    expect(new LanaiTable(unpackEntry(rebuilt, rebuilt.entries[ref.index]!).body).u8(0, 0x3d)).toBe(1);
    expect(lanaiContents(restored)[1]!.stages[0]!.stamina).toBe(source.stages[0]!.stamina);
    const msg = restored.need('MessageMapStage'),
      r = msg.find(other.stages[0]!.messageId);
    restored.setText(msg, r, 0x10, '宝は{ins:ItemData:0x80000001:name}です');
    expect(parseLanaiText(restored.field(msg, r, 0x10)!.text).some((t) => t.t === 'ins')).toBe(true);
    restored.revertAll();
    expect(restored.need('Contents').rows).toBe(originalRows);
    expect(restored.modFiles().size).toBe(0);
  });
});
