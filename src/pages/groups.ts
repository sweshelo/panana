// Encounter groups (monsterGroup): every row with its candidates and the maps that use it (section 6);
// the candidates can be edited, and a group can be copied into a new row.
import { clear, h } from '../editor/dom';
import type { MapInfo } from '../game/codebin';
import type { Game } from '../game/game';
import { countLabel, GROUP_SLOTS, mapEncounters, type GroupSlot, type MonsterBook, type MonsterGroup } from '../game/monsters';
import { mapTitle } from '../game/names';
import type { MapDoc } from '../game/sections';
import { hex8 } from '../util/bytes';

export const groupHref = (row: number): string => `#/groups/${row}`;

export interface GroupUse {
  map: MapInfo;
  /** 'map' = the map's group (section 6 header), else the number of cells with this group. */
  cells: number | 'map';
}

/** Group hash -> maps that use it (current map documents, so edits show up). */
export function groupUses(game: Game, docOf: (m: MapInfo) => MapDoc): Map<number, GroupUse[]> {
  const out = new Map<number, GroupUse[]>();
  const add = (hash: number, use: GroupUse): void => {
    if (hash) out.set(hash, [...(out.get(hash) ?? []), use]);
  };
  for (const m of game.editableMaps()) {
    const enc = mapEncounters(docOf(m));
    add(enc.group, { map: m, cells: 'map' });
    for (const [hash, cells] of enc.cells) add(hash, { map: m, cells: cells.length });
  }
  return out;
}

export class GroupPage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: 'モンスターの名前で検索' });
  private readonly filter = h('select', {});
  private selected = 0;
  private uses = new Map<number, GroupUse[]>();

  constructor(
    private readonly game: Game,
    private readonly book: MonsterBook,
    private readonly docOf: (m: MapInfo) => MapDoc,
    /** Called after an edit (to save it). */
    private readonly onEdit: () => void = () => {},
  ) {
    this.filter.append(
      h('option', { value: 'all' }, 'すべて'),
      h('option', { value: 'used' }, 'マップで使う'),
      h('option', { value: 'unused' }, 'どのマップも使わない'),
      h('option', { value: 'changed' }, '変更した'),
    );
    this.search.addEventListener('input', () => this.renderList());
    this.filter.addEventListener('change', () => this.renderList());
    this.el.append(h('div', { class: 'book-side' }, h('div', { class: 'row' }, this.search, this.filter), this.list), this.detail);
  }

  /** Show the page (recomputes which maps use each group). */
  show(row?: number): void {
    this.uses = groupUses(this.game, this.docOf);
    if (row !== undefined && this.book.groups[row]) this.selected = row;
    this.renderList();
    this.renderDetail();
  }

  private names(g: MonsterGroup): string {
    return this.book.groupMonsters(g).map((r) => this.book.monster(r)?.name ?? `#${r}`).join('・');
  }

  private matches(g: MonsterGroup): boolean {
    const q = this.search.value.trim();
    if (q && !this.book.groupMonsters(g).some((r) => this.book.monster(r)?.name.includes(q))) return false;
    const f = this.filter.value;
    const used = (this.uses.get(g.hash)?.length ?? 0) > 0;
    if (f === 'used') return used;
    if (f === 'unused') return !used;
    if (f === 'changed') return this.book.groupChanged(g.row);
    return true;
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.book.groups.filter((g) => this.matches(g));
    const body = h('tbody');
    for (const g of rows) {
      const n = this.uses.get(g.hash)?.length ?? 0;
      body.append(h('tr', { class: g.row === this.selected ? 'active' : '', onclick: () => (location.hash = groupHref(g.row)) },
        h('td', { class: 'num muted' }, String(g.row)),
        h('td', {}, this.names(g) || h('span', { class: 'muted' }, '(敵なし)'), this.book.groupChanged(g.row) ? h('span', { class: 'edited-mark' }, ' ●') : ''),
        h('td', { class: 'num muted' }, n ? String(n) : '')));
    }
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.book.groups.length} 件`),
      h('table', { class: 'book-table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'モンスター'), h('th', {}, 'マップ'))), body));
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private edited(): void {
    this.onEdit();
    this.renderList();
    this.renderDetail();
  }

  private renderDetail(): void {
    const scroll = this.detail.scrollTop;
    clear(this.detail);
    const g = this.book.groups[this.selected];
    if (!g) return;
    const uses = this.uses.get(g.hash) ?? [];
    const added = this.book.groupAdded(g.row);
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, `群れ #${g.row}`),
        h('span', { class: 'muted' }, `ハッシュ ${g.hash ? hex8(g.hash) : '(索引なし)'}${added ? '  (追加した行)' : ''}`)),
      h('p', { class: 'muted small book-desc' },
        '戦闘の 1 体目 (マップで見える敵) と 3 体目は「先頭」から、2・4 体目は「仲間」から、重みに比例して選ばれます。数は候補ごとの出る数のコードです。',
        `候補は 5 個まで。変更はマスター (56562135) の monsterGroup.bin として書き出されます。`),
      h('div', { class: 'row' },
        h('button', { title: 'この群れを写した新しい行を作ります。マップ編集の「出現する敵」で選べます', onclick: () => {
          const n = this.book.copyGroup(g.row);
          this.onEdit();
          location.hash = groupHref(n);
        } }, '写して新しい群れを作る'),
        !added && this.book.groupChanged(g.row)
          ? h('button', { onclick: () => { this.book.revertGroup(g.row); this.edited(); } }, 'この群れの変更を元に戻す')
          : ''),
      h('div', { class: 'book-cols group-cols' },
        this.slotEditor(g, 'leads', '先頭 (マップで見える敵)・3 体目'),
        this.slotEditor(g, 'mates', '仲間 (2・4 体目)')),
      h('div', { class: 'muted small' }, `+0x28〜: ${g.extra.join(' ')} (未解析)`),
      h('h3', {}, `使うマップ (${uses.length})`),
      uses.length
        ? h('table', { class: 'enc-table book-chests' },
            h('tr', {}, h('th', {}, 'マップ'), h('th', {}, '使い方')),
            ...uses.map((u) => h('tr', {},
              h('td', {}, h('a', { href: `#/map/${u.map.name}` }, mapTitle(u.map, this.game.code.maps, this.game.master))),
              h('td', { class: 'muted' }, u.cells === 'map' ? 'マップの群れ (区画 6 のヘッダー)' : `セル ${u.cells} 個`))))
        : h('div', { class: 'muted' }, 'どのマップも使っていません (マップ編集の右ペイン「出現する敵」で選べます)'),
    );
    this.detail.scrollTop = scroll;
  }

  /** Table of one side's candidates: monster, weight (with its share), count; add and remove. */
  private slotEditor(g: MonsterGroup, side: 'leads' | 'mates', title: string): HTMLElement {
    const slots = g[side];
    const total = slots.reduce((a, s) => a + s.weight, 0);
    const set = (next: GroupSlot[]): void => {
      this.book.setGroupSlots(g.row, side === 'leads' ? next : g.leads, side === 'mates' ? next : g.mates);
      this.edited();
    };
    const change = (k: number, patch: Partial<GroupSlot>): void => set(slots.map((s, i) => (i === k ? { ...s, ...patch } : s)));
    const monsterSelect = (value: number, onchange: (row: number) => void): HTMLSelectElement => {
      const sel = h('select', { onchange: (e: Event) => onchange(Number((e.target as HTMLSelectElement).value)) });
      for (const m of this.book.monsters) sel.append(h('option', { value: m.row, selected: m.row === value }, `${m.name} Lv${m.level} (#${m.row})`));
      if (!this.book.monster(value)) sel.append(h('option', { value, selected: true }, `#${value}`));
      return sel;
    };
    const tbl = h('table', { class: 'enc-table group-slots' },
      h('tr', {}, h('th', {}, 'モンスター'), h('th', {}, '重み'), h('th', {}, '割合'), h('th', {}, '数'), h('th', {}, '')));
    slots.forEach((s, k) => {
      const count = h('select', { onchange: (e: Event) => change(k, { count: Number((e.target as HTMLSelectElement).value) }) });
      for (let c = 0; c < 8; c++) count.append(h('option', { value: c, selected: c === s.count }, countLabel(c)));
      if (s.count >= 8) count.append(h('option', { value: s.count, selected: true }, countLabel(s.count)));
      tbl.append(h('tr', {},
        h('td', {}, monsterSelect(s.monster, (row) => change(k, { monster: row })), ' ', h('a', { href: `#/monsters/${s.monster}`, title: 'モンスター図鑑で開く' }, '↗')),
        h('td', {}, h('input', { type: 'number', min: 1, max: 255, value: s.weight, class: 'num-input', onchange: (e: Event) => {
          const v = Math.round(Number((e.target as HTMLInputElement).value));
          // weight 0 would drop the slot (the game skips it), so removing is done with ×
          if (v >= 1 && v <= 255) change(k, { weight: v });
          else this.renderDetail();
        } })),
        h('td', { class: 'num' }, `${Math.round((s.weight / total) * 100)}%`),
        h('td', {}, count),
        h('td', {}, h('button', { title: '外す', onclick: () => set(slots.filter((_, i) => i !== k)) }, '×'))));
    });
    if (!slots.length) tbl.append(h('tr', {}, h('td', { class: 'muted', colspan: 5 }, 'なし')));
    const add = h('button', {
      disabled: slots.length >= GROUP_SLOTS,
      title: slots.length >= GROUP_SLOTS ? `候補は ${GROUP_SLOTS} 個まで` : '',
      onclick: () => set([...slots, { monster: slots[0]?.monster ?? g.leads[0]?.monster ?? 1, weight: 1, count: 0 }]),
    }, '＋ 追加');
    return h('section', {}, h('h3', {}, title), tbl, add);
  }
}
