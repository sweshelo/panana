// RPG3's side of the map editor (editor/state.ts MapEditState): the open map of OahuMaps, the EventObject tables and
// the chest contents in every undo point, adding records (props, copies of the dungeon's own records) and copying them with their own
// EventObject rows, and the checks shown under the inspector.
import type { GsTable } from '../archive/gstable';
import { MapEditState, GRID, tileAt, type Selection } from '../editor/state';
import type { Issue } from '../editor/validate';
import { letterIndex, recCellPos, setRecCellPos, type MapDoc, type Rec } from '../game/sections';
import { hex8, u16, u32, w32 } from '../util/bytes';
import { oahuKindName } from './events';
import {
  OAHU_EVENT_SECTIONS,
  OAHU_LAYOUTS,
  oahuCharaKind,
  oahuCharaLabel,
  oahuExitKind,
  oahuExitLabel,
  oahuRecEventRow,
  type OahuMapInfo,
  type OahuMaps,
} from './maps';
import { oahuTreasureTable } from './treasure';

/** Sections with positioned records, drawn last first (exits on top). */
export const OAHU_POINT_SECTIONS = [3, 4, 5, 8, 2, 1, 9] as const;

/** A record of the dungeon to copy (with a copy of its EventObject row). */
export interface OahuTemplate {
  section: number;
  raw: Uint8Array;
  /** EventObject row of the record (null = none). */
  event: Uint8Array | null;
  label: string;
  /** Map it is copied from. */
  source: string;
}

export type OahuStamp =
  /** A prop (section 2): mapObject row and facing. */
  | { type: 'prop'; row: number; dir: number }
  | { type: 'template'; t: OahuTemplate };

export function oahuStampLabel(s: OahuStamp): string {
  return s.type === 'prop' ? `置物 (mapObject #${s.row})` : `${s.t.label} (${s.t.source} から)`;
}

/** Where a record keeps its EventObject row (sections 3 / 4 / 5 / 8: +0x04; map.md §3). */
const EVENT_FIELD = 4;
/** EventObject +0x4C: the state slot (0xFFFF = the row number; map.md §5.1). */
const SLOT_FIELD = 0x4c;

/** What a section's record is, for the add panel and the checks. */
export function oahuRecLabel(section: number, raw: Uint8Array): string {
  switch (section) {
    case 1: return `床のギミック ${raw[0x0d]}`;
    case 2: return `置物 #${u16(raw, 0)}`;
    case 3: return oahuExitLabel(oahuExitKind(raw));
    case 4: return '宝箱';
    case 5: return oahuCharaLabel(oahuCharaKind(raw));
    case 8: return u32(raw, 0) >= 100 ? `範囲の置物 ${u32(raw, 0)}` : `イベントの範囲 ${u32(raw, 0)}`;
    case 9: return `地点 ${u32(raw, 0)}`;
  }
  return `区画 ${section}`;
}

/** What an undo point copies besides the map: the loaded EventObject tables and the chest contents (treasureGroup). */
interface Tables {
  events: [archive: string, bytes: Uint8Array][];
  treasure: Uint8Array | null;
}

export class OahuEditState extends MapEditState<OahuStamp, Tables> {
  info: OahuMapInfo | null = null;
  readonly layouts = OAHU_LAYOUTS;
  readonly pointSections = OAHU_POINT_SECTIONS;

  constructor(readonly maps: OahuMaps) {
    super();
    // every edit goes to the map database right away (the map list marks the map, the export takes it)
    this.on((what) => {
      if (what === 'doc' && this.info) this.maps.commit(this.info);
    });
  }

  open(info: OahuMapInfo): void {
    const doc = this.maps.doc(info);
    this.docs.set(info.hash, doc);
    this.current = doc;
    this.info = info;
    this.tileset = this.maps.tileSource(info, doc).tileset;
    this.selection = { type: 'none' };
    if (this.stamp?.type === 'template' && this.tool === 'place') this.tool = 'select';
    this.emit('map');
  }

  /** The open map's dungeon. */
  get dungeon() {
    return this.info ? this.maps.dungeonOf(this.info) : undefined;
  }

  protected saveTables(): Tables {
    const treasure = this.treasureTable();
    return { events: this.maps.eventTableBytes(), treasure: treasure ? treasure.data.slice() : null };
  }
  protected restoreTables(t: Tables): void {
    const treasure = this.treasureTable();
    if (treasure && t.treasure) treasure.data = t.treasure.slice();
    this.maps.restoreEventTableBytes(t.events);
  }
  private treasureTable(): GsTable | null {
    return this.maps.objectRows ? oahuTreasureTable(this.maps.master) : null;
  }
  protected override docReplaced(doc: MapDoc): void {
    const info = this.maps.map(doc.hash);
    if (info) this.maps.setDoc(info, doc);
  }

  /** Props (+0x10) and exits (+0x14) face one of 4 ways. */
  override canRotate(section: number): boolean {
    return section === 2 || section === 3;
  }
  override rotateRecord(rec: Rec, section: number, dir: 1 | -1): void {
    const o = section === 2 ? 0x10 : 0x14;
    rec.raw[o] = ((rec.raw[o]! & 3) + dir + 4) & 3;
  }

  /** Copy an EventObject row of the open dungeon as a new row; returns its number (-1 when the table is not loaded). */
  private copyEventRow(row: Uint8Array): number {
    const d = this.dungeon;
    if (!d || !this.maps.loadedEventTable(d)) throw new Error('このダンジョンのイベントの表を読み込めていません');
    return this.maps.addEventRow(d, row.slice());
  }

  /** A point ID (section 3 +0x00) no map uses. */
  private newPointId(): number {
    const used = new Set<number>();
    for (const m of this.maps.maps) if (!m.world) for (const r of this.maps.doc(m).recs[3] ?? []) used.add(u32(r.raw, 0));
    let id: number;
    do id = (Math.random() * 0xffffffff) >>> 0;
    while (!id || used.has(id));
    return id;
  }

  placeStamp(doc: MapDoc, stamp: OahuStamp, cx: number, cy: number): [number, number] {
    let section: number, raw: Uint8Array;
    if (stamp.type === 'prop') {
      section = 2;
      raw = new Uint8Array(OAHU_LAYOUTS[2]!.size);
      w32(raw, 0, stamp.row);
      raw[0x10] = stamp.dir & 3;
    } else {
      const t = stamp.t;
      section = t.section;
      raw = t.raw.slice();
      if (section === 3) w32(raw, 0, this.newPointId());
      if (t.event) w32(raw, EVENT_FIELD, this.copyEventRow(t.event));
    }
    const rec: Rec = { raw, x: 0, y: 0 };
    setRecCellPos(rec, OAHU_LAYOUTS[section]!, cx, cy);
    const list = (doc.recs[section] ??= []);
    list.push(rec);
    return [section, list.length - 1];
  }

  duplicateRecord(_doc: MapDoc, section: number, rec: Rec): Rec {
    const copy: Rec = { raw: rec.raw.slice(), x: rec.x, y: rec.y };
    if (section === 3) w32(copy.raw, 0, this.newPointId());
    const ev = oahuRecEventRow(section, rec.raw);
    const table = this.dungeon ? this.maps.loadedEventTable(this.dungeon) : null;
    if (ev && table && ev < table.rows) w32(copy.raw, EVENT_FIELD, this.copyEventRow(table.row(ev)));
    return copy;
  }

  /** Put the open map back as it is in the ROM (with an undo point). */
  revert(): void {
    const info = this.info;
    if (!info) return;
    this.checkpoint();
    this.maps.revert(info);
    const doc = this.maps.doc(info);
    this.docs.set(info.hash, doc);
    this.current = doc;
    this.selection = { type: 'none' };
    this.emit('doc');
  }

  /** Records of the dungeon's maps to copy: the first of each kind (section, kind and EventObject kind). */
  templates(): OahuTemplate[] {
    const info = this.info;
    const d = this.dungeon;
    if (!info || !d) return [];
    const table = this.maps.loadedEventTable(d);
    const out = new Map<string, OahuTemplate>();
    const maps = this.maps.maps.filter((m) => m.dungeon === info.dungeon && !m.world);
    for (const k of [3, 4, 5, 8, 1, 9])
      for (const m of maps)
        for (const r of this.maps.doc(m).recs[k] ?? []) {
          const ev = oahuRecEventRow(k, r.raw);
          const event = ev && table && ev < table.rows ? table.row(ev).slice() : null;
          const kind = k === 3 ? oahuExitKind(r.raw) : k === 4 ? 0 : k === 1 ? r.raw[0x0d]! : u32(r.raw, 0);
          const key = `${k}/${kind}/${event ? event[0x55] : -1}`;
          if (out.has(key)) continue;
          const label = oahuRecLabel(k, r.raw) + (event ? ` ・ ${oahuKindName(event[0x55]!)}` : '');
          out.set(key, { section: k, raw: r.raw.slice(), event, label, source: m.name });
        }
    return [...out.values()];
  }
}

const states = new WeakMap<OahuMaps, OahuEditState>();
/** The map page's editing state (one per opened dump, kept across pages so undo survives). */
export function oahuEditState(maps: OahuMaps): OahuEditState {
  let st = states.get(maps);
  if (!st) {
    st = new OahuEditState(maps);
    states.set(maps, st);
  }
  return st;
}

// ---- checks

const baselines = new Map<string, Set<string>>();

/** Problems of an edited map that the ROM's map does not already have. */
export function oahuValidate(maps: OahuMaps, info: OahuMapInfo, doc: MapDoc): Issue[] {
  const d = maps.dungeonOf(info);
  const table = d ? maps.loadedEventTable(d) : null;
  const key = `${info.hash}/${table ? 1 : 0}`;
  let base = baselines.get(key);
  if (!base) {
    base = new Set(oahuValidateAll(maps, info, maps.originalDoc(info)).map((i) => i.key));
    baselines.set(key, base);
  }
  return oahuValidateAll(maps, info, doc).filter((i) => !base.has(i.key));
}

export function oahuValidateAll(maps: OahuMaps, info: OahuMapInfo, doc: MapDoc): Issue[] {
  const out: Issue[] = [];
  const cell = (x: number, y: number): Selection => ({ type: 'tiles', cells: [[x, y]] });
  const rec = (section: number, index: number): Selection => ({ type: 'rec', section, index });
  const tileset = maps.tileSource(info, doc).tileset;
  const dungeon = maps.dungeonOf(info);
  const table = dungeon ? maps.loadedEventTable(dungeon) : null;

  // tiles: inside the 30 x 30 grid, one per cell, with a model in the tileset
  const seen = new Map<string, number>();
  for (const t of doc.tiles) {
    const k = `${t.x},${t.y}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (t.x < 0 || t.y < 0 || t.x >= GRID || t.y >= GRID)
      out.push({ level: 'error', msg: `タイル (${t.x}, ${t.y}) が範囲 0〜${GRID - 1} の外です`, target: cell(t.x, t.y), key: `range/${k}` });
    if (!maps.partModel(t.kind, tileset, letterIndex(t.letter)))
      out.push({ level: 'warn', msg: `タイル (${t.x}, ${t.y}) 種類 ${t.kind}: このタイルセットにモデルがありません`, target: cell(t.x, t.y), key: `model/${k}/${t.kind}/${letterIndex(t.letter)}` });
  }
  for (const [k, n] of seen)
    if (n > 1) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      out.push({ level: 'warn', msg: `セル (${x}, ${y}) にタイルが ${n} 枚あります (後の 1 枚が使われます)`, target: cell(x, y), key: `dup/${k}` });
    }
  if (!doc.tiles.length) out.push({ level: 'error', msg: 'タイルがありません', key: 'empty' });

  // positions: 100 / 125 units are 0..299 (the game puts others at 0; map.md §3.5)
  for (const k of [2, 4, 5, 8]) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      if (r.x < 0 || r.x > 299 || r.y < 0 || r.y > 299)
        out.push({ level: 'error', msg: `${OAHU_LAYOUTS[k]!.label} #${i}: 座標 (${r.x}, ${r.y}) が 0〜299 の外です`, target: rec(k, i), key: `fine/${k}/${r.x},${r.y}` });
    });
  }
  // records on cells without a tile
  for (const k of OAHU_POINT_SECTIONS) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      const [px, py] = recCellPos(r, OAHU_LAYOUTS[k]!);
      if (!tileAt(doc, Math.floor(px), Math.floor(py)))
        out.push({ level: 'warn', msg: `${OAHU_LAYOUTS[k]!.label} #${i}: セル (${Math.floor(px)}, ${Math.floor(py)}) にタイルがありません`, target: rec(k, i), key: `notile/${k}/${hex8(u32(r.raw, 0))}/${r.x},${r.y}` });
    });
  }

  // EventObject rows: in the table, and one state slot each (chests that share a row share their contents)
  if (table) {
    const slots = new Map<number, Set<number>>();
    for (const k of OAHU_EVENT_SECTIONS) {
      (doc.recs[k] ?? []).forEach((r, i) => {
        const row = oahuRecEventRow(k, r.raw);
        if (!row) return;
        if (row >= table.rows) {
          out.push({ level: 'error', msg: `${OAHU_LAYOUTS[k]!.label} #${i}: EventObject の行 ${row} がありません (表は ${table.rows} 行)`, target: rec(k, i), key: `evrow/${k}/${row}` });
          return;
        }
        const s = u16(table.row(row), SLOT_FIELD);
        const slot = s === 0xffff ? row : s;
        slots.set(slot, (slots.get(slot) ?? new Set()).add(row));
      });
    }
    for (const [slot, rows] of slots)
      if (rows.size > 1)
        out.push({ level: 'warn', msg: `EventObject の行 ${[...rows].join(', ')} が同じ状態の枠 ${slot} を使っています (開けた・倒したなどの状態を共有します)`, key: `slotdup/${slot}/${[...rows].join(',')}` });
    const chests = new Map<number, number>();
    for (const r of doc.recs[4] ?? []) chests.set(oahuRecEventRow(4, r.raw), (chests.get(oahuRecEventRow(4, r.raw)) ?? 0) + 1);
    for (const [row, n] of chests)
      if (n > 1) out.push({ level: 'warn', msg: `宝箱 ${n} 個が同じ EventObject の行 ${row} を使っています (中身と「開けた」状態を共有します)`, key: `chestdup/${row}` });
  }

  // section 3: point IDs are what the exits of other maps lead to (EventObject +0x14)
  const ids = new Map<number, number>();
  for (const r of doc.recs[3] ?? []) ids.set(u32(r.raw, 0), (ids.get(u32(r.raw, 0)) ?? 0) + 1);
  (doc.recs[3] ?? []).forEach((r, i) => {
    const id = u32(r.raw, 0);
    if (id && ids.get(id)! > 1 && oahuExitKind(r.raw) !== 0x64)
      out.push({ level: 'warn', msg: `出入口 #${i}: 地点 ID ${hex8(id).toUpperCase()} がこのマップでほかにも使われています`, target: rec(3, i), key: `iddup/${hex8(id)}` });
  });
  const now = new Set(ids.keys());
  for (const r of maps.originalDoc(info).recs[3] ?? []) {
    const id = u32(r.raw, 0);
    if (!now.has(id)) out.push({ level: 'warn', msg: `元の出入口 (地点 ${hex8(id).toUpperCase()}) が消えています。ここへ来る出入口の行き先がなくなります`, key: `gone/${hex8(id)}` });
  }

  // section 6: cells on tiles
  doc.cells6.forEach((c) => {
    if (!tileAt(doc, c.x, c.y)) out.push({ level: 'warn', msg: `区画 6 のセル (${c.x}, ${c.y}) にタイルがありません`, target: cell(c.x, c.y), key: `s6/${c.x},${c.y}` });
  });
  return out;
}
