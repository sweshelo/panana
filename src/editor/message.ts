// Message IDs, and the message editor for the map inspector (the editor itself is src/ui/message.tsx).
import { createElement } from 'react';
import type { Master } from '../game/master';
import { MessageEditor } from '../ui/message';
import { reactElement } from '../ui/mount';

export const hexId = (id: number): string => `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;

/** The message editor (src/ui/message.tsx) as an element, for the map inspector. */
export function messageEditor(master: Master, id: number, apply: (f: () => void) => void): HTMLElement {
  return reactElement(createElement(MessageEditor, { master, id, apply }));
}

export const MESSAGE_HELP =
  '改行はそのまま書きます。{ruby:親字|よみ} でルビ、{page} でページ送り (直後の改行は一緒に消えます)、{msg:XXXX} でほかのメッセージの差し込みです。{tag:XXXX} は名前・数値の差し込みや声・感情・文字色のタグ、{XXXX} はそれ以外の制御コードです (16 進)。下の欄はゲームでの見え方のプレビューです。';
