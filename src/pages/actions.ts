// Action list: every actionData row with the fields known so far, its raw words, and what refers to it
// (items' use effect, monsters' skills).
import { clear, h } from '../editor/dom';
import { ACTION_KIND, itemEffect, type Action, type ActionBook } from '../game/actions';
import { hex8, s16, u32 } from '../util/bytes';

export const actionHref = (row: number): string => `#/actions/${row}`;

/** Offsets of the fields that are decoded (the raw table marks them). */
const KNOWN: Record<number, string> = { 0x00: 'w0 (種類・効果・付与・使える場面)', 0x04: '名前 (メッセージ)', 0x18: '量 (s16 最小 / 最大)' };

export class ActionPage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: '名前・効果・アイテム・モンスターで検索' });
  private readonly filter = h('select', {});
  private selected = -1;

  constructor(private readonly book: ActionBook) {
    this.filter.append(
      h('option', { value: 'item' }, 'アイテムの効果 (種類 2)'),
      h('option', { value: 'used-item' }, 'アイテムが使う'),
      h('option', { value: 'skill' }, 'モンスターのワザ'),
      h('option', { value: 'all' }, 'すべて'),
    );
    this.search.addEventListener('input', () => this.renderList());
    this.filter.addEventListener('change', () => this.renderList());
    this.el.append(h('div', { class: 'book-side' }, h('div', { class: 'row' }, this.search, this.filter), this.list), this.detail);
  }

  show(row?: number): void {
    if (row !== undefined && this.book.action(row)) this.selected = row;
    if (this.selected < 0) this.selected = this.book.actions.find((a) => a.kind === 2)?.row ?? 0;
    this.renderList();
    this.renderDetail();
  }

  private matches(a: Action): boolean {
    const refs = this.book.refsOf(a.row);
    const q = this.search.value.trim();
    if (q && ![a.name, itemEffect(a), ...refs.items.map((i) => i.name), ...refs.monsters.map((m) => m.name)].some((t) => t.includes(q))) return false;
    const f = this.filter.value;
    if (f === 'item') return a.kind === 2;
    if (f === 'used-item') return refs.items.length > 0;
    if (f === 'skill') return refs.monsters.length > 0;
    return true;
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.book.actions.filter((a) => this.matches(a));
    const body = h('tbody');
    for (const a of rows) {
      const refs = this.book.refsOf(a.row);
      body.append(h('tr', { class: a.row === this.selected ? 'active' : '', onclick: () => (location.hash = actionHref(a.row)) },
        h('td', { class: 'num muted' }, String(a.row)),
        h('td', {}, a.name || h('span', { class: 'muted' }, '(名前なし)')),
        h('td', { class: 'muted' }, itemEffect(a) || kindLabel(a.kind)),
        h('td', { class: 'num muted' }, refs.items.length + refs.monsters.length ? String(refs.items.length + refs.monsters.length) : '')));
    }
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.book.actions.length} 件`),
      h('table', { class: 'book-table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, '名前'), h('th', {}, '内容'), h('th', { title: '使うアイテムとモンスターの数' }, '参照'))), body));
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private renderDetail(): void {
    clear(this.detail);
    const a = this.book.action(this.selected);
    if (!a) return;
    const refs = this.book.refsOf(a.row);
    const field = (label: string, v: string | HTMLElement, note = ''): HTMLElement =>
      h('tr', {}, h('td', {}, label), h('td', {}, v), h('td', { class: 'muted' }, note));
    const [lo, hi] = a.amount;
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, a.name || `アクション #${a.row}`),
        h('span', { class: 'muted' }, `#${a.row}  ${kindLabel(a.kind)}  (actionData.bin、${a.raw.length} バイト)`)),
      itemEffect(a) ? h('div', { class: 'model-line' }, `効果: ${itemEffect(a)}`) : '',
      h('h3', {}, '内容'),
      h('table', { class: 'enc-table action-fields' },
        h('tr', {}, h('th', {}, '欄'), h('th', {}, '値'), h('th', {}, '')),
        field('+0x00 w0', `0x${hex8(a.w0)}`),
        field('  bit1-2 種類', String(a.kind), kindLabel(a.kind)),
        field('  bit3-6 効果の種別', String(a.type), a.kind === 2 ? '' : 'アイテム以外での意味は未解析'),
        field('  bit13-15 付与の段階', String(a.level), 'ワザの状態異常の基本の率 (BattleParameter [0x60 + 段階])'),
        field('  bit29-31 使える場面', a.scenes.join('・') || 'なし', 'アイテム'),
        field('+0x04 名前', a.nameId ? `${a.nameId} (0x${a.nameId.toString(16).toUpperCase()})` : '0', a.name),
        field('+0x18 / +0x1A 量', `${lo} / ${hi}`, a.kind === 2 && a.type <= 1 ? '回復量 (最小〜最大)' : '')),
      h('div', { class: 'book-cols' },
        h('section', {}, h('h3', {}, `使うアイテム (${refs.items.length})`),
          refs.items.length
            ? h('ul', {}, ...refs.items.map((i) => h('li', {}, h('a', { href: `#/items/${i.id}` }, i.name), ' ', h('span', { class: 'muted' }, `#${i.id}`))))
            : h('div', { class: 'muted' }, 'なし (itemData +0x24、道具のみ)')),
        h('section', {}, h('h3', {}, `ワザとして持つモンスター (${refs.monsters.length})`),
          refs.monsters.length
            ? h('ul', {}, ...refs.monsters.map((m) => h('li', {}, h('a', { href: `#/monsters/${m.row}` }, m.name), ' ', h('span', { class: 'muted' }, `#${m.row}`))))
            : h('div', { class: 'muted' }, 'なし (MonsterParameter +0x3C)'))),
      h('h3', {}, '生データ'),
      rawTable(a.raw),
    );
  }
}

function kindLabel(kind: number): string {
  return ACTION_KIND[kind] ?? `種類 ${kind}`;
}

/** The row as u32 words (hex, decimal, two s16), with the decoded offsets marked. */
function rawTable(raw: Uint8Array): HTMLElement {
  const tbl = h('table', { class: 'enc-table action-raw' },
    h('tr', {}, h('th', {}, 'オフセット'), h('th', {}, 'u32 (16 進)'), h('th', {}, 'u32'), h('th', {}, 's16 × 2'), h('th', {}, '')));
  for (let o = 0; o + 4 <= raw.length; o += 4) {
    const v = u32(raw, o);
    tbl.append(h('tr', { class: KNOWN[o] ? 'known' : v ? '' : 'muted' },
      h('td', { class: 'mono' }, `+0x${o.toString(16).toUpperCase().padStart(2, '0')}`),
      h('td', { class: 'mono' }, hex8(v)),
      h('td', { class: 'num' }, String(v)),
      h('td', { class: 'num' }, `${s16(raw, o)} / ${s16(raw, o + 2)}`),
      h('td', { class: 'muted' }, KNOWN[o] ?? '')));
  }
  if (raw.length % 4) tbl.append(h('tr', {}, h('td', { class: 'muted', colspan: 5 }, `残り ${raw.length % 4} バイト: ${[...raw.subarray(raw.length - (raw.length % 4))].join(' ')}`)));
  return tbl;
}
