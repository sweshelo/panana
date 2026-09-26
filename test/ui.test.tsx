// React pages, rendered to a string (no DOM needed).
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { decodeAction, type Action, type ActionRefs } from '../src/game/actions';
import { EditorState } from '../src/editor/state';
import type { Game } from '../src/game/game';
import { ActionView } from '../src/pages/actions';
import { Radar } from '../src/ui/Radar';
import { MessagePreview } from '../src/ui/message';
import type { MessageStore } from '../src/game/gmsg';
import { textToUnits } from '../src/game/msgtext';
import { w32 } from '../src/util/bytes';

function action(row: number, w0: number, name: string): Action {
  const raw = new Uint8Array(0x22);
  w32(raw, 0, w0);
  raw.set([40, 0, 30, 0], 0x18);
  return { ...decodeAction(raw), row, name, raw };
}

describe('action page', () => {
  const actions = [action(0, 1 << 1, 'たいあたり'), action(1, ((2 << 1) | (1 << 29)) >>> 0, 'やくそう')];
  const refs: Record<number, ActionRefs> = { 1: { items: [{ id: 7, name: 'やくそう' }], monsters: [] } };
  const book = { actions, action: (r: number) => actions[r], refsOf: (r: number) => refs[r] ?? { items: [], monsters: [] } };

  test('list shows item actions by default, detail shows fields, refs and raw words', () => {
    const html = renderToString(<ActionView book={book} selected={1} />);
    expect(html).toContain('1 / 2 件');
    expect(html).toContain('<tr class="active">');
    expect(html).toContain('効果: HP 回復 30〜40 (戦闘)');
    expect(html).toContain('href="#/items/7"');
    expect(html).toContain('+0x18');
    expect(html).toContain('残り 2 バイト: 0 0');
    expect(html).not.toContain('たいあたり');
  });
});

describe('editor state', () => {
  test('on() returns an unsubscribe, emit() bumps the revision', () => {
    const st = new EditorState({} as Game);
    const seen: string[] = [];
    const off = st.on((w) => seen.push(w));
    st.emit('doc');
    off();
    st.emit('tool');
    expect(seen).toEqual(['doc']);
    expect(st.revision).toBe(2);
  });
});

describe('shared pieces', () => {
  test('message preview: ruby, page break (eats its line break), referenced message', () => {
    const texts = { units: (id: number) => (id === 0x66 ? textToUnits({ kind: 1, text: 'デンパタウン', tail: new Uint16Array([0]) }) : undefined) } as unknown as MessageStore;
    const units = textToUnits({ kind: 1, text: 'ここ、{msg:0066}。{page}\n{ruby:祠|ほこら}', tail: new Uint16Array([0]) });
    const html = renderToString(<MessagePreview texts={texts} units={units} />);
    expect(html).toContain('<ruby>祠<rp>(</rp><rt>ほこら</rt><rp>)</rp></ruby>');
    expect(html).toContain('href="#/messages/0x0066"');
    expect(html).toContain('デンパタウン');
    expect(html).toContain('▼');
    expect(html).not.toContain('<br/>');
  });

  test('radar: one handle per axis, edited ones marked, original outline only when changed', () => {
    const props = { min: -9, max: 10, rings: [-9, 0, 10], format: String, onChange: () => {} };
    const same = renderToString(<Radar {...props} axes={[{ label: 'A', value: 0, original: 0 }, { label: 'B', value: 1, original: 1 }, { label: 'C', value: 2, original: 2 }]} />);
    expect(same.match(/class="handle"/g)?.length).toBe(3);
    expect(same).not.toContain('shape original');
    const edited = renderToString(<Radar {...props} axes={[{ label: 'A', value: 5, original: 0 }, { label: 'B', value: 1, original: 1 }, { label: 'C', value: 2, original: 2 }]} />);
    expect(edited).toContain('handle edited');
    expect(edited).toContain('shape original');
  });
});
