// Editing model: one MapDoc per opened map, snapshot-based undo / redo, selection, tools. MapEditState (the
// game-independent part, model.ts) is re-exported here; EditorState adds RPG2's tables (master, event tables).
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import { duplicateRecord, placeStamp, type PlaceContext, type Stamp } from './place';
import type { Game } from '../game/game';
import type { MapRef } from '../game/master';
import { FIX_TABLE } from '../game/boss';
import { JUMP_TABLE } from '../game/jumppoints';
import { EVENT_SECTIONS, LAYOUTS, POINT_SECTIONS, loadDoc, recEventRow, sectionBytes, type MapDoc, type Rec } from '../game/sections';
import { equalBytes } from '../util/bytes';
import { MapEditState } from './model';
import { KAHARA_AUTO } from '../game/autotile';
import { letterByte, letterIndex } from '../game/sections';
import type { AutoProfile } from './autotile';
import { isIndoor } from '../game/objects';
import { freeRows, liveRows, releaseRows } from '../game/eventslots';
import { WORLD_DUNGEON } from '../game/worldmap';

/** Event tables by dungeon; the dungeons' own tables get their free rows from the editor (game/eventslots.ts). */
class EventTables extends Map<number, EventTable> {
  attach: (dungeon: number, t: EventTable) => void = () => {};
  override set(dungeon: number, t: EventTable): this {
    this.attach(dungeon, t);
    return super.set(dungeon, t);
  }
}

/** Event rows the records of a map point at. */
function docRefs(doc: MapDoc, out: Set<number>): void {
  for (const section of EVENT_SECTIONS) for (const rec of doc.recs[section] ?? []) {
    const row = recEventRow(section, rec.raw);
    if (row) out.add(row);
  }
}

export * from './model';

/** RPG2's shared tables of an undo point (events of loaded dungeons, treasure, …). */
interface KaharaTables {
  events: [number, Uint8Array][];
  treasure: Uint8Array;
  mapData: Uint8Array;
  /** mapGroup +0x26 / +0x27 of every row (the mapData rows of the dungeons; the rest of mapGroup is not undone). */
  dungeonRows: Uint8Array;
  /** mapData keys of the added maps (the rows they pick). */
  keys: [number, number][];
  /** monsterFixGroup (boss battles). */
  fix: Uint8Array;
  /** mapChara (the monsters shown for boss battles). */
  chara: Uint8Array;
  messages: [number, Uint16Array][];
  /** mapJumpPoint ("ジャンプ" destinations, edited on the world map page). */
  jump?: Uint8Array;
}

export class EditorState extends MapEditState<Stamp, KaharaTables> {
  /** EventObject tables of the dungeons opened so far (edited in place). */
  readonly events = new EventTables();
  /** Event rows the game's maps point at, by map (the maps not opened yet still point at these). */
  private readonly romRefs = new Map<number, Set<number>>();
  /** Free rows by dungeon, for the revision they were found at. */
  private readonly freeCache = new Map<number, { revision: number; rows: number[] }>();
  info: MapInfo | null = null;
  /** mapData row source of the open map (indoor flag from its tiles when opened). */
  ref: MapRef | null = null;
  readonly layouts = LAYOUTS;
  readonly pointSections = POINT_SECTIONS;

  constructor(readonly game: Game) {
    super();
    this.events.attach = (d, t) => {
      // world maps' tables (entrance conditions) are not tied to dungeon maps: they keep growing only
      if (d < WORLD_DUNGEON) t.freeRows = () => this.cachedFreeRows(d);
    };
  }

  private romRefsOf(info: MapInfo): Set<number> {
    let refs = this.romRefs.get(info.hash);
    if (!refs) {
      refs = new Set();
      try {
        docRefs(loadDoc(this.game.db, info), refs);
      } catch {
        // an added map with no data in the ROM points at nothing there
      }
      this.romRefs.set(info.hash, refs);
    }
    return refs;
  }

  /** Rows of dungeon `d`'s table in use and free now (game/eventslots.ts); free rows lowest first. */
  eventRowUse(d: number): { live: Set<number>; free: number[] } {
    const ev = this.events.get(d);
    if (!ev) return { live: new Set(), free: [] };
    const refs = new Set<number>(), rom = new Set<number>();
    const seen = new Set<number>();
    for (const m of this.game.editableMaps()) {
      if (m.dungeon !== d) continue;
      seen.add(m.hash);
      const r = this.romRefsOf(m);
      r.forEach((x) => rom.add(x));
      const doc = this.docs.get(m.hash);
      if (doc) docRefs(doc, refs);
      else r.forEach((x) => refs.add(x));
    }
    for (const doc of this.docs.values()) if (doc.dungeon === d && !seen.has(doc.hash)) docRefs(doc, refs);
    const live = liveRows(ev, refs, d);
    return { live, free: freeRows(ev, live, rom) };
  }

  /** Free rows of dungeon `d`'s table now, lowest first. */
  freeEventRows(d: number): number[] {
    return this.eventRowUse(d).free;
  }

  /**
   * Delete event row `row` of dungeon `d` by hand (the event list's trash button): it is blanked, so it is free from
   * now on, even a row of the game that the game's maps did not use. Rows in use are refused.
   */
  deleteEventRow(d: number, row: number): void {
    const ev = this.events.get(d);
    if (!ev || row <= 0 || !ev.has(row)) return;
    if (this.eventRowUse(d).live.has(row)) throw new Error(`イベント #${row} は使われているので削除できません`);
    this.editTables(() => {
      releaseRows(ev, [row]);
      releaseRows(ev, this.freeEventRows(d));
      this.freeCache.delete(d);
    });
  }

  /**
   * The same, found once per revision: addRow takes rows out of the list, so the rows an edit adds (not pointed at by
   * a record until the edit ends) are not handed out twice; every edit ends with a new revision.
   */
  private cachedFreeRows(d: number): number[] {
    const c = this.freeCache.get(d);
    if (c && c.revision === this.revision) return c.rows;
    const rows = this.freeEventRows(d);
    this.freeCache.set(d, { revision: this.revision, rows });
    return rows;
  }

  /** A deleted chest / gimmick gives its event row back when nothing else points at it. */
  override recordRemoved(doc: MapDoc, section: number, rec: Rec): void {
    const ev = this.events.get(doc.dungeon);
    if (!ev || !recEventRow(section, rec.raw)) return;
    releaseRows(ev, this.freeEventRows(doc.dungeon));
    this.freeCache.delete(doc.dungeon);
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
    if (this.brush.auto && !this.autoProfile) this.brush = {...this.brush, auto: false};
    this.selection = { type: 'none' };
    this.emit('map');
  }

  override get autoProfile(): AutoProfile | undefined {
    if (!this.mapTopology) return undefined;
    const palette = this.game.master.palette(this.tileset);
    return KAHARA_AUTO.parts.every(p => palette.has(p.kind)) ? KAHARA_AUTO : undefined;
  }

  override get mapTopology(): AutoProfile | undefined {
    return this.current && !isIndoor(this.current) ? KAHARA_AUTO : undefined;
  }

  override autoLetter(kind: number, preferred: number): number {
    const letters = this.game.master.palette(this.tileset).get(kind) ?? [0];
    return letterByte(letters.includes(letterIndex(preferred)) ? letterIndex(preferred) : letters[0]!);
  }

  override autoVariantLetters(kind: number): readonly number[] {
    return this.game.master.palette(this.tileset).get(kind) ?? [0];
  }

  /**
   * Pick the open map's mapData row again (after its dungeon's row, its own key or its tiles changed): `ref` and the
   * tileset follow the tables. Returns whether the tileset changed.
   */
  syncRef(): boolean {
    if (!this.info || !this.current) return false;
    const ref = this.game.mapRef(this.info, this.current), o = this.ref;
    if (!o || o.hash !== ref.hash || o.mapDataKey !== ref.mapDataKey || o.indoor !== ref.indoor || o.dungeon !== ref.dungeon) this.ref = ref;
    const t = this.game.master.tileset(this.ref ?? ref);
    if (t === this.tileset) return false;
    this.tileset = t;
    return true;
  }

  private dungeonRows(): Uint8Array {
    const mg = this.game.master.mapGroup;
    const out = new Uint8Array(mg.rows * 2);
    for (let r = 0; r < mg.rows; r++) out.set(mg.row(r).subarray(0x26, 0x28), r * 2);
    return out;
  }

  get currentEvents(): EventTable | null {
    return this.current ? this.events.get(this.current.dungeon) ?? null : null;
  }

  /** mapJumpPoint's bytes (undefined when the master has no such table, as in some tests). */
  private jumpBytes(): Uint8Array | undefined {
    try {
      return this.game.master.table(JUMP_TABLE).data.slice();
    } catch {
      return undefined;
    }
  }

  protected saveTables(): KaharaTables {
    return {
      events: [...this.events].map(([d, t]) => [d, t.data.slice()]),
      treasure: this.game.master.treasureGroup.data.slice(),
      mapData: this.game.master.mapData.data.slice(),
      dungeonRows: this.dungeonRows(),
      keys: this.game.code.addedMaps().map((m) => [m.hash, m.mapDataKey]),
      fix: this.game.master.table(FIX_TABLE).data.slice(),
      chara: this.game.master.mapChara.data.slice(),
      messages: this.game.master.texts.saved(),
      jump: this.jumpBytes(),
    };
  }

  protected restoreTables(s: KaharaTables): void {
    for (const [d, bytes] of s.events) this.events.get(d)?.restore(bytes);
    this.game.master.restoreTreasure(s.treasure);
    this.game.master.restoreTable('mapData.bin', s.mapData);
    const mg = this.game.master.mapGroup;
    for (let r = 0; r < mg.rows && r * 2 + 1 < s.dungeonRows.length; r++) mg.row(r).set(s.dungeonRows.subarray(r * 2, r * 2 + 2), 0x26);
    for (const [h, k] of s.keys) {
      const m = this.game.code.byHash(h);
      if (m?.added) m.mapDataKey = k;
    }
    this.game.master.restoreTable(FIX_TABLE, s.fix);
    this.game.master.restoreTable('mapChara.bin', s.chara);
    this.game.master.texts.restore(s.messages, true);
    if (s.jump) this.game.master.restoreTable(JUMP_TABLE, s.jump);
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
