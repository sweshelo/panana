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
import {
  cloneLanaiContent,
  editLanaiStage,
  lanaiStageStart,
  LANAI_EMPTY_SCRIPT_CONTENT,
  setLanaiStageStart,
} from '../src/lanai/stageEdit';
import { CRO_COMMON_HOOKS, CRO_HOOK_START_EVENT, croHooks } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { lanaiEditState } from '../src/lanai/mapedit';
import { Controller } from '../src/editor/controller';
import { findEntry } from '../src/archive/gsarc';
import { u32 } from '../src/util/bytes';
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

  test('every stage starts at a map of its own map table: MapStage +0x3A names the MapGroup, +0x14 / +0x18 the map and the arrival point', async () => {
    const s = await fresh();
    let checked = 0;
    for (const c of lanaiContents(s)) {
      if (!c.index) continue;
      const local = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')!.table;
      for (const stage of c.stages) {
        const start = await lanaiStageStart(s, c, stage);
        // the integration row and the content's own row agree
        expect(local.u16(0, 0x3a) === start.group || c.stages.length > 1).toBe(true);
        if (!start.group) continue;
        const maps = await lanaiMaps(s, c);
        const info = maps.map(start.map)!;
        expect(info).toBeDefined();
        expect(info.world).toBe(false);
        expect((maps.doc(info).recs[3] ?? []).some((r) => u32(r.raw, 0) === start.point)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(126);
  }, 300000);

  test('the CROs share 41 hooks; hook 3 is the opening event, and content 99 has only the common ones', async () => {
    const s = await fresh();
    const cs = lanaiContents(s);
    const one = (await readContent(s, cs[1]!)).cro!.info.hooks;
    expect(one).toContain(CRO_HOOK_START_EVENT);
    const empty = (await readContent(s, cs[LANAI_EMPTY_SCRIPT_CONTENT]!)).cro!.info.hooks;
    expect(empty.filter((h) => !(CRO_COMMON_HOOKS as readonly number[]).includes(h))).toEqual([]);
    expect(croHooks(new Uint8Array(0x200))).toEqual([]);
  });

  test('a new stage: its maps open and edit, its start moves to an added map, and an empty script is registered', async () => {
    const s = await fresh(),
      source = lanaiContents(s)[1]!;
    const index = await cloneLanaiContent(s, source, '白紙の島', { script: 'empty' });
    const c = lanaiContents(s)[index]!;
    const a = await readContent(s, c);
    expect(a.cro!.info.hooks).not.toContain(CRO_HOOK_START_EVENT);
    expect(a.cro!.info.classes).toEqual([]);
    const files = s.modFiles();
    const crr = files.get(`.crr/contents${index.toString().padStart(4, '0')}.crr`)!;
    expect(equalBytesOf(crr, await dump.readUpdateRomfs!('.crr/contents0099.crr'))).toBe(true);
    // the copy keeps the source's own tables, and the source is untouched
    expect((await readContent(s, source)).cro!.info.hooks).toContain(CRO_HOOK_START_EVENT);

    // the maps of the new content are its own: painting a tile changes the new archive only
    const maps = await lanaiMaps(s, c);
    expect(maps.content.index).toBe(index);
    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    const doc = st.current!;
    const t = doc.tiles.find((x) => x.kind === 5)!;
    st.brush = { kind: 14, letter: 0x7a, rot: 1 };
    st.setTool('paint');
    const ctl = new Controller(st);
    ctl.down(t.x + 0.5, t.y + 0.5, { shiftKey: false, button: 0 });
    ctl.up();
    expect(s.changedMapDbs().map((x) => x.archive)).toEqual([c.archive]);
    const out = parseArchive(s.modFiles().get(c.archive)!);
    const srcArc = await s.archive(source.archive);
    const built = unpackEntry(out, findEntry(out, 0xc9f79000)!).body;
    expect(equalBytesOf(built, unpackEntry(srcArc, findEntry(srcArc, 0xc9f79000)!).body)).toBe(false);
    expect(s.modFiles().has(source.archive)).toBe(false);

    // start at the second map's first arrival point
    const second = maps.mapByName('D01001B02')!;
    const point = u32(maps.doc(second).recs[3]![0]!.raw, 0);
    await setLanaiStageStart(s, c, c.stages[0]!, second.hash, point);
    expect(await lanaiStageStart(s, c, c.stages[0]!)).toEqual({ group: second.dungeon, map: second.hash, point });
    expect(await lanaiStageStart(s, source, source.stages[0]!)).not.toEqual({
      group: second.dungeon,
      map: second.hash,
      point,
    });
    // saved and restored with the new content
    const restored = await fresh();
    await restored.restore(s.saved());
    const rc = lanaiContents(restored)[index]!;
    expect(await lanaiStageStart(restored, rc, rc.stages[0]!)).toEqual({
      group: second.dungeon,
      map: second.hash,
      point,
    });
    const rm = await lanaiMaps(restored, rc);
    expect(rm.isChanged(rm.mapByName('D01001B01')!)).toBe(true);

    // taken out and added again: the maps are read anew, not the ones of the content taken out
    s.revertAll();
    const again = await cloneLanaiContent(s, lanaiContents(s)[1]!, '白紙の島');
    expect(again).toBe(index);
    const fresh2 = await lanaiMaps(s, lanaiContents(s)[again]!);
    expect(fresh2).not.toBe(maps);
    expect(fresh2.isChanged(fresh2.mapByName('D01001B01')!)).toBe(false);
  }, 300000);
});

function equalBytesOf(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
