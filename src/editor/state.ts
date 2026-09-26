// Editing model: one MapDoc per opened map, snapshot-based undo / redo, selection, tools.
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import type { Stamp } from './place';
import type { Game } from '../game/game';
import { cloneDoc, LETTER_DEFAULT, sectionBytes, type MapDoc, type Tile } from '../game/sections';
import { equalBytes } from '../util/bytes';

export type Tool = 'select' | 'paint' | 'erase' | 'rect' | 'room' | 'place';

export type Selection =
  | { type: 'none' }
  | { type: 'tiles'; cells: [number, number][] }
  | { type: 'rec'; section: number; index: number }
  | { type: 'rect'; x0: number; y0: number; x1: number; y1: number };

export interface Brush {
  kind: number;
  letter: number; // byte
  rot: number;
}

export interface Clip {
  w: number;
  h: number;
  tiles: Tile[]; // coordinates relative to the top-left of the copied rectangle
}

export const GRID = 30; // docs/map-editor-design.md §7: limit to 30 x 30

type Listener = (what: 'doc' | 'selection' | 'tool' | 'map') => void;

/** Undo point: the map, plus the tables shared between maps (events of loaded dungeons, treasure). */
interface Snapshot {
  doc: MapDoc;
  events: [number, Uint8Array][];
  treasure: Uint8Array;
}

export class EditorState {
  readonly docs = new Map<number, MapDoc>();
  /** EventObject tables of the dungeons opened so far (edited in place). */
  readonly events = new Map<number, EventTable>();
  private readonly undoStacks = new Map<number, Snapshot[]>();
  private readonly redoStacks = new Map<number, Snapshot[]>();
  current: MapDoc | null = null;
  info: MapInfo | null = null;
  tileset = 0;
  tool: Tool = 'select';
  brush: Brush = { kind: 5, letter: LETTER_DEFAULT, rot: 0 };
  selection: Selection = { type: 'none' };
  clip: Clip | null = null;
  /** What the 'place' tool adds. */
  stamp: Stamp | null = null;
  /** Last error of an edit (shown in the status bar). */
  error = '';
  private listeners: Listener[] = [];

  constructor(readonly game: Game) {}

  on(f: Listener): void {
    this.listeners.push(f);
  }
  emit(what: 'doc' | 'selection' | 'tool' | 'map'): void {
    for (const f of this.listeners) f(what);
  }

  open(info: MapInfo): void {
    let doc = this.docs.get(info.hash);
    if (!doc) {
      doc = this.game.doc(info);
      this.docs.set(info.hash, doc);
    }
    this.current = doc;
    this.info = info;
    this.tileset = this.game.master.tileset(info.dungeon);
    this.selection = { type: 'none' };
    this.emit('map');
  }

  /** Record an undo point, then mutate the current document. */
  edit(f: (doc: MapDoc) => void): void {
    const doc = this.current;
    if (!doc) return;
    this.checkpoint();
    f(doc);
    this.emit('doc');
  }

  get currentEvents(): EventTable | null {
    return this.current ? this.events.get(this.current.dungeon) ?? null : null;
  }

  private snapshot(doc: MapDoc): Snapshot {
    return {
      doc: cloneDoc(doc),
      events: [...this.events].map(([d, t]) => [d, t.data.slice()]),
      treasure: this.game.master.treasureGroup.data.slice(),
    };
  }

  private restore(s: Snapshot): void {
    for (const [d, bytes] of s.events) this.events.get(d)?.restore(bytes);
    this.game.master.restoreTreasure(s.treasure);
  }

  /** Change the shared tables (events / treasure) with an undo point on the current map. */
  editTables(f: () => void): void {
    this.checkpoint();
    f();
    this.emit('doc');
  }

  /** Push an undo snapshot (for drags: call once at the start, then mutate with `touch`). */
  checkpoint(): void {
    const doc = this.current;
    if (!doc) return;
    const u = this.undoStacks.get(doc.hash) ?? [];
    u.push(this.snapshot(doc));
    if (u.length > 200) u.shift();
    this.undoStacks.set(doc.hash, u);
    this.redoStacks.set(doc.hash, []);
  }

  touch(f: (doc: MapDoc) => void): void {
    if (!this.current) return;
    f(this.current);
    this.emit('doc');
  }

  private swap(from: Map<number, Snapshot[]>, to: Map<number, Snapshot[]>): void {
    const doc = this.current;
    if (!doc) return;
    const s = from.get(doc.hash);
    const prev = s?.pop();
    if (!prev) return;
    const t = to.get(doc.hash) ?? [];
    t.push(this.snapshot(doc));
    to.set(doc.hash, t);
    this.restore(prev);
    this.docs.set(doc.hash, prev.doc);
    this.current = prev.doc;
    this.selection = { type: 'none' };
    this.emit('doc');
    this.emit('selection');
  }
  undo(): void {
    this.swap(this.undoStacks, this.redoStacks);
  }
  redo(): void {
    this.swap(this.redoStacks, this.undoStacks);
  }
  canUndo(): boolean {
    return !!this.current && (this.undoStacks.get(this.current.hash)?.length ?? 0) > 0;
  }
  canRedo(): boolean {
    return !!this.current && (this.redoStacks.get(this.current.hash)?.length ?? 0) > 0;
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.emit('tool');
  }
  select(s: Selection): void {
    this.selection = s;
    this.emit('selection');
  }

  /** Section k of an opened map changed compared with the ROM? */
  changedSections(doc: MapDoc): number[] {
    const info = this.game.code.byHash(doc.hash);
    if (!info) return [];
    const out: number[] = [];
    for (let k = 0; k < 10; k++) {
      if (!equalBytes(sectionBytes(doc, k), this.game.db.get(info.sections[k]!))) out.push(k);
    }
    return out;
  }

  modifiedDocs(): MapDoc[] {
    return [...this.docs.values()].filter((d) => this.changedSections(d).length > 0);
  }

  /** Throw away the edits of a map. */
  revert(hash: number): void {
    const info = this.game.code.byHash(hash);
    if (!info) return;
    const doc = this.game.doc(info);
    this.checkpoint();
    this.docs.set(hash, doc);
    if (this.current?.hash === hash) this.current = doc;
    this.emit('doc');
  }
}

// ---- tile helpers
export function tileAt(doc: MapDoc, x: number, y: number): Tile | undefined {
  // The game fills the grid in record order, so the last record for a cell wins.
  for (let i = doc.tiles.length - 1; i >= 0; i--) {
    const t = doc.tiles[i]!;
    if (t.x === x && t.y === y) return t;
  }
  return undefined;
}

export function setTile(doc: MapDoc, x: number, y: number, b: Brush): void {
  const t = tileAt(doc, x, y);
  if (t) {
    t.kind = b.kind;
    t.letter = b.letter;
    t.rot = b.rot & 3;
    return;
  }
  doc.tiles.push({ kind: b.kind, x, y, rot: b.rot & 3, rotHi: 0, letter: b.letter, pad: 0 });
}

export function removeTile(doc: MapDoc, x: number, y: number): boolean {
  const n = doc.tiles.length;
  doc.tiles = doc.tiles.filter((t) => t.x !== x || t.y !== y);
  return doc.tiles.length !== n;
}

export function inGrid(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID && y < GRID;
}
