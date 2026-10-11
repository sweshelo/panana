// RPG FREE!'s side of the map editor (editor/model.ts MapEditState; naauao lanai/map.md): the open map of a content's
// LanaiMaps, adding records (props, copies of the group's own records), copying and turning them (the facings of
// sections 2〜5 are the 1 / 2 / 4 / 8 masks), and the checks shown under the inspector. Every edit goes to the
// content's map database right away (the session saves it and exports it).
//
// Nothing besides the map is edited: the EventObject tables of the content are not editable yet, so a copied record
// names the same EventObject row as the one it was copied from (the checks say so).
import { MapEditState, GRID, tileAt, type Issue, type Selection } from '../editor/model';
import { LANAI_ROT_CODEC, letterIndex, recCellPos, setRecCellPos, type MapDoc, type Rec } from '../game/sections';
import { hex8, u32, w32 } from '../util/bytes';
import {
  LANAI_EVENT_SECTIONS,
  LANAI_FACING_OFFSET,
  LANAI_LAYOUTS,
  LANAI_POINT_SECTIONS,
  lanaiExitKind,
  lanaiExitLabel,
  type LanaiMapInfo,
  type LanaiMaps,
  type LanaiTileSource,
} from './maps';

/** The kind of the tiles the game leaves empty (map.md §6.3): no model, and not a problem. */
export const LANAI_EMPTY_KIND = 33;
/** Where a record keeps its EventObject row (sections 3 / 4 / 5 / 8: +0x04; map.md §7). */
const EVENT_FIELD = 4;
/** Section 3 +0x15 = 100: a door on a wall (it has no point of its own). */
const WALL_DOOR = 100;

/** A record of the group's maps to copy (it keeps its EventObject row). */
export interface LanaiTemplate {
  section: number;
  raw: Uint8Array;
  label: string;
  /** Map it is copied from. */
  source: string;
}

export type LanaiStamp =
  /** A prop (section 2): MapObject row (+0x00) and facing (turn 0..3). */
  | { type: 'prop'; row: number; dir: number }
  | { type: 'template'; t: LanaiTemplate };

export function lanaiStampLabel(s: LanaiStamp): string {
  return s.type === 'prop' ? `置物 (MapObject #${s.row})` : `${s.t.label} (${s.t.source} から)`;
}

/** EventObject row of a record (sections 3 / 4 / 5 / 8), 0 for the others. */
export const lanaiRecEventRow = (section: number, raw: Uint8Array): number => ((LANAI_EVENT_SECTIONS as readonly number[]).includes(section) ? u32(raw, EVENT_FIELD) : 0);

/** What a section's record is, for the add panel and the checks. */
export function lanaiRecLabel(section: number, raw: Uint8Array): string {
  switch (section) {
    case 1: return `床のギミック ${raw[0x0d]}`;
    case 2: return `置物 #${u32(raw, 0)}`;
    case 3: return lanaiExitLabel(lanaiExitKind(raw));
    case 4: return `宝箱 (見た目 ${u32(raw, 0)})`;
    case 5: return `キャラ・オブジェクト 種類 ${u32(raw, 0)}`;
    case 8: return u32(raw, 0) >= 100 ? `範囲の置物 ${u32(raw, 0)}` : `イベントの範囲 ${u32(raw, 0)}`;
    case 9: return `地点 ${u32(raw, 0)}`;
  }
  return `区画 ${section}`;
}

/** The turn (0..3) of a facing byte; a byte that is none of the masks reads as 0. */
const turnOf = (b: number): number => Math.max(0, LANAI_ROT_CODEC.decode(b));

export class LanaiEditState extends MapEditState<LanaiStamp, null> {
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
    this.maps.on(() => {
      if (this.info && this.current && !this.info.world && this.maps.doc(this.info) !== this.current) {
        this.reopen();
        this.emit('map');
      }
    });
  }

  open(info: LanaiMapInfo): void {
    this.info = info;
    this.reopen();
    if (this.stamp?.type === 'template' && this.tool === 'place') this.tool = 'select';
    this.emit('map');
  }

  private reopen(): void {
    const info = this.info!;
    const doc = this.maps.doc(info);
    this.docs.set(info.hash, doc);
    this.current = doc;
    this.selection = { type: 'none' };
    this.readSource();
  }

  /** Read the open map's MapData again (adding or removing indoor tiles can change it); returns whether it changed. */
  readSource(): boolean {
    if (!this.info || !this.current) return false;
    const src = this.maps.tileSource(this.info, this.current);
    const changed = !this.source || src.mapData !== this.source.mapData || src.tileset !== this.source.tileset;
    this.source = src;
    this.tileset = src.tileset;
    return changed;
  }

  protected saveTables(): null {
    return null;
  }
  protected restoreTables(): void {}
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
    rec.raw[o] = LANAI_ROT_CODEC.encode((turnOf(rec.raw[o]!) + dir + 4) & 3);
  }

  /** A point ID (section 3 +0x00) no map of the content uses. */
  private newPointId(): number {
    const used = new Set<number>();
    for (const m of this.maps.maps) if (!m.world) for (const r of this.maps.doc(m).recs[3] ?? []) used.add(u32(r.raw, 0));
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
    }
    const rec: Rec = { raw, x: 0, y: 0 };
    setRecCellPos(rec, LANAI_LAYOUTS[section]!, cx, cy);
    const list = (doc.recs[section] ??= []);
    list.push(rec);
    return [section, list.length - 1];
  }

  /** A copy of a record: an exit gets a new point ID; the EventObject row stays the same (the table is not edited). */
  duplicateRecord(_doc: MapDoc, section: number, rec: Rec): Rec {
    const copy: Rec = { raw: rec.raw.slice(), x: rec.x, y: rec.y };
    if (section === 3 && lanaiExitKind(rec.raw) !== WALL_DOOR) w32(copy.raw, 0, this.newPointId());
    return copy;
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
          const label = lanaiRecLabel(k, r.raw) + (action >= 0 ? ` ・ 動作 ${hex8(action).toUpperCase()}` : '');
          out.set(key, { section: k, raw: r.raw.slice(), label, source: m.name });
        }
    return [...out.values()];
  }

  /** MapObject rows the props of the content's maps use, most used first. */
  props(): number[] {
    const n = new Map<number, number>();
    for (const m of this.maps.maps) if (!m.world) for (const r of this.maps.doc(m).recs[2] ?? []) n.set(u32(r.raw, 0), (n.get(u32(r.raw, 0)) ?? 0) + 1);
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
      msg: `屋内のタイル (種類 15〜27) の有無が変わったので、MapData が行 ${before.mapData} → ${src.mapData} (タイルセット ${before.partsName || before.tileset} → ${src.partsName || src.tileset}) になります。ほかのタイルのモデルも変わります`,
      key: `mapdata/${src.mapData}`,
    });

  // tiles: inside the 30 x 30 grid, one per cell, with a model in the tileset (kind 33 is empty on purpose)
  const seen = new Map<string, number>();
  for (const t of doc.tiles) {
    const k = `${t.x},${t.y}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (t.x < 0 || t.y < 0 || t.x >= GRID || t.y >= GRID)
      out.push({ level: 'error', msg: `タイル (${t.x}, ${t.y}) が範囲 0〜${GRID - 1} の外です`, target: cell(t.x, t.y), key: `range/${k}` });
    if (t.kind !== LANAI_EMPTY_KIND && !maps.partRef(src, t.kind, letterIndex(t.letter)))
      out.push({ level: 'warn', msg: `タイル (${t.x}, ${t.y}) 種類 ${t.kind}: このタイルセット (${src.partsName || src.tileset}) にモデルがありません`, target: cell(t.x, t.y), key: `model/${k}/${t.kind}/${letterIndex(t.letter)}` });
  }
  for (const [k, n] of seen)
    if (n > 1) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      out.push({ level: 'warn', msg: `セル (${x}, ${y}) にタイルが ${n} 枚あります (後の 1 枚が使われます)`, target: cell(x, y), key: `dup/${k}` });
    }
  if (!doc.tiles.length) out.push({ level: 'error', msg: 'タイルがありません', key: 'empty' });

  // positions in 100 units are 0..299
  for (const k of [2, 4, 5, 8, 9]) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      if (r.x < 0 || r.x > 299 || r.y < 0 || r.y > 299)
        out.push({ level: 'error', msg: `${LANAI_LAYOUTS[k]!.label} #${i}: 座標 (${r.x}, ${r.y}) が 0〜299 の外です`, target: rec(k, i), key: `fine/${k}/${r.x},${r.y}` });
    });
  }
  // records on cells without a tile
  for (const k of LANAI_POINT_SECTIONS) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
      if (!tileAt(doc, Math.floor(px), Math.floor(py)))
        out.push({ level: 'warn', msg: `${LANAI_LAYOUTS[k]!.label} #${i}: セル (${Math.floor(px)}, ${Math.floor(py)}) にタイルがありません`, target: rec(k, i), key: `notile/${k}/${hex8(u32(r.raw, 0))}/${r.x},${r.y}` });
    });
  }

  // EventObject rows: in the group's table, one record each (records that share a row share its state)
  const users = new Map<number, number>();
  for (const k of LANAI_EVENT_SECTIONS) {
    (doc.recs[k] ?? []).forEach((r, i) => {
      const row = lanaiRecEventRow(k, r.raw);
      if (!row) return;
      users.set(row, (users.get(row) ?? 0) + 1);
      if (table && row >= table.rows)
        out.push({ level: 'error', msg: `${LANAI_LAYOUTS[k]!.label} #${i}: EventObject の行 ${row} がありません (表は ${table.rows} 行)`, target: rec(k, i), key: `evrow/${k}/${row}` });
    });
  }
  for (const [row, n] of users)
    if (n > 1) out.push({ level: 'warn', msg: `${n} 個のレコードが同じ EventObject の行 ${row} を使っています (宝箱の中身や「開けた」などの状態を共有します)`, key: `evshare/${row}/${n}` });

  // section 3: point IDs are what the exits of other maps lead to (EventObject +0x18)
  const ids = new Map<number, number>();
  for (const r of doc.recs[3] ?? []) ids.set(u32(r.raw, 0), (ids.get(u32(r.raw, 0)) ?? 0) + 1);
  (doc.recs[3] ?? []).forEach((r, i) => {
    const id = u32(r.raw, 0);
    if (id && ids.get(id)! > 1 && lanaiExitKind(r.raw) !== WALL_DOOR)
      out.push({ level: 'warn', msg: `出入口 #${i}: 地点 ID ${hex8(id).toUpperCase()} がこのマップでほかにも使われています`, target: rec(3, i), key: `iddup/${hex8(id)}` });
  });
  for (const r of maps.originalDoc(info).recs[3] ?? []) {
    const id = u32(r.raw, 0);
    if (!ids.has(id)) out.push({ level: 'warn', msg: `元の出入口 (地点 ${hex8(id).toUpperCase()}) が消えています。ここへ来る出入口の行き先がなくなります`, key: `gone/${hex8(id)}` });
  }

  // section 6: cells on tiles
  doc.cells6.forEach((c) => {
    if (!tileAt(doc, c.x, c.y)) out.push({ level: 'warn', msg: `区画 6 のセル (${c.x}, ${c.y}) にタイルがありません`, target: cell(c.x, c.y), key: `s6/${c.x},${c.y}` });
  });
  return out;
}
