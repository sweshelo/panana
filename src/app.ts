// Application shell: loading a dump, map list, views, tools, export.
import { loadTilesetModels } from './cgfx/loader';
import { ModelFactory } from './cgfx/three';
import { Controller } from './editor/controller';
import { clear, h } from './editor/dom';
import { Inspector } from './editor/inspector';
import { SECTION_COLORS } from './editor/legend';
import { Palette } from './editor/palette';
import { AddPanel } from './editor/addpanel';
import { EditorState, type Tool } from './editor/state';
import { validate, type Issue } from './editor/validate';
import { fillMapSelect, mapLabel } from './editor/labels';
import { isIndoor } from './game/objects';
import { mapTitle } from './game/names';
import { MASTER_ARCHIVE } from './game/master';
import { View2D } from './editor/view2d';
import { View3D } from './editor/view3d';
import { buildModFiles, buildModZip, modPackage } from './export/pack';
import { Game } from './game/game';
import { MapDb, MAPDB_ARCHIVE } from './game/mapdb';
import { LAYOUTS, loadDoc, POINT_SECTIONS, sectionBytes } from './game/sections';
import { cachedDumpInfo, openCachedDump, saveDumpCache } from './rom/cache';
import { baseModFromFiles, openFolder, openImage, TITLE_ID, type BaseMod, type Dump } from './rom/dump';
import { idbClear, idbGet, idbSet } from './util/idb';

type ViewMode = '2d' | '3d' | 'split';
const EDITS_KEY = 'edits/v2';
const BASEMOD_KEY = 'basemod/v1';

type SavedBaseMod = { label: string; romfs: [string, Uint8Array][]; ips: Uint8Array | null };

export class App {
  private game: Game | null = null;
  /** The dump as opened (without the base MOD). */
  private rawDump: Dump | null = null;
  private st: EditorState | null = null;
  private ctl: Controller | null = null;
  private v2: View2D | null = null;
  private v3: View3D | null = null;
  private palette: Palette | null = null;
  private addPanel: AddPanel | null = null;
  private inspector: Inspector | null = null;
  private factory: ModelFactory | null = null;
  private mode: ViewMode = 'split';
  private clipHeight = 400;
  private readonly root: HTMLElement;
  private status = h('div', { class: 'status' });
  private issuesEl = h('div', { class: 'issues' });
  private saveTimer = 0;
  private validateTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.showStart();
  }

  // ---------------------------------------------------------------- start screen

  private async showStart(error?: string): Promise<void> {
    clear(this.root);
    const cached = await cachedDumpInfo();
    const fileInput = h('input', { type: 'file', accept: '.cia,.cxi,.app,.bin', onchange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) this.load(() => openImage(f, f.name));
    } });
    const dirInput = h('input', { type: 'file', onchange: (e: Event) => {
      const files = [...((e.target as HTMLInputElement).files ?? [])];
      if (files.length) this.load(() => openFolder(files, files[0]!.webkitRelativePath.split('/')[0] ?? 'folder'));
    } });
    dirInput.setAttribute('webkitdirectory', '');
    const drop = h('div', { class: 'drop' }, 'ここに .cia / .cxi をドロップ');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) this.load(() => openImage(f, f.name));
    });
    this.root.append(
      h('div', { class: 'start' },
        h('h1', {}, '電波人間のRPG2 マップエディタ'),
        h('p', {}, `v1.1.0 (${TITLE_ID}) のダンジョンのマップを編集し、LayeredFS 用の MOD として書き出します。`),
        h('p', { class: 'muted' }, 'ROM のデータはブラウザの中だけで読み取ります (どこにも送信しません)。読み取った一部のファイルは、この端末の IndexedDB にキャッシュします。'),
        error ? h('div', { class: 'error' }, error) : null,
        h('div', { class: 'choices' },
          h('label', { class: 'choice' }, h('b', {}, '復号済みの CIA / CXI'), h('span', { class: 'muted' }, 'GodMode9 などで復号したダンプ'), fileInput),
          h('label', { class: 'choice' }, h('b', {}, '展開済みのフォルダ'), h('span', { class: 'muted' }, 'RomFS のファイル (A90C8038 など) と code.bin を含むフォルダ'), dirInput),
          cached
            ? h('div', { class: 'choice' },
                h('b', {}, '前回のダンプ'),
                h('span', { class: 'muted' }, `${cached.label} (${new Date(cached.savedAt).toLocaleString()})`),
                h('div', { class: 'row' },
                  h('button', { class: 'primary', onclick: () => this.load(async () => (await openCachedDump())!) }, 'キャッシュから開く'),
                  h('button', { onclick: async () => { await idbClear(); this.showStart(); } }, 'キャッシュを消す'),
                ),
              )
            : null,
        ),
        drop,
      ),
    );
  }

  private async load(open: () => Promise<Dump>): Promise<void> {
    clear(this.root);
    this.root.append(h('div', { class: 'start' }, h('p', {}, '読み込み中…')));
    try {
      const dump = await open();
      if (dump.titleVersion !== undefined && dump.titleVersion !== 1040)
        throw new Error(`TitleVersion が ${dump.titleVersion} です。このエディタは v1.1.0 (1040) 専用です。`);
      this.rawDump = dump;
      const game = await Game.load(dump, await this.savedBaseMod());
      if (!dump.label.endsWith('(キャッシュ)')) saveDumpCache(dump, (await Game.load(dump)).neededFiles()).catch(() => {});
      this.game = game;
      await this.showEditor();
    } catch (err) {
      console.error(err);
      this.showStart((err as Error).message);
    }
  }

  // ---------------------------------------------------------------- editor

  private async showEditor(autoRestore = false): Promise<void> {
    const game = this.game!;
    const st = new EditorState(game);
    const ctl = new Controller(st);
    this.st = st;
    this.ctl = ctl;
    this.v2 = new View2D(st, ctl);
    this.v3 = new View3D(st, ctl);
    this.palette = new Palette(st);
    this.inspector = new Inspector(st, ctl);
    this.addPanel = new AddPanel(st);

    await this.restoreEdits(autoRestore);
    this.inspector.objectName = (row) => this.v3!.objectName(row);
    this.addPanel.objectName = (row) => this.v3!.objectName(row);
    this.inspector.gotoRecord = async (map, section, index) => {
      if (st.current?.hash !== map) {
        const sel = this.root.querySelector<HTMLSelectElement>('.map-select');
        if (sel) sel.value = String(map);
        await this.openMap(map);
      }
      st.select({ type: 'rec', section, index });
    };
    this.v3.objectContext = () => {
      const doc = st.current;
      return doc ? { master: game.master, events: st.currentEvents, indoor: isIndoor(doc) } : null;
    };

    clear(this.root);
    const mapSel = h('select', { class: 'map-select', onchange: (e: Event) => this.openMap(Number((e.target as HTMLSelectElement).value)) });
    const header = h('header', {},
      h('b', { class: 'title' }, 'マップエディタ'),
      mapSel,
      h('div', { class: 'seg' }, ...(['2d', '3d', 'split'] as ViewMode[]).map((m) =>
        h('button', { 'data-mode': m, onclick: () => this.setMode(m) }, m === '2d' ? '2D' : m === '3d' ? '3D' : '分割'))),
      h('div', { class: 'seg' },
        h('button', { title: '元に戻す (Ctrl+Z)', onclick: () => st.undo(), 'data-act': 'undo' }, '↶ 戻す'),
        h('button', { title: 'やり直す (Ctrl+Y)', onclick: () => st.redo(), 'data-act': 'redo' }, '↷ やり直し'),
      ),
      h('span', { class: 'map-title' }),
      h('span', { class: 'grow' }),
      h('span', { class: 'muted small' }, game.dump.label),
      h('button', { class: 'base-btn', title: '既存の MOD (elpulse の mod/out など: romfs のファイルと code.ips) を土台にします。書き出しにはその MOD の全ファイルが入ります', onclick: () => this.pickBaseMod() }, ''),
      h('button', { class: 'primary', onclick: () => this.showExport() }, '書き出し…'),
      h('button', { onclick: () => this.showStart() }, 'ダンプを変える'),
    );

    const tools = h('div', { class: 'tools' },
      ...([
        ['select', '選択・移動', 'V'],
        ['paint', 'タイルを置く', 'B'],
        ['erase', 'タイルを消す', 'E'],
        ['rect', '範囲選択', 'M'],
        ['room', '部屋のセル (区画 6)', 'G'],
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
      layerBox('部屋のセル (区画 6)', () => ctl.layers.room, (v) => (ctl.layers.room = v), 'rgba(80,200,255,0.6)'),
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
    this.root.append(h('div', { class: 'app' }, header, left, views, right, this.status));
    fillMapSelect(mapSel, game, 0, false, true);
    this.updateBaseUi();
    // Event tables of every dungeon (treasure sharing, validation); small files.
    for (const d of new Set(game.editableMaps().map((m) => m.dungeon)))
      game.eventTable(d).then((t) => {
        if (t && !st.events.has(d)) st.events.set(d, t);
      });

    st.on((what) => this.refresh(what));
    ctl.onHover = () => {
      this.v2!.draw();
      if (this.mode !== '2d') this.v3!.syncOverlayOnly();
      this.updateStatus();
    };
    this.bindKeys();
    this.setMode(this.mode);
    const first = game.code.byName('D01B02001') ?? game.editableMaps()[0]!;
    mapSel.value = String(first.hash);
    await this.openMap(first.hash);
  }

  private setMode(m: ViewMode): void {
    this.mode = m;
    const app = this.root.querySelector('.app');
    app?.setAttribute('data-mode', m);
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    requestAnimationFrame(() => {
      this.v2?.draw();
      this.v3?.sync();
    });
  }

  private async openMap(hash: number): Promise<void> {
    const game = this.game!;
    const st = this.st!;
    const info = game.code.byHash(hash);
    if (!info) return;
    const events = await game.eventTable(info.dungeon);
    if (events && !st.events.has(info.dungeon)) st.events.set(info.dungeon, events);
    st.open(info);
    this.v2!.fit();
    const title = this.root.querySelector('.map-title');
    if (title) title.textContent = '';
    this.setStatus(`${info.name} のモデルを読み込み中…`);
    try {
      const set = await loadTilesetModels(game, info.dungeon);
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
    const st = this.st!;
    if (what === 'map') {
      this.palette!.render();
      this.v3!.setFactory(this.factory);
    }
    if (what === 'doc' || what === 'map') {
      this.v3!.sync();
      this.scheduleSave();
      this.scheduleValidate();
    }
    if (what === 'selection') this.v3!.syncSelection();
    if (what === 'tool' || what === 'doc' || what === 'map') this.addPanel!.render();
    if (what === 'map') this.addPanel!.loadTemplates();
    if (what === 'tool') {
      this.palette!.render();
      this.v3!.syncOverlayOnly();
      this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === st.tool));
    }
    this.v2!.draw();
    this.inspector!.render();
    const u = this.root.querySelector<HTMLButtonElement>('[data-act=undo]');
    const r = this.root.querySelector<HTMLButtonElement>('[data-act=redo]');
    if (u) u.disabled = !st.canUndo();
    if (r) r.disabled = !st.canRedo();
    this.markModified();
    this.updateStatus();
  }

  private markModified(): void {
    const st = this.st!;
    const modified = new Set(st.modifiedDocs().map((d) => d.hash));
    for (const [d, t] of st.events) if (t.changed()) for (const m of st.game.editableMaps()) if (m.dungeon === d) modified.add(m.hash);
    this.root.querySelectorAll<HTMLOptionElement>('.map-select option').forEach((o) => {
      const name = o.textContent!.replace(/^\* /, '');
      o.textContent = (modified.has(Number(o.value)) ? '* ' : '') + name;
    });
  }

  private statusMsg = '';
  private setStatus(msg: string): void {
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
    const st = this.st!;
    const doc = st.current;
    if (!doc) return;
    const issues = validate(this.game!, doc, st.tileset, st.docs, st.currentEvents);
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

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const st = this.st;
      const ctl = this.ctl;
      if (!st || !ctl) return;
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
    });
  }

  // ---------------------------------------------------------------- persistence of edits

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }

  private saveNow(): void {
    clearTimeout(this.saveTimer);
    {
      const st = this.st!;
      const maps: Record<number, Record<number, Uint8Array>> = {};
      for (const d of st.modifiedDocs()) {
        const secs: Record<number, Uint8Array> = {};
        for (const k of st.changedSections(d)) secs[k] = sectionBytes(d, k);
        maps[d.hash] = secs;
      }
      const events: Record<number, Uint8Array> = {};
      for (const [d, t] of st.events) if (t.changed()) events[d] = t.data;
      const master = st.game.master;
      idbSet(EDITS_KEY, { maps, events, treasure: master.treasureChanged() ? master.treasureGroup.data : null });
    }
  }

  private async restoreEdits(auto = false): Promise<void> {
    type Saved = { maps: Record<number, Record<number, Uint8Array>>; events: Record<number, Uint8Array>; treasure: Uint8Array | null };
    const edits = await idbGet<Saved>(EDITS_KEY);
    if (!edits) return;
    const game = this.game!;
    const names = Object.keys(edits.maps).map((h) => mapLabel(game, Number(h)));
    const nEvents = Object.keys(edits.events).length;
    if (!names.length && !nEvents && !edits.treasure) return;
    const what = [names.join(', '), nEvents ? `イベントの表 ${nEvents} 個` : '', edits.treasure ? '宝箱の中身' : ''].filter(Boolean).join(' / ');
    if (!auto && !confirm(`前回の編集が残っています (${what})。読み込みますか?\n「キャンセル」で破棄します。`)) {
      await idbSet(EDITS_KEY, null);
      return;
    }
    const tmp = new MapDb(game.dbBytes);
    for (const [hash, secs] of Object.entries(edits.maps)) {
      const info = game.code.byHash(Number(hash));
      if (!info) continue;
      for (const [k, bytes] of Object.entries(secs)) tmp.set(info.sections[Number(k)]!, bytes);
      this.st!.docs.set(info.hash, loadDoc(tmp, info));
    }
    for (const [d, bytes] of Object.entries(edits.events)) {
      const t = await game.eventTable(Number(d));
      if (t) {
        t.restore(bytes);
        this.st!.events.set(Number(d), t);
      }
    }
    if (edits.treasure) game.master.restoreTreasure(edits.treasure);
  }

  // ---------------------------------------------------------------- base MOD (elpulse mod/out)

  private updateBaseUi(): void {
    const game = this.game!;
    const b = this.root.querySelector('.base-btn');
    if (b) b.textContent = `土台の MOD: ${game.baseMod?.label ?? 'なし'}${game.switchVersion ? ' (汎用スイッチあり)' : ''}`;
  }

  private async savedBaseMod(): Promise<BaseMod | null> {
    const s = await idbGet<SavedBaseMod>(BASEMOD_KEY);
    return s ? { label: s.label, romfs: new Map(s.romfs), ips: s.ips } : null;
  }

  /** Reload the game with another base MOD, keeping the edits (they are saved first). */
  private async reloadWith(mod: BaseMod | null): Promise<void> {
    await idbSet(BASEMOD_KEY, mod ? { label: mod.label, romfs: [...mod.romfs], ips: mod.ips } satisfies SavedBaseMod : null);
    this.saveNow();
    this.game = await Game.load(this.rawDump!, mod);
    await this.showEditor(true);
    this.setStatus(mod ? `土台の MOD: ${mod.label}` : '土台の MOD を外しました');
  }

  private pickBaseMod(): void {
    const game = this.game!;
    if (game.baseMod && confirm(`今の土台: ${game.baseMod.label}\n外しますか? (「キャンセル」で別のフォルダを選ぶ)`)) {
      this.reloadWith(null);
      return;
    }
    const input = h('input', { type: 'file' });
    input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      try {
        const label = files[0]!.webkitRelativePath.split('/')[0] || 'MOD';
        const mod = baseModFromFiles(label, await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
        await this.reloadWith(mod);
      } catch (err) {
        alert(`MOD として読めませんでした: ${(err as Error).message}`);
      }
    });
    input.click();
  }

  // ---------------------------------------------------------------- export

  private showExport(): void {
    const st = this.st!;
    const game = this.game!;
    const docs = st.modifiedDocs();
    const events = [...st.events.values()].filter((t) => t.changed());
    const treasure = game.master.treasureChanged();
    const issues: { map: string; issue: Issue }[] = [];
    for (const d of docs) {
      const info = game.code.byHash(d.hash)!;
      for (const i of validate(game, d, game.master.tileset(d.dungeon), st.docs, st.events.get(d.dungeon) ?? null))
        issues.push({ map: mapTitle(info, game.code.maps, game.master), issue: i });
    }
    const errors = issues.filter((i) => i.issue.level === 'error').length;
    const close = (): void => dlg.remove();
    const out = h('div', { class: 'export-result' });
    const build = (): Map<string, Uint8Array> | null => {
      try {
        const files = buildModFiles(game, docs, events, treasure);
        const pkg = modPackage(game, files);
        out.textContent = `書き出すファイル: ${[...pkg].map(([n, b]) => `${n}${files.has(n.replace('romfs/', '')) ? ' (変更)' : ''} ${(b.length / 1024).toFixed(0)} KB`).join('、') || 'なし'}`;
        return pkg;
      } catch (err) {
        out.textContent = `書き出せませんでした: ${(err as Error).message}`;
        return null;
      }
    };
    const download = (data: Uint8Array, name: string): void => {
      const url = URL.createObjectURL(new Blob([data as BlobPart]));
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    const canFs = 'showDirectoryPicker' in window;
    const changes: string[] = docs.map((d) => `${mapLabel(game, d.hash)} (区画 ${st.changedSections(d).join(', ')})`);
    for (const t of events) changes.push(`${game.master.dungeonName(t.dungeon)} のイベントの表 (${t.archiveName})`);
    if (treasure) changes.push(`宝箱の中身 (${MASTER_ARCHIVE})`);
    const dlg = h('div', { class: 'modal' },
      h('div', { class: 'dialog' },
        h('h2', {}, '書き出し'),
        changes.length ? h('div', {}, `変更: ${changes.join('、')}`) : h('div', { class: 'muted' }, '変更はありません。'),
        issues.length
          ? h('div', { class: 'issues' }, ...issues.map(({ map, issue }) => h('div', { class: `issue ${issue.level}` }, `${issue.level === 'error' ? '✖' : '⚠'} ${map}: ${issue.msg}`)))
          : h('div', { class: 'ok' }, '検証: 問題なし'),
        errors ? h('div', { class: 'error' }, `エラーが ${errors} 件あります。このまま書き出すとゲームが正しく動かないおそれがあります。`) : '',
        game.baseMod
          ? h('div', { class: 'muted' }, `土台の MOD「${game.baseMod.label}」の全ファイル${game.baseMod.ips ? ' (code.ips を含む)' : ''}も入ります。`)
          : h('div', { class: 'warn-box' }, `アイテム MOD など、ほかの MOD と一緒に使う場合は、ヘッダーの「土台の MOD」でその MOD のフォルダ (elpulse の mod/out など) を読み込んでから書き出してください。同じファイル (${MASTER_ARCHIVE} や code.ips) を置き換える MOD は同時に置けません。`),
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => { const f = build(); if (f?.size) download(buildModZip(f), 'denpa2-map-mod.zip'); } }, 'MOD の zip をダウンロード'),
          canFs ? h('button', { onclick: () => this.writeToFolder(build, out) }, 'MOD フォルダに直接書き込む') : '',
          h('button', { onclick: close }, '閉じる'),
        ),
        out,
        h('div', { class: 'muted small' },
          h('p', {}, `zip の中身: ${TITLE_ID}/romfs/… と ${TITLE_ID}/exefs/code.ips`),
          h('p', {}, 'Azahar: %APPDATA%/Azahar/load/mods/ に展開 (00040000000A7900/romfs/… になるように)。'),
          h('p', {}, 'Luma3DS: SD の /luma/titles/ に展開し、Luma の設定で「Enable game patching」を有効にする。'),
        ),
      ),
    );
    dlg.addEventListener('click', (e) => e.target === dlg && close());
    document.body.append(dlg);
  }

  private async writeToFolder(build: () => Map<string, Uint8Array> | null, out: HTMLElement): Promise<void> {
    const pkg = build();
    if (!pkg?.size) return;
    try {
      const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      let dir = await picker({ mode: 'readwrite' });
      // Accept the mods folder or the title folder.
      if (dir.name.toUpperCase() !== TITLE_ID) dir = await dir.getDirectoryHandle(TITLE_ID, { create: true });
      for (const [path, data] of pkg) {
        const [sub, name] = path.split('/') as [string, string];
        const d = await dir.getDirectoryHandle(sub, { create: true });
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(data as BlobPart);
        await w.close();
      }
      out.textContent += ` 書き込みました: …/${TITLE_ID}/{${[...pkg.keys()].join(', ')}}`;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') out.textContent = `書き込めませんでした: ${(err as Error).message}`;
    }
  }
}
