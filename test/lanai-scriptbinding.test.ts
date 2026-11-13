// What can start the event of a map's record when a function of the stage's script is given to it
// (src/lanai/EventScriptBinding.tsx recordTriggers; the kinds are those of lanai-custom-stages event-actions.md §3).
import { expect, test } from 'bun:test';
import { recordTriggers } from '../src/lanai/EventScriptBinding';
import { triggerFitsRecord } from '../src/lanai/stageScript';

const rec = (kind: number): Uint8Array => new Uint8Array([kind & 0xff, (kind >> 8) & 0xff, 0, 0, 0, 0, 0, 0]);

test('RPG FREE! stage script: the triggers of a record by its section and kind', () => {
  // a range: entering it, or (as the place the event is kept) all monsters beaten; kinds from 100 on have no event
  expect(recordTriggers(8, rec(0))).toEqual(['area', 'defeat']);
  expect(recordTriggers(8, rec(1))).toEqual(['area', 'defeat']);
  expect(recordTriggers(8, rec(100))).toEqual([]);
  // section 5: characters talk, kinds 4〜6 are buttons, the other gimmicks and the event-less kinds take no function
  expect(recordTriggers(5, rec(0))).toEqual(['talk']);
  expect(recordTriggers(5, rec(1))).toEqual(['talk']);
  for (const k of [4, 5, 6]) expect(recordTriggers(5, rec(k))).toEqual(['button']);
  for (const k of [7, 10, 11, 14, 15]) expect(recordTriggers(5, rec(k))).toEqual([]);
  // doors and chests: not yet
  expect(recordTriggers(3, rec(0))).toEqual([]);
  expect(recordTriggers(4, rec(0))).toEqual([]);
  expect(triggerFitsRecord('defeat', { section: 8, kind: 0 })).toBe(true);
  expect(triggerFitsRecord('defeat', { section: 5, kind: 0 })).toBe(false);
  expect(triggerFitsRecord('button', { section: 5, kind: 4 })).toBe(true);
  expect(triggerFitsRecord('talk', { section: 5, kind: 4 })).toBe(false);
});
