// The map editor: map list, 2D / 3D views, tools, palette, inspector, validation. The views are canvases owned
// here; the header and the panes around them are React (src/editor/panes.tsx), rendered into this element, which
// the shell places in the map page.
import { loadTilesetModels } from '../cgfx/loader';
import { ModelFactory } from '../cgfx/three';
import type { Game } from '../game/game';
import { isIndoor } from '../game/objects';
import type { Session } from '../session';
import { mountReact } from '../ui/mount';
import { Signal } from '../ui/useEditorState';
import { Controller } from './controller';
import { h } from './dom';
import { MapEditorUi } from './panes';
import type { EditorState } from './state';
import { validate, type Issue } from './validate';
import { View2D } from './view2d';
import { View3D } from './view3d';

export type ViewMode = '2d' | '3d' | 'split';

export class MapEditor {
  readonly el = h('div', { class: 'app' });
  readonly game: Game;
  readonly st: EditorState;
  readonly ctl: Controller;
  readonly v2: View2D;
  readonly v3: View3D;
  /** The two view panes (placed between the React panes). */
  readonly views: HTMLElement;
  /** Emitted when what the panes show besides the edit state changes (view mode, models, status, issues). */
  readonly ui = new Signal();
  /** Emitted when the hovered cell changes (the status bar). */
  readonly hover = new Signal();
  factory: ModelFactory | null = null;
  /** Map hash + model source the factory was built for (to reload when the tileset changes). */
  private factoryKey = '';
  private factoryLoad: Promise<void> = Promise.resolve();
  mode: ViewMode = 'split';
  clipHeight = 400;
  statusMsg = '';
  /** The last edit's error, shown in the status bar until the mouse moves. */
  errorMsg = '';
  issues: Issue[] = [];
  private validateTimer = 0;
  /** The map page is shown (keyboard shortcuts work only then). */
  private active = false;
  private unsubscribe = (): void => {};
  private readonly renderUi = mountReact(this.el);

  private constructor(readonly session: Session) {
    this.game = session.game;
    this.st = session.st;
    this.ctl = new Controller(this.st);
    this.v2 = new View2D(this.st, this.ctl);
    this.v3 = new View3D(this.st, this.ctl);
    this.views = h('div', { class: 'views' }, h('div', { class: 'pane pane2d' }, this.v2.canvas), h('div', { class: 'pane pane3d' }, this.v3.canvas));
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
      if (info && this.st.current?.hash !== info.hash) await this.openMap(info.hash);
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
    this.renderUi(null);
    clearTimeout(this.validateTimer);
    this.factory?.dispose();
  }

  /** Builds the editor and opens the first map (the one in the URL, else D01B02001). */
  private async init(): Promise<void> {
    const { game, st } = this;
    this.v3.objectContext = () => {
      const doc = st.current;
      return doc ? { master: game.master, events: st.currentEvents, indoor: isIndoor(doc) } : null;
    };
    this.renderUi(<MapEditorUi editor={this} />);
    // Event tables of every dungeon (treasure sharing, validation); small files.
    for (const d of new Set(game.editableMaps().map((m) => m.dungeon)))
      game.eventTable(d).then((t) => {
        if (t && !st.events.has(d)) {
          st.events.set(d, t);
          this.ui.emit();
        }
      });

    this.unsubscribe = st.on((what) => this.refresh(what));
    this.ctl.onHover = () => {
      this.v2.draw();
      if (this.mode !== '2d') this.v3.syncOverlayOnly();
      this.errorMsg = '';
      this.hover.emit();
    };
    window.addEventListener('keydown', this.onKey);
    this.setMode(this.mode);
    const wanted = location.hash.match(/^#\/map\/(.+)$/)?.[1];
    const first = (wanted && game.code.byName(decodeURIComponent(wanted))) || game.code.byName('D01B02001') || game.editableMaps()[0]!;
    await this.openMap(first.hash);
  }

  setMode(m: ViewMode): void {
    this.mode = m;
    this.el.setAttribute('data-mode', m);
    this.ui.emit();
    requestAnimationFrame(() => {
      this.v2.draw();
      this.v3.sync();
    });
  }

  setClipHeight(v: number): void {
    this.clipHeight = v;
    this.v3.setClip(v >= 400 ? null : v);
    this.ui.emit();
  }

  /** Redraw both views after a display setting changed. */
  redraw(): void {
    this.v2.draw();
    this.v3.sync();
    this.ui.emit();
  }

  /** Open a map and select one of its records. */
  async gotoRecord(map: number, section: number, index: number): Promise<void> {
    if (this.st.current?.hash !== map) await this.openMap(map);
    this.st.select({ type: 'rec', section, index });
  }

  /** Maps with edits (their sections, or their dungeon's event table). */
  modifiedMaps(): Set<number> {
    const st = this.st;
    const modified = new Set(st.modifiedDocs().map((d) => d.hash));
    for (const [d, t] of st.events) if (t.changed()) for (const m of st.game.editableMaps()) if (m.dungeon === d) modified.add(m.hash);
    return modified;
  }

  async openMap(hash: number): Promise<void> {
    const { game, st } = this;
    const info = game.code.byHash(hash);
    if (!info) return;
    const events = await game.eventTable(info.dungeon);
    if (events && !st.events.has(info.dungeon)) st.events.set(info.dungeon, events);
    st.open(info);
    this.v2.fit();
    await this.loadModels();
    this.v3.fit();
  }

  /** Tile models of the open map's current tileset (reloaded when the tileset is switched in the inspector). */
  private loadModels(): Promise<void> {
    const { game, st } = this;
    const doc = st.current;
    if (!doc || !st.ref) return Promise.resolve();
    const src = game.tilesetSource(st.ref, st.tileset);
    const key = `${doc.hash}/${src.modelArchive}/${src.textureEntry}`;
    if (key !== this.factoryKey) {
      this.factoryKey = key;
      this.factoryLoad = this.buildFactory(key);
    }
    return this.factoryLoad;
  }

  private async buildFactory(key: string): Promise<void> {
    const { game, st } = this;
    const stale = () => this.factoryKey !== key;
    this.setStatus(`${st.info?.name ?? st.current!.name} のモデルを読み込み中…`);
    try {
      const set = await loadTilesetModels(game, st.ref!, st.tileset);
      if (stale()) return;
      this.factory?.dispose();
      this.factory = new ModelFactory(set);
      this.v3.setFactory(this.factory);
      this.setStatus(set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '');
    } catch (err) {
      if (stale()) return;
      this.factoryKey = ''; // try again on the next open or tileset change
      console.error(err);
      this.v3.setFactory(null);
      this.setStatus(`モデルを読み込めませんでした (記号で表示します): ${(err as Error).message}`);
    }
  }

  private refresh(what: 'doc' | 'selection' | 'tool' | 'map'): void {
    const st = this.st;
    if (what === 'map') {
      this.v3.setFactory(this.factory);
      void this.loadModels();
    }
    if (what === 'doc' || what === 'map') {
      this.v3.sync();
      this.session.scheduleSave();
      this.scheduleValidate();
    }
    if (what === 'selection') this.v3.syncSelection();
    if (what === 'tool') this.v3.syncOverlayOnly();
    this.v2.draw();
    if (st.error) {
      this.errorMsg = st.error;
      st.error = '';
      this.ui.emit();
    }
  }

  setStatus(msg: string): void {
    this.statusMsg = msg;
    this.ui.emit();
  }

  private scheduleValidate(): void {
    clearTimeout(this.validateTimer);
    this.validateTimer = window.setTimeout(() => {
      const st = this.st;
      const doc = st.current;
      if (!doc) return;
      this.issues = validate(this.game, doc, st.tileset, st.docs, st.currentEvents);
      this.ui.emit();
    }, 250);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const st = this.st;
    const ctl = this.ctl;
    if (!this.active || document.querySelector('dialog[open]')) return;
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
