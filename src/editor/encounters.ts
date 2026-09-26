// Inspector block of a map: BGM (mapData of the dungeon) and the enemies (section 6 monster groups).
import { countLabel, mapEncounters, type GroupSlot, type MonsterBook, type MonsterGroup } from '../game/monsters';
import type { SoundNames } from '../game/sound';
import { hex8, w32 } from '../util/bytes';
import { h } from './dom';
import type { EditorState } from './state';

export const monsterHref = (row: number): string => `#/monsters/${row}`;

function groupSummary(book: MonsterBook, g: MonsterGroup): string {
  const names = book.groupMonsters(g).map((r) => book.monster(r)?.name ?? `#${r}`);
  return `群れ #${g.row}${names.length ? `: ${names.join('・')}` : ' (敵なし)'}`;
}

function slotTable(book: MonsterBook, title: string, slots: GroupSlot[]): HTMLElement {
  const total = slots.reduce((a, s) => a + s.weight, 0);
  return h('table', { class: 'enc-table' },
    h('tr', {}, h('th', { colspan: 3 }, title)),
    ...slots.map((s) => {
      const m = book.monster(s.monster);
      return h('tr', {},
        h('td', {}, h('a', { href: monsterHref(s.monster) }, m ? `${m.name} Lv${m.level}` : `#${s.monster}`)),
        h('td', { class: 'num' }, `${Math.round((s.weight / total) * 100)}%`),
        h('td', { class: 'num muted' }, `×${countLabel(s.count)}`));
    }),
    slots.length ? '' : h('tr', {}, h('td', { class: 'muted', colspan: 3 }, 'なし')));
}

export function groupDetail(book: MonsterBook, g: MonsterGroup): HTMLElement {
  return h('div', { class: 'enc-group' },
    h('div', { class: 'small' }, h('a', { href: `#/groups/${g.row}` }, `群れ #${g.row} を開く (編集)`)),
    slotTable(book, '先頭 (マップで見える敵)・3 体目', g.leads),
    slotTable(book, '2・4 体目', g.mates),
    h('div', { class: 'muted small' }, `+0x28〜: ${g.extra.join(' ')} (未解析)`));
}

export function encounterPanel(st: EditorState, book: MonsterBook | null, sounds: SoundNames | null): HTMLElement {
  const doc = st.current!;
  const master = st.game.master;
  const s = master.sounds(doc.dungeon);
  const label = (row: number): string => sounds?.label(row) ?? `サウンド ${row}`;
  const box = h('div', { class: 'enc-box' },
    h('h3', {}, 'BGM・効果音'),
    h('table', { class: 'enc-table' },
      h('tr', {}, h('td', {}, 'フィールド'), h('td', {}, label(s.bgm))),
      h('tr', {}, h('td', {}, '戦闘'), h('td', {}, label(s.battle))),
      h('tr', {}, h('td', {}, '足音'), h('td', {}, label(s.steps)))),
    h('div', { class: 'muted small' }, `ダンジョン共通 (mapData 行 ${master.mapDataRow(doc.dungeon)} の [4] / [5] / [6])`),
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
