// Monster book: every MonsterParameter row with its stats, drops, skills, resistances, and the maps
// whose encounter groups (section 6) contain it.
import { clear, h } from '../editor/dom';
import { groupDetail } from '../editor/encounters';
import type { Game } from '../game/game';
import type { MapInfo } from '../game/codebin';
import { mapEncounters, RESIST_GROUPS, RESIST_MAX, RESIST_MIN, type Monster, type MonsterBook, type MonsterGroup, type ResistKind } from '../game/monsters';
import { radar } from './radar';
import { lazyPhoto, ModelViewer, type ModelRef } from './modelview';
import { loadComposite } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, MONSTER_MOTIONS } from '../game/monsters';
import { hex8 } from '../util/bytes';
import { mapTitle } from '../game/names';
import type { MapDoc } from '../game/sections';

export interface Appearance {
  map: MapInfo;
  group: MonsterGroup;
  /** 'map' = the map's group, else the number of cells with this group. */
  cells: number | 'map';
  lead: boolean;
}

/** Monster row -> where it appears (current map documents, so edits show up). */
export function appearances(game: Game, book: MonsterBook, docOf: (m: MapInfo) => MapDoc): Map<number, Appearance[]> {
  const out = new Map<number, Appearance[]>();
  const add = (map: MapInfo, g: MonsterGroup, cells: number | 'map'): void => {
    for (const s of [...g.leads, ...g.mates]) {
      const list = out.get(s.monster) ?? [];
      const lead = g.leads.some((l) => l.monster === s.monster);
      if (!list.some((a) => a.map === map && a.group === g)) list.push({ map, group: g, cells, lead });
      out.set(s.monster, list);
    }
  };
  for (const m of game.editableMaps()) {
    const enc = mapEncounters(docOf(m));
    const g = book.group(enc.group);
    if (g) add(m, g, 'map');
    for (const [hash, cells] of enc.cells) {
      const cg = hash ? book.group(hash) : undefined;
      if (cg) add(m, cg, cells.length);
    }
  }
  return out;
}

const range = (r: { min: number; max: number }): string => (r.min === r.max || !r.min ? String(r.max) : `${r.min}〜${r.max}`);

export class MonsterPage {
  readonly el = h('div', { class: 'book' });
  private readonly list = h('div', { class: 'book-list' });
  private readonly detail = h('div', { class: 'book-detail' });
  private readonly search = h('input', { type: 'search', placeholder: '名前・ワザ・ドロップで検索' });
  private readonly filter = h('select', {});
  private selected = 0;
  private readonly viewer = new ModelViewer(MONSTER_MOTIONS);
  private shownModel = '';
  private where = new Map<number, Appearance[]>();

  constructor(
    private readonly game: Game,
    private readonly book: MonsterBook,
    private readonly docOf: (m: MapInfo) => MapDoc,
    /** Called after an edit (to save it). */
    private readonly onEdit: () => void = () => {},
  ) {
    this.filter.append(
      h('option', { value: 'all' }, 'すべて'),
      h('option', { value: 'seen' }, 'マップに出る'),
      h('option', { value: 'boss' }, 'ボス・変身'),
      ...[...new Set(game.editableMaps().map((m) => m.dungeon))].map((d) => h('option', { value: `d${d}` }, game.master.dungeonName(d) || `ダンジョン ${d}`)),
    );
    this.search.addEventListener('input', () => this.renderList());
    this.filter.addEventListener('change', () => this.renderList());
    this.el.append(h('div', { class: 'book-side' }, h('div', { class: 'row' }, this.search, this.filter), this.list), this.detail);
  }

  /** Show the page (recomputes the appearances from the current maps). */
  show(row?: number): void {
    this.where = appearances(this.game, this.book, this.docOf);
    if (row && this.book.monster(row)) this.selected = row;
    if (!this.selected) this.selected = 1;
    this.renderList();
    this.renderDetail();
  }

  private matches(m: Monster): boolean {
    const q = this.search.value.trim();
    if (q && ![m.name, ...m.skills.map((s) => s.name), ...m.drops.map((d) => d.name)].some((t) => t.includes(q))) return false;
    const f = this.filter.value;
    if (f === 'seen') return this.where.has(m.row);
    if (f === 'boss') return !!(m.boss || m.nextForm || this.book.monsters.some((o) => o.nextForm === m.row));
    if (f.startsWith('d')) return (this.where.get(m.row) ?? []).some((a) => a.map.dungeon === Number(f.slice(1)));
    return true;
  }

  private renderList(): void {
    clear(this.list);
    const rows = this.book.monsters.filter((m) => this.matches(m));
    const tbl = h('table', { class: 'book-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '#'), h('th', {}, '名前'), h('th', {}, 'Lv'), h('th', {}, 'HP'), h('th', {}, '出現'))));
    const body = h('tbody');
    for (const m of rows) {
      const n = this.where.get(m.row)?.length ?? 0;
      body.append(h('tr', { class: m.row === this.selected ? 'active' : '', onclick: () => (location.hash = `#/monsters/${m.row}`) },
        h('td', { class: 'photo-cell' }, lazyPhoto(this.ref(m))),
        h('td', { class: 'num muted' }, String(m.row)),
        h('td', {}, m.name),
        h('td', { class: 'num' }, String(m.level)),
        h('td', { class: 'num' }, String(m.hp.max)),
        h('td', { class: 'num muted' }, n ? String(n) : '')));
    }
    tbl.append(body);
    this.list.append(h('div', { class: 'muted small' }, `${rows.length} / ${this.book.monsters.length} 件`), tbl);
    this.list.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }

  private renderDetail(): void {
    const scroll = this.detail.scrollTop;
    this.renderDetailInner();
    this.detail.scrollTop = scroll;
  }

  /** Model of a monster (MonsterDesign +0x10 / +0x14 in 470D2848). */
  private ref(m: Monster): ModelRef | null {
    const x = this.book.modelOf(m);
    if (!x) return null;
    return {
      key: `monster/${hex8(x.model)}/${hex8(x.texture)}`,
      load: async () => ({ set: await loadComposite(this.game, MONSTER_MODEL_ARCHIVE, x.model, x.texture), hash: x.model }),
    };
  }

  private renderDetailInner(): void {
    clear(this.detail);
    const m = this.book.monster(this.selected);
    if (!m) return;
    const ref = this.ref(m);
    if ((ref?.key ?? '') !== this.shownModel || !ref) {
      this.shownModel = ref?.key ?? '';
      this.viewer.show(ref, m.name);
    }
    const link = (row: number): HTMLElement => h('a', { href: `#/monsters/${row}` }, `${this.book.monster(row)?.name ?? '?'} (#${row})`);
    const prev = this.book.monsters.filter((o) => o.nextForm === m.row);
    const stat = (label: string, v: string): HTMLElement => h('div', { class: 'stat' }, h('span', { class: 'muted' }, label), h('b', {}, v));
    const res = this.resistEditor(m);
    const where = this.where.get(m.row) ?? [];
    const byMap = h('div', { class: 'book-where' });
    if (!where.length) byMap.append(h('div', { class: 'muted' }, 'どのマップの群れにもいません (ボス・イベント戦、エサ場など)'));
    for (const a of where)
      byMap.append(h('details', {},
        h('summary', {},
          h('a', { href: `#/map/${a.map.name}` }, mapTitle(a.map, this.game.code.maps, this.game.master)),
          h('span', { class: 'muted' }, ` 群れ #${a.group.row}${a.cells === 'map' ? '' : ` (セル ${a.cells} 個)`}${a.lead ? '' : ' 仲間としてのみ'}`)),
        groupDetail(this.book, a.group)));
    this.detail.append(
      h('div', { class: 'book-head' },
        h('h2', {}, m.name),
        h('span', { class: 'muted' }, `#${m.row}  種族 ${m.species}  図鑑 ${m.museum}  デザイン ${m.design}`)),
      h('div', { class: 'book-top' },
        h('div', {},
          m.description ? h('p', { class: 'book-desc' }, m.description) : '',
          h('div', { class: 'stats' },
            stat('Lv', String(m.level)), stat('HP', range(m.hp)), stat('こうげき', range(m.attack)), stat('ぼうぎょ', range(m.defense)),
            stat('すばやさ', range(m.speed)), stat('回避', `${m.evasion}%`), stat('経験値', String(m.exp)), stat('ゴールド', String(m.gold)))),
        this.viewer.el),
      h('div', { class: 'book-cols' },
        h('section', {}, h('h3', {}, 'ドロップ (率の値)'),
          m.drops.length ? h('ul', {}, ...m.drops.map((d) => h('li', {}, h('a', { href: `#/items/${d.item}` }, d.name), ' ', h('span', { class: 'muted' }, `(${d.rate})`)))) : h('div', { class: 'muted' }, 'なし')),
        h('section', {}, h('h3', {}, 'ワザ'),
          h('ul', {}, ...m.skills.map((s) => h('li', {}, `${s.name} `, h('a', { class: 'muted', href: `#/actions/${s.action}` }, `#${s.action}`))))),
        h('section', {}, h('h3', {}, '行動'),
          h('div', {}, `AI: ${m.ai} / 狙い ${m.target}`),
          h('div', {}, `行動回数 ${m.actions}${m.focus ? '、集中攻撃' : ''}`),
          m.boss ? h('div', {}, `ボス特殊 ${m.boss}`) : '',
          m.nextForm ? h('div', {}, '次の形態: ', link(m.nextForm)) : '',
          prev.length ? h('div', {}, '前の形態: ', ...prev.map((p) => link(p.row))) : '',
          m.line ? h('div', { class: 'muted' }, `「${m.line.replace(/[Ąą]+/g, m.name)}」`) : '')),
      h('div', { class: 'row' }, h('h3', {}, '耐性'),
        this.book.changed(m.row)
          ? h('button', { onclick: () => { this.book.revert(m.row); this.onEdit(); this.renderDetail(); } }, 'このモンスターの変更を元に戻す')
          : ''),
      res,
      h('h3', {}, `出現する場所 (${where.length})`), byMap,
    );
  }

  /**
   * Resistances by group, each with its effect. Elements and ailments are radar charts whose handles can
   * be dragged; every value can also be picked in the tables (-9..+10).
   */
  private resistEditor(m: Monster): HTMLElement {
    const bp = this.book.battle;
    const set = (k: number, v: number): void => {
      this.book.setResist(m.row, k, v);
      this.onEdit();
      this.renderDetail();
    };
    const effect = (kind: ResistKind, v: number): string => {
      if (kind === 'element') {
        const mul = bp.multiplier(v);
        return mul === 0 ? '無効 (×0)' : `×${mul}${mul > 1 ? ' (弱点)' : mul < 1 ? ' (効きにくい)' : ''}`;
      }
      return `係数 ${bp.coefficient(v)}%`;
    };
    const fmt = (v: number): string => `${v > 0 ? '+' : ''}${v}`;
    const box = h('div', { class: 'resists' },
      h('p', { class: 'muted small' },
        '値は −9〜+10 (正ほど強い)。属性はダメージの倍率 (BattleParameter +0x08 の表: −9 = ×4 … +9 = ×0.1)。',
        '属性の +10 はその属性のダメージを無効にします (モンスターを作るとき、値が 9 より大きい属性に無効のフラグが立ち、倍率が 0 になる)。',
        '状態異常・能力ダウン・突然死は付与率に掛かる係数 (BattleParameter [0x67 + 値 + 9]: −9 = 200% … +9 = 0%)。値は −9〜+9 に丸められるので、+10 は +9 と同じ (0%、効かない)。',
        'ワザの付与率 = 基本の率 (ワザごとに 100 / 75 / 50 / 34 / 25 / 12 / 6%) × 係数 (上限 100%)。'));
    const charts = h('div', { class: 'radars' });
    for (const [label, kind, a, b] of RESIST_GROUPS) {
      if (kind !== 'element' && kind !== 'ailment') continue;
      const axes = m.resist.slice(a, b).map((r, j) => ({ label: r.name, value: r.value, original: this.book.originalResist(m.row, a + j) }));
      charts.append(h('figure', { class: 'radar-box' },
        radar(axes, {
          min: RESIST_MIN,
          max: RESIST_MAX,
          rings: [-9, -5, 0, 5, 10],
          format: (v) => `${fmt(v)} ${effect(kind, v)}`,
          onChange: (j, v) => set(a + j, v),
        }),
        h('figcaption', {}, `${label} (ドラッグで変更。点線 = 元の値)`)));
    }
    box.append(charts);
    for (const [label, kind, a, b] of RESIST_GROUPS) {
      const tbl = h('table', { class: 'res-table' });
      tbl.append(h('tr', {}, h('th', {}, label), h('th', {}, '値'),
        ...(kind === 'element' ? [h('th', {}, 'ダメージ')] : [h('th', {}, '係数'), h('th', {}, '100% のワザ'), h('th', {}, '50%'), h('th', {}, '25%')])));
      for (let k = a; k < b; k++) {
        const r = m.resist[k]!;
        const orig = this.book.originalResist(m.row, k);
        const sel = h('select', {
          class: r.value !== orig ? 'edited' : '',
          title: r.value !== orig ? `元の値 ${fmt(orig)}` : `状態 ${r.id} (0x${r.id.toString(16).toUpperCase()})`,
          onchange: (e: Event) => set(k, Number((e.target as HTMLSelectElement).value)),
        });
        const values = new Set([...Array.from({ length: RESIST_MAX - RESIST_MIN + 1 }, (_, i) => i + RESIST_MIN), r.value]);
        for (const v of [...values].sort((x, y) => x - y)) sel.append(h('option', { value: v, selected: v === r.value }, fmt(v)));
        const cls = r.value > 0 ? 'plus' : r.value < 0 ? 'minus' : '';
        const cells = kind === 'element'
          ? [h('td', { class: `num ${cls}` }, effect(kind, r.value))]
          : [h('td', { class: `num ${cls}` }, `${bp.coefficient(r.value)}%`), ...[0, 2, 4].map((lv) => h('td', { class: 'num muted' }, `${bp.chance(lv, r.value)}%`))];
        tbl.append(h('tr', {}, h('td', {}, r.name), h('td', {}, sel), ...cells));
      }
      box.append(tbl);
    }
    return box;
  }
}
