// The map editor: map list, 2D / 3D views, tools, palette, inspector, validation. Built with h() (the other pages
// are React); the shell places its element in the map page.
import { loadTilesetModels } from '../cgfx/loader';
import { ModelFactory } from '../cgfx/three';
import type { Game } from '../game/game';
import { isIndoor } from '../game/objects';
import { LAYOUTS, POINT_SECTIONS } from '../game/sections';
import type { Session } from '../session';
import { AddPanel } from './addpanel';
import { Controller } from './controller';
import { clear, h } from './dom';
import { Inspector } from './inspector';
import { fillMapSelect } from './labels';
import { openNewMapDialog } from './newmapdialog';
import { SECTION_COLORS } from './legend';
import { Palette } from './palette';
import type { EditorState, Tool } from './state';
import { validate } from './validate';
import { View2D } from './view2d';
import { View3D } from './view3d';

type ViewMode = '2d' | '3d' | 'split';

export class MapEditor {
  readonly el = h('div', { class: 'app' });
  private readonly game: Game;
  private readonly st: EditorState;
  private readonly ctl: Controller;
  private readonly v2: View2D;
  private readonly v3: View3D;
  private readonly palette: Palette;
  private readonly addPanel: AddPanel;
  private readonly inspector: Inspector;
  private factory: ModelFactory | null = null;
  private mode: ViewMode = 'split';
  private clipHeight = 400;
  private readonly mapSel = h('select', { class: 'map-select', onchange: (e: Event) => this.openMap(Number((e.target as HTMLSelectElement).value)) });
  private status = h('div', { class: 'status' });
  private issuesEl = h('div', { class: 'issues' });
  private validateTimer = 0;
  /** The map page is shown (keyboard shortcuts work only then). */
  private active = false;
  private unsubscribe = (): void => {};

  private constructor(private readonly session: Session) {
    this.game = session.game;
    this.st = session.st;
    this.ctl = new Controller(this.st);
    this.v2 = new View2D(this.st, this.ctl);
    this.v3 = new View3D(this.st, this.ctl);
    this.palette = new Palette(this.st);
    this.inspector = new Inspector(this.st, this.ctl);
    this.addPanel = new AddPanel(this.st);
  }

  static async create(session: Session): Promise<MapEditor> {
    const e = new MapEditor(session);
    await e.init();
    return e;
  }

  /** The map page was shown: open the map of the URL (#/map/NAME) and redraw. */
  async show(name: string | undefined): Promise<void> {
    this.active = true;
    if (name) {
      const info = this.game.code.byName(decodeURIComponent(name));
      if (info && this.st.current?.hash !== info.hash) {
        this.mapSel.value = String(info.hash);
        await this.openMap(info.hash);
      }
    }
    this.setMode(this.mode);
  }

  /** Another page was shown. */
  hide(): void {
    this.active = false;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.unsubscribe();
    clearTimeout(this.validateTimer);
    this.factory?.dispose();
  }

  /** Builds the editor and opens the first map (the one in the URL, else D01B02001). */
  private async init(): Promise<void> {
    const { game, st } = this;
    const ctl = this.ctl;
    this.inspector.book = this.session.book;
    this.inspector.sounds = this.session.sounds;
    this.inspector.objectName = (row) => this.v3!.objectName(row);
    this.addPanel.objectName = (row) => this.v3!.objectName(row);
    this.addPanel.loadObjects = (rows) => this.v3!.loadObjects(rows);
    this.addPanel.objectThumb = (row) => this.v3!.objectThumb(row);
    this.inspector.gotoRecord = async (map, section, index) => {
      if (st.current?.hash !== map) {
        this.mapSel.value = String(map);
        await this.openMap(map);
      }
      st.select({ type: 'rec', section, index });
    };
    this.v3.objectContext = () => {
      const doc = st.current;
      return doc ? { master: game.master, events: st.currentEvents, indoor: isIndoor(doc) } : null;
    };

    const mapSel = this.mapSel;
    const header = h('header', {},
      mapSel,
      h('button', { title: '既存のダンジョンに新しいマップ (階) を足す', onclick: () => this.addMap() }, '＋ マップを追加'),
      h('div', { class: 'seg' }, ...(['2d', '3d', 'split'] as ViewMode[]).map((m) =>
        h('button', { 'data-mode': m, onclick: () => this.setMode(m) }, m === '2d' ? '2D' : m === '3d' ? '3D' : '分割'))),
      h('div', { class: 'seg' },
        h('button', { title: '元に戻す (Ctrl+Z)', onclick: () => st.undo(), 'data-act': 'undo' }, '↶ 戻す'),
        h('button', { title: 'やり直す (Ctrl+Y)', onclick: () => st.redo(), 'data-act': 'redo' }, '↷ やり直し'),
      ),
      h('span', { class: 'map-title' }),
      h('span', { class: 'grow' }),
    );

    const tools = h('div', { class: 'tools' },
      ...([
        ['select', '選択・移動', 'V'],
        ['paint', 'タイルを置く', 'B'],
        ['erase', 'タイルを消す', 'E'],
        ['rect', '範囲選択', 'M'],
        ['room', '敵が出ないセル (区画 6)', 'G'],
      ] as [Tool, string, string][]).map(([t, label, key]) =>
        h('button', { 'data-tool': t, title: `${label} (${key})`, onclick: () => st.setTool(t) }, `${label} `, h('kbd', {}, key))),
    );
    const layerBox = (label: string, get: () => boolean, set: (v: boolean) => void, color?: string): HTMLElement => {
      const cb = h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); this.refresh('doc'); } });
      return h('label', { class: 'layer' }, cb, color ? h('span', { class: 'dot', style: `background:${color}` }) : null, ` ${label}`);
    };
    const layers = h('div', { class: 'layers' },
      h('h3', {}, '表示'),
      layerBox('タイル', () => ctl.layers.tiles, (v) => (ctl.layers.tiles = v)),
      layerBox('敵が出ないセル (区画 6)', () => ctl.layers.room, (v) => (ctl.layers.room = v), 'rgba(80,200,255,0.6)'),
      ...POINT_SECTIONS.map((k) => layerBox(LAYOUTS[k]!.label, () => ctl.layers.sections[k]!, (v) => (ctl.layers.sections[k] = v), SECTION_COLORS[k])),
      h('h3', {}, '2D'),
      h('div', { class: 'seg' },
        h('button', { onclick: () => { this.v2!.style = 'symbols'; this.v2!.draw(); } }, '記号'),
        h('button', { onclick: () => { this.v2!.style = 'minimap'; this.v2!.draw(); } }, 'ミニマップ風'),
        h('button', { onclick: () => this.v2!.fit() }, '全体'),
      ),
      h('h3', {}, '3D'),
      h('label', { class: 'layer' },
        h('input', { type: 'checkbox', checked: false, onchange: (e: Event) => this.v3!.setCeilingVisible((e.target as HTMLInputElement).checked) }),
        ' 天井を表示'),
      h('label', { class: 'field' }, h('span', {}, '高さで切る (右端 = 切らない)'),
        h('input', { type: 'range', min: 20, max: 400, value: this.clipHeight, oninput: (e: Event) => {
          this.clipHeight = Number((e.target as HTMLInputElement).value);
          this.v3!.setClip(this.clipHeight >= 400 ? null : this.clipHeight);
        } })),
      h('div', { class: 'seg' },
        h('button', { onclick: () => this.v3!.fit() }, '全体'),
        h('button', { onclick: () => this.v3!.topView() }, '真上'),
      ),
      h('label', { class: 'layer' },
        h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => { this.v3!.showObjects = (e.target as HTMLInputElement).checked; this.v3!.sync(); } }),
        ' オブジェクトのモデル (階段・扉・宝箱・NPC など)'),
      h('p', { class: 'muted small' }, '3D: 右ドラッグで回転、中ドラッグで移動、ホイールで拡大。2D: 右 / 中ドラッグで移動。'),
    );

    const views = h('div', { class: 'views' }, h('div', { class: 'pane pane2d' }, this.v2.canvas), h('div', { class: 'pane pane3d' }, this.v3.canvas));
    const left = h('aside', { class: 'left' }, tools, this.addPanel.el, this.palette.el, layers);
    const right = h('aside', { class: 'right' }, this.inspector.el, h('h3', {}, '検証'), this.issuesEl);
    this.el.append(header, left, views, right, this.status);
    fillMapSelect(mapSel, game, 0, false, true);
    // Event tables of every dungeon (treasure sharing, validation); small files.
    for (const d of new Set(game.editableMaps().map((m) => m.dungeon)))
      game.eventTable(d).then((t) => {
        if (t && !st.events.has(d)) st.events.set(d, t);
      });

    this.unsubscribe = st.on((what) => this.refresh(what));
    ctl.onHover = () => {
      this.v2!.draw();
      if (this.mode !== '2d') this.v3!.syncOverlayOnly();
      this.updateStatus();
    };
    window.addEventListener('keydown', this.onKey);
    this.setMode(this.mode);
    const wanted = location.hash.match(/^#\/map\/(.+)$/)?.[1];
    const first = (wanted && game.code.byName(decodeURIComponent(wanted))) || game.code.byName('D01B02001') || game.editableMaps()[0]!;
    mapSel.value = String(first.hash);
    await this.openMap(first.hash);
  }

  private addMap(): void {
    openNewMapDialog(this.session, this.st.info?.dungeon ?? null, (m) => {
      clear(this.mapSel);
      fillMapSelect(this.mapSel, this.game, m.hash, false, true);
      this.markModified();
      void this.openMap(m.hash);
    });
  }

  private setMode(m: ViewMode): void {
    this.mode = m;
    this.el.setAttribute('data-mode', m);
    this.el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    requestAnimationFrame(() => {
      this.v2?.draw();
      this.v3?.sync();
    });
  }

  private async openMap(hash: number): Promise<void> {
    const { game, st } = this;
    const info = game.code.byHash(hash);
    if (!info) return;
    const events = await game.eventTable(info.dungeon);
    if (events && !st.events.has(info.dungeon)) st.events.set(info.dungeon, events);
    st.open(info);
    this.v2!.fit();
    const title = this.el.querySelector('.map-title');
    if (title) title.textContent = '';
    this.setStatus(`${info.name} のモデルを読み込み中…`);
    try {
      const set = await loadTilesetModels(game, st.ref!);
      if (st.current?.hash !== hash) return;
      this.factory?.dispose();
      this.factory = new ModelFactory(set);
      this.v3!.setFactory(this.factory);
      this.palette!.setFactory(this.factory);
      this.v3!.fit();
      this.setStatus(set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '');
    } catch (err) {
      console.error(err);
      this.v3!.setFactory(null);
      this.setStatus(`モデルを読み込めませんでした (記号で表示します): ${(err as Error).message}`);
    }
  }

  private refresh(what: 'doc' | 'selection' | 'tool' | 'map'): void {
    const st = this.st;
    if (what === 'map') {
      this.palette!.render();
      this.v3!.setFactory(this.factory);
    }
    if (what === 'doc' || what === 'map') {
      this.v3!.sync();
      this.session.scheduleSave();
      this.scheduleValidate();
    }
    if (what === 'selection') this.v3!.syncSelection();
    if (what === 'tool' || what === 'doc' || what === 'map') this.addPanel!.render();
    if (what === 'map') this.addPanel!.loadTemplates();
    if (what === 'tool') {
      this.palette!.render();
      this.v3!.syncOverlayOnly();
      this.el.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === st.tool));
    }
    this.v2!.draw();
    this.inspector!.render();
    const u = this.el.querySelector<HTMLButtonElement>('[data-act=undo]');
    const r = this.el.querySelector<HTMLButtonElement>('[data-act=redo]');
    if (u) u.disabled = !st.canUndo();
    if (r) r.disabled = !st.canRedo();
    this.markModified();
    this.updateStatus();
  }

  private markModified(): void {
    const st = this.st;
    const modified = new Set(st.modifiedDocs().map((d) => d.hash));
    for (const [d, t] of st.events) if (t.changed()) for (const m of st.game.editableMaps()) if (m.dungeon === d) modified.add(m.hash);
    this.mapSel.querySelectorAll<HTMLOptionElement>('option').forEach((o) => {
      const name = o.textContent!.replace(/^\* /, '');
      o.textContent = (modified.has(Number(o.value)) ? '* ' : '') + name;
    });
  }

  private statusMsg = '';
  setStatus(msg: string): void {
    this.statusMsg = msg;
    this.updateStatus();
  }
  private updateStatus(): void {
    const st = this.st;
    const hv = this.ctl?.hover;
    const parts = [];
    if (hv) parts.push(`セル (${hv[0]}, ${hv[1]})`);
    if (st) parts.push(`ツール: ${st.tool}`);
    if (st?.clip) parts.push(`コピー ${st.clip.w}×${st.clip.h}`);
    if (this.statusMsg) parts.push(this.statusMsg);
    if (st?.error) {
      parts.push(`⚠ ${st.error}`);
      st.error = '';
    }
    this.status.textContent = parts.join('   ');
  }

  private scheduleValidate(): void {
    clearTimeout(this.validateTimer);
    this.validateTimer = window.setTimeout(() => this.renderIssues(), 250);
  }

  private renderIssues(): void {
    const st = this.st;
    const doc = st.current;
    if (!doc) return;
    const issues = validate(this.game, doc, st.tileset, st.docs, st.currentEvents);
    clear(this.issuesEl);
    if (!issues.length) {
      this.issuesEl.append(h('div', { class: 'ok' }, '問題なし'));
      return;
    }
    for (const i of issues)
      this.issuesEl.append(
        h('div', { class: `issue ${i.level}`, onclick: () => i.target && st.select(i.target) }, i.level === 'error' ? '✖ ' : '⚠ ', i.msg),
      );
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const st = this.st;
    const ctl = this.ctl;
    if (!this.active) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const mod = e.ctrlKey || e.metaKey;
    const letters = st.game.master.palette(st.tileset).get(st.brush.kind) ?? [0];
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) st.undo();
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) st.redo();
    else if (mod && e.key.toLowerCase() === 'c') ctl.copy();
    else if (mod && e.key.toLowerCase() === 'v') ctl.paste();
    else if (mod && e.key.toLowerCase() === 'd') ctl.duplicateRec();
    else if (mod) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') ctl.deleteSelection();
    else if (e.key === 'r' || e.key === 'R') ctl.rotate(e.shiftKey ? -1 : 1);
    else if (e.key === '[') ctl.cycleLetter(letters, -1);
    else if (e.key === ']') ctl.cycleLetter(letters, 1);
    else if (e.key === 'v') st.setTool('select');
    else if (e.key === 'b') st.setTool('paint');
    else if (e.key === 'e') st.setTool('erase');
    else if (e.key === 'm') st.setTool('rect');
    else if (e.key === 'g') st.setTool('room');
    else if (e.key === 'Escape') {
      if (st.tool === 'place') st.setTool('select');
      else st.select({ type: 'none' });
    }
    else if (e.key.startsWith('Arrow') && (e.shiftKey || st.selection.type === 'rec')) {
      const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key] as [number, number];
      ctl.shiftSelection(d[0], d[1]);
    } else return;
    e.preventDefault();
  };
}
