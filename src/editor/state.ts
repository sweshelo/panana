// Editing model: one MapDoc per opened map, snapshot-based undo / redo, selection, tools. MapEditState is the
// part both games share (RPG3's is src/oahu/mapedit.ts); EditorState adds RPG2's tables (master, event tables).
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import { duplicateRecord, placeStamp, type PlaceContext, type Stamp } from './place';
import type { Game } from '../game/game';
import type { MapRef } from '../game/master';
import { FIX_TABLE } from '../game/boss';
import { cloneDoc, LAYOUTS, LETTER_DEFAULT, POINT_SECTIONS, sectionBytes, type MapDoc, type Rec, type RecordLayout, type Tile } from '../game/sections';
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

export type EditEvent = 'doc' | 'selection' | 'tool' | 'map';
type Listener = (what: EditEvent) => void;

/** Undo point: the map, plus the game's tables shared between maps (what saveTables returns). */
interface Snapshot<T> {
  doc: MapDoc;
  tables: T;
}

/**
 * The editing model shared by RPG2 and RPG3: documents, tools, selection, clipboard and undo / redo. A game says
 * where its records are (layouts, point sections), what else an edit can change (saveTables / restoreTables, kept
 * with every undo point), and how records are added and copied (placeStamp / duplicateRecord).
 */
export abstract class MapEditState<S = unknown, T = unknown> {
  readonly docs = new Map<number, MapDoc>();
  private readonly undoStacks = new Map<number, Snapshot<T>[]>();
  private readonly redoStacks = new Map<number, Snapshot<T>[]>();
  current: MapDoc | null = null;
  /** Tileset of the open map (the palette and the tile models). */
  tileset = 0;
  tool: Tool = 'select';
  brush: Brush = { kind: 5, letter: LETTER_DEFAULT, rot: 0 };
  selection: Selection = { type: 'none' };
  clip: Clip | null = null;
  /** What the 'place' tool adds. */
  stamp: S | null = null;
  /** Last error of an edit (shown in the status bar). */
  error = '';
  /** Bumped on every emit (React components subscribe to it: src/ui/useEditorState.ts). */
  revision = 0;
  private listeners: Listener[] = [];

  /** Record layouts of the sections, by RPG2's section numbers. */
  abstract readonly layouts: Record<number, RecordLayout>;
  /** Sections with positioned records, drawn last first. */
  abstract readonly pointSections: readonly number[];
  /** The tables an edit can change besides the map (copied into every undo point). */
  protected abstract saveTables(): T;
  protected abstract restoreTables(t: T): void;
  /** Add a record for `stamp` at cell coordinates (cx, cy). Returns [section, index]. */
  abstract placeStamp(doc: MapDoc, stamp: S, cx: number, cy: number): [number, number];
  /** A copy of a record (with its own EventObject row when it has one). */
  abstract duplicateRecord(doc: MapDoc, section: number, rec: Rec): Rec;
  /** Whether the records of a section have a facing that `R` turns. */
  canRotate(_section: number): boolean {
    return false;
  }
  /** Turn a record by a quarter (`R`; sections where canRotate). */
  rotateRecord(_rec: Rec, _section: number, _dir: 1 | -1): void {}
  /** A document was replaced (undo / redo): games that keep documents elsewhere put it there. */
  protected docReplaced(_doc: MapDoc): void {}

  /** Returns the function that removes the listener. */
  on(f: Listener): () => void {
    this.listeners.push(f);
    return () => {
      this.listeners = this.listeners.filter((g) => g !== f);
    };
  }
  emit(what: EditEvent): void {
    this.revision++;
    for (const f of [...this.listeners]) f(what);
  }

  /** Record an undo point, then mutate the current document. */
  edit(f: (doc: MapDoc) => void): void {
    const doc = this.current;
    if (!doc) return;
    this.checkpoint();
    f(doc);
    this.emit('doc');
  }

  private snapshot(doc: MapDoc): Snapshot<T> {
    return { doc: cloneDoc(doc), tables: this.saveTables() };
  }

  /** Change the shared tables (events, treasure, messages …) with an undo point on the current map. */
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

  private swap(from: Map<number, Snapshot<T>[]>, to: Map<number, Snapshot<T>[]>): void {
    const doc = this.current;
    if (!doc) return;
    const s = from.get(doc.hash);
    const prev = s?.pop();
    if (!prev) return;
    const t = to.get(doc.hash) ?? [];
    t.push(this.snapshot(doc));
    to.set(doc.hash, t);
    this.restoreTables(prev.tables);
    this.docs.set(doc.hash, prev.doc);
    this.current = prev.doc;
    this.docReplaced(prev.doc);
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
}

/** RPG2's shared tables of an undo point (events of loaded dungeons, treasure, …). */
interface KaharaTables {
  events: [number, Uint8Array][];
  treasure: Uint8Array;
  mapData: Uint8Array;
  /** monsterFixGroup (boss battles). */
  fix: Uint8Array;
  /** mapChara (the monsters shown for boss battles). */
  chara: Uint8Array;
  messages: [number, Uint16Array][];
}

export class EditorState extends MapEditState<Stamp, KaharaTables> {
  /** EventObject tables of the dungeons opened so far (edited in place). */
  readonly events = new Map<number, EventTable>();
  info: MapInfo | null = null;
  /** mapData row source of the open map (indoor flag from its tiles when opened). */
  ref: MapRef | null = null;
  readonly layouts = LAYOUTS;
  readonly pointSections = POINT_SECTIONS;

  constructor(readonly game: Game) {
    super();
  }

  open(info: MapInfo): void {
    let doc = this.docs.get(info.hash);
    if (!doc) {
      doc = this.game.doc(info);
      this.docs.set(info.hash, doc);
    }
    this.current = doc;
    this.info = info;
    this.ref = this.game.mapRef(info, doc);
    this.tileset = this.game.master.tileset(this.ref);
    this.selection = { type: 'none' };
    this.emit('map');
  }

  get currentEvents(): EventTable | null {
    return this.current ? this.events.get(this.current.dungeon) ?? null : null;
  }

  protected saveTables(): KaharaTables {
    return {
      events: [...this.events].map(([d, t]) => [d, t.data.slice()]),
      treasure: this.game.master.treasureGroup.data.slice(),
      mapData: this.game.master.mapData.data.slice(),
      fix: this.game.master.table(FIX_TABLE).data.slice(),
      chara: this.game.master.mapChara.data.slice(),
      messages: this.game.master.texts.saved(),
    };
  }

  protected restoreTables(s: KaharaTables): void {
    for (const [d, bytes] of s.events) this.events.get(d)?.restore(bytes);
    this.game.master.restoreTreasure(s.treasure);
    this.game.master.restoreTable('mapData.bin', s.mapData);
    this.game.master.restoreTable(FIX_TABLE, s.fix);
    this.game.master.restoreTable('mapChara.bin', s.chara);
    this.game.master.texts.restore(s.messages, true);
  }

  placeContext(doc: MapDoc): PlaceContext {
    return { doc, docs: this.docs.values(), events: this.currentEvents, master: this.game.master };
  }

  placeStamp(doc: MapDoc, stamp: Stamp, cx: number, cy: number): [number, number] {
    return placeStamp(this.placeContext(doc), stamp, cx, cy);
  }

  duplicateRecord(doc: MapDoc, section: number, rec: Rec): Rec {
    return duplicateRecord(this.placeContext(doc), section, rec);
  }

  /** Doors on walls (section 7): facing +0x16 (0..3). */
  override canRotate(section: number): boolean {
    return section === 7;
  }
  override rotateRecord(rec: Rec, _section: number, dir: 1 | -1): void {
    rec.raw[0x16] = (rec.raw[0x16]! + dir + 4) & 3;
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
