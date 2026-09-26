// Item book: every item with its category, prices, use effect, and where to get it (shops, chests,
// monster drops).
import { clear, h } from '../editor/dom';
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import type { Game } from '../game/game';
import { ITEM_CATEGORY, MAX_LIMIT, MAX_RARITY, type Item, type ItemBook, type ItemFields } from '../game/items';
import type { MonsterBook } from '../game/monsters';
import { mapTitle } from '../game/names';
import { LAYOUTS, recCellPos, type MapDoc } from '../game/sections';
import { hex8, u32 } from '../util/bytes';
import { lazyPhoto, ModelViewer, type ModelRef } from './modelview';
import { loadObjectModels, objKey } from '../cgfx/loader';
import { itemModelArchive } from '../game/items';
import { shopLabel } from '../game/shops';
import { shopHref } from './shops';

const CHEST_KINDS = new Set([0x0c, 0x0d, 0x0e]);

export interface ChestSource {
  map: MapInfo;
  x: number;
  y: number;
  /** treasureGroup row and the chance (%) of this item in it. */
  row: number;
  chance: number;
}

/** Item -> chests that can hold it (current map documents and event tables). */
export async function chestSources(game: Game, docOf: (m: MapInfo) => MapDoc, events: (d: number) => Promise<EventTable | null>): Promise<Map<number, ChestSource[]>> {
  const out = new Map<number, ChestSource[]>();
  const master = game.master;
  for (const m of game.editableMaps()) {
    const ev = await events(m.dungeon);
    if (!ev) continue;
    for (const rec of docOf(m).recs[4] ?? []) {
      const evRow = u32(rec.raw, 0);
      if (!ev.has(evRow) || !CHEST_KINDS.has(ev.kind(evRow))) continue;
      const row = ev.treasureRow(evRow);
      const slots = master.treasureSlots(row).filter((s) => s.item);
      const total = slots.reduce((a, s) => a + s.weight, 0);
      const [x, y] = recCellPos(rec, LAYOUTS[4]!);
      const seen = new Set<number>();
      for (const s of slots) {
        if (seen.has(s.item)) continue;
        seen.add(s.item);
        const w = slots.filter((o) => o.item === s.item).reduce((a, o) => a + o.weight, 0);
        out.set(s.item, [...(out.get(s.item) ?? []), { map: m, x: Math.floor(x), y: Math.floor(y), row, chance: total ? (w / total) * 100 : 0 }]);
      }
    }
  }
  return out;
}

/** Model of an item (itemData +0x20, an entry of one of the item model archives). */
export function itemRef(game: Game, it: Item): ModelRef | null {
  if (!it.model) return null;
  return {
    key: `item/${hex8(it.model)}`,
    load: async () => {
      const name = await itemModelArchive(game, it.model);
      if (!name) return null;
      const archive = parseInt(name, 16);
      const sets = await loadObjectModels(game, [{ archive, entry: it.model }]);
      const set = sets.get(objKey(archive, it.model));
      return set ? { set, hash: it.model } : null;
    },
  };
}

export class ItemPage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: '名前・説明で検索' });
  private readonly filter = h('select', {});
  private selected = 0;
  /** Item shown in the detail (its scroll position is kept while it is edited). */
  private shownItem = 0;
  private readonly viewer = new ModelViewer();
  private shownModel = '';
  private chests = new Map<number, ChestSource[]>();

  constructor(
    private readonly game: Game,
    private readonly items: ItemBook,
    private readonly monsters: MonsterBook | null,
    private readonly docOf: (m: MapInfo) => MapDoc,
    private readonly events: (d: number) => Promise<EventTable | null>,
    /** Called after an edit (to save it). */
    private readonly onEdit: () => void = () => {},
  ) {
    this.filter.append(
      h('option', { value: 'all' }, 'すべて'),
      ...Object.entries(ITEM_CATEGORY).map(([k, v]) => h('option', { value: `c${k}` }, v)),
      h('option', { value: 'shop' }, 'お店で買える'),
      h('option', { value: 'chest' }, '宝箱から出る'),
      h('option', { value: 'drop' }, 'モンスターが落とす'),
      h('option', { value: 'changed' }, '変更した'),
    );
    this.search.addEventListener('input', () => this.renderList());
    this.filter.addEventListener('change', () => this.renderList());
    this.el.append(h('div', { class: 'book-side' }, h('div', { class: 'row' }, this.search, this.filter), this.list), this.detail);
  }

  async show(id?: number): Promise<void> {
    if (id && this.items.item(id)) this.selected = id;
    if (!this.selected) this.selected = this.items.items[0]?.id ?? 0;
    this.renderList();
    this.renderDetail();
    this.chests = await chestSources(this.game, this.docOf, this.events);
    this.renderList();
    this.renderDetail();
  }

  private drops(id: number): { row: number; name: string; rate: number }[] {
    return (this.monsters?.monsters ?? []).flatMap((m) => m.drops.filter((d) => d.item === id).map((d) => ({ row: m.row, name: m.name, rate: d.rate })));
  }

  private matches(it: Item): boolean {
    const q = this.search.value.trim();
    if (q && !it.name.includes(q) && !it.description.includes(q)) return false;
    const f = this.filter.value;
    if (f.startsWith('c')) return (it.categoryByte & 0xf) === Number(f.slice(1));
    if (f === 'shop') return it.shops.length > 0;
    if (f === 'chest') return this.chests.has(it.id);
    if (f === 'drop') return this.drops(it.id).length > 0;
    if (f === 'changed') return this.items.changed(it.id);
    return true;
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.items.items.filter((it) => this.matches(it));
    const body = h('tbody');
    for (const it of rows)
      body.append(h('tr', { class: it.id === this.selected ? 'active' : '', onclick: () => (location.hash = `#/items/${it.id}`) },
        h('td', { class: 'photo-cell' }, lazyPhoto(this.ref(it))),
        h('td', { class: 'num muted' }, String(it.id)),
        h('td', {}, it.name, this.items.changed(it.id) ? h('span', { class: 'edited-mark', title: '変更した' }, ' ●') : ''),
        h('td', { class: 'muted' }, it.category),
        h('td', { class: 'num' }, it.price ? String(it.price) : '')));
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.items.items.length} 件`),
      h('table', { class: 'book-table' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'ID'), h('th', {}, '名前'), h('th', {}, '分類'), h('th', {}, '買値'))), body));
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private ref(it: Item): ModelRef | null {
    return itemRef(this.game, it);
  }

  private edited(): void {
    this.onEdit();
    this.renderList();
    this.renderDetail();
  }

  private renderDetail(): void {
    const scroll = this.shownItem === this.selected ? this.detail.scrollTop : 0;
    this.shownItem = this.selected;
    clear(this.detail);
    const it = this.items.item(this.selected);
    if (!it) return;
    const ref = this.ref(it);
    if ((ref?.key ?? '') !== this.shownModel || !ref) {
      this.shownModel = ref?.key ?? '';
      this.viewer.show(ref, it.name);
    }
    const chests = this.chests.get(it.id) ?? [];
    const drops = this.drops(it.id);
    const changed = this.items.changed(it.id);
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, it.name),
        h('span', { class: 'muted' }, `ID ${it.id}  ${it.category} (0x${it.categoryByte.toString(16).padStart(2, '0').toUpperCase()})`)),
      h('div', { class: 'book-top' },
        h('div', {}, this.descriptionTable(it), this.fieldEditor(it)),
        this.viewer.el),
      h('div', { class: 'row' },
        h('span', { class: 'muted small' }, '変更はマスター (56562135) の itemData.bin として書き出されます。'),
        changed ? h('button', { onclick: () => { this.items.revert(it.id); this.edited(); } }, 'このアイテムの変更を元に戻す') : ''),
      (it.categoryByte & 0xf) === 3 ? h('div', { class: 'muted small' }, `装備の値 +0x2D = ${it.extra[0]}、+0x2E = ${it.extra[1]} (未解析)`) : '',
      h('div', { class: 'book-cols' },
        h('section', {}, h('h3', {}, `お店 (${it.shops.length})`),
          it.shops.length ? h('div', {}, ...it.shops.flatMap((s, i) => [i ? '、' : '', h('a', { href: shopHref(s) }, shopLabel(s))])) : h('div', { class: 'muted' }, 'なし')),
        h('section', {}, h('h3', {}, `落とすモンスター (${drops.length})`),
          drops.length
            ? h('ul', {}, ...drops.map((d) => h('li', {}, h('a', { href: `#/monsters/${d.row}` }, d.name), ' ', h('span', { class: 'muted' }, `(率の値 ${d.rate})`))))
            : h('div', { class: 'muted' }, 'なし'))),
      h('h3', {}, `宝箱 (${chests.length})`),
      chests.length
        ? h('table', { class: 'enc-table book-chests' },
            h('tr', {}, h('th', {}, 'マップ'), h('th', {}, 'セル'), h('th', {}, '中身の表'), h('th', {}, '確率')),
            ...chests.map((c) => h('tr', {},
              h('td', {}, h('a', { href: `#/map/${c.map.name}` }, mapTitle(c.map, this.game.code.maps, this.game.master))),
              h('td', { class: 'muted' }, `(${c.x}, ${c.y})`),
              h('td', { class: 'num muted' }, `#${c.row}`),
              h('td', { class: 'num' }, `${c.chance.toFixed(c.chance < 10 ? 1 : 0)}%`))))
        : h('div', { class: 'muted' }, 'なし (ダンジョンの宝箱のみ数えます)'),
    );
    this.detail.scrollTop = scroll;
  }

  /** The message fields (+0x10..+0x1C), one row each; empty fields are left out. */
  private descriptionTable(it: Item): HTMLElement {
    const rows = it.descriptions.filter((d) => d.text);
    if (!rows.length) return h('p', { class: 'muted' }, '説明はありません');
    return h('table', { class: 'enc-table desc-table' },
      ...rows.map((d) => h('tr', {},
        h('th', { title: `itemData +0x${d.offset.toString(16).toUpperCase()}、メッセージ ${d.id}` }, d.label),
        h('td', { class: 'book-desc' }, d.text))));
  }

  /** Prices, stars, stack limit, use effect (tools) and the item that replaces it at the limit. */
  private fieldEditor(it: Item): HTMLElement {
    const orig = this.items.original(it.id);
    const set = (patch: Partial<ItemFields>): void => {
      this.items.set(it.id, patch);
      this.edited();
    };
    const mark = <K extends keyof ItemFields>(k: K, show: (v: ItemFields[K]) => string = String): { class: string; title: string } =>
      it[k] !== orig[k] ? { class: 'edited', title: `元の値 ${show(orig[k])}` } : { class: '', title: '' };
    const number = (k: 'price' | 'sell' | 'limit', min: number, max: number): HTMLElement => {
      const m = mark(k);
      return h('input', { type: 'number', min, max, value: it[k], class: `num-input ${m.class}`, title: m.title, onchange: (e: Event) => {
        const v = Math.round(Number((e.target as HTMLInputElement).value));
        if (Number.isFinite(v) && v >= min && v <= max) set({ [k]: v });
        else this.renderDetail();
      } });
    };
    const stars = (n: number): string => '★'.repeat(n) || '0';
    const rarity = h('select', { ...mark('rarity', stars), onchange: (e: Event) => set({ rarity: Number((e.target as HTMLSelectElement).value) }) });
    for (let v = 0; v <= MAX_RARITY; v++) rarity.append(h('option', { value: v, selected: v === it.rarity }, stars(v)));
    const stat = (label: string, input: HTMLElement, suffix = ''): HTMLElement =>
      h('label', { class: 'stat' }, h('span', { class: 'muted' }, label), h('span', {}, input, suffix));
    const box = h('div', { class: 'item-fields' },
      h('div', { class: 'stats' },
        stat('買値', number('price', 0, 0xffffffff), ' G'),
        stat('売値', number('sell', 0, 0xffffffff), ' G'),
        stat('☆', rarity),
        stat('上限', number('limit', 1, MAX_LIMIT))));
    if ((it.categoryByte & 0xf) === 1) {
      const action = h('select', { ...mark('action', (v) => `#${v}`), onchange: (e: Event) => set({ action: Number((e.target as HTMLSelectElement).value) }) });
      const choices = this.items.itemActions();
      action.append(h('option', { value: 0, selected: it.action === 0 }, 'なし'));
      if (it.action && !choices.some((c) => c.row === it.action)) action.append(h('option', { value: it.action, selected: true }, `#${it.action} (アイテム以外のアクション)`));
      for (const c of choices) action.append(h('option', { value: c.row, selected: c.row === it.action }, `#${c.row} ${c.name || '(名前なし)'} — ${c.effect}`));
      box.append(h('div', { class: 'model-line' }, '効果: ', action, ' ',
        it.action ? h('a', { href: `#/actions/${it.action}`, title: 'アクションで開く' }, '↗') : '',
        it.effect ? h('span', { class: 'muted' }, ` ${it.effect}`) : ''));
    }
    const chainName = (id: number): string => (id ? this.items.item(id)?.name ?? `#${id}` : 'なし');
    const chain = h('select', { ...mark('chain', chainName), onchange: (e: Event) => set({ chain: Number((e.target as HTMLSelectElement).value) }) });
    chain.append(h('option', { value: 0, selected: it.chain === 0 }, 'なし'));
    if (it.chain && !this.items.item(it.chain)) chain.append(h('option', { value: it.chain, selected: true }, `#${it.chain}`));
    for (const o of this.items.items) if (o.id !== it.id) chain.append(h('option', { value: o.id, selected: o.id === it.chain }, `${o.id} ${o.name}`));
    box.append(h('div', { class: 'model-line' }, '上限に達すると: ', chain, ' ',
      it.chain && this.items.item(it.chain) ? h('a', { href: `#/items/${it.chain}`, title: 'このアイテムを開く' }, '↗') : ''));
    return box;
  }
}
