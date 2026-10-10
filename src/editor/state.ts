// Editing model: one MapDoc per opened map, snapshot-based undo / redo, selection, tools. MapEditState (the
// game-independent part, model.ts) is re-exported here; EditorState adds RPG2's tables (master, event tables).
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import { duplicateRecord, placeStamp, type PlaceContext, type Stamp } from './place';
import type { Game } from '../game/game';
import type { MapRef } from '../game/master';
import { FIX_TABLE } from '../game/boss';
import { LAYOUTS, POINT_SECTIONS, sectionBytes, type MapDoc, type Rec } from '../game/sections';
import { equalBytes } from '../util/bytes';
import { MapEditState } from './model';

export * from './model';

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

