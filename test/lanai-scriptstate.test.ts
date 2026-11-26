import { describe, expect, test } from 'bun:test';
import { contentScript, LANAI_EMPTY_SCRIPT_CONTENT } from '../src/lanai/stageEdit';
import { lanaiContents } from '../src/lanai/contents';
import { parseCro } from '../src/lanai/cro';
import {
  compileStageScript,
  CRO_TEXT,
  parseStageScript,
  scriptStateRow,
  usesOwnState,
  writesOwnState,
} from '../src/lanai/eventScript';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe('RPG FREE! stage script: event states', () => {
  test('state and state(N) are names of states, not variables', () => {
    expect(scriptStateRow('state')).toBe('own');
    expect(scriptStateRow('state(12)')).toBe(12);
    expect(scriptStateRow('STATE')).toBeNull();
    const s = parseStageScript(
      'on talk(1, 5) { if (state == 0) { state = 2 } else { state += 1 }; state(7) = state(7) + 1 }',
    );
    expect(s.vars).toEqual([]);
    const body = s.events[0]!.body;
    expect(usesOwnState(body)).toBe(true);
    expect(writesOwnState(body)).toBe(true);
    // reading only
    const read = parseStageScript('on area(1, 4) { if (state(3) >= 2) { ScriptSystem.WaitTime(1) } }').events[0]!.body;
    expect(usesOwnState(read)).toBe(false);
    expect(writesOwnState(read)).toBe(false);
  });

  test('mistakes', () => {
    const err = (src: string): string => {
      try {
        parseStageScript(src);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(err('var state: byte')).toContain('イベントの状態');
    expect(err('on start(1) { state = 1 }')).toContain('state(イベント番号)');
    expect(err('on start(1) { state(4) = 1 }')).toBe('');
    expect(err('on area(1, 4) { state = 256 }')).toContain('0〜255');
  });
});

describe.skipIf(!hasLanai)('RPG FREE! stage script: event states into the CRO (ROM)', () => {
  test('reading and writing a state build, and an event that writes its own keeps the game from moving it', async () => {
    const s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
      { fresh: true },
    );
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const text = (src: string): Uint8Array =>
      compileStageScript(base, parseStageScript(src)).cro.segments[CRO_TEXT]!.bytes!;
    const none = text('on talk(1, 5) { ScriptSystem.WaitTime(1) }');
    const read = text('on talk(1, 5) { if (state == 1) { ScriptSystem.WaitTime(1) } }');
    const write = text('on talk(1, 5) { state(6) = state + 1 }');
    expect(read.length).toBeGreaterThan(none.length);
    expect(write.length).toBeGreaterThan(none.length);
  });
});
