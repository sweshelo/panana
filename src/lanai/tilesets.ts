// The tilesets of 電波人間のRPG FREE! (lanai) and giving a map another one. A content keeps the tilesets of its maps:
// MapData +0x0A names a row of its MapPartsType (the entry of a MapParts<name> table of its archive: 67 tile kinds × 8
// letters, each a GSC model of a root archive) and +0x0B a row of its MapResource (the tiles' texture). The MapParts
// table of a tileset has the same entry hash in every content (CaveC = 0xDAB22400 in contents 28 and 58), and a content
// can hold many (content 58 has 10), so another tileset is given by copying its table from a content that has it,
// adding a MapPartsType row for it and a MapResource row (the texture a MapData row of that content pairs with it), and
// pointing the MapData row at them. The tile kinds mean the same in every tileset (as RPG3's mapParts); a kind the new
// tileset has no model for shows nothing (tilesetGaps tells which).
import { lanaiContents } from './contents';
import type { LanaiMaps, LanaiPartRef } from './maps';
import type { LanaiSession } from './session';
import { LanaiTable } from './table';
import { equalBytes } from '../util/bytes';

export interface LanaiTileset {
  /** Entry hash of its MapParts table (the same in every content). */
  entry: number;
  /** "CaveA" (the table's name without MapParts). */
  name: string;
  /** The contents that have it (the first gives the table and the texture). */
  contents: number[];
  /** The MapResource row the contents' MapData pair with it most often (a texture of its own: not the empty row 0). */
  resource: Uint8Array;
  /** The model of the room floor (kind 5, else the corridor 1) for a picture. */
  floor: LanaiPartRef | null;
}

/** Tile kinds tried for the picture of a tileset: the room floor, then a straight corridor (as RPG2's picker). */
const FLOOR_KINDS = [5, 1];
const PARTS = 'MapParts';

const catalogs = new WeakMap<LanaiSession, Promise<LanaiTileset[]>>();

/** Every tileset of the ROM's contents (read once per session: it reads every content's tables). */
export function lanaiTilesets(s: LanaiSession): Promise<LanaiTileset[]> {
  let p = catalogs.get(s);
  if (!p) {
    p = readTilesets(s);
    p.catch(() => catalogs.delete(s));
    catalogs.set(s, p);
  }
  return p;
}

async function readTilesets(s: LanaiSession): Promise<LanaiTileset[]> {
  const out = new Map<number, LanaiTileset>();
  // the textures seen with each tileset: bytes (hex) -> count
  const seen = new Map<number, Map<string, { bytes: Uint8Array; n: number }>>();
  for (const c of lanaiContents(s)) {
    if (!c || c.index === 0 || s.createdFiles.has(c.archive.toUpperCase())) continue;
    let tables;
    try {
      tables = await s.tablesIn(c.archive);
    } catch {
      continue;
    }
    const named = (n: string) => tables.find((t) => t.table.name === n)?.table;
    const md = named('MapData'),
      pt = named('MapPartsType'),
      mr = named('MapResource');
    if (!md || !pt || !mr) continue;
    for (let r = 0; r < md.rows; r++) {
      const ts = md.row(r)[0x0a]!,
        res = md.row(r)[0x0b]!;
      if (ts >= pt.rows || res >= mr.rows) continue;
      const entry = pt.u32(ts, 0);
      const parts = tables.find((t) => t.entry === entry)?.table;
      if (!parts || !parts.name.startsWith(PARTS)) continue;
      const key = Array.from(mr.row(res), (b) => b.toString(16).padStart(2, '0')).join('');
      const counts = seen.get(entry) ?? seen.set(entry, new Map()).get(entry)!;
      const k = counts.get(key);
      if (k) k.n++;
      else counts.set(key, { bytes: mr.row(res).slice(), n: 1 });
      const have = out.get(entry);
      if (have) {
        if (!have.contents.includes(c.index)) have.contents.push(c.index);
        continue;
      }
      out.set(entry, {
        entry,
        name: parts.name.slice(PARTS.length),
        contents: [c.index],
        resource: mr.row(res).slice(),
        floor: floorOf(parts),
      });
    }
  }
  for (const [entry, ts] of out) {
    const list = [...seen.get(entry)!.values()].sort((a, b) => b.n - a.n);
    const textured = list.find(
      (x) => x.bytes.length >= 8 && (x.bytes[0]! | x.bytes[1]! | x.bytes[2]! | x.bytes[3]!) !== 0,
    );
    ts.resource = (textured ?? list[0]!).bytes;
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function floorOf(parts: LanaiTable): LanaiPartRef | null {
  for (const kind of FLOOR_KINDS) {
    const r = kind + 1;
    if (r >= parts.rows) continue;
    const archive = parts.u32(r, 0),
      entry = parts.u32(r, 4);
    if (archive && entry) return { archive, entry };
  }
  return null;
}

/** The tileset entry a MapData row of the content uses (0 when it names none). */
export function mapDataTileset(maps: LanaiMaps, mapDataRow: number): number {
  const md = maps.contentTable('MapData'),
    pt = maps.contentTable('MapPartsType');
  if (!md || !pt || mapDataRow < 0 || mapDataRow >= md.rows) return 0;
  const ts = md.row(mapDataRow)[0x0a]!;
  return ts < pt.rows ? pt.u32(ts, 0) : 0;
}

/** The tile kinds the content's maps of a MapData row use that the tileset has no model for (they would show nothing). */
export function tilesetGaps(maps: LanaiMaps, mapDataRow: number, parts: LanaiTable): number[] {
  const kinds = new Set<number>();
  for (const m of maps.maps) {
    if (m.world) continue;
    const doc = maps.doc(m);
    if (maps.mapDataRow(m, doc) !== mapDataRow) continue;
    for (const t of doc.tiles) kinds.add(t.kind);
  }
  return [...kinds]
    .filter((k) => k + 1 >= parts.rows || !(parts.u32(k + 1, 0) && parts.u32(k + 1, 4)))
    .sort((a, b) => a - b);
}

/** The MapParts table of a tileset: the content's own, or a copy of the first content's that has it. */
export async function tilesetTable(s: LanaiSession, maps: LanaiMaps, ts: LanaiTileset): Promise<LanaiTable> {
  const own = maps.contentTable(`${PARTS}${ts.name}`);
  if (own) return own;
  const donor = lanaiContents(s)[ts.contents[0]!];
  const t = donor && (await s.tablesIn(donor.archive)).find((x) => x.entry === ts.entry)?.table;
  if (!t) throw new Error(`タイルセット ${ts.name} の表が見つかりません`);
  return t;
}

/**
 * Gives the maps of a MapData row of the content the tileset `ts`: its MapParts table is copied into the content's
 * archive when the content does not have it, with a MapPartsType row and a MapResource row (its texture). Only for
 * an added stage, or a new MapData row in a ROM stage (the original rows stay intact).
 */
export async function setLanaiTileset(
  s: LanaiSession,
  maps: LanaiMaps,
  mapDataRow: number,
  ts: LanaiTileset,
): Promise<void> {
  const archive = maps.content.archive;
  const md = maps.contentTable('MapData'),
    pt = maps.contentTable('MapPartsType'),
    mr = maps.contentTable('MapResource');
  if (!md || !pt || !mr) throw new Error('このステージには MapData / MapPartsType / MapResource の表がありません');
  if (mapDataRow < 0 || mapDataRow >= md.rows) throw new Error(`MapData の行 ${mapDataRow} がありません`);
  if (!s.createdFiles.has(archive.toUpperCase()) && mapDataRow < md.originalRows)
    throw new Error('ROM の MapData 行のタイルセットは変更できません。新しい MapData 行を作って割り当ててください');
  if (!pt.rows) throw new Error('MapPartsType に行がありません');
  // the table: the content's own, or a copy packed like the content's first MapParts table
  if (!maps.contentTable(`${PARTS}${ts.name}`)) {
    const source = await tilesetTable(s, maps, ts);
    const table = LanaiTable.copyOf(source, source.rows);
    s.addTable(archive, ts.entry, '', pt.u32(0, 0), table);
    maps.addContentTable(ts.entry, table);
    maps.addPartsTable(ts.entry, table);
  }
  let typeRow = Array.from({ length: pt.rows }, (_, r) => r).find((r) => pt.u32(r, 0) === ts.entry);
  if (typeRow === undefined) {
    typeRow = pt.addRow(0);
    pt.setU32(typeRow, 0, ts.entry);
  }
  let resRow = Array.from({ length: mr.rows }, (_, r) => r).find((r) => equalBytes(mr.row(r), ts.resource));
  if (resRow === undefined) {
    resRow = mr.addRow(mr.rows - 1);
    mr.setRow(resRow, ts.resource);
  }
  if (typeRow > 0xff || resRow > 0xff) throw new Error('MapPartsType / MapResource の行が 255 を超えます');
  md.setBits(mapDataRow, 0x08, 16, 8, typeRow);
  md.setBits(mapDataRow, 0x08, 24, 8, resRow);
  maps.changed();
  s.edited();
}
