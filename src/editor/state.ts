// Editing model: one MapDoc per opened map, snapshot-based undo / redo, selection, tools. MapEditState (the
// game-independent part, model.ts) is re-exported here; EditorState adds RPG2's tables (master, event tables).
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import { duplicateRecord, placeStamp, type PlaceContext, type Stamp } from './place';
import type { Game } from '../game/game';
import type { MapRef } from '../game/master';
import { FIX_TABLE } from '../game/boss';
import { JUMP_TABLE } from '../game/jumppoints';
import { LAYOUTS, POINT_SECTIONS, sectionBytes, type MapDoc, type Rec } from '../game/sections';
import { equalBytes } from '../util/bytes';
import { MapEditState } from './model';
import { KAHARA_AUTO } from '../game/autotile';
import { letterByte, letterIndex } from '../game/sections';
import type { AutoProfile } from './autotile';
import { isIndoor } from '../game/objects';

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
