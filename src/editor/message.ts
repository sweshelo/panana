// Editor of one message (GMSG text): shared by the map inspector and the message page.
import { MESSAGE_KINDS, PLACEHOLDERS, placeholderLabel, textToUnits, tokenize, type MessageStore } from '../game/gmsg';
import type { Master } from '../game/master';
import { h } from './dom';

export const hexId = (id: number): string => `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The message as a reader sees it: ruby as <ruby>, "&" references as the referenced message (a link), placeholders
 * as what they are filled with, other control codes as small chips; the type code as a badge.
 */
export function messagePreview(texts: MessageStore, units: Uint16Array, depth = 0): HTMLElement {
  const box = h('span', { class: 'msg-render' });
  if (!depth && units.length) {
    const k = units[0]!;
    box.append(h('span', { class: 'msg-kind', title: `種別コード ${hexId(k)} (画面には出ない)` }, MESSAGE_KINDS[k] ?? `種別 ${hexId(k)}`));
  }
  for (const t of tokenize(units)) {
    if (t.t === 'text') box.append(t.s);
    else if (t.t === 'br') box.append(h('br'));
    else if (t.t === 'ruby') box.append(h('ruby', {}, t.base, h('rp', {}, '('), h('rt', {}, t.reading), h('rp', {}, ')')));
    else if (t.t === 'ph')
      box.append(h('span', { class: 'msg-ph', title: `差し込み ${hexId(t.code)}${PLACEHOLDERS[t.code] ? ' (使われ方からの推定)' : ' (意味は未解析)'}` }, placeholderLabel(t.code)));
    else if (t.t === 'ref') {
      const u = depth < 2 ? texts.units(t.id) : undefined;
      box.append(h('a', { class: 'msg-ref', href: `#/messages/${hexId(t.id)}`, title: `メッセージ ${hexId(t.id)} の差し込み` },
        u ? messagePreview(texts, u, depth + 1) : `メッセージ ${hexId(t.id)}`));
    } else box.append(h('span', { class: 'msg-ctl', title: '制御コード (意味は未解析)' }, hexId(t.code)));
  }
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
  '改行はそのまま書きます。{&XXXX} はほかのメッセージ (地名・人名など) の差し込み、{0100}〜{017F} はゲーム中に決まる名前などの差し込み、それ以外の {XXXX} は制御コード (ルビなど) です。下の欄はゲームでの見え方のプレビューです (ルビを振り、差し込みは中身か意味を表示)。記号の & は全角 ＆ で書いてください。';
