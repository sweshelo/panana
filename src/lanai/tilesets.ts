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
import { equalBytes, u32, w32 } from '../util/bytes';
import { LANAI_RESOURCE_BATTLE_FIELD } from './battleField';
import { lanaiTileModels } from './mapModels';

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
  // the textures seen with each tileset: texture (MapResource +0x00 / +0x04, hex) -> its rows (bytes, hex) -> count
  const seen = new Map<number, Map<string, Map<string, { bytes: Uint8Array; n: number }>>>();
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
      const bytes = mr.row(res);
      const texture = hexOf(bytes.subarray(0, 8));
      const textures = seen.get(entry) ?? seen.set(entry, new Map()).get(entry)!;
      const rows = textures.get(texture) ?? textures.set(texture, new Map()).get(texture)!;
      const key = hexOf(bytes);
      const k = rows.get(key);
      if (k) k.n++;
      else rows.set(key, { bytes: bytes.slice(), n: 1 });
      const have = out.get(entry);
      if (have) {
        if (!have.contents.includes(c.index)) have.contents.push(c.index);
        continue;
      }
      out.set(entry, {
        entry,
        name: parts.name.slice(PARTS.length),
        contents: [c.index],
        resource: bytes.slice(),
        floor: floorOf(parts),
      });
    }
  }
  for (const [entry, ts] of out) {
    // A tileset can be seen with textures its models don't name (Relic: 2B84B000's bg_wall_stone_* in some
    // contents, 6D3A9800's bg_kabrickfloor in others): the texture that names the most of the floor's textures, then
    // the most rows (a texture's rows differ in +0x10, the content's battle field, so the rows are counted by texture).
    let best: { bytes: Uint8Array; hits: number; n: number } | null = null;
    for (const rows of seen.get(entry)!.values()) {
      const list = [...rows.values()].sort((a, b) => b.n - a.n);
      const bytes = list[0]!.bytes;
      const n = list.reduce((sum, x) => sum + x.n, 0);
      const textured = bytes.length >= 8 && u32(bytes, 0) !== 0 && u32(bytes, 4) !== 0;
      const hits = textured ? await floorHits(s, ts.floor, bytes) : -1;
      if (!best || hits > best.hits || (hits === best.hits && n > best.n)) best = { bytes, hits, n };
    }
    ts.resource = best!.bytes;
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** How many texture names of the floor model's materials the texture of a MapResource row has (-1: none read). */
async function floorHits(s: LanaiSession, floor: LanaiPartRef | null, resource: Uint8Array): Promise<number> {
  if (!floor) return 0;
  const set = await lanaiTileModels(
    s,
    {
      mapData: -1,
      tileset: 0,
      partsName: '',
      resource: 0,
      textureArchive: u32(resource, 0),
      textureEntry: u32(resource, 4),
    },
    [floor],
  );
  const model = set.models.get(floor.entry);
  if (!model) return 0;
  const names = new Set<string>();
  for (const m of model.materials) for (const t of m.textures) if (t) names.add(t);
  return [...names].filter((n) => set.textures.has(n)).length;
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

/** The MapData row uses the tileset but not its texture (a stage given Relic with another texture): picking it again fixes it. */
export function tilesetTextureDiffers(maps: LanaiMaps, mapDataRow: number, ts: LanaiTileset): boolean {
  const md = maps.contentTable('MapData'),
    mr = maps.contentTable('MapResource');
  if (!md || !mr || mapDataTileset(maps, mapDataRow) !== ts.entry) return false;
  const res = md.row(mapDataRow)[0x0b]!;
  return res >= mr.rows || !equalBytes(mr.row(res).subarray(0, 8), ts.resource.subarray(0, 8));
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
  // the texture row, with the battle field (+0x10, a row ID of the content's BattleFieldContents) the map had
  const current = md.row(mapDataRow)[0x0b]!;
  const resource = ts.resource.slice();
  const field = current < mr.rows ? mr.u32(current, LANAI_RESOURCE_BATTLE_FIELD) : 0;
  w32(resource, LANAI_RESOURCE_BATTLE_FIELD, field);
  let resRow = Array.from({ length: mr.rows }, (_, r) => r).find((r) => equalBytes(mr.row(r), resource));
  if (resRow === undefined) {
    resRow = mr.addRow(mr.rows - 1);
    mr.setRow(resRow, resource);
  }
  if (typeRow > 0xff || resRow > 0xff) throw new Error('MapPartsType / MapResource の行が 255 を超えます');
  md.setBits(mapDataRow, 0x08, 16, 8, typeRow);
  md.setBits(mapDataRow, 0x08, 24, 8, resRow);
  maps.changed();
  s.edited();
}
