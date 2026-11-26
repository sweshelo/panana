// Ported from lanai-custom-stages web/stage-events.test.ts (99304a5); the uwapo there is kept in parallel.
import { expect, test } from 'bun:test';
import { appendLcse, checkStageEvents, lcseBinary, stageEventsFor } from './stage-events';

const key = '6f1c2a40-9b7e-4c55-8d1a-0123456789ab';

test('LCSE header carries version, key and owned ranges', () => {
  const b = lcseBinary({
    stageKey: key,
    owned: [
      { field: 'bit', first: 100, count: 10 },
      { field: 'state', first: 50, count: 4 },
    ],
  });
  const v = new DataView(b.buffer);
  expect([b.length, new TextDecoder().decode(b.subarray(0, 4)), v.getUint16(4, true), v.getUint16(6, true)]).toEqual([
    0x38,
    'LCSE',
    1,
    0,
  ]);
  expect(Buffer.from(b.subarray(8, 24)).toString('hex')).toBe(key.replaceAll('-', ''));
  expect([0x18, 0x1a, 0x1c, 0x1e, 0x20, 0x22, 0x24].map((o) => v.getUint16(o, true))).toEqual([
    0x51, 10, 100, 0, 0x103, 4, 50,
  ]);
});

test('appendLcse adds the footer the 3DS looks for', () => {
  const out = appendLcse(new Uint8Array(12), new Uint8Array(0x38));
  const v = new DataView(out.buffer);
  expect([out.length, v.getUint32(out.length - 8, true), v.getUint32(out.length - 4, true)]).toEqual([
    12 + 0x38 + 8,
    0x4553434c,
    0x38,
  ]);
  expect(() => appendLcse(new Uint8Array(10), new Uint8Array(0x38))).toThrow();
});

test('specs are validated before publishing', () => {
  for (const bad of [
    { stageKey: 'not-a-uuid' },
    { stageKey: '00000000-0000-0000-0000-000000000000' },
    { stageKey: key, owned: [{ field: 'bit' as const, first: 24999, count: 2 }] },
    { stageKey: key, owned: [{ field: 'byte' as const, first: 0, count: 0 }] },
    { stageKey: key, owned: Array.from({ length: 5 }, () => ({ field: 'clear' as const, first: 0, count: 1 })) },
  ])
    expect(() => checkStageEvents(bad)).toThrow();
  expect(stageEventsFor({ format: 1, stages: { '127': { stageKey: key } } }, 127)?.stageKey).toBe(key);
  expect(stageEventsFor({ format: 1, stages: {} }, 127)).toBeNull();
  expect(() => stageEventsFor({ format: 2, stages: {} }, 127)).toThrow();
});
