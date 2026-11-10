// Adding, copying and renaming the maps and the dungeons (MapGroup rows) of a 電波人間のRPG FREE! content (naauao
// lanai/map.md §2, §7), as RPG2's "マップを追加" / "ダンジョンを追加" (game/newmap.ts, game/newdungeon.ts).
//
// - A map is a row of the content's map table (0x4C bytes: 10 section hashes, MapData row ID, MapGroup row, floor,
//   name) and its sections in the content's map database. A new map gets new random hashes (the ROM's are not a hash
//   of the name that Panana knows: map.md §13), like RPG2's; the sections that have bytes are added to the database.
// - A dungeon is a MapGroup row: its name (a MessageMapName row of the master), MapData, first map, EventObject table
//   (an entry of the content's archive) and the range of state slots (+0x28 first, +0x2A count; the groups' ranges
//   follow each other). A new group gets a copy of its template's row, its own EventObject table (a new entry, packed
//   like the template's and listed in TableResource when the template's is), its own name row and the state slots
//   after the last group's.
// - Copying a dungeon copies all its maps and its EventObject table: the copies' rows keep their numbers, so the
//   records name the same rows, and the actions' arguments that name a map of the group (stairs, exits) are turned to
//   the copies, so the copy is a dungeon of its own.
// - The CRO of the content (contentsNNNN.cro) names its event classes after the maps (D01001B01Npc0201): a map with
//   another name is not expected to find them, so the rows with a script action do nothing there (not checked in the
//   game). renameMap and the copies say so (scriptRows).
import { newHash } from '../game/mappatch';
import { loadDoc, type MapDoc } from '../game/sections';
import { cstr, hex8, u32, w32 } from '../util/bytes';
import { LANAI_ACTION_SCRIPT } from './actions';
import {
  LANAI_EVENT_ACTIONS,
  LANAI_EVENT_ARGS,
  LANAI_MAP_FORMAT,
  LANAI_MAP_NAME_MAX,
  LANAI_MAP_NAME_OFFSET,
  LANAI_MAP_ROW,
  LANAI_SECTION_SLOT,
  type LanaiMapInfo,
  type LanaiMaps,
} from './maps';
import { LanaiTable } from './table';

/** MapGroup fields (map.md §7). */
export const LANAI_MG = { name: 0x00, firstMap: 0x14, firstPoint: 0x18, eventEntry: 0x1c, stateFirst: 0x28, stateCount: 0x2a } as const;
/** Map table fields besides the sections (map.md §2). */
const ROW_GROUP = 0x2c;
const ROW_FLOOR = 0x34;

const NAME_RE = /^[A-Z0-9_]+$/;

/** Why a map name cannot be used in the content (''= it can). */
export function mapNameProblem(maps: LanaiMaps, name: string, except?: LanaiMapInfo): string {
  if (!name) return 'マップのコードを入れてください';
  if (name.length > LANAI_MAP_NAME_MAX) return `マップのコードは ${LANAI_MAP_NAME_MAX} 文字までです`;
  if (!NAME_RE.test(name)) return 'マップのコードは英大文字・数字・_ で書いてください (例: D01001B01)';
  const other = maps.mapByName(name);
  if (other && other !== except) return `このステージには ${name} がもうあります`;
  return '';
}

/** The dungeon code of a group: the first 3 letters most of its maps' names start with ("D01"), '' when it has none. */
export function groupCode(maps: LanaiMaps, group: number): string {
  const n = new Map<string, number>();
  for (const m of maps.maps) if (m.dungeon === group && !m.world && m.name.length >= 3) n.set(m.name.slice(0, 3), (n.get(m.name.slice(0, 3)) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** The codes (first 3 letters) the content's maps use. */
export function takenCodes(maps: LanaiMaps): Set<string> {
  return new Set(maps.maps.filter((m) => m.name.length >= 3).map((m) => m.name.slice(0, 3)));
}

/** A code for a new group: `kind` and the next free 2 digits ("D09"). */
export function suggestGroupCode(maps: LanaiMaps, kind = 'D'): string {
  const taken = takenCodes(maps);
  for (let n = 1; n < 100; n++) {
    const c = `${kind}${String(n).padStart(2, '0')}`;
    if (!taken.has(c)) return c;
  }
  return `${kind}99`;
}

/** Why a group code cannot be used for a new group or a group's new code ('' = it can). */
export function groupCodeProblem(maps: LanaiMaps, code: string, group = -1): string {
  if (!/^[A-Z][A-Z0-9]{2}$/.test(code)) return 'ダンジョンのコードは英大文字 1 文字 + 英数字 2 文字にしてください (例: D09)';
  if (maps.maps.some((m) => m.dungeon !== group && m.name.startsWith(code))) return `${code} はこのステージのほかのマップが使っています`;
  return '';
}

/** "B01" / "F01" (floor 0 reads as F01, as the towns' maps). */
const floorPart = (floor: number): string => (floor < 0 ? `B${String(-floor).padStart(2, '0')}` : `F${String(Math.max(1, floor)).padStart(2, '0')}`);

/** "D01003B02": the code, the next free 3-digit number, the floor (the ROM's naming: map.md §2). */
export function suggestMapName(maps: LanaiMaps, code: string, floor: number): string {
  for (let n = 1; n < 1000; n++) {
    const name = `${code}${String(n).padStart(3, '0')}${floorPart(floor)}`;
    if (!maps.mapByName(name)) return name;
  }
  return '';
}

/** A map's name with another code ("D01001B01" with D09 -> "D09001B01"; a name that does not start with `from` is kept). */
export const recodeMapName = (name: string, from: string, to: string): string => (from && name.startsWith(from) ? to + name.slice(from.length) : name);

/** Every hash the content's map table and database use (new hashes avoid them). */
export function takenHashes(maps: LanaiMaps): Set<number> {
  const out = new Set<number>();
  const t = maps.tableBytes;
  for (let i = 0; i + LANAI_MAP_ROW <= t.length; i += LANAI_MAP_ROW) for (let k = 0; k < 10; k++) out.add(u32(t, i + k * 4));
  return out;
}

/** `n` new hashes: none the content uses, none of `reserved` (the hashes of rows not in the table yet; they are added). */
function newHashes(maps: LanaiMaps, n: number, rand: () => number, reserved = new Set<number>()): number[] {
  const taken = takenHashes(maps);
  for (const h of reserved) taken.add(h);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = newHash((x) => taken.has(x) || maps.db.has(x), rand);
    taken.add(h);
    reserved.add(h);
    out.push(h);
  }
  return out;
}

/** The row of `info` in the map table (a copy). */
function mapRow(maps: LanaiMaps, info: LanaiMapInfo): Uint8Array {
  return maps.tableBytes.slice(info.index * LANAI_MAP_ROW, (info.index + 1) * LANAI_MAP_ROW);
}

function writeName(row: Uint8Array, name: string): void {
  row.fill(0, LANAI_MAP_NAME_OFFSET, LANAI_MAP_ROW);
  for (let i = 0; i < name.length; i++) row[LANAI_MAP_NAME_OFFSET + i] = name.charCodeAt(i);
}

/** A map table row from `from`'s with new section hashes (by slot), group, floor and name. */
function newRow(from: Uint8Array, slots: number[], group: number, floor: number, name: string): Uint8Array {
  const row = from.slice();
  for (let s = 0; s < 10; s++) w32(row, s * 4, slots[s]!);
  w32(row, ROW_GROUP, group);
  w32(row, ROW_FLOOR, floor >>> 0);
  writeName(row, name);
  return row;
}

/** The sections (by section number) of a map table row's slots (map.md §3: section k = slot k, 8 / 9 -> 7 / 8). */
const sectionsOf = (slots: number[]): number[] => LANAI_SECTION_SLOT.map((s) => (s < 0 ? 0 : slots[s]!));

/** Puts a document's sections in the database (those with bytes), for a new map. */
function addSections(maps: LanaiMaps, sections: number[], doc: MapDoc): void {
  for (let k = 0; k < 10; k++) {
    const h = sections[k]!;
    if (k === 7 || !h) continue;
    const b = maps.sectionBytes(doc, k);
    if (b.length) maps.db.add(h, b);
  }
}

/** Appends rows to the map table and reads the maps again. */
function appendRows(maps: LanaiMaps, rows: Uint8Array[]): void {
  const t = maps.tableBytes;
  const out = new Uint8Array(t.length + rows.length * LANAI_MAP_ROW);
  out.set(t);
  rows.forEach((r, i) => out.set(r, t.length + i * LANAI_MAP_ROW));
  maps.setTableBytes(out);
}

/** EventObject rows of a group's table with a script action (the CRO's classes are found by the map's name). */
export function scriptRows(maps: LanaiMaps, group: number): number {
  const t = maps.eventTable(group);
  let n = 0;
  for (let r = 1; t && r < t.rows; r++) if (LANAI_EVENT_ACTIONS.some((o) => t.u32(r, o) === LANAI_ACTION_SCRIPT)) n++;
  return n;
}

/** The maps of a group (not the world map), as the map table lists them. */
export const groupMaps = (maps: LanaiMaps, group: number): LanaiMapInfo[] => maps.maps.filter((m) => m.dungeon === group && !m.world);

// ---- a new map in a group

export interface LanaiNewMapSpec {
  /** A map of the group the new map goes in: its row is copied (MapData, how the enemies come …). */
  template: LanaiMapInfo;
  floor: number;
  name: string;
  /** 'none' = no tiles (the encounter header only), 'tiles' = the template's tiles, 'all' = a copy of the whole map. */
  copy: 'none' | 'tiles' | 'all';
}

/**
 * Add a map to the template's group. With 'all' the records are copied too, and each EventObject row they name gets a
 * copy of its own (with a state slot of its own: maps.addEventRow), so a chest of the copy is opened on its own; the
 * records that shared a row share its copy. Returns the new map (saved with the session's edits).
 */
export function addLanaiMap(maps: LanaiMaps, spec: LanaiNewMapSpec, rand: () => number = Math.random): LanaiMapInfo {
  const t = spec.template;
  const name = spec.name.trim().toUpperCase();
  const problem = mapNameProblem(maps, name);
  if (problem) throw new Error(problem);
  if (t.world) throw new Error('ワールドマップは写せません');
  if (!Number.isInteger(spec.floor) || Math.abs(spec.floor) > 99) throw new Error('階は -99〜99 にしてください');
  const slots = newHashes(maps, 10, rand);
  const sections = sectionsOf(slots);
  const src = maps.doc(t);
  const doc = loadDoc({ get: () => new Uint8Array(0) }, { hash: slots[0]!, name, dungeon: t.dungeon, floor: spec.floor, sections }, LANAI_MAP_FORMAT);
  delete doc.raw[6];
  doc.sec6Header = src.sec6Header.slice();
  if (spec.copy !== 'none') doc.tiles = src.tiles.map((x) => ({ ...x }));
  if (spec.copy === 'all') {
    const copied = new Map<number, number>();
    for (const [k, list] of Object.entries(src.recs)) {
      doc.recs[Number(k)] = list.map((r) => {
        const raw = r.raw.slice();
        const ev = isEventSection(Number(k)) ? u32(raw, 4) : 0;
        if (ev > 0 && maps.eventTable(t.dungeon) && ev < maps.eventTable(t.dungeon)!.rows) {
          let row = copied.get(ev);
          if (row === undefined) copied.set(ev, (row = maps.addEventRow(t.dungeon, ev)));
          w32(raw, 4, row);
        }
        return { ...r, raw };
      });
    }
    doc.cells6 = src.cells6.map((c) => ({ ...c }));
    for (const [k, b] of Object.entries(src.raw)) if (Number(k) !== 6) doc.raw[Number(k)] = b.slice();
  }
  addSections(maps, sections, doc);
  appendRows(maps, [newRow(mapRow(maps, t), slots, t.dungeon, spec.floor, name)]);
  maps.session.edited();
  return maps.map(slots[0]!)!;
}

const isEventSection = (k: number): boolean => k === 3 || k === 4 || k === 5 || k === 8;

// ---- a new group

export interface LanaiNewGroupSpec {
  /** The MapGroup row whose settings are copied (look, music, talk table …). */
  template: number;
  /** The name shown in the game (a new MessageMapName row). */
  name: string;
  /** The code the maps' names start with ("D09"). */
  code: string;
  /**
   * true = a copy of the whole group (its maps and its EventObject table), false = a new group with one map from
   * `first` (no records; an EventObject table with its empty row 0 only).
   */
  copyMaps: boolean;
  first?: { template: LanaiMapInfo; floor: number; name: string; copyTiles: boolean };
}

export interface LanaiNewGroup {
  group: number;
  /** The first map of the group (MapGroup +0x14). */
  first: LanaiMapInfo;
  /** The maps made. */
  made: LanaiMapInfo[];
  /** The group's state slots. */
  stateFirst: number;
  stateCount: number;
}

/** The first slot after every group's range of state slots (map.md §7.2: the ranges follow each other). */
export function nextStateSlot(maps: LanaiMaps): number {
  return Math.max(0, ...maps.groups.map((g) => (g.stateCount ? g.stateFirst + g.stateCount : 0)));
}

/** The ROM's end of the content's state slots (a new group goes after it). */
export function romStateEnd(maps: LanaiMaps): number {
  const mg = maps.mapGroup;
  if (!mg) return 0;
  let end = 0;
  for (let r = 0; r < mg.originalRows; r++) {
    const o = mg.originalRow(r)!;
    const n = o[LANAI_MG.stateCount]!;
    if (n) end = Math.max(end, (o[LANAI_MG.stateFirst]! | (o[LANAI_MG.stateFirst + 1]! << 8)) + n);
  }
  return end;
}

/** The name field of MessageMapName (the dungeons' names). */
function nameField(t: LanaiTable): number {
  const f = t.fields.find((x) => x.name === 'message');
  if (!f) throw new Error('MessageMapName に message の欄がありません');
  return f.offset;
}

/** A new MessageMapName row (a copy of the row `like` names, or of row 0) with `name`; returns its row ID. */
function addNameRow(maps: LanaiMaps, like: number, name: string): number {
  const msg = maps.session.table('MessageMapName');
  if (!msg) throw new Error('マスターに MessageMapName がありません');
  const from = Math.max(0, msg.find(like));
  const r = msg.addRow(from);
  maps.session.setText(msg, r, nameField(msg), name);
  return msg.rowIds.length ? msg.rowId(r) : r;
}

/** A hash for a new entry of the content's archive (none of its entries' nor the added tables'). */
function newEntryHash(maps: LanaiMaps, rand: () => number): number {
  const taken = new Set([...maps.archive.entries.map((e) => e.hash), ...maps.session.addedTables().filter((t) => t.archive === maps.content.archive.toUpperCase()).map((t) => t.entry)]);
  return newHash((h) => taken.has(h), rand);
}

/** "d01_EventObject.bin" -> "d01_EventObject_2.bin" (a ZIP name the archive does not have yet). */
function newFileName(maps: LanaiMaps, file: string | null, group: number): string {
  const base = (file || 'EventObject.bin').replace(/\.bin$/i, '');
  const used = new Set(maps.session.addedTables().map((t) => t.file));
  for (let n = group; ; n++) {
    const f = `${base}_${n}.bin`;
    if (!used.has(f)) return f;
  }
}

/** The content's TableResource (the hashes of the archive's tables to read), if it is a table. */
const tableResource = (maps: LanaiMaps): LanaiTable | undefined => maps.contentTable('TableResource');

/**
 * Add a group (a dungeon) to the content: a copy of the template's MapGroup row with its own name, EventObject table
 * and state slots, and its maps (all the template's copied, or one new map). Saved with the session's edits.
 */
export function addLanaiGroup(maps: LanaiMaps, spec: LanaiNewGroupSpec, rand: () => number = Math.random): LanaiNewGroup {
  const mg = maps.mapGroup;
  const session = maps.session;
  if (!mg) throw new Error('このステージには MapGroup の表がありません');
  const g = maps.groups[spec.template];
  if (!g || spec.template <= 0) throw new Error('写す元のダンジョン (MapGroup) を選んでください');
  const name = spec.name.trim();
  if (!name) throw new Error('ダンジョンの名前を入れてください');
  const code = spec.code.trim().toUpperCase();
  const codeProblem = groupCodeProblem(maps, code);
  if (codeProblem) throw new Error(codeProblem);
  const events = maps.eventTable(spec.template);
  const ref = events && session.refOf(events);
  if (!events || !ref) throw new Error(`MapGroup ${spec.template} の EventObject の表がありません`);
  const from = groupCode(maps, spec.template);
  const sourceMaps = groupMaps(maps, spec.template);
  // the names of the maps first (nothing is changed when one does not fit)
  let plan: { from: LanaiMapInfo; name: string; floor: number; copy: 'none' | 'tiles' | 'all' }[];
  if (spec.copyMaps) {
    if (!sourceMaps.length) throw new Error('写す元のダンジョンにマップがありません');
    plan = sourceMaps.map((m) => ({ from: m, name: from ? recodeMapName(m.name, from, code) : `${code}${m.name.slice(3)}`, floor: m.floor, copy: 'all' }));
  } else {
    const f = spec.first;
    if (!f) throw new Error('最初のマップを決めてください');
    plan = [{ from: f.template, name: f.name.trim().toUpperCase(), floor: f.floor, copy: f.copyTiles ? 'tiles' : 'none' }];
  }
  const names = new Set<string>();
  for (const p of plan) {
    const problem = mapNameProblem(maps, p.name);
    if (problem) throw new Error(`${p.name}: ${problem}`);
    if (names.has(p.name)) throw new Error(`${p.name} が 2 つになります`);
    names.add(p.name);
  }
  const stateFirst = nextStateSlot(maps);
  if (stateFirst + g.stateCount > 0xffff) throw new Error('状態の枠の番号が 0xFFFF を超えます');

  // the EventObject table: a copy (all its rows, or row 0 = no event), a new entry of the archive
  const table = LanaiTable.copyOf(events, spec.copyMaps ? events.rows : 1);
  const group = mg.rows;
  const entry = newEntryHash(maps, rand);
  session.addTable(maps.content.archive, entry, newFileName(maps, ref.file, group), g.eventEntry, table);
  maps.addContentTable(entry, table);
  const tr = tableResource(maps);
  if (tr && tr.rowSize >= 4) {
    const r = Array.from({ length: tr.rows }, (_, i) => i).find((i) => tr.u32(i, 0) === g.eventEntry);
    if (r !== undefined) tr.setU32(tr.addRow(r), 0, entry);
  }
  // the MapGroup row
  const row = mg.addRow(spec.template);
  if (row !== group) throw new Error('MapGroup の行が思った番号になりません');
  mg.setU32(row, LANAI_MG.name, addNameRow(maps, g.nameId, name));
  mg.setU32(row, LANAI_MG.eventEntry, entry);
  mg.setU16(row, LANAI_MG.stateFirst, stateFirst);
  maps.readGroups();

  // the maps: new hashes, the sections copied (a copy) or the first map's tiles
  const rows: Uint8Array[] = [];
  const hashOf = new Map<number, number>();
  const made: number[] = [];
  const reserved = new Set<number>();
  for (const p of plan) {
    const slots = newHashes(maps, 10, rand, reserved);
    const sections = sectionsOf(slots);
    const src = maps.doc(p.from);
    const doc = loadDoc({ get: () => new Uint8Array(0) }, { hash: slots[0]!, name: p.name, dungeon: group, floor: p.floor, sections }, LANAI_MAP_FORMAT);
    delete doc.raw[6];
    doc.sec6Header = src.sec6Header.slice();
    if (p.copy !== 'none') doc.tiles = src.tiles.map((x) => ({ ...x }));
    if (p.copy === 'all') {
      for (const [k, list] of Object.entries(src.recs)) doc.recs[Number(k)] = list.map((r) => ({ ...r, raw: r.raw.slice() }));
      doc.cells6 = src.cells6.map((c) => ({ ...c }));
      for (const [k, b] of Object.entries(src.raw)) if (Number(k) !== 6) doc.raw[Number(k)] = b.slice();
    }
    addSections(maps, sections, doc);
    rows.push(newRow(mapRow(maps, p.from), slots, group, p.floor, p.name));
    hashOf.set(p.from.hash, slots[0]!);
    made.push(slots[0]!);
  }
  // the actions that name a map of the group (stairs, exits, warps) go to the copies
  if (spec.copyMaps) remapEventMaps(table, hashOf);
  const first = hashOf.get(g.firstMap) ?? made[0]!;
  mg.setU32(row, LANAI_MG.firstMap, first);
  appendRows(maps, rows);
  maps.readGroups();
  session.edited();
  return { group, first: maps.map(first)!, made: made.map((h) => maps.map(h)!), stateFirst, stateCount: g.stateCount };
}

/** Turn the actions' arguments that are a key of `hashOf` (a map of the copied group) to its copy. Returns how many. */
export function remapEventMaps(t: LanaiTable, hashOf: Map<number, number>): number {
  let n = 0;
  for (let r = 0; r < t.rows; r++)
    for (const o of LANAI_EVENT_ACTIONS)
      for (let a = 0; a < LANAI_EVENT_ARGS; a++) {
        const to = hashOf.get(t.u32(r, o + 4 + a * 4));
        if (to === undefined) continue;
        t.setU32(r, o + 4 + a * 4, to);
        n++;
      }
  return n;
}

// ---- names

/**
 * Rename a map (+0x40 of its row). The hash stays, so the exits that lead to it still do; the CRO's classes for its
 * events are named after the old name (see scriptRows).
 */
export function renameLanaiMap(maps: LanaiMaps, info: LanaiMapInfo, name: string): void {
  const n = name.trim().toUpperCase();
  if (n === info.name) return;
  const problem = mapNameProblem(maps, n, info);
  if (problem) throw new Error(problem);
  const t = maps.tableBytes.slice();
  const row = t.subarray(info.index * LANAI_MAP_ROW, (info.index + 1) * LANAI_MAP_ROW);
  writeName(row, n);
  maps.setTableBytes(t);
  maps.session.edited();
}

/** Whether a group's name row is its own (a MessageMapName row an edit added for it): writing it renames no other group. */
export function ownsName(maps: LanaiMaps, group: number): boolean {
  const msg = maps.session.table('MessageMapName');
  const g = maps.groups[group];
  if (!msg || !g) return false;
  const r = msg.find(g.nameId);
  return r >= msg.originalRows && !maps.groups.some((x) => x.row !== group && x.nameId === g.nameId);
}

/**
 * Rename a group (its name in the game). The ROM's name rows are shared by the stages that reuse a dungeon, so the
 * group gets a name row of its own first (a copy of its row) and only that row is written.
 */
export function renameLanaiGroup(maps: LanaiMaps, group: number, name: string): void {
  const n = name.trim();
  const g = maps.groups[group];
  const mg = maps.mapGroup;
  if (!g || !mg || group <= 0) throw new Error(`MapGroup ${group} はありません`);
  if (!n) throw new Error('ダンジョンの名前を入れてください');
  if (n === maps.groupName(group)) return;
  const msg = maps.session.table('MessageMapName');
  if (!msg) throw new Error('マスターに MessageMapName がありません');
  if (ownsName(maps, group)) maps.session.setText(msg, msg.find(g.nameId), nameField(msg), n);
  else mg.setU32(group, LANAI_MG.name, addNameRow(maps, g.nameId, n));
  maps.readGroups();
  maps.session.edited();
  maps.changed();
}

/** Change the code a group's maps' names start with (the names that start with the old code). */
export function recodeLanaiGroup(maps: LanaiMaps, group: number, code: string): void {
  const c = code.trim().toUpperCase();
  const old = groupCode(maps, group);
  if (c === old) return;
  const problem = groupCodeProblem(maps, c, group);
  if (problem) throw new Error(problem);
  const list = groupMaps(maps, group);
  const t = maps.tableBytes.slice();
  for (const m of list) {
    const n = recodeMapName(m.name, old, c);
    const p = mapNameProblem(maps, n, m);
    if (p && !list.some((x) => x.name === n)) throw new Error(`${n}: ${p}`);
    writeName(t.subarray(m.index * LANAI_MAP_ROW, (m.index + 1) * LANAI_MAP_ROW), n);
  }
  maps.setTableBytes(t);
  maps.session.edited();
}

// ---- taking out what was added

/** Take out an added map (its row and its sections). The EventObject rows copied for it stay (unused). */
export function removeLanaiMap(maps: LanaiMaps, info: LanaiMapInfo): void {
  if (!info.added) throw new Error(`${info.name} は ROM のマップなので消せません`);
  for (const h of info.sections) if (h && maps.db.isAdded(h)) maps.db.remove(h);
  const t = maps.tableBytes;
  const out = new Uint8Array(t.length - LANAI_MAP_ROW);
  out.set(t.subarray(0, info.index * LANAI_MAP_ROW));
  out.set(t.subarray((info.index + 1) * LANAI_MAP_ROW), info.index * LANAI_MAP_ROW);
  maps.setTableBytes(out);
  maps.session.edited();
}

/** Whether a group can be taken out: an added group that is the last row of MapGroup. */
export function canRemoveGroup(maps: LanaiMaps, group: number): boolean {
  const mg = maps.mapGroup;
  return !!mg && group === mg.rows - 1 && group >= mg.originalRows;
}

/** Take out the last added group: its maps, its EventObject table (and its TableResource row), its name row, its row. */
export function removeLanaiGroup(maps: LanaiMaps, group: number): void {
  const mg = maps.mapGroup!;
  if (!canRemoveGroup(maps, group)) throw new Error('消せるのは、追加したダンジョンのうち最後のものだけです');
  const g = maps.groups[group]!;
  for (const m of groupMaps(maps, group).reverse()) if (m.added) removeLanaiMap(maps, m);
  const ref = maps.session.addedTables().find((t) => t.archive === maps.content.archive.toUpperCase() && t.entry === g.eventEntry);
  if (ref) {
    maps.session.removeTable(ref);
    maps.removeContentTable(ref.entry);
  }
  const tr = tableResource(maps);
  if (tr && tr.rows > tr.originalRows && tr.u32(tr.rows - 1, 0) === g.eventEntry) tr.removeLastRow();
  const msg = maps.session.table('MessageMapName');
  if (msg && ownsName(maps, group) && msg.find(g.nameId) === msg.rows - 1) msg.removeLastRow();
  mg.removeLastRow();
  maps.readGroups();
  maps.session.edited();
  maps.changed();
}

/** "D09001B01 (1A2B3C4D)" */
export const lanaiMapLabel = (m: LanaiMapInfo): string => `${m.name} (${hex8(m.hash)})`;

/** The name a map table row holds (for the tests). */
export const rowName = (row: Uint8Array): string => cstr(row.subarray(LANAI_MAP_NAME_OFFSET), 0);
