// Shop list: every shop (ShopItem / Shop) with what it sells, in the shop's order, at the item's current prices,
// with the description the shop shows and the clerk's messages. The item lists can be edited (add, remove, move).
import { clear, h } from '../editor/dom';
import { hexId, messagePreview } from '../editor/message';
import type { Game } from '../game/game';
import type { ItemBook } from '../game/items';
import { DESCRIPTION_VARIANT, shopLabel, type Shop, type ShopStock } from '../game/shops';
import { hex8, u32 } from '../util/bytes';

export const shopHref = (id: number): string => `#/shops/${id}`;

const VARIANT_LABEL: Record<number, string> = { 0: '片言 (Ď)', 1: '片言 (ď)', 2: '自然な口調' };

export class ShopPage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: 'アイテム名・店員の台詞で検索' });
  private readonly filter = h('select', {});
  private selected = -1;
  /** Shop shown in the detail (its scroll position is kept while it is edited). */
  private shown = -1;

  constructor(
    private readonly game: Game,
    private readonly shops: Shop[],
    private readonly items: ItemBook,
    /** Editable lists (null: ShopItem could not be read, the lists of `shops` are shown as they are). */
    private readonly stock: ShopStock | null,
    /** Called after an edit (to save it). */
    private readonly onEdit: () => void = () => {},
  ) {
    this.filter.append(h('option', { value: 'all' }, 'すべて'), h('option', { value: 'changed' }, '変更した'));
    this.search.addEventListener('input', () => this.renderList());
    this.filter.addEventListener('change', () => this.renderList());
    this.el.append(h('div', { class: 'book-side' }, h('div', { class: 'row' }, this.search, this.filter), this.list), this.detail);
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

  private itemsOf(s: Shop): number[] {
    return this.stock ? this.stock.items(s.id) : s.items;
  }

  private changed(s: Shop): boolean {
    return this.stock?.changedShop(s.id) ?? false;
  }

  /** First clerk message on one line (to tell the shops apart in the list). */
  private greeting(s: Shop): string {
    const id = s.messages.find((m) => m) ?? 0;
    return id ? this.game.master.texts.preview(id, true) ?? '' : '';
  }

  private matches(s: Shop): boolean {
    if (this.filter.value === 'changed' && !this.changed(s)) return false;
    const q = this.search.value.trim();
    if (!q) return true;
    if (shopLabel(s.id).includes(q) || this.greeting(s).includes(q)) return true;
    return this.itemsOf(s).some((id) => this.items.item(id)?.name.includes(q));
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.shops.filter((s) => this.matches(s));
    const body = h('tbody');
    for (const s of rows)
      body.append(h('tr', { class: s.id === this.selected ? 'active' : '', onclick: () => (location.hash = shopHref(s.id)) },
        h('td', { class: 'num muted' }, String(s.id)),
        h('td', {}, shopLabel(s.id), this.changed(s) ? h('span', { class: 'edited-mark', title: '変更した' }, ' ●') : '',
          h('div', { class: 'muted small' }, this.greeting(s))),
        h('td', { class: 'num' }, String(this.itemsOf(s).length))));
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.shops.length} 店`),
      h('table', { class: 'book-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, '店'), h('th', {}, '品数'))), body));
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private edit(s: Shop, items: number[]): void {
    this.stock!.set(s.id, items);
    this.items.setShops(this.stock!.lists);
    this.onEdit();
    this.renderList();
    this.renderDetail();
  }

  private renderDetail(): void {
    const scroll = this.shown === this.selected ? this.detail.scrollTop : 0;
    this.shown = this.selected;
    clear(this.detail);
    const s = this.shop(this.selected);
    if (!s) return;
    const list = this.itemsOf(s);
    const stock = this.stock;
    const original = stock?.originalItems(s.id) ?? list;
    const descOffset = DESCRIPTION_VARIANT[s.variant];
    const q = this.search.value.trim();
    const move = (i: number, d: number): void => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      this.edit(s, next);
    };
    const btn = (label: string, title: string, disabled: boolean, f: () => void): HTMLElement =>
      h('button', { class: 'small', title, disabled, onclick: f }, label);
    const table = h('table', { class: 'enc-table shop-items' },
      h('tr', {}, h('th', {}, '#'), h('th', {}, 'ID'), h('th', {}, '名前'), h('th', {}, '分類'), h('th', {}, '買値'), h('th', {}, '売値'), h('th', {}, '店での説明'), stock ? h('th', {}, '') : ''),
      ...list.map((id, i) => {
        const it = this.items.item(id);
        const desc = it?.descriptions.find((d) => d.offset === descOffset)?.text || it?.descriptions[0]?.text || '';
        return h('tr', { class: [q && it?.name.includes(q) ? 'hit' : '', original[i] !== id ? 'edited-row' : ''].filter(Boolean).join(' ') },
          h('td', { class: 'num muted' }, String(i + 1)),
          h('td', { class: 'num muted' }, String(id)),
          h('td', {}, it ? h('a', { href: `#/items/${id}` }, it.name) : h('span', { class: 'error' }, `#${id} (ないアイテム)`),
            it && this.items.changed(id) ? h('span', { class: 'edited-mark', title: 'アイテム図鑑で変更した' }, ' ●') : ''),
          h('td', { class: 'muted' }, it?.category ?? ''),
          h('td', { class: 'num' }, it ? String(it.price) : ''),
          h('td', { class: 'num' }, it ? String(it.sell) : ''),
          h('td', { class: 'book-desc small' }, desc),
          stock ? h('td', { class: 'shop-ops' },
            btn('↑', '上へ', i === 0, () => move(i, -1)),
            btn('↓', '下へ', i === list.length - 1, () => move(i, 1)),
            btn('×', 'この店から外す', false, () => this.edit(s, list.filter((_, j) => j !== i)))) : '');
      }));
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, shopLabel(s.id)),
        h('span', { class: 'muted' }, `${list.length} 品  商品の説明: ${s.variant < 0 ? '不明' : `${VARIANT_LABEL[s.variant] ?? `バリアント ${s.variant}`} (itemData +0x${(descOffset ?? 0).toString(16).toUpperCase()})`}`)),
      h('h3', {}, '品揃え'),
      table,
      stock ? this.editor(s, list, stock) : '',
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
    this.detail.scrollTop = scroll;
  }

  /** Adding an item, reverting the shop, and warnings about lists the game was not seen with. */
  private editor(s: Shop, list: number[], stock: ShopStock): HTMLElement {
    const pick = h('select', {});
    pick.append(h('option', { value: 0 }, '追加するアイテムを選ぶ…'));
    for (const it of this.items.items) if (!list.includes(it.id)) pick.append(h('option', { value: it.id }, `${it.id} ${it.name} (${it.category}${it.price ? `、${it.price} G` : ''})`));
    pick.addEventListener('change', () => {
      const id = Number(pick.value);
      if (id) this.edit(s, [...list, id]);
    });
    const warnings: string[] = [];
    if (!list.length) warnings.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
    if (list.length > stock.originalMax) warnings.push(`元のデータで一番多い店は ${stock.originalMax} 品です。それを超える数はゲームで確かめていません。`);
    if (list.some((id) => !this.items.item(id))) warnings.push('ないアイテムが入っています。');
    if (list.some((id) => this.items.item(id)?.price === 0)) warnings.push('買値 0 のアイテムがあります (タダで買えます)。');
    return h('div', {},
      h('div', { class: 'row' }, pick,
        stock.changedShop(s.id) ? h('button', { onclick: () => this.edit(s, stock.originalItems(s.id)) }, 'この店の変更を元に戻す') : ''),
      h('div', { class: 'muted small' }, `変更は ShopItem として ${stock.archiveNames().join(' と ')} に書き出されます。`),
      ...warnings.map((w) => h('div', { class: 'issue warn' }, `⚠ ${w}`)));
  }
}
