// The shipped CROs' events written back as stage script (src/lanai/croDecompile.ts, STATE #17).
import { describe, expect, test } from 'bun:test';
import { lanaiContents } from '../src/lanai/contents';
import { parseCro } from '../src/lanai/cro';
import { decompileContentCro, decompiledSource, floatText, fold, render, type Stmt } from '../src/lanai/croDecompile';
import { compileStageScript, parseStageScript } from '../src/lanai/eventScript';
import { LanaiSession } from '../src/lanai/session';
import { contentScript, LANAI_EMPTY_SCRIPT_CONTENT } from '../src/lanai/stageEdit';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const call = (who: string | null, cls: string, name: string, ...args: string[]): Stmt => ({
  k: 'call',
  who,
  cls,
  name,
  args,
});

describe('RPG FREE! CRO decompile: the text', () => {
  test('floats are the shortest decimal of the single float', () => {
    expect(floatText(Math.fround(0.2))).toBe('0.2');
    expect(floatText(Math.fround(3.14159265))).toBe('3.1415927');
    expect(floatText(1, true)).toBe('1.0');
    expect(floatText(1)).toBe('1');
  });

  test("the library's shapes are folded, the ones made of others after", () => {
    const body: Stmt[] = [
      call('self', 'ScriptChara', 'StartAnimation', '0x80000079', '0', '1', '0'),
      call(null, 'ScriptMenu', 'StartMessage', '0x80000028', '0', '0', '0.2'),
      call('self', 'ScriptChara', 'StartAnimation', '0x80000075', '0', '1', '0'),
      call(null, 'ScriptSound', 'PauseBGM', '0.3'),
      call(null, 'ScriptSound', 'Play', '65', '0'),
      call(null, 'ScriptSystem', 'WaitTime', '1'),
      call(null, 'ScriptSound', 'ReplayBGM', '0.3'),
      call('obj(5)', 'ScriptChara', 'StartAnimation', '0x80000073', '0', '1', '0'),
      call('obj(5)', 'ScriptChara', 'WaitAnimation', '62'),
      call(null, 'ScriptMap', 'SetDoorOpenFlag', '5'),
    ];
    expect(render(fold(body), 0)).toEqual(['talk(0x80000028)', 'jingle(65)', 'open(5)']);
  });

  test('a shape whose arguments are not what the parameters take stays as it is', () => {
    const body: Stmt[] = [
      call(null, 'ScriptMap', 'SetUpdateFormation', '0'),
      call(null, 'ScriptMap', 'SetPartyConvexPosition', 'v1', '4', '150'),
    ];
    expect(render(fold(body), 0)).toHaveLength(2);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! CRO decompile (ROM)', () => {
  const open = async (): Promise<LanaiSession> =>
    LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
      { fresh: true },
    );

  test('content 65: the factories bind the talk events, the bodies fold to talk(), and they build', async () => {
    const s = await open();
    const c = lanaiContents(s).find((x) => x.index === 65)!;
    const d = decompileContentCro((await contentScript(s, c, await s.archive(c.archive))).body);
    const npc = d.events.find((e) => e.cls === 'D01001F01_Npc0103')!;
    expect(npc.bindings.map((b) => [b.trigger, b.group, b.row])).toEqual([['talk', 1, 7]]);
    expect(npc.notes).toEqual([]);
    expect(npc.text).toContain('talk(0x80000028)');
    // every event's text reads; the clean ones build into a CRO with an `on` of their own
    for (const e of d.events) expect(() => parseStageScript(decompiledSource(d, [e.cls], 65))).not.toThrow();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const clean = d.events.filter((e) => !e.notes.length && e.bindings.some((b) => b.trigger === 'talk'));
    expect(clean.length).toBeGreaterThan(1);
    const src = [
      decompiledSource(
        d,
        clean.map((e) => e.cls),
        65,
      ),
      ...clean.map((e) => `on talk(1, ${e.bindings[0]!.row}) ${e.cls}`),
    ].join('\n');
    expect(compileStageScript(base, parseStageScript(src)).cro.segments.length).toBeGreaterThan(0);
  }, 60000);

  test('content 1: the answer of a question picks the line in both ways (the rest written in each)', async () => {
    const s = await open();
    const c = lanaiContents(s).find((x) => x.index === 1)!;
    const d = decompileContentCro((await contentScript(s, c, await s.archive(c.archive))).body);
    const npc = d.events.find((e) => e.cls === 'D01001B01Npc0201')!;
    expect(npc.text).toContain(
      'if (ScriptMenu.SystemMessageYesNo(0x80000000) != 0) {\n    talk(0x80000005)\n  } else {\n    talk(0x80000006)\n  }',
    );
  }, 60000);
});
