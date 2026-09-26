// "追加" panel: pick what the place tool adds (chest, prop, floor gimmick, copy of an existing gimmick).
import { gimmickTemplates, type GimmickTemplate } from '../game/templates';
import { objectCategory } from '../game/objects';
import { clear, h } from './dom';
import { stampLabel, type Stamp } from './place';
import type { EditorState } from './state';

export class AddPanel {
  readonly el = h('div', { class: 'add-panel' });
  private templates: GimmickTemplate[] = [];
  private templatesFor = -1;
  /** Model name of a mapObject row once loaded (set by the app). */
  objectName: (row: number) => string = () => '';
  /** Loads the models of mapObject rows, and renders a thumbnail of one (set by the app). */
  loadObjects: (rows: number[]) => Promise<void> = async () => {};
  objectThumb: (row: number) => Promise<string | null> = async () => null;
  /** Direction of new props. */
  private dir = 0;
  /** Groups (<details>) the user opened. */
  private readonly open = new Set<string>();

  constructor(private readonly st: EditorState) {}

  private use(stamp: Stamp): void {
    this.st.stamp = stamp;
    this.st.setTool('place');
  }

  async loadTemplates(): Promise<void> {
    const d = this.st.current?.dungeon ?? -1;
    if (d === this.templatesFor) return;
    this.templatesFor = d;
    this.templates = [];
    this.render();
    this.templates = await gimmickTemplates(this.st.game, d);
    if (this.templatesFor === d) this.render();
  }

  render(): void {
    const st = this.st;
    clear(this.el);
    const ev = st.currentEvents;
    const room = ev ? ev.roomLeft() : 0;
    const active = st.tool === 'place' && st.stamp ? st.stamp : null;

    // props: mapObject rows of placeable objects, grouped by category
    const master = st.game.master;
    const cats = new Map<string, number[]>();
    for (let row = 69; row < master.mapObject.rows; row++) {
      const cat = objectCategory(row);
      if (['ワールドマップ', 'NPC', '見えない', 'オブジェクト'].includes(cat) || !master.objectModel(row)) continue;
      cats.set(cat, [...(cats.get(cat) ?? []), row]);
    }
    const dirs = h('div', { class: 'row' }, h('span', { class: 'muted small' }, '向き'),
      ...['↑', '→', '↓', '←'].map((l, i) => h('button', {
        class: this.dir === i ? 'active' : '',
        title: `${i * 90}°`,
        onclick: () => {
          this.dir = i;
          if (active?.type === 'prop') this.use({ ...active, dir: i });
          else this.render();
        },
      }, l)));
    const props = [...cats].map(([cat, rows]) => this.group(`prop/${cat}`, `${cat} (${rows.length})`, rows,
      rows.map((row) => ({
        row,
        label: `#${row}`,
        title: () => `mapObject #${row} ${this.objectName(row)}`,
        active: active?.type === 'prop' && active.row === row,
        pick: () => this.use({ type: 'prop', row, dir: this.dir }),
      }))));

    // gimmicks: copies of existing records
    const gimmicks = this.templates.length
      ? ([[5, 'ギミック (区画 5)'], [3, '出入口・扉・穴 (区画 3)']] as const).map(([section, label]) => {
          const list = this.templates.filter((t) => t.section === section);
          return this.group(`tmpl/${section}`, `${label} (${list.length})`, list.map((t) => t.objectRow).filter((r) => r),
            list.map((t) => ({
              row: t.objectRow,
              label: t.label,
              title: () => `${t.label} — ${t.source}`,
              active: active?.type === 'template' && active.t === t,
              pick: () => this.use({ type: 'template', t }),
            })));
        })
      : [h('div', { class: 'muted small' }, 'ギミックを読み込み中…')];

    this.el.append(
      h('h3', {}, '追加'),
      h('div', { class: 'muted small' }, ev ? `イベントの行: あと ${room} 行 (${ev.rows} / ${ev.capacity})` : 'このダンジョンにはイベントの表がありません'),
      h('div', { class: 'row' },
        h('button', { class: active?.type === 'chest' ? 'active' : '', disabled: room < 1, onclick: () => this.use({ type: 'chest' }) }, '宝箱'),
        h('button', { class: active?.type === 'floor' && active.kind === 0 ? 'active' : '', onclick: () => this.use({ type: 'floor', kind: 0 }) }, 'ダメージ床'),
        h('button', { class: active?.type === 'floor' && active.kind === 1 ? 'active' : '', onclick: () => this.use({ type: 'floor', kind: 1 }) }, '凍った床'),
      ),
      h('h4', {}, '置物'), dirs, ...props,
      h('h4', {}, 'ギミック (ゲーム中のものの写し)'), ...gimmicks,
      st.game.switchVersion
        ? h('div', { class: 'row' },
            h('button', { class: active?.type === 'switchgate' ? 'active' : '', disabled: room < 2, onclick: () => this.use({ type: 'switchgate' }) }, 'スイッチと柵'),
            h('span', { class: 'muted small' }, '踏むと柵が開く (汎用スイッチ)'))
        : h('div', { class: 'muted small' }, 'スイッチと柵: ヘッダーの「土台の MOD」で汎用スイッチ入りの MOD (elpulse の mod/out) を読み込むと使えます。'),
      active ? h('div', { class: 'place-hint' }, `置くもの: ${stampLabel(active)}。マップをクリックして置く (Esc で終わる)`) : '',
      h('p', { class: 'muted small' },
        '宝箱とギミックには新しいイベントの行 (状態を保存する枠つき) を作ります。宝箱の中身は新しい行 (最初は同じダンジョンの宝箱の中身の写し) で、右ペインで編集できます。ギミックはゲーム中の同じ種類のものを写すので、動き (つながる扉・行き先など) は写し元の設定のままです。'),
    );
  }

  /** A collapsible grid of thumbnails; thumbnails are rendered when it is open. */
  private group(key: string, label: string, rows: number[], items: { row: number; label: string; title: () => string; active: boolean; pick: () => void }[]): HTMLElement {
    const grid = h('div', { class: 'pal-items obj-items' });
    const d = h('details', { class: 'obj-group', open: this.open.has(key) || items.some((i) => i.active) },
      h('summary', {}, label), grid);
    let filled = false;
    const fill = (): void => {
      if (filled || !d.open) return;
      filled = true;
      const load = this.loadObjects(rows);
      for (const it of items) {
        const img = h('div', { class: 'pal-swatch' });
        const btn = h('button', { class: 'pal-item obj-item' + (it.active ? ' active' : ''), title: it.title(), onclick: it.pick },
          img, h('span', { class: 'pal-label' }, it.label));
        grid.append(btn);
        if (!it.row) continue;
        load.then(() => this.objectThumb(it.row)).then((url) => {
          btn.title = it.title();
          if (url) img.replaceWith(h('img', { src: url, alt: '' }));
        });
      }
    };
    d.addEventListener('toggle', () => {
      if (d.open) this.open.add(key);
      else this.open.delete(key);
      fill();
    });
    fill();
    return d;
  }
}
