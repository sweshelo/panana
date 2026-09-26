// Shop list: every shop (ShopItem / Shop) with what it sells, in the shop's order, at the item's current prices,
// with the description the shop shows and the clerk's messages.
import { clear, h } from '../editor/dom';
import { hexId, messagePreview } from '../editor/message';
import type { Game } from '../game/game';
import type { ItemBook } from '../game/items';
import { DESCRIPTION_VARIANT, shopLabel, type Shop } from '../game/shops';
import { hex8, u32 } from '../util/bytes';

export const shopHref = (id: number): string => `#/shops/${id}`;

const VARIANT_LABEL: Record<number, string> = { 0: '片言 (Ď)', 1: '片言 (ď)', 2: '自然な口調' };

export class ShopPage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: 'アイテム名・店員の台詞で検索' });
  private selected = -1;

  constructor(
    private readonly game: Game,
    private readonly shops: Shop[],
    private readonly items: ItemBook,
  ) {
    this.search.addEventListener('input', () => this.renderList());
    this.el.append(h('div', { class: 'book-side' }, h('div', { class: 'row' }, this.search), this.list), this.detail);
  }

  show(id?: number): void {
    if (id !== undefined && this.shop(id)) this.selected = id;
    if (!this.shop(this.selected)) this.selected = this.shops[0]?.id ?? -1;
    this.renderList();
    this.renderDetail();
  }

  private shop(id: number): Shop | undefined {
    return this.shops.find((s) => s.id === id);
  }

  /** First clerk message on one line (to tell the shops apart in the list). */
  private greeting(s: Shop): string {
    const id = s.messages.find((m) => m) ?? 0;
    return id ? this.game.master.texts.preview(id, true) ?? '' : '';
  }

  private matches(s: Shop): boolean {
    const q = this.search.value.trim();
    if (!q) return true;
    if (shopLabel(s.id).includes(q) || this.greeting(s).includes(q)) return true;
    return s.items.some((id) => this.items.item(id)?.name.includes(q));
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.shops.filter((s) => this.matches(s));
    const body = h('tbody');
    for (const s of rows)
      body.append(h('tr', { class: s.id === this.selected ? 'active' : '', onclick: () => (location.hash = shopHref(s.id)) },
        h('td', { class: 'num muted' }, String(s.id)),
        h('td', {}, shopLabel(s.id), h('div', { class: 'muted small' }, this.greeting(s))),
        h('td', { class: 'num' }, String(s.items.length))));
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.shops.length} 店`),
      h('table', { class: 'book-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, '店'), h('th', {}, '品数'))), body));
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private renderDetail(): void {
    clear(this.detail);
    const s = this.shop(this.selected);
    if (!s) return;
    const descOffset = DESCRIPTION_VARIANT[s.variant];
    const q = this.search.value.trim();
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, shopLabel(s.id)),
        h('span', { class: 'muted' }, `${s.items.length} 品  商品の説明: ${s.variant < 0 ? '不明' : `${VARIANT_LABEL[s.variant] ?? `バリアント ${s.variant}`} (itemData +0x${(descOffset ?? 0).toString(16).toUpperCase()})`}`)),
      h('h3', {}, '品揃え'),
      h('table', { class: 'enc-table shop-items' },
        h('tr', {}, h('th', {}, '#'), h('th', {}, 'ID'), h('th', {}, '名前'), h('th', {}, '分類'), h('th', {}, '買値'), h('th', {}, '売値'), h('th', {}, '店での説明')),
        ...s.items.map((id, i) => {
          const it = this.items.item(id);
          const desc = it?.descriptions.find((d) => d.offset === descOffset)?.text || it?.descriptions[0]?.text || '';
          return h('tr', { class: q && it?.name.includes(q) ? 'hit' : '' },
            h('td', { class: 'num muted' }, String(i + 1)),
            h('td', { class: 'num muted' }, String(id)),
            h('td', {}, it ? h('a', { href: `#/items/${id}` }, it.name) : h('span', { class: 'muted' }, `#${id} (なし)`),
              it && this.items.changed(id) ? h('span', { class: 'edited-mark', title: 'アイテム図鑑で変更した' }, ' ●') : ''),
            h('td', { class: 'muted' }, it?.category ?? ''),
            h('td', { class: 'num' }, it ? String(it.price) : ''),
            h('td', { class: 'num' }, it ? String(it.sell) : ''),
            h('td', { class: 'book-desc small' }, desc));
        })),
      h('div', { class: 'muted small' }, '並びは店での表示順 (ShopItem)。値段はアイテムごと (アイテム図鑑で編集できます)。'),
      h('h3', {}, '店員のメッセージ'),
      s.messages.length
        ? h('table', { class: 'enc-table' },
            h('tr', {}, h('th', {}, '欄'), h('th', {}, 'ID'), h('th', {}, '本文')),
            ...s.messages.map((id, i) => {
              const units = id ? this.game.master.texts.units(id) : undefined;
              return h('tr', {},
                h('td', { class: 'mono muted' }, `+0x${(0x0c + i * 4).toString(16).toUpperCase()}`),
                h('td', { class: 'mono' }, id ? h('a', { href: `#/messages/${hexId(id)}` }, hexId(id)) : '0'),
                h('td', {}, units ? messagePreview(this.game.master.texts, units) : ''));
            }))
        : h('div', { class: 'muted' }, 'Shop の表 (0xD5CEF800) に行がありません'),
      s.raw.length ? h('div', { class: 'muted small mono' }, `+0x00〜+0x08 (未解析): ${[0, 4, 8].map((o) => hex8(u32(s.raw, o))).join(' ')}`) : '',
    );
  }
}
