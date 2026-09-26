// Shop list: every shop (ShopItem / Shop) with what it sells, in the shop's order, at the item's current prices,
// with the description the shop shows and the clerk's messages. The item lists can be edited by drag and drop
// (rows move, items are dragged in from a palette, rows dragged onto the palette are removed).
import { clear, h } from '../editor/dom';
import { hexId, messagePreview } from '../editor/message';
import type { Game } from '../game/game';
import { ITEM_CATEGORY, type ItemBook } from '../game/items';
import { DESCRIPTION_VARIANT, dropInto, shopLabel, type Shop, type ShopDrag, type ShopStock } from '../game/shops';
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
  private drag: ShopDrag | null = null;
  /** The item palette's search and category (kept across renders). */
  private readonly paletteSearch = h('input', { type: 'search', placeholder: '追加するアイテムを検索' });
  private readonly paletteCategory = h('select', {});

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
    this.paletteCategory.append(h('option', { value: '' }, 'すべての分類'), ...Object.entries(ITEM_CATEGORY).map(([k, v]) => h('option', { value: k }, v)));
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
    const table = h('table', { class: `enc-table shop-items${stock ? ' editable' : ''}` },
      h('tr', {}, stock ? h('th', {}, '') : '', h('th', {}, '#'), h('th', {}, '名前'), h('th', {}, '分類'), h('th', {}, '買値'), stock ? h('th', {}, '') : ''),
      ...list.map((id, i) => {
        const it = this.items.item(id);
        const tr = h('tr', { class: [q && it?.name.includes(q) ? 'hit' : '', original[i] !== id ? 'edited-row' : ''].filter(Boolean).join(' ') },
          stock ? h('td', { class: 'drag-handle', title: 'ドラッグで並べ替え (品物の一覧へ落とすと外す)' }, '⠿') : '',
          h('td', { class: 'num muted' }, String(i + 1)),
          h('td', {}, it ? h('a', { href: `#/items/${id}`, draggable: false }, it.name) : h('span', { class: 'error' }, `#${id} (ないアイテム)`),
            it && this.items.changed(id) ? h('span', { class: 'edited-mark', title: 'アイテム図鑑で変更した' }, ' ●') : ''),
          h('td', { class: 'muted' }, it?.category ?? ''),
          h('td', { class: 'num' }, it ? String(it.price) : ''),
          stock ? h('td', { class: 'shop-ops' },
            h('button', { class: 'small', title: 'この店から外す', onclick: () => this.edit(s, list.filter((_, j) => j !== i)) }, '×')) : '');
        if (stock) {
          tr.draggable = true;
          tr.addEventListener('dragstart', (e) => this.startDrag(e, { kind: 'row', index: i }, tr));
          tr.addEventListener('dragend', () => this.endDrag());
        }
        return tr;
      }));
    if (stock) this.dropTarget(table, s, list);
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, shopLabel(s.id)),
        h('span', { class: 'muted' }, `${list.length} 品  商品の説明: ${s.variant < 0 ? '不明' : `${VARIANT_LABEL[s.variant] ?? `バリアント ${s.variant}`} (itemData +0x${(descOffset ?? 0).toString(16).toUpperCase()})`}`)),
      h('h3', {}, '品揃え'),
      stock ? h('div', { class: 'shop-edit' }, h('div', {}, table, this.editor(s, list, stock)), this.palette(s, list)) : table,
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

  // ------------------------------------------------------------ drag and drop

  private startDrag(e: DragEvent, drag: ShopDrag, el: HTMLElement): void {
    this.drag = drag;
    e.dataTransfer?.setData('text/plain', drag.kind === 'row' ? `row ${drag.index}` : `item ${drag.id}`); // Firefox needs data
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('dragging'));
  }

  private endDrag(): void {
    this.drag = null;
    this.el.querySelectorAll('.dragging, .drop-before, .drop-after, .drop-remove').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-remove'));
  }

  /** Drops on the list: before or after the row under the pointer (below the last row: at the end). */
  private dropTarget(table: HTMLTableElement, s: Shop, list: number[]): void {
    const rows = (): HTMLTableRowElement[] => [...table.querySelectorAll<HTMLTableRowElement>('tr')].slice(1);
    const gap = (e: DragEvent): number => {
      const rs = rows();
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i]!.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) return i;
      }
      return rs.length;
    };
    const mark = (at: number): void => {
      const rs = rows();
      rs.forEach((r, i) => {
        r.classList.toggle('drop-before', i === at);
        r.classList.toggle('drop-after', at === rs.length && i === rs.length - 1);
      });
    };
    const zone = table.parentElement ?? table;
    zone.addEventListener('dragover', (e) => {
      if (!this.drag) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      mark(gap(e));
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget as Node)) mark(-1);
    });
    zone.addEventListener('drop', (e) => {
      const drag = this.drag;
      if (!drag) return;
      e.preventDefault();
      const at = gap(e);
      this.endDrag();
      const next = dropInto(list, drag, at);
      if (next.some((id, i) => id !== list[i]) || next.length !== list.length) this.edit(s, next);
    });
  }

  /** Items to add: search, category, and a list to drag from; rows of the shop dropped here are removed. */
  private palette(s: Shop, list: number[]): HTMLElement {
    const box = h('div', { class: 'shop-palette' });
    const body = h('div', { class: 'shop-palette-list' });
    const render = (): void => {
      clear(body);
      const q = this.paletteSearch.value.trim();
      const cat = this.paletteCategory.value;
      const shown = this.items.items.filter((it) => (!q || it.name.includes(q) || String(it.id) === q) && (!cat || (it.categoryByte & 0xf) === Number(cat)));
      for (const it of shown.slice(0, 300)) {
        const sold = list.includes(it.id);
        const row = h('div', { class: `shop-palette-item${sold ? ' sold' : ''}`, title: sold ? 'この店で売っています (ドラッグで位置を変えられます)' : 'ドラッグで追加 (ダブルクリックで末尾に追加)' },
          h('span', { class: 'num muted' }, String(it.id)), ' ', it.name, ' ',
          h('span', { class: 'muted small' }, `${it.category}${it.price ? `・${it.price} G` : ''}`));
        row.draggable = true;
        row.addEventListener('dragstart', (e) => this.startDrag(e, { kind: 'item', id: it.id }, row));
        row.addEventListener('dragend', () => this.endDrag());
        row.addEventListener('dblclick', () => { if (!sold) this.edit(s, [...list, it.id]); });
        body.append(row);
      }
      if (shown.length > 300) body.append(h('div', { class: 'muted small' }, `ほか ${shown.length - 300} 件 (検索で絞ってください)`));
      if (!shown.length) body.append(h('div', { class: 'muted small' }, '該当なし'));
    };
    this.paletteSearch.oninput = render;
    this.paletteCategory.onchange = render;
    box.addEventListener('dragover', (e) => {
      if (this.drag?.kind !== 'row') return;
      e.preventDefault();
      box.classList.add('drop-remove');
    });
    box.addEventListener('dragleave', (e) => {
      if (!box.contains(e.relatedTarget as Node)) box.classList.remove('drop-remove');
    });
    box.addEventListener('drop', (e) => {
      const drag = this.drag;
      if (drag?.kind !== 'row') return;
      e.preventDefault();
      this.endDrag();
      this.edit(s, list.filter((_, j) => j !== drag.index));
    });
    box.append(h('div', { class: 'row' }, this.paletteSearch, this.paletteCategory), body);
    render();
    return box;
  }

  /** Adding an item, reverting the shop, and warnings about lists the game was not seen with. */
  private editor(s: Shop, list: number[], stock: ShopStock): HTMLElement {
    const warnings: string[] = [];
    if (!list.length) warnings.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
    if (list.length > stock.originalMax) warnings.push(`元のデータで一番多い店は ${stock.originalMax} 品です。それを超える数はゲームで確かめていません。`);
    if (list.some((id) => !this.items.item(id))) warnings.push('ないアイテムが入っています。');
    if (list.some((id) => this.items.item(id)?.price === 0)) warnings.push('買値 0 のアイテムがあります (タダで買えます)。');
    return h('div', {},
      h('div', { class: 'row' },
        h('span', { class: 'muted small' }, '行をドラッグして並べ替え、右の一覧からドラッグ (またはダブルクリック) で追加、一覧へドラッグで外します。'),
        stock.changedShop(s.id) ? h('button', { onclick: () => this.edit(s, stock.originalItems(s.id)) }, 'この店の変更を元に戻す') : ''),
      h('div', { class: 'muted small' }, `変更は ShopItem として ${stock.archiveNames().join(' と ')} に書き出されます。`),
      ...warnings.map((w) => h('div', { class: 'issue warn' }, `⚠ ${w}`)));
  }
}
