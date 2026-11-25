// The stage's clear (clearTelop / clearStage: CRO 23 D0100XF01Npc0562, CRO 28 D01001B01Npc0712) and the event of an
// exit (on exit: the CRO's export 6, MoveEvent; CRO 22's random holes) and the buttons put back (buttonOff /
// switchOff: CRO 5 D01002B02GimmickCommon) in the stage script (src/lanai/eventScript.ts).
import { describe, expect, test } from 'bun:test';
import { lanaiContents } from '../src/lanai/contents';
import { buildCro, parseCro } from '../src/lanai/cro';
import { decompileContentCro } from '../src/lanai/croDecompile';
import { compileStageScript, eventProblem, parseStageScript, ScriptError, SLOT_EXIT } from '../src/lanai/eventScript';
import { LanaiSession } from '../src/lanai/session';
import { contentScript, LANAI_EMPTY_SCRIPT_CONTENT } from '../src/lanai/stageEdit';
import { eventRecordKind, recordTrigger } from '../src/lanai/stageScript';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe('RPG FREE! stage script: the clear and the exits', () => {
  test('clearTelop is a statement, not of an intro', () => {
    const s = parseStageScript('on talk(1, 5) { clearStage() }');
    expect(s.events[0]!.body.some((n) => n.op === 'clearTelop')).toBe(true); // clearStage is written out where called
    expect(eventProblem('talk', s.events[0]!.body)).toBeNull();
    expect(eventProblem('intro', s.events[0]!.body)).toContain('clearTelop()');
    expect(() => parseStageScript('on intro(1) { clearTelop() }')).toThrow(ScriptError);
    expect(() => parseStageScript('function clearTelop() {}')).toThrow();
  });

  test("an exit's record (section 3) takes the exit's event, but the arrival points", () => {
    const raw = new Uint8Array(0x18);
    raw[0x15] = 7; // a hole
    expect(recordTrigger({ section: 3, kind: eventRecordKind(3, raw) })).toBe('exit');
    raw[0x15] = 11; // an arrival point
    expect(recordTrigger({ section: 3, kind: eventRecordKind(3, raw) })).toBeNull();
    expect(SLOT_EXIT).toBe(6);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! stage script: the clear and the exits (ROM)', () => {
  test('they build, and read back as written', async () => {
    const s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
      { fresh: true },
    );
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const script = parseStageScript(
      [
        'on talk(1, 5) {',
        '  if (ScriptMenu.SystemMessageYesNo(0x8000027E) != 0) { clearStage() }',
        '}',
        'on exit(1, 6) {',
        '  let r = ScriptMath.RandRange(100)',
        '  if (r < 45) { warp(0x0A536F4E, 0xE997CA15) } else { warp(0x0A536F4E, 0xD37C082E) }',
        '}',
      ].join('\n'),
    );
    // the content to clear is needed
    expect(() => compileStageScript(base, script)).toThrow(ScriptError);
    const built = compileStageScript(base, script, [], {}, 23);
    const cro = buildCro(built.cro);
    expect(parseCro(cro).indexedExports[SLOT_EXIT]).toBeTruthy();
    const d = decompileContentCro(cro);
    const talk = d.events.find((e) => e.bindings.some((b) => b.trigger === 'talk' && b.row === 5))!;
    expect(talk.text).toContain('clearTelop()');
    expect(talk.text).not.toContain('CallMenu');
    expect(talk.text).not.toContain('ChangeMapIsland');
    // its CtrlFlag clears content 23, as CRO 23's
    expect(talk.text).toContain('ScriptFlag.ClearMapGroup(23)');
    const exit = d.events.find((e) => e.bindings.some((b) => b.trigger === 'exit' && b.row === 6))!;
    expect(exit.text).toContain('ScriptMath.RandRange(100)');
    expect(exit.text).toContain('warp(0xA536F4E, 0xE997CA15)');
  }, 120000);

  test('buttons put back build and read back', async () => {
    const s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
      { fresh: true },
    );
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const script = parseStageScript(
      'on switch(1, 37) {\n  if (state(38) == 0) { switchOff(39); buttonOff(40); state = 0 }\n}',
    );
    const d = decompileContentCro(buildCro(compileStageScript(base, script).cro));
    const text = d.events.find((e) => e.bindings.some((b) => b.trigger === 'switch' && b.row === 37))!.text;
    expect(text).toContain('buttonOff(39)');
    expect(text).toContain('ScriptFlag.SetScriptState(39, 0)');
    expect(text).toContain('buttonOff(40)');
  }, 120000);

  test('the shipped events read back: the clear of CRO 23, the holes of CRO 22 on export 6', async () => {
    const s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
    );
    const read = async (n: number) => {
      const c = lanaiContents(s).find((x) => x.index === n)!;
      return decompileContentCro((await contentScript(s, c, await s.archive(c.archive))).body);
    };
    const c23 = await read(23);
    expect(c23.events.find((e) => e.cls === 'D0100XF01Npc0562')!.text).toContain('clearTelop()');
    const c22 = await read(22);
    expect(c22.events.find((e) => e.cls === 'D01B01Hole')!.bindings.map((b) => [b.trigger, b.group, b.row])).toEqual([
      ['exit', 1, 6],
      ['exit', 1, 7],
    ]);
  }, 120000);
});
