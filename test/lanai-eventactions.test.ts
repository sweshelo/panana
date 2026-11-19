// What the action types and the conditions of RPG FREE!'s EventObject rows are offered as (src/lanai/actions.ts,
// conditions.ts): the types a record's event takes by its section and kind, and the kinds an author may pick.
import { expect, test } from 'bun:test';
import {
  LANAI_ACTION_NONE,
  LANAI_ACTION_RUNS,
  LANAI_ACTION_SCRIPT,
  LANAI_ACTION_TYPES,
  LANAI_ACTIONS,
  LANAI_DESTINATION_ACTIONS,
  lanaiActionName,
  lanaiActionTypesFor,
} from '../src/lanai/actions';
import { LANAI_CONDITIONS } from '../src/lanai/conditions';

const t = (n: number): number => (0x80000000 | n) >>> 0;

test('0x37 is the NPC that joins (seven lines from one row) and 0x39 a door, not four lines and a warp', () => {
  expect(LANAI_ACTIONS[t(0x37)]!.talk).toEqual([0]);
  expect(lanaiActionName(t(0x37))).toBe('仲間になる NPC');
  expect(lanaiActionName(t(0x39))).toContain('扉');
  expect(LANAI_DESTINATION_ACTIONS).toContain(t(0x39));
});

test('the thirteen types that had no name have one', () => {
  for (const n of [0x12, 0x15, 0x16, 0x18, 0x19, 0x1c, 0x1d, 0x33, 0x34, 0x35, 0x36, 0x3a, 0x3b])
    expect(LANAI_ACTION_TYPES).toContain(t(n));
});

test('a record is offered the types its event takes: by section, and by kind for section 5', () => {
  const chest = lanaiActionTypesFor(4)!;
  expect(chest).toEqual([LANAI_ACTION_NONE, t(0x0e), t(0x10), LANAI_ACTION_SCRIPT, t(0x2e)]);
  expect(lanaiActionTypesFor(8)).toEqual([
    LANAI_ACTION_NONE,
    t(0x0c),
    t(0x0d),
    LANAI_ACTION_SCRIPT,
    t(0x33),
    t(0x35),
    t(0x36),
  ]);
  expect(lanaiActionTypesFor(3)).toContain(t(0x31));
  expect(lanaiActionTypesFor(3)).not.toContain(t(0x01));
  expect(lanaiActionTypesFor(5, 0)).toContain(t(0x01));
  expect(lanaiActionTypesFor(5, 0)).not.toContain(t(0x2f));
  expect(lanaiActionTypesFor(5, 11)).toContain(t(0x2f));
  expect(lanaiActionTypesFor(5, 13)).toEqual([LANAI_ACTION_NONE, LANAI_ACTION_SCRIPT, t(0x30)]);
  expect(lanaiActionTypesFor(5, 8)).toEqual([LANAI_ACTION_NONE, LANAI_ACTION_SCRIPT]);
  expect(lanaiActionTypesFor(5, 7)).toEqual([LANAI_ACTION_NONE]);
  // a kind or a section nothing is known of: no narrowing
  expect(lanaiActionTypesFor(5, 99)).toBeUndefined();
  expect(lanaiActionTypesFor(2)).toBeUndefined();
  // every offered type has a name
  for (const s of [3, 4, 8]) for (const v of lanaiActionTypesFor(s)!) expect(LANAI_ACTIONS[v]).toBeDefined();
  for (const k of [0, 4, 12]) for (const v of lanaiActionTypesFor(5, k)!) expect(LANAI_ACTIONS[v]).toBeDefined();
});

test('the three actions are the first, the second and the later runs', () => {
  expect(LANAI_ACTION_RUNS).toEqual(['1 回目', '2 回目', '3 回目以降']);
});

test('conditions: the item counts and the joined number flags are offered, the date kinds are not', () => {
  expect(LANAI_CONDITIONS[0x14]!.label).toContain('以上');
  expect(LANAI_CONDITIONS[0x15]!.label).toContain('未満');
  for (let k = 0x30; k <= 0x38; k++) expect(LANAI_CONDITIONS[k]).toBeDefined();
  expect(LANAI_CONDITIONS[0x30]!.secondMax).toBe(0xffff);
  expect(LANAI_CONDITIONS[0x38]!.secondMax).toBe(0xffffffff);
  expect(LANAI_CONDITIONS[0x38]!.label).toContain('4 つ');
  for (let k = 0x39; k <= 0x71; k++) expect(LANAI_CONDITIONS[k]).toBeUndefined();
  for (const k of [0x27, 0x2e, 0x2f, 0x6e]) expect(LANAI_CONDITIONS[k]).toBeUndefined();
});
