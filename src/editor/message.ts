// Editor of one message (GMSG text): shared by the map inspector and the message page.
import { textToUnits } from '../game/gmsg';
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
  const kind = t.kind >= 0x20 ? String.fromCharCode(t.kind) : '';
  box.append(h('div', { class: 'muted small' },
    `${hexId(id)} (${id}) · ${file.name} · 種別 ${hexId(t.kind)}${kind ? ` 「${kind}」` : ''}`,
    texts.isEdited(id) ? h('b', { class: 'edited' }, ' · 変更あり') : ''));
  const area = h('textarea', { class: 'msg-text', rows: Math.min(8, t.text.split('\n').length + 1), value: t.text });
  const err = h('div', { class: 'error small', hidden: true });
  if (!file.editable) {
    area.readOnly = true;
    box.append(area, h('div', { class: 'muted small' }, 'このファイルは作り直すと元と同じにならないため、書き換えられません。'));
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
  box.append(area, err);
  if (texts.isEdited(id)) box.append(h('button', { class: 'small', onclick: () => apply(() => texts.revert(id)) }, '元の文に戻す'));
  return box;
}

export const MESSAGE_HELP = '改行はそのまま、制御コード (色・名前の差し込み・ルビなど) は {XXXX} (16 進) で書きます。{XXXX} を消すと表示が崩れることがあります。';
