// Editor of one message (GMSG text): shared by the map inspector and the message page.
import type { MessageStore } from '../game/gmsg';
import { FIXED_NAMES, MESSAGE_KINDS, parseBody, tagKind, tagLabel, textToUnits } from '../game/msgtext';
import type { Master } from '../game/master';
import { h } from './dom';

export const hexId = (id: number): string => `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The message as a reader sees it: ruby as <ruby>, page breaks as ▼ and a rule, references and fixed names expanded
 * (links to the message), run-time names and numbers as 〈placeholders〉, voice / emotion as small badges, colours
 * dropped.
 */
export function messagePreview(texts: MessageStore, units: Uint16Array, depth = 0): HTMLElement {
  const box = h('span', { class: 'msg-render' });
  const tokens = parseBody(units).tokens;
  const nested = (id: number, title: string): HTMLElement => {
    const u = depth < 2 ? texts.units(id) : undefined;
    return h('a', { class: 'msg-ref', href: `#/messages/${hexId(id)}`, title }, u ? messagePreview(texts, u, depth + 1) : `メッセージ ${hexId(id)}`);
  };
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (t.t === 'text') box.append(t.s);
    else if (t.t === 'br') {
      if (!(prev?.t === 'tag' && prev.x === 0x10)) box.append(h('br')); // the page break eats it
    } else if (t.t === 'ruby') box.append(h('ruby', {}, t.base, h('rp', {}, '('), h('rt', {}, t.reading), h('rp', {}, ')')));
    else if (t.t === 'ref') box.append(nested(t.id, `メッセージ ${hexId(t.id)} の差し込み`));
    else if (t.t === 'raw') box.append(h('span', { class: 'msg-ctl', title: '制御コード (意味は未解析)' }, hexId(t.c)));
    else {
      const k = tagKind(t.x);
      const title = `タグ ${hexId(t.x)}: ${tagLabel(t.x)}`;
      if (k === 'page') box.append(h('span', { class: 'msg-page', title }, '▼'), h('hr', { class: 'msg-page-rule' }));
      else if (k === 'fixed') box.append(nested(FIXED_NAMES[t.x]!, `${title} (メッセージ ${hexId(FIXED_NAMES[t.x]!)})`));
      else if (k === 'name' || k === 'number') box.append(h('span', { class: 'msg-ph', title }, tagLabel(t.x)));
      else if (k === 'voice' || k === 'emotion') { if (!depth) box.append(h('span', { class: 'msg-kind', title: `${title} (画面には出ない)` }, tagLabel(t.x))); }
      else if (k === 'other') box.append(h('span', { class: 'msg-ctl', title }, hexId(t.x)));
      // colour / decoration: not drawn
    }
  });
  return box;
}

/**
 * Text box for a message. Edits are applied when the box loses focus, through `apply` (so the caller can
 * record an undo point and save); a bad {XXXX} code is reported and not applied.
 */
export function messageEditor(master: Master, id: number, apply: (f: () => void) => void): HTMLElement {
  const texts = master.texts;
  const file = texts.file(id);
  const t = texts.text(id);
  const box = h('div', { class: 'msg-edit' });
  if (!file || !t) {
    box.append(h('div', { class: 'muted' }, id ? `${hexId(id)}: 見つからない ID` : '(なし)'));
    return box;
  }
  box.append(h('div', { class: 'muted small' },
    `${hexId(id)} (${id}) · ${file.name}`,
    texts.isEdited(id) ? h('b', { class: 'edited' }, ' · 変更あり') : ''));
  const area = h('textarea', { class: 'msg-text', rows: Math.min(8, t.text.split('\n').length + 1), value: t.text });
  const err = h('div', { class: 'error small', hidden: true });
  if (!file.editable) {
    area.readOnly = true;
    box.append(area, h('div', { class: 'msg-preview' }, messagePreview(texts, texts.units(id)!)), h('div', { class: 'muted small' }, 'このファイルは作り直すと元と同じにならないため、書き換えられません。'));
    return box;
  }
  area.addEventListener('change', () => {
    try {
      const cur = texts.text(id)!;
      if (area.value === cur.text) return;
      textToUnits({ ...cur, text: area.value }); // throws on a bad {XXXX}
      err.hidden = true;
      apply(() => texts.setText(id, area.value));
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  });
  const kindSel = h('select', { title: '先頭の種別コード。ゲームは表示するときにこの 1 文字を読み飛ばします' });
  for (const k of [...new Set([...Object.keys(MESSAGE_KINDS).map(Number), t.kind])].sort((a, b) => a - b))
    kindSel.append(h('option', { value: k, selected: k === t.kind }, `${hexId(k)} ${MESSAGE_KINDS[k] ?? ''}`));
  kindSel.addEventListener('change', () => apply(() => texts.setKind(id, Number(kindSel.value))));
  const preview = h('div', { class: 'msg-preview' }, messagePreview(texts, texts.units(id)!));
  area.addEventListener('input', () => {
    try {
      const u = textToUnits({ ...texts.text(id)!, text: area.value });
      preview.replaceChildren(messagePreview(texts, u));
      err.hidden = true;
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
    }
  });
  box.append(h('label', { class: 'field' }, h('span', {}, '種別 (先頭の 1 文字、表示されない)'), kindSel), area, err, preview);
  if (texts.isEdited(id)) box.append(h('button', { class: 'small', onclick: () => apply(() => texts.revert(id)) }, '元の文に戻す'));
  return box;
}

export const MESSAGE_HELP =
  '改行はそのまま書きます。{ruby:親字|よみ} でルビ、{page} でページ送り (直後の改行は一緒に消えます)、{msg:XXXX} でほかのメッセージの差し込みです。{tag:XXXX} は名前・数値の差し込みや声・感情・文字色のタグ、{XXXX} はそれ以外の制御コードです (16 進)。下の欄はゲームでの見え方のプレビューです。';
