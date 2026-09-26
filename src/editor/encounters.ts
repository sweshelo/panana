// Inspector block of a map: BGM (mapData of the dungeon) and the enemies (section 6 monster groups).
import { createElement } from 'react';
import { mapEncounters, type MonsterBook, type MonsterGroup } from '../game/monsters';
import type { SoundNames } from '../game/sound';
import { hex8, w32 } from '../util/bytes';
import { h } from './dom';
import type { EditorState } from './state';
import { GroupDetail } from '../ui/GroupDetail';
import { reactElement } from '../ui/mount';

function groupSummary(book: MonsterBook, g: MonsterGroup): string {
  const names = book.groupMonsters(g).map((r) => book.monster(r)?.name ?? `#${r}`);
  return `群れ #${g.row}${names.length ? `: ${names.join('・')}` : ' (敵なし)'}`;
}

/** The group's candidates (src/ui/GroupDetail.tsx) as an element. */
export function groupDetail(book: MonsterBook, g: MonsterGroup): HTMLElement {
  return reactElement(createElement(GroupDetail, { book, group: g }));
}

export function encounterPanel(st: EditorState, book: MonsterBook | null, sounds: SoundNames | null): HTMLElement {
  const doc = st.current!;
  const master = st.game.master;
  const s = master.sounds(st.ref!);
  const label = (row: number): string => sounds?.label(row) ?? `サウンド ${row}`;
  const box = h('div', { class: 'enc-box' },
    h('h3', {}, 'BGM・効果音'),
    h('table', { class: 'enc-table' },
      h('tr', {}, h('td', {}, 'フィールド'), h('td', {}, label(s.bgm))),
      h('tr', {}, h('td', {}, '戦闘'), h('td', {}, label(s.battle))),
      h('tr', {}, h('td', {}, '足音'), h('td', {}, label(s.steps)))),
    h('div', { class: 'muted small' }, `マップごと (mapData 行 ${master.mapDataRow(st.ref!)} の [4] / [5] / [6])`),
    h('h3', {}, '出現する敵'));
  if (!book) {
    box.append(h('div', { class: 'muted' }, 'モンスターのデータを読めませんでした'));
    return box;
  }
  const enc = mapEncounters(doc);
  const cur = book.group(enc.group);
  const sel = h('select', {
    onchange: (e: Event) => {
      const hash = Number((e.target as HTMLSelectElement).value);
      st.edit((d) => {
        if (d.sec6Header.length < 8) {
          d.sec6Header = new Uint8Array(8);
          w32(d.sec6Header, 4, 0xffffffff);
        }
        w32(d.sec6Header, 0, hash);
      });
    },
  }, h('option', { value: 0, selected: !enc.group }, '(なし: 敵が出ない)'));
  for (const g of book.groups) if (g.hash) sel.append(h('option', { value: g.hash, selected: g.hash === enc.group }, groupSummary(book, g)));
  if (enc.group && !cur) sel.append(h('option', { value: enc.group, selected: true }, `不明な群れ ${hex8(enc.group)}`));
  box.append(h('label', { class: 'field' }, h('span', {}, 'マップの群れ (区画 6 のヘッダー)'), sel));
  if (cur) box.append(groupDetail(book, cur));
  const own = [...enc.cells].filter(([hash]) => hash);
  const plain = enc.cells.get(0)?.length ?? 0;
  box.append(h('div', { class: 'muted small' },
    `敵の出現セル (区画 6): ${doc.cells6.length} 個${plain ? ` (うちマップの群れ ${plain} 個)` : ''}。左の「敵の出現セル」ツールで付け外しできます。`));
  for (const [hash, cells] of own) {
    const g = book.group(hash);
    box.append(h('details', { class: 'enc-cells' },
      h('summary', {}, `セル ${cells.length} 個: ${g ? groupSummary(book, g) : `不明な群れ ${hex8(hash)}`}`),
      h('div', { class: 'muted small' }, cells.map(([x, y]) => `(${x}, ${y})`).join(' ')),
      g ? groupDetail(book, g) : ''));
  }
  return box;
}
