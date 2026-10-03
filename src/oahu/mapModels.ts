// The 3D models of RPG3's maps (naauao oahu/map.md §4): tile models are type 8 entries (a 0x180-byte header and a
// BCH) of mapResource's model archive, by hash; their textures come from the texture entries of mapResource. Map
// objects (mapObject rows) are a BCH entry of their own archive. Built as the model sets the three.js side draws.
import { findEntry, parseArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { parseBch, unwrapBch } from '../bch/bch';
import type { TilesetModels } from '../cgfx/tileset';
import type { Dump } from '../rom/dump';
import { hex8 } from '../util/bytes';
import type { OahuTileSource } from './maps';

const archives = new WeakMap<Dump, Map<string, Promise<Archive>>>();

function archive(dump: Dump, name: string): Promise<Archive> {
  let m = archives.get(dump);
  if (!m) archives.set(dump, (m = new Map()));
  let p = m.get(name);
  if (!p) {
    p = dump.readRomfs(name).then(parseArchive);
    m.set(name, p);
    p.catch(() => m.delete(name));
  }
  return p;
}

/** Add the first model of entry `hash` (keyed by the hash) and its textures. */
function addEntry(set: TilesetModels, arc: Archive, hash: number): void {
  const e = findEntry(arc, hash);
  if (!e) {
    set.errors.push(`${hex8(hash)} がありません`);
    return;
  }
  try {
    const f = parseBch(unwrapBch(unpackEntry(arc, e).body));
    for (const t of f.textures) if (!set.textures.has(t.name)) set.textures.set(t.name, t);
    const m = f.models[0];
    if (m) {
      set.models.set(hash, m);
      set.paths.set(hash, m.name);
    }
  } catch (err) {
    set.errors.push(`${hex8(hash)}: ${(err as Error).message}`);
  }
}

/** The tile models `hashes` of a map's tile source, with the textures of its mapResource row. */
export async function oahuTileModels(dump: Dump, src: OahuTileSource, hashes: Iterable<number>): Promise<TilesetModels> {
  const set: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
  const models = await archive(dump, src.modelArchive);
  const textures = src.textureArchive !== '00000000' ? await archive(dump, src.textureArchive).catch(() => null) : null;
  for (const h of src.textureEntries) {
    const arc = textures && findEntry(textures, h) ? textures : findEntry(models, h) ? models : null;
    if (!arc) {
      set.errors.push(`テクスチャ ${hex8(h)} がありません`);
      continue;
    }
    try {
      for (const t of parseBch(unwrapBch(unpackEntry(arc, findEntry(arc, h)!).body)).textures) set.textures.set(t.name, t);
    } catch (err) {
      set.errors.push(`テクスチャ ${hex8(h)}: ${(err as Error).message}`);
    }
  }
  for (const h of new Set(hashes)) if (h) addEntry(set, models, h);
  return set;
}

/** The model of a map object (mapObject row -> archive and entry), keyed by the entry's hash. */
export async function oahuObjectModels(dump: Dump, ref: { archive: string; entry: number }): Promise<TilesetModels> {
  const set: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
  addEntry(set, await archive(dump, ref.archive), ref.entry);
  return set;
}
