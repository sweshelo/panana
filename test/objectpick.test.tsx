// The picker of things placed on a map (editor/objectpick.tsx), rendered to a string.
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PlacedPickButton, type PlacedChoice } from '../src/editor/objectpick';

const choices: PlacedChoice[] = [
  { value: 0x1234, name: '階段 (下り)', sub: 'セル (3.5, 4.5)', model: null, badge: '⇲' },
  { value: 7, name: 'イベント #7 扉', model: null },
];

describe('PlacedPickButton', () => {
  test('shows the chosen thing by name, not by number', () => {
    const html = renderToString(<PlacedPickButton title="t" value={0x1234} choices={choices} onChange={() => {}} />);
    expect(html).toContain('階段 (下り)');
    expect(html).toContain('セル (3.5, 4.5)');
  });
  test('shows extra choices and unknown values', () => {
    expect(renderToString(<PlacedPickButton title="t" value={0} choices={choices} extra={[{ value: 0, label: '(なし)' }]} onChange={() => {}} />)).toContain('(なし)');
    expect(renderToString(<PlacedPickButton title="t" value={99} choices={choices} missing={(v) => `${v} (行き先にない)`} onChange={() => {}} />)).toContain('99 (行き先にない)');
  });
});
