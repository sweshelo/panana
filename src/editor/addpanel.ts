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

    // props: mapObject rows of placeable objects
    const propSel = h('select', { class: 'grow' });
    const master = st.game.master;
    let group = null as HTMLOptGroupElement | null;
    for (let row = 69; row < master.mapObject.rows; row++) {
      const cat = objectCategory(row);
      if (['ワールドマップ', 'NPC', '見えない', 'オブジェクト'].includes(cat) || !master.objectModel(row)) continue;
      if (group?.label !== cat) {
        group = h('optgroup', { label: cat });
        propSel.append(group);
      }
      const name = this.objectName(row);
      group.append(h('option', { value: row, selected: active?.type === 'prop' && active.row === row }, `#${row}${name ? ' ' + name : ''}`));
    }
    const dirSel = h('select', {}, ...['↑ 0', '→ 1', '↓ 2', '← 3'].map((l, i) => h('option', { value: i }, l)));

    const tmplSel = h('select', { class: 'grow' });
    if (!this.templates.length) tmplSel.append(h('option', { value: '' }, '読み込み中…'));
    for (const [section, label] of [[5, 'ギミック (区画 5)'], [3, '出入口・扉・穴 (区画 3)']] as const) {
      const g = h('optgroup', { label });
      this.templates.forEach((t, i) => {
        if (t.section === section) g.append(h('option', { value: i, selected: active?.type === 'template' && active.t === t }, `${t.label} — ${t.source}`));
      });
      tmplSel.append(g);
    }

    this.el.append(
      h('h3', {}, '追加'),
      h('div', { class: 'muted small' }, ev ? `イベントの行: あと ${room} 行 (${ev.rows} / ${ev.capacity})` : 'このダンジョンにはイベントの表がありません'),
      h('div', { class: 'row' },
        h('button', { class: active?.type === 'chest' ? 'active' : '', disabled: room < 1, onclick: () => this.use({ type: 'chest' }) }, '宝箱'),
        h('button', { class: active?.type === 'floor' && active.kind === 0 ? 'active' : '', onclick: () => this.use({ type: 'floor', kind: 0 }) }, 'ダメージ床'),
        h('button', { class: active?.type === 'floor' && active.kind === 1 ? 'active' : '', onclick: () => this.use({ type: 'floor', kind: 1 }) }, '凍った床'),
      ),
      h('div', { class: 'row' }, propSel, dirSel,
        h('button', { onclick: () => this.use({ type: 'prop', row: Number(propSel.value), dir: Number(dirSel.value) }) }, '置物')),
      h('div', { class: 'row' }, tmplSel,
        h('button', {
          disabled: !this.templates.length,
          onclick: () => {
            const t = this.templates[Number(tmplSel.value)];
            if (t) this.use({ type: 'template', t });
          },
        }, 'ギミック')),
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
}
