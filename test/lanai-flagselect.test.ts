import { expect, test } from 'bun:test';
import { conditionFlagKind } from '../src/lanai/EventConditionFields';
import { STAGE_BIT_FLAGS, STAGE_BYTE_FLAGS } from '../src/lanai/eventScript';
import { scriptVarFlags } from '../src/lanai/FlagSelect';

test('script variables take flag numbers by kind in declared order', () => {
  const vars = [
    { name: 'A', kind: 'byte' as const, reset: false },
    { name: 'B', kind: 'bit' as const, reset: true },
    { name: 'C', kind: 'byte' as const, reset: true },
  ];
  expect(scriptVarFlags(vars, 'byte')).toEqual([
    { name: 'A', flag: STAGE_BYTE_FLAGS.first, reset: false },
    { name: 'C', flag: STAGE_BYTE_FLAGS.first + 1, reset: true },
  ]);
  expect(scriptVarFlags(vars, 'bit')).toEqual([{ name: 'B', flag: STAGE_BIT_FLAGS.first, reset: true }]);
});

test('conditions that name a flag pick from the matching kind', () => {
  expect(conditionFlagKind(3)).toBe('bit');
  expect(conditionFlagKind(4)).toBe('bit');
  expect([5, 6, 7, 0x30, 0x38].map(conditionFlagKind)).toEqual(['byte', 'byte', 'byte', 'byte', 'byte']);
  expect([1, 12, 14, 0x72].map(conditionFlagKind)).toEqual([undefined, undefined, undefined, undefined]);
});
