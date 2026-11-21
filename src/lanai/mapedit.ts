// RPG FREE!'s side of the map editor (editor/model.ts MapEditState; naauao lanai/map.md): the open map of a content's
// LanaiMaps, adding records (props, copies of the group's own records), copying and turning them (the facings of
// sections 2〜5 are the 1 / 2 / 4 / 8 masks), and the checks shown under the inspector. Every edit goes to the
// content's map database right away (the session saves it and exports it).
//
// The group's EventObject table (map.md §7.1) is edited with the map: a copied record gets a copy of its EventObject
// row (appended to the table, with a state slot of its own), so copies do not share a chest's contents or its
// "opened" state; the rows' fields are edited from the inspector. The table goes into undo points and the export
// like the map (it is one of the content's tables of the session).
import { MapEditState, GRID, tileAt, type Issue, type Selection } from '../editor/model';
import type { AutoProfile } from '../editor/autotile';
import { LANAI_AUTO } from '../game/autotile';
import { LANAI_ROT_CODEC, letterIndex, recCellPos, setRecCellPos, type MapDoc, type Rec } from '../game/sections';
import { f32, hex8, u32, w32, wf32 } from '../util/bytes';
import {
  LANAI_ACTION_GOAL_CHEST,
  LANAI_ACTION_NONE,
  LANAI_ACTION_OUTSIDE_DOOR,
  LANAI_ACTIONS,
  LANAI_DESTINATION_ACTIONS,
} from './actions';
import {
  LANAI_EVENT_SECTIONS,
  LANAI_FACING_OFFSET,
  LANAI_LAYOUTS,
  LANAI_EVENT_ACTIONS,
  LANAI_POINT_SECTIONS,
  lanaiEventSlot,
  lanaiExitCategory,
  lanaiExitKind,
  lanaiExitLabel,
  lanaiExitNote,
  lanaiFloorKindLabel,
  LANAI_FLOOR_KIND,
  type LanaiTalkRows,
  type LanaiMapInfo,
  type LanaiMaps,
  type LanaiTileSource,
  restoreTableRows,
  tableRows,
} from './maps';
import type { LanaiTable } from './table';
import {
  LANAI_DOOR_FACING,
  LANAI_DOOR_KIND,
  LANAI_DOORWAY_TILE,
  LANAI_SIGN_KIND,
  lanaiEventParts,
  lanaiFloorParts,
  lanaiLookKind,
  type NewEventRow,
} from './eventParts';
import { romEventRow, type LanaiRomPart } from './romParts';
import { lanaiMonsters } from './monsters';
import {
  LANAI_CHARA_DENPA,
  LANAI_CHARA_MONSTER,
  LANAI_GOAL_CHEST,
  LANAI_REPAIR_FIELD,
  LANAI_REPAIR_POINT,
  lanaiDoorOffset,
  lanaiObjectRef,
  lanaiExitDefaultRow,
  lanaiRecordLook,
  type LanaiRecordModel,
} from './mapObjects';
import { lanaiChestFields, lanaiTreasureSlots, lanaiWriteTreasure } from './treasure';
import type { ScriptDoc } from './eventScript';
import { docBound } from './scriptDoc';

/** The kind of the tiles the game leaves empty (map.md §6.3): no model, and not a problem. */
export const LANAI_EMPTY_KIND = 33;
/** Where a record keeps its EventObject row (sections 3 / 4 / 5 / 8: +0x04; map.md §7). */
const EVENT_FIELD = 4;
/** Section 3 +0x15 = 100: a door on a wall (it has no point of its own). */
const WALL_DOOR = 100;

/** The add panel's category of the records copied from the stage's own maps. */
export const LANAI_EXISTING_CATEGORY = '既存ギミック';
/** A record of the group's maps to copy (it keeps its EventObject row). */
export interface LanaiTemplate {
  section: number;
  raw: Uint8Array;
  label: string;
  /** Map it is copied from. */
  source: string;
  /** A new record (eventParts.ts): the EventObject row it gets instead of a copy of the row its raw names. */
  event?: NewEventRow;
  /** Its look, when the raw's row is not what the look is read from (a new record). */
  model?: LanaiRecordModel | null;
  /** The add panel's category in place of the section's. */
  category?: string;
  iconLabel?: string;
  description?: string;
  keywords?: string;
  subtitle?: string;
  choiceKey?: string;
}

export type LanaiStamp =
  /** A prop (section 2): MapObject row (+0x00) and facing (turn 0..3). */
  { type: 'prop'; row: number; dir: number } | { type: 'template'; t: LanaiTemplate };

export function lanaiStampLabel(s: LanaiStamp): string {
  return s.type === 'prop' ? `置物 #${s.row}` : s.t.label;
}

/** EventObject row of a record (sections 3 / 4 / 5 / 8), 0 for the others. */
export const lanaiRecEventRow = (section: number, raw: Uint8Array): number =>
  (LANAI_EVENT_SECTIONS as readonly number[]).includes(section) ? u32(raw, EVENT_FIELD) : 0;

/** The first door named by an authored button's bound function. */
export function lanaiButtonDoor(maps: LanaiMaps, group: number, row: number): number | null {
  const script = maps.session.stageScripts.get(maps.content.archive.toUpperCase())?.doc;
  const binding = script?.bindings.find(
    (b) => b.group === group && b.row === row && (b.trigger === 'switch' || b.trigger === 'button'),
  );
  const body = script?.functions.find((f) => f.name === binding?.fn)?.body;
  // openDoor(3), openDoor(obj(3)) or obj(3).openDoor()
  const match = body?.match(/\bopenDoor\(\s*(?:obj\(\s*)?(\d+)|\bobj\(\s*(\d+)\s*\)\s*\.\s*openDoor\(/u);
  return match ? Number(match[1] ?? match[2]) : null;
}

/** What a section's record is, for the add panel and the checks. */
export function lanaiRecLabel(section: number, raw: Uint8Array): string {
  switch (section) {
    case 1:
      return lanaiFloorKindLabel(raw[LANAI_FLOOR_KIND]!);
    case 2:
      return `置物 #${u32(raw, 0)}`;
    case 3:
      return lanaiExitLabel(lanaiExitKind(raw)).replace(/^種類 (\d+)$/u, '出入口 #$1');
    case 4:
      return u32(raw, 0) === LANAI_GOAL_CHEST ? 'クリア宝箱' : '宝箱';
    case 5:
      return u32(raw, 0) === 0
        ? 'NPC'
        : u32(raw, 0) === 1
          ? 'モンスター'
          : u32(raw, 0) === 2
            ? '電波人間'
            : [4, 5, 6].includes(u32(raw, 0))
              ? 'スイッチ'
              : u32(raw, 0) === LANAI_SIGN_KIND
                ? '看板'
                : u32(raw, 0) === LANAI_REPAIR_POINT
                  ? '回復ポイント'
                  : u32(raw, 0) === LANAI_REPAIR_FIELD
                    ? '回復の場'
                    : `装置 #${u32(raw, 0)}`;
    case 8:
      return u32(raw, 0) >= 100 ? `範囲の置物 #${u32(raw, 0)}` : `イベント範囲 #${u32(raw, 0)}`;
    case 9:
      return `地点 ${u32(raw, 0)}`;
  }
  return `区画 ${section}`;
}

/** A ROM entry is grouped by what the placed record does, while its exact kind stays searchable. */
export function lanaiRomPartCategory(section: number, kind: number, action: number): string {
  if (section === 3) return lanaiExitCategory(kind);
  if (section === 1) return '床のギミック';
  if (section === 8) return '範囲イベント';
  if (section === 9) return '地点';
  if (section === 5) {
    if (kind === 0 && [0x80000001, 0x80000002, 0x80000003, 0x80000032].includes(action)) return 'メッセージ・店';
    if (kind <= 2) return '人物・敵';
    if ([4, 5, 6].includes(kind)) return 'スイッチ';
    if (kind === LANAI_SIGN_KIND) return 'メッセージ・店';
    if ([3, LANAI_REPAIR_FIELD, LANAI_REPAIR_POINT].includes(kind)) return '回復';
    return '装置・その他';
  }
  return 'その他';
}

/** The turn (0..3) of a facing byte; a byte that is none of the masks reads as 0. */
const turnOf = (b: number): number => Math.max(0, LANAI_ROT_CODEC.decode(b));

/** An undo point's tables: the rows of the open map's group's EventObject table and of the content's TreasureGroup. */
/** Content tables an undo point copies whole: the map's sounds and battle field (BattleParts.tsx). */
// MapChara: a new character can add a row (LanaiMaps.addCharaRow)
const UNDO_CONTENT_TABLES = ['MapData', 'MapResource', 'MapChara'];

/** Whether a map's tile source changed so that its models must be read again (MapData row, tileset, its table, texture). */
export const sourceChanged = (a: LanaiTileSource, b: LanaiTileSource): boolean =>
  a.mapData !== b.mapData ||
  a.tileset !== b.tileset ||
  a.partsName !== b.partsName ||
  a.textureArchive !== b.textureArchive ||
  a.textureEntry !== b.textureEntry;

type LanaiTables = {
  group: number | null;
  rows: Uint8Array[] | null;
  treasure: Uint8Array[] | null;
  content: [name: string, rows: Uint8Array[]][];
  script: { key: string; doc: ScriptDoc } | null;
  /** The lines added to the group's talk table (a new sign or NPC adds one). */
  talk: LanaiTalkRows | null;
};

export class LanaiEditState extends MapEditState<LanaiStamp, LanaiTables> {
  private readonly unsubscribeMaps: () => void;
  info: LanaiMapInfo | null = null;
  /** The open map's tile models (MapData row, tileset). Indoor tiles can change it (map.md §6.1): it is read again after every edit. */
  source: LanaiTileSource | null = null;
  readonly layouts = LANAI_LAYOUTS;
  readonly pointSections = LANAI_POINT_SECTIONS;

  constructor(readonly maps: LanaiMaps) {
    super();
    // every edit goes to the map database right away (the session saves it, the export takes it)
    this.on((what) => {
      if (what !== 'doc' || !this.info) return;
      this.maps.commit(this.info);
      this.readSource();
      this.maps.session.edited();
    });
    // the session put the sections back (or reverted them): the open document is read again
    this.unsubscribeMaps = this.maps.on(() => {
      if (this.info && this.current && !this.info.world && this.maps.doc(this.info) !== this.current) {
        this.reopen();
        this.emit('map');
      } else if (this.info && this.current && this.readSource()) {
        // the content's tables changed the map's looks (another tileset: tilesets.ts): the views read the models again
        this.emit('map');
      }
    });
  }

  /** Release the map subscription of a temporary, read-only preview state. */
  dispose(): void {
    this.unsubscribeMaps();
  }

  open(info: LanaiMapInfo): void {
    if (this.stamp?.type === 'template' && this.info?.dungeon !== info.dungeon) {
      this.stamp = null;
      if (this.tool === 'place') this.tool = 'select';
    }
    this.info = info;
    this.reopen();
    if (this.stamp?.type === 'template' && this.tool === 'place') this.tool = 'select';
    this.emit('map');
  }

  /** The automatic brush on the outdoor / dungeon maps (not the world map, not maps with indoor tiles: map.md §6.1). */
  override get mapTopology(): AutoProfile | undefined {
    return this.info &&
      !this.info.world &&
      this.current &&
      !this.current.tiles.some((t) => t.kind >= 15 && t.kind <= 27)
      ? LANAI_AUTO
      : undefined;
  }

  protected override autoPalette(): ReadonlyMap<number, readonly number[]> {
    return this.maps.palette(this.tileset);
  }

  private reopen(): void {
    const info = this.info!;
    const doc = this.maps.doc(info);
    this.docs.set(info.hash, doc);
    this.current = doc;
    this.selection = { type: 'none' };
    this.readSource();
    if (this.brush.auto && !this.autoProfile) this.brush = { ...this.brush, auto: false };
  }

  /** Read the open map's MapData again (adding or removing indoor tiles can change it); returns whether it changed. */
  readSource(): boolean {
    if (!this.info || !this.current) return false;
    const src = this.maps.tileSource(this.info, this.current);
    const changed = !this.source || sourceChanged(this.source, src);
    this.source = src;
    this.tileset = src.tileset;
    return changed;
  }

  protected saveTables(): LanaiTables {
    const group = this.info?.dungeon ?? null;
    const archive = this.maps.content?.archive?.toUpperCase();
    const content = UNDO_CONTENT_TABLES.flatMap((n): [string, Uint8Array[]][] => {
      const t = this.maps.contentTable(n);
      return t ? [[n, tableRows(t)]] : [];
    });
    return {
      group,
      rows: group === null ? null : this.maps.eventRows(group),
      treasure: this.maps.treasureRows(),
      content,
      script: archive ? (this.maps.session?.stageScripts?.get(archive) ?? null) : null,
      // (a stand-in for the maps in the tests has no talk tables)
      talk: group === null ? null : (this.maps.talkRows?.(group) ?? null),
    };
  }
  protected restoreTables(t: LanaiTables): void {
    if (t.group !== null && t.rows) this.maps.restoreEventRows(t.group, t.rows);
    if (t.treasure) this.maps.restoreTreasureRows(t.treasure);
    if (t.talk) this.maps.restoreTalkRows(t.talk);
    for (const [n, rows] of t.content) {
      const table = this.maps.contentTable(n);
      if (table) restoreTableRows(table, rows);
    }
    const archive = this.maps.content?.archive?.toUpperCase();
    if (archive && this.maps.session?.createdFiles?.has(archive))
      this.maps.session.setStageScriptDoc(archive, t.script?.doc ?? null, t.script?.key);
  }
  protected override docReplaced(doc: MapDoc): void {
    const info = this.maps.map(doc.hash);
    if (info) this.maps.setDoc(info, doc);
  }

  /** Props (+0x10), exits (+0x14), chests (+0x14) and characters (+0x1C) face one of 4 ways (1 / 2 / 4 / 8). */
  override canRotate(section: number): boolean {
    return section >= 2 && section <= 5;
  }
  override rotateRecord(rec: Rec, section: number, dir: 1 | -1): void {
    const o = LANAI_FACING_OFFSET[section];
    if (o === undefined) return;
    const was = rec.raw[o]!;
    rec.raw[o] = LANAI_ROT_CODEC.encode((turnOf(was) + dir + 4) & 3);
    // an exit whose offset points the way it faces (the doors and gates on the edge of their cell, mapObjects.ts
    // lanaiDoorOffset) keeps it there: the offset turns with the record
    if (section === 3) {
      const L = LANAI_LAYOUTS[3]!;
      const [ox, oy] = [f32(rec.raw, L.fxo!), f32(rec.raw, L.fyo!)];
      const [ux, uy] = lanaiDoorOffset(was, 0);
      const along = ox * ux + oy * uy;
      if (along > 0 && Math.abs(ox * uy - oy * ux) < 1e-6) {
        const [nx, ny] = lanaiDoorOffset(rec.raw[o]!, 0);
        wf32(rec.raw, L.fxo!, nx * along);
        wf32(rec.raw, L.fyo!, ny * along);
      }
    }
  }

  /** A point ID (section 3 +0x00) no map of the content uses. */
  private newPointId(): number {
    const used = new Set<number>();
    for (const m of this.maps.maps)
      if (!m.world) for (const r of this.maps.doc(m).recs[3] ?? []) used.add(u32(r.raw, 0));
    for (const r of this.current?.recs[3] ?? []) used.add(u32(r.raw, 0));
    let id: number;
    do id = (Math.random() * 0xffffffff) >>> 0;
    while (!id || used.has(id));
    return id;
  }

  placeStamp(doc: MapDoc, stamp: LanaiStamp, cx: number, cy: number): [number, number] {
    let section: number, raw: Uint8Array;
    if (stamp.type === 'prop') {
      section = 2;
      raw = new Uint8Array(LANAI_LAYOUTS[2]!.size);
      w32(raw, 0, stamp.row);
      raw[LANAI_FACING_OFFSET[2]!] = LANAI_ROT_CODEC.encode(stamp.dir);
    } else {
      section = stamp.t.section;
      raw = stamp.t.raw.slice();
      if (section === 3 && lanaiExitKind(raw) !== WALL_DOOR) w32(raw, 0, this.newPointId());
      // a door faces the opening of the doorway tile it is put on, as the data's doors do
      const tile = tileAt(doc, cx, cy);
      if (section === 3 && lanaiExitKind(raw) === LANAI_DOOR_KIND && tile?.kind === LANAI_DOORWAY_TILE)
        raw[0x14] = LANAI_DOOR_FACING[tile.rot & 3]!;
      // a new door stands on the edge of its cell as the data's doors do (the record's offset; the game adds none)
      if (section === 3 && lanaiExitKind(raw) === LANAI_DOOR_KIND) {
        const L = LANAI_LAYOUTS[3]!;
        if (!f32(raw, L.fxo!) && !f32(raw, L.fyo!)) {
          const [ox, oy] = lanaiDoorOffset(raw[0x14]!, stamp.t.event?.look ?? 0);
          wf32(raw, L.fxo!, ox);
          wf32(raw, L.fyo!, oy);
        }
      }
      const ev = stamp.t.event;
      if (ev) {
        if (!this.info || !this.maps.eventTable(this.info.dungeon))
          throw new Error('この MapGroup には EventObject の表がないので、イベントを持つものは置けません');
        // checked before any row is added, so that nothing is left behind
        if ((ev.talk || ev.lines?.length) && !this.maps.talkTable(this.info.dungeon))
          throw new Error('この MapGroup には台詞の表がないので、メッセージを持つものは置けません');
        const look = ev.chara ? this.maps.addCharaRow(ev.chara.kind, ev.chara.model) : ev.look;
        const row = ev.from
          ? this.maps.addEventRowBytes(this.info.dungeon, ev.from, look)
          : this.maps.addNewEventRow(this.info.dungeon, ev.action, look);
        w32(raw, EVENT_FIELD, row);
        // New scripted ranges promise an event on entry. Channel 1 (bit 15) is checked every frame;
        // channel 2 is checked when A/L is pressed. (A ROM part keeps its sample's bits.)
        if (stamp.t.section === 8 && !ev.from) {
          const events = this.maps.eventTable(this.info.dungeon)!;
          events.setU16(row, 0x5c, events.u16(row, 0x5c) | 0x8000);
        }
        for (const l of [
          ...(ev.talk ? [{ stage: 0, arg: ev.talk.arg ?? 0, text: ev.talk.text, speaker: ev.talk.speaker }] : []),
          ...(ev.lines ?? []),
        ]) {
          const line = this.maps.addTalkRow(this.info.dungeon, l.text, l.speaker);
          this.maps.eventTable(this.info.dungeon)!.setU32(row, LANAI_EVENT_ACTIONS[l.stage]! + 4 + 4 * l.arg, line);
        }
        if (ev.destination) {
          const events = this.maps.eventTable(this.info.dungeon)!;
          events.setU32(row, LANAI_EVENT_ACTIONS[0] + 4, ev.destination.map);
          events.setU32(row, LANAI_EVENT_ACTIONS[0] + 8, ev.destination.point);
        }
        if (ev.switchTrigger) {
          const session = this.maps.session;
          const archive = this.maps.content.archive.toUpperCase();
          if (!session.createdFiles.has(archive)) throw new Error('スイッチのスクリプトは追加ステージで使えます');
          // the function is written in the script editor: placing the switch only gives it one already there
          const stored = session.stageScripts.get(archive);
          if (ev.scriptFn && stored)
            session.setStageScriptDoc(
              archive,
              docBound(stored.doc, { trigger: ev.switchTrigger, group: this.info.dungeon, row, fn: ev.scriptFn }),
              stored.key,
            );
        }
        if (ev.chest) {
          const events = this.maps.eventTable(this.info.dungeon)!;
          const treasure = this.maps.treasureGroup;
          if (!treasure) throw new Error('このコンテンツには TreasureGroup の表がありません');
          for (const [stage, offset] of LANAI_EVENT_ACTIONS.entries()) {
            if (stage && ev.chest === 'normal') break;
            const reward = treasure.addRow();
            lanaiWriteTreasure(treasure, reward, ev.rewards?.[stage] ?? []);
            events.setU32(row, offset, ev.chest === 'goal' ? LANAI_ACTION_GOAL_CHEST : ev.action);
            events.setU32(row, offset + 4, reward);
          }
          if (ev.chest === 'goal') events.setU32(row, LANAI_EVENT_ACTIONS[0] + 8, ev.clears ?? this.maps.content.index);
        }
        // the clerk opens the Shop row chosen when placed (its second argument)
        if (typeof ev.shop === 'number')
          this.maps.eventTable(this.info.dungeon)!.setU32(row, LANAI_EVENT_ACTIONS[0] + 8, ev.shop);
      } else this.copyEventRow(section, raw);
    }
    const rec: Rec = { raw, x: 0, y: 0 };
    setRecCellPos(rec, LANAI_LAYOUTS[section]!, cx, cy);
    const list = (doc.recs[section] ??= []);
    list.push(rec);
    return [section, list.length - 1];
  }

  /** Give a record (a copy) a copy of its EventObject row; row 0 (the empty row: no event) stays. */
  private copyEventRow(section: number, raw: Uint8Array): void {
    const ev = lanaiRecEventRow(section, raw);
    const table = this.info ? this.maps.eventTable(this.info.dungeon) : undefined;
    if (!ev || !table || ev >= table.rows) return;
    w32(raw, EVENT_FIELD, this.maps.addEventRow(this.info!.dungeon, ev));
  }

  /** A copy of a record: an exit gets a new point ID, a record with an EventObject row a copy of the row. */
  duplicateRecord(_doc: MapDoc, section: number, rec: Rec): Rec {
    const copy: Rec = { raw: rec.raw.slice(), x: rec.x, y: rec.y };
    if (section === 3 && lanaiExitKind(rec.raw) !== WALL_DOOR) w32(copy.raw, 0, this.newPointId());
    this.copyEventRow(section, copy.raw);
    return copy;
  }

  /** Write a field of an EventObject row of the open map's group (with an undo point). */
  setEventField(row: number, write: (t: NonNullable<ReturnType<LanaiMaps['eventTable']>>) => void): void {
    const t = this.info ? this.maps.eventTable(this.info.dungeon) : undefined;
    if (!t || row <= 0 || row >= t.rows) return;
    this.editTables(() => write(t));
  }

  /** Change the content's TreasureGroup (chests' contents; with an undo point). */
  editTreasure(write: (t: LanaiTable) => void): void {
    const t = this.maps.treasureGroup;
    if (t) this.editTables(() => write(t));
  }

  /** Give the selected record a copy of its EventObject row (so it stops sharing the row with other records). */
  separateEventRow(section: number, index: number): void {
    const rec = this.current?.recs[section]?.[index];
    if (!rec) return;
    this.edit(() => this.copyEventRow(section, rec.raw));
  }

  /** Put the open map back as it is in the ROM (with an undo point). */
  revert(): void {
    const info = this.info;
    if (!info) return;
    this.checkpoint();
    this.maps.revert(info);
    this.reopen();
    this.emit('doc');
  }

  /** Records of the group's maps to copy: the first of each kind (section, kind and EventObject action type). */
  templates(): LanaiTemplate[] {
    const info = this.info;
    if (!info) return [];
    const table = this.maps.eventTable(info.dungeon);
    const out = new Map<string, LanaiTemplate>();
    const maps = this.maps.maps.filter((m) => m.dungeon === info.dungeon && !m.world);
    for (const k of [3, 4, 5, 8, 1, 9])
      for (const m of maps)
        for (const r of this.maps.doc(m).recs[k] ?? []) {
          const ev = lanaiRecEventRow(k, r.raw);
          // EventObject +0x10: the action type's row ID (map.md §7)
          const action = ev && table && ev < table.rows ? table.u32(ev, 0x10) : -1;
          const kind = k === 3 ? lanaiExitKind(r.raw) : k === 1 ? r.raw[0x0d]! : u32(r.raw, 0);
          const key = `${k}/${kind}/${action}`;
          if (out.has(key)) continue;
          const goal = k === 4 && kind === LANAI_GOAL_CHEST;
          const label =
            k === 3 && kind === LANAI_DOOR_KIND
              ? action === 0x80000017
                ? '通路をふさぐ扉'
                : action === 0x80000015
                  ? '触れると開く扉'
                  : action === 0x80000016
                    ? '触れて開き、場所を移動する扉'
                    : action === 0x80000018
                      ? '外から開くと移動できる扉'
                      : action === 0x8000002d
                        ? 'スクリプト付きの扉'
                        : '扉'
              : k === 3 && kind === 4 && action === 0x80000012
                ? 'ワープゲート'
                : k === 3 && kind === 2 && action === 0x80000014
                  ? 'ワープホール'
                  : k === 5 && [4, 5, 6].includes(kind)
                    ? 'スイッチ'
                    : k === 4
                      ? goal
                        ? 'クリア宝箱'
                        : '通常の宝箱'
                      : lanaiRecLabel(k, r.raw);
          out.set(key, {
            section: k,
            raw: r.raw.slice(),
            label,
            source: m.name,
            description: `このステージの ${m.name} から動作と設定を複製します。${action >= 0 && LANAI_ACTIONS[action] ? `動作: ${LANAI_ACTIONS[action]!.name}。` : ''}`,
            // what the stage already has, in one category (the parts made from nothing have the categories by purpose)
            category: LANAI_EXISTING_CATEGORY,
          });
        }
    // records made from nothing (a button, a character, a range), each with an EventObject row of its own
    const fresh = table
      ? lanaiEventParts(this.maps.session.table('MapObject'), this.maps.contentTable('MapChara'), this.partDefaults())
      : [];
    return [
      ...fresh.map((part) => ({
        ...part,
        category: ['スイッチ', '宝箱・ゴール'].includes(part.category) ? part.category : '新規・設定付き',
      })),
      ...lanaiFloorParts().map((part) => ({ ...part, category: '新規・設定付き' })),
      ...out.values(),
    ];
  }

  /**
   * The ROM's kinds of records (romParts.ts) as parts of the open map: a record like the sample with a new EventObject
   * row like the sample's (romEventRow: what names the sample's content cleared, the lines copied as new lines of the
   * group, a character's MapChara row made anew). Their destination is chosen when placed (ExitPlacement).
   */
  romTemplates(parts: readonly LanaiRomPart[]): LanaiTemplate[] {
    if (!this.info) return [];
    const content = this.maps.content.index;
    const hasEvents = !!this.maps.eventTable(this.info.dungeon);
    const out: LanaiTemplate[] = [];
    for (const p of [...parts].sort(
      (a, b) => a.section - b.section || a.kind - b.kind || a.action - b.action || a.look - b.look,
    )) {
      const raw = p.raw.slice();
      // the sample's row number means nothing here: the new row is given when placed
      if ((LANAI_EVENT_SECTIONS as readonly number[]).includes(p.section)) w32(raw, EVENT_FIELD, 0);
      const from = romEventRow(p, content);
      if (from && !hasEvents) continue;
      const action = p.action >>> 0;
      const what = from
        ? action === LANAI_ACTION_NONE
          ? '動作なし'
          : (LANAI_ACTIONS[action]?.name ?? `動作 0x${(action & 0xff).toString(16).toUpperCase()}`)
        : 'イベントなし';
      const recordName = lanaiRecLabel(p.section, raw);
      const generic = /^出入口 #\d+$|^装置 #\d+$/u.test(recordName);
      const name = generic && from && action !== LANAI_ACTION_NONE ? what.split(/[（(]/u)[0]!.trim() : recordName;
      const appearance = p.section === 3 ? p.look || lanaiExitDefaultRow(p.kind) : 0;
      const description = [
        p.section === 3 ? lanaiExitNote(p.kind) : '',
        what !== name && what !== 'イベントなし' ? `動作: ${what}。` : '',
        `区画 ${p.section}、種類 ${p.kind}。`,
        appearance ? `外観: MapObject #${appearance}。` : '',
        from ? '元ステージ固有の参照は配置先で設定してください。' : '',
      ]
        .filter(Boolean)
        .join('');
      const look = from ? new DataView(from.buffer).getUint16(0x5a, true) : 0;
      const lookKind = lanaiLookKind(p.section, raw);
      let model: LanaiRecordModel | null | undefined;
      if (p.chara)
        model =
          p.chara.kind === LANAI_CHARA_MONSTER
            ? { type: 'monster', design: p.chara.model }
            : p.chara.kind === LANAI_CHARA_DENPA
              ? { type: 'denpa', custom: p.chara.model }
              : { type: 'object', row: p.chara.model };
      else if (lookKind === 'object' && look && lanaiObjectRef(this.maps.session.table('MapObject'), look))
        model = { type: 'object', row: look };
      let event: NewEventRow | undefined;
      if (from) {
        const [first, ...rest] = p.lines;
        const talk = first && first.stage === 0 ? first : undefined;
        event = {
          action,
          look: p.chara ? 0 : lookKind === 'chara' ? 0 : look,
          from,
          ...(p.chara ? { chara: p.chara } : {}),
          ...(talk ? { talk: { text: talk.text, speaker: talk.speaker, arg: talk.arg } } : {}),
          ...(talk ? (rest.length ? { lines: rest } : {}) : p.lines.length ? { lines: p.lines } : {}),
          ...(LANAI_DESTINATION_ACTIONS.includes(action) ? { destination: { map: 0, point: 0 } } : {}),
        };
      }
      out.push({
        section: p.section,
        raw,
        label: name,
        description,
        subtitle: appearance
          ? `外観 #${appearance}${what !== name && what !== 'イベントなし' ? ` · ${what}` : ''}`
          : what === name
            ? `種類 ${p.kind}`
            : what,
        keywords: `区画 ${p.section} 種類 ${p.kind} ${what}`,
        choiceKey: `rom/${p.section}/${p.kind}/${p.action}/${p.look}`,
        source: `ROM ${p.source}、${p.count} 件`,
        category: lanaiRomPartCategory(p.section, p.kind, action),
        ...(event ? { event } : {}),
        ...(model !== undefined ? { model } : {}),
      });
    }
    return out;
  }

  /**
   * The looks of a new NPC or monster when the content has none: the model of MapChara row 0 (most contents keep an
   * NPC there), else the first NPC model (MapObject 0x199〜) there is; the first monster with a design.
   */
  private partDefaults(): { npcModel: number; monsterDesign: number } {
    const objects = this.maps.session.table('MapObject');
    const mc = this.maps.contentTable('MapChara');
    const row0 = mc?.rows ? new DataView(mc.row(0).buffer, mc.row(0).byteOffset).getUint16(0x2c, true) : 0;
    let npcModel = lanaiObjectRef(objects, row0) ? row0 : 0;
    for (let r = 0x199; !npcModel && r < (objects?.rows ?? 0); r++) if (lanaiObjectRef(objects, r)) npcModel = r;
    const monsterDesign = lanaiMonsters(this.maps.session).find((m) => m.name && m.designRow > 0)?.designRow ?? 0;
    return { npcModel, monsterDesign };
  }

  /** MapObject rows the props of the content's maps use, most used first. */
  props(): number[] {
    const n = new Map<number, number>();
    for (const m of this.maps.maps)
      if (!m.world)
        for (const r of this.maps.doc(m).recs[2] ?? []) n.set(u32(r.raw, 0), (n.get(u32(r.raw, 0)) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([row]) => row);
  }
}

const states = new WeakMap<LanaiMaps, LanaiEditState>();
/** The map page's editing state (one per content's maps, kept across pages so undo survives). */
export function lanaiEditState(maps: LanaiMaps): LanaiEditState {
  let st = states.get(maps);
  if (!st) {
    st = new LanaiEditState(maps);
    states.set(maps, st);
  }
  return st;
}

// ---- checks

const baselines = new WeakMap<LanaiMaps, Map<number, Set<string>>>();

/** Problems of an edited map that the ROM's map does not already have. */
export function lanaiValidate(maps: LanaiMaps, info: LanaiMapInfo, doc: MapDoc): Issue[] {
  const byMap = baselines.get(maps) ?? new Map<number, Set<string>>();
  baselines.set(maps, byMap);
  let base = byMap.get(info.hash);
  if (!base) {
    base = new Set(lanaiValidateAll(maps, info, maps.originalDoc(info)).map((i) => i.key));
    byMap.set(info.hash, base);
  }
  return lanaiValidateAll(maps, info, doc).filter((i) => !base.has(i.key));
}

export function lanaiValidateAll(maps: LanaiMaps, info: LanaiMapInfo, doc: MapDoc): Issue[] {
  const out: Issue[] = [];
  const cell = (x: number, y: number): Selection => ({ type: 'tiles', cells: [[x, y]] });
  const rec = (section: number, index: number): Selection => ({ type: 'rec', section, index });
  const src = maps.tileSource(info, doc);
  const table = maps.eventTable(info.dungeon);

  // MapData: indoor tiles (kinds 15〜27) choose the group's indoor row (map.md §6.1)
  const before = maps.tileSource(info, maps.originalDoc(info));
  if (src.mapData !== before.mapData)
    out.push({
      level: 'warn',
      msg: `屋内のタイル (種類 15〜27) の有無が変わったので、MapData が #${before.mapData} → ${src.mapData} (タイルセット ${before.partsName || before.tileset} → ${src.partsName || src.tileset}) になります。ほかのタイルのモデルも変わります`,
      key: `mapdata/${src.mapData}`,
    });

  // tiles: inside the 30 x 30 grid, one per cell, with a model in the tileset (kind 33 is empty on purpose)
  const seen = new Map<string, number>();
  for (const t of doc.tiles) {
    const k = `${t.x},${t.y}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (t.x < 0 || t.y < 0 || t.x >= GRID || t.y >= GRID)
      out.push({
        level: 'error',
        msg: `タイル (${t.x}, ${t.y}) が範囲 0〜${GRID - 1} の外です`,
        target: cell(t.x, t.y),
        key: `range/${k}`,
      });
    if (t.kind !== LANAI_EMPTY_KIND && !maps.partRef(src, t.kind, letterIndex(t.letter)))
      out.push({
        level: 'warn',
        msg: `タイル (${t.x}, ${t.y}) 種類 ${t.kind}: このタイルセット (${src.partsName || src.tileset}) にモデルがありません`,
        target: cell(t.x, t.y),
        key: `model/${k}/${t.kind}/${letterIndex(t.letter)}`,
      });
  }
  for (const [k, n] of seen)
    if (n > 1) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      out.push({
        level: 'warn',
        msg: `セル (${x}, ${y}) にタイルが ${n} 枚あります (後の 1 枚が使われます)`,
        target: cell(x, y),
        key: `dup/${k}`,
      });
    }
  if (!doc.tiles.length) out.push({ level: 'error', msg: 'タイルがありません', key: 'empty' });

  // positions in 100 units are 0..299
  for (const k of [2, 4, 5, 8, 9]) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      if (r.x < 0 || r.x > 299 || r.y < 0 || r.y > 299)
        out.push({
          level: 'error',
          msg: `${LANAI_LAYOUTS[k]!.label} #${i}: 座標 (${r.x}, ${r.y}) が 0〜299 の外です`,
          target: rec(k, i),
          key: `fine/${k}/${r.x},${r.y}`,
        });
    });
  }
  // records on cells without a tile
  for (const k of LANAI_POINT_SECTIONS) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
      if (!tileAt(doc, Math.floor(px), Math.floor(py)))
        out.push({
          level: 'warn',
          msg: `${LANAI_LAYOUTS[k]!.label} #${i}: セル (${Math.floor(px)}, ${Math.floor(py)}) にタイルがありません`,
          target: rec(k, i),
          key: `notile/${k}/${hex8(u32(r.raw, 0))}/${r.x},${r.y}`,
        });
    });
  }

  // doors (kind 12): on a doorway tile (kind 9), facing its opening, as 177 of the data's 191 doors are
  (doc.recs[3] ?? []).forEach((r, i) => {
    if (lanaiExitKind(r.raw) !== LANAI_DOOR_KIND) return;
    const [px, py] = recCellPos(r, LANAI_LAYOUTS[3]!);
    const t = tileAt(doc, Math.floor(px), Math.floor(py));
    if (!t) return;
    const msg =
      t.kind !== LANAI_DOORWAY_TILE
        ? `扉 #${i}: 出入口のタイル (種類 ${LANAI_DOORWAY_TILE}) の上にありません (壁や部屋の中に立ちます)`
        : r.raw[0x14] !== LANAI_DOOR_FACING[t.rot & 3]
          ? `扉 #${i}: 向き (${r.raw[0x14]}) が出入口のタイルの向きに合っていません (${LANAI_DOOR_FACING[t.rot & 3]} にすると開口部をふさぎます)`
          : null;
    if (msg) out.push({ level: 'warn', msg, target: rec(3, i), key: `door/${r.x},${r.y}/${r.raw[0x14]}` });
  });

  // EventObject rows: in the group's table, one record each (records that share a row share its state)
  const users = new Map<number, number>();
  for (const k of LANAI_EVENT_SECTIONS) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      const row = lanaiRecEventRow(k, r.raw);
      if (!row) return;
      users.set(row, (users.get(row) ?? 0) + 1);
      if (table && row >= table.rows)
        out.push({
          level: 'error',
          msg: `${LANAI_LAYOUTS[k]!.label} #${i}: イベント番号 ${row} がありません (表は ${table.rows} 件)`,
          target: rec(k, i),
          key: `evrow/${k}/${row}`,
        });
    });
  }
  // chests: their TreasureGroup row is in the content's table
  const treasure = maps.treasureGroup;
  if (table && treasure)
    for (const k of LANAI_EVENT_SECTIONS)
      (doc.recs[k] ?? []).forEach((r, i) => {
        const ev = lanaiRecEventRow(k, r.raw);
        for (const { field } of ev && ev < table.rows ? lanaiChestFields(table, ev) : []) {
          const row = table.u32(ev, field);
          if (row >= treasure.rows)
            out.push({
              level: 'error',
              msg: `${LANAI_LAYOUTS[k]!.label} #${i}: 中身の表 (TreasureGroup) に番号 ${row} がありません (表は ${treasure.rows} 件)`,
              target: rec(k, i),
              key: `treasure/${k}/${row}`,
            });
          else if (k === 4 && !lanaiTreasureSlots(treasure, row).length)
            out.push({
              level: 'warn',
              msg: `宝箱 #${i}: ${field === LANAI_EVENT_ACTIONS[0] + 4 ? '初回の' : '再挑戦時の'}報酬がありません`,
              target: rec(k, i),
              key: `reward/${k}/${i}/${field}`,
            });
        }
        if (
          k === 4 &&
          ev &&
          ev < table.rows &&
          table.u32(ev, LANAI_EVENT_ACTIONS[0]) === LANAI_ACTION_GOAL_CHEST &&
          !table.u32(ev, LANAI_EVENT_ACTIONS[0] + 8)
        )
          out.push({
            level: 'error',
            msg: `クリア宝箱 #${i}: クリア対象がありません`,
            target: rec(k, i),
            key: `clear/${i}`,
          });
      });
  // where the exits of the content's maps lead ("map/point"): the doors one arrives at
  const arrivals = new Set<string>();
  if (table)
    for (const m of maps.maps) {
      const t = m.world ? null : maps.eventTable(m.dungeon);
      if (!t) continue;
      for (const r of (m.hash === info.hash ? doc : maps.doc(m)).recs[3] ?? []) {
        const ev = lanaiRecEventRow(3, r.raw);
        if (ev && ev < t.rows && LANAI_DESTINATION_ACTIONS.includes(t.u32(ev, LANAI_EVENT_ACTIONS[0])))
          arrivals.add(`${t.u32(ev, LANAI_EVENT_ACTIONS[0] + 4)}/${t.u32(ev, LANAI_EVENT_ACTIONS[0] + 8)}`);
      }
    }
  if (table)
    for (const k of [3, 5] as const)
      (doc.recs[k] ?? []).forEach((r, i) => {
        const ev = lanaiRecEventRow(k, r.raw);
        if (!ev || ev >= table.rows) return;
        const action = table.u32(ev, LANAI_EVENT_ACTIONS[0]);
        if (k === 3 && LANAI_DESTINATION_ACTIONS.includes(action)) {
          const hash = table.u32(ev, LANAI_EVENT_ACTIONS[0] + 4);
          const point = table.u32(ev, LANAI_EVENT_ACTIONS[0] + 8);
          const destination = maps.map(hash);
          if (
            !destination ||
            (!destination.world && !(maps.doc(destination).recs[3] ?? []).some((p) => u32(p.raw, 0) === point))
          )
            out.push({
              level: 'error',
              msg:
                hash === 0 && point === 0
                  ? `出入口 #${i}: 行き先が未設定です。相手を置いた後、インスペクタの「接続」で指定してください`
                  : `出入口 #${i}: 行き先の地点がありません`,
              target: rec(k, i),
              key: `destination/${i}/${hash}/${point}`,
            });
        }
        // a door's opening sound: a SoundData row (the factories keep it as u16)
        const soundArg = Object.entries(LANAI_ACTIONS[action]?.pick ?? {}).find(([, p]) => p === 'doorSound')?.[0];
        const soundRows = maps.session.table('SoundData')?.rows ?? 0;
        if (k === 3 && soundArg !== undefined && soundRows) {
          const sound = table.u32(ev, LANAI_EVENT_ACTIONS[0] + 4 + Number(soundArg) * 4) & 0xffff;
          if (sound >= soundRows)
            out.push({
              level: 'warn',
              msg: `出入口 #${i}: 開く音 0x${sound.toString(16).toUpperCase()} は SoundData (${soundRows} 件) の外です`,
              target: rec(k, i),
              key: `doorsound/${i}/${sound}`,
            });
        }
        // a door one arrives at stands open (its state and collision): the map's load opens the record whose point is
        // the exit one came through (kinds 0x0C〜0x12, 0x21D7FC → 0x413E98). A door opened only from outside then
        // stays open; the shipped stages close their start gate again in the intro (D01Intro: SetDoorCloseFlag)
        if (
          k === 3 &&
          action === LANAI_ACTION_OUTSIDE_DOOR &&
          r.raw[0x15]! >= 0x0c &&
          r.raw[0x15]! <= 0x12 &&
          arrivals.has(`${info.hash}/${u32(r.raw, 0)}`)
        )
          out.push({
            level: 'warn',
            msg: `扉 #${i}: ほかの出入口の行き先 (到着地点) なので、ここに着くと開いたままになり通り抜けられます。戻れる扉にするなら動作を「鍵つきの扉 (行き先あり)」に、閉じた扉にするなら行き先を別の地点にしてください`,
            target: rec(k, i),
            key: `arrivaldoor/${hex8(u32(r.raw, 0))}`,
          });
        if (
          k === 5 &&
          [4, 5, 6].includes(u32(r.raw, 0)) &&
          !lanaiRecordLook(k, r.raw, {
            mapObject: maps.session.table('MapObject'),
            mapChara: maps.contentTable('MapChara'),
            events: table,
            indoor: false,
          })?.model
        )
          out.push({ level: 'warn', msg: `ボタン #${i}: 見た目未設定です`, target: rec(k, i), key: `buttonlook/${i}` });
      });
  for (const [row, n] of users)
    if (n > 1)
      out.push({
        level: 'warn',
        msg: `${n} 個のレコードが同じ イベント番号 ${row} を使っています (宝箱の中身や「開けた」などの状態を共有します)`,
        key: `evshare/${row}/${n}`,
      });

  // EventObject state slots (+0x58): below the group's count, one row each (map.md §7.2)
  const group = maps.group(info);
  if (table && group) {
    const slots = new Map<number, number[]>();
    for (const row of users.keys()) {
      if (row >= table.rows) continue;
      const slot = lanaiEventSlot(table, row);
      if (slot >= group.stateCount) {
        out.push({
          level: 'warn',
          msg: `イベント番号 ${row}: 状態の枠 ${slot} が MapGroup の枠の数 ${group.stateCount} 以上なので、状態 (開けた、など) が保存されません`,
          key: `evslot/${row}/${slot}`,
        });
        continue;
      }
      slots.set(slot, [...(slots.get(slot) ?? []), row]);
    }
    for (const t of Array.from({ length: table.rows }, (_, r) => r)) {
      if (users.has(t) || !t) continue;
      const slot = lanaiEventSlot(table, t);
      if (slots.has(slot)) slots.get(slot)!.push(t);
    }
    for (const [slot, rows] of slots)
      if (rows.length > 1)
        out.push({
          level: 'warn',
          msg: `イベント番号 ${rows.join(', ')} が同じ状態の枠 ${slot} を使っています (状態を共有します)`,
          key: `evslotshare/${slot}/${rows.join(',')}`,
        });
  }

  // the group's start (MapGroup +0x14 / +0x18): a point of its first map
  if (group && group.firstMap === info.hash && !(doc.recs[3] ?? []).some((r) => u32(r.raw, 0) === group.firstPoint))
    out.push({
      level: 'warn',
      msg: `このマップは MapGroup の最初のマップですが、最初の地点 ${hex8(group.firstPoint).toUpperCase()} がこのマップの出入口にありません (グループの始まりに使う地点を、この出入口のどれかにしてください)`,
      key: `firstpoint/${hex8(group.firstPoint)}`,
    });

  // section 3: point IDs are what the exits of other maps lead to (EventObject +0x18)
  const ids = new Map<number, number>();
  for (const r of doc.recs[3] ?? []) ids.set(u32(r.raw, 0), (ids.get(u32(r.raw, 0)) ?? 0) + 1);
  (doc.recs[3] ?? []).forEach((r, i) => {
    const id = u32(r.raw, 0);
    if (id && ids.get(id)! > 1 && lanaiExitKind(r.raw) !== WALL_DOOR)
      out.push({
        level: 'warn',
        msg: `出入口 #${i}: 地点 ID ${hex8(id).toUpperCase()} がこのマップでほかにも使われています`,
        target: rec(3, i),
        key: `iddup/${hex8(id)}`,
      });
  });
  for (const r of maps.originalDoc(info).recs[3] ?? []) {
    const id = u32(r.raw, 0);
    if (!ids.has(id))
      out.push({
        level: 'warn',
        msg: `元の出入口 (地点 ${hex8(id).toUpperCase()}) が消えています。ここへ来る出入口の行き先がなくなります`,
        key: `gone/${hex8(id)}`,
      });
  }

  // section 6: cells on tiles, values that name a MonsterGroup row (others become row 0: map.md §5.7)
  doc.cells6.forEach((c) => {
    if (!tileAt(doc, c.x, c.y))
      out.push({
        level: 'warn',
        msg: `区画 6 のセル (${c.x}, ${c.y}) にタイルがありません`,
        target: cell(c.x, c.y),
        key: `s6/${c.x},${c.y}`,
      });
    if (maps.monsterGroup && maps.monsterGroupRow(c.value) < 0)
      out.push({
        level: 'error',
        msg: `区画 6 のセル (${c.x}, ${c.y}): ${hex8(c.value).toUpperCase()} はこのコンテンツの MonsterGroup にありません (番号 0 の群れになります)`,
        target: cell(c.x, c.y),
        key: `s6id/${c.x},${c.y}/${hex8(c.value)}`,
      });
  });
  if (doc.sec6Header.length >= 4 && maps.monsterGroup && maps.monsterGroupRow(u32(doc.sec6Header, 0)) < 0)
    out.push({
      level: 'error',
      msg: `区画 6 のヘッダーの群れ ${hex8(u32(doc.sec6Header, 0)).toUpperCase()} はこのコンテンツの MonsterGroup にありません (番号 0 の群れになります)`,
      key: `s6head/${hex8(u32(doc.sec6Header, 0))}`,
    });
  return out;
}
