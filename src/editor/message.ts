// Editor of one message (GMSG text): shared by the map inspector and the message page.
import { MESSAGE_KINDS, textToUnits } from '../game/gmsg';
import type { Master } from '../game/master';
import { h } from './dom';

export const hexId = (id: number): string => `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;

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
    box.append(area, h('div', { class: 'msg-preview' }, texts.preview(id) ?? ''), h('div', { class: 'muted small' }, 'このファイルは作り直すと元と同じにならないため、書き換えられません。'));
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
  box.append(h('label', { class: 'field' }, h('span', {}, '種別 (先頭の 1 文字、表示されない)'), kindSel), area, err,
    h('div', { class: 'msg-preview' }, texts.preview(id) ?? ''));
  if (texts.isEdited(id)) box.append(h('button', { class: 'small', onclick: () => apply(() => texts.revert(id)) }, '元の文に戻す'));
  return box;
}

export const MESSAGE_HELP =
  '改行はそのまま書きます。{&XXXX} はほかのメッセージ (地名・人名など) の差し込み、{0100}〜{017F} はゲーム中に決まる名前などの差し込み、それ以外の {XXXX} は制御コード (ルビなど) です。下の灰色の欄は差し込みを展開した見え方です。記号の & は全角 ＆ で書いてください。';
