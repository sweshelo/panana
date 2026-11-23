// The 3D models of a lanai map's tiles (naauao lanai/map.md §6.4): a GSC (type 10 entry of the root archive that
// MapParts names) is a 0x180-byte header and a BCH; the tiles' texture is the BCH of MapResource +0x00 / +0x04.
import { findEntry, unpackEntry } from '../archive/gsarc';
import { parseBch, unwrapBch } from '../bch/bch';
import { parsePctx, type ProcTex } from '../cgfx/proctex';
import type { TilesetModels } from '../cgfx/tileset';
import { hex8 } from '../util/bytes';
import type { LanaiPartRef, LanaiTileSource } from './maps';
import type { LanaiSession } from './session';

/** The models `refs` name (keyed by the entry's hash) with the textures of the tile source. */
export async function lanaiTileModels(
  session: LanaiSession,
  src: LanaiTileSource,
  refs: Iterable<LanaiPartRef>,
): Promise<TilesetModels> {
  const set: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
  if (src.textureArchive && src.textureEntry) {
    try {
      const arc = await session.archive(hex8(src.textureArchive));
      const e = findEntry(arc, src.textureEntry);
      if (!e) set.errors.push(`テクスチャ ${hex8(src.textureEntry)} がありません`);
      else for (const t of parseBch(unwrapBch(unpackEntry(arc, e).body)).textures) set.textures.set(t.name, t);
    } catch (err) {
      set.errors.push(`テクスチャ ${hex8(src.textureEntry)}: ${(err as Error).message}`);
    }
  }
  const seen = new Set<number>();
  const list = [...refs];
  const procModels = new Set(list.filter((r) => r.archive >>> 0 === LANAI_PROCTEX_ARCHIVE).map((r) => r.entry));
  if (procModels.size) {
    try {
      set.proctex = { p: await lanaiProcTex(session, LANAI_PROCTEX_FILE), models: procModels };
    } catch (err) {
      set.errors.push(`${LANAI_PROCTEX_FILE}: ${(err as Error).message}`);
    }
  }
  for (const ref of list) {
    if (seen.has(ref.entry)) continue;
    seen.add(ref.entry);
    try {
      const arc = await session.archive(hex8(ref.archive));
      const e = findEntry(arc, ref.entry);
      if (!e) {
        set.errors.push(`${hex8(ref.archive)}/${hex8(ref.entry)} がありません`);
        continue;
      }
      const f = parseBch(unwrapBch(unpackEntry(arc, e).body));
      for (const t of f.textures) if (!set.textures.has(t.name)) set.textures.set(t.name, t);
      const m = f.models[0];
      if (m) {
        set.models.set(ref.entry, m);
        set.paths.set(ref.entry, m.name);
      }
    } catch (err) {
      set.errors.push(`${hex8(ref.entry)}: ${(err as Error).message}`);
    }
  }
  return set;
}

/**
 * The field gives every model of this archive (the parts of MapPartsCaveC, and no other tileset's) the procedural
 * texture proctex_mud03 as texture 3 (update code 0x2BEB54; roms/tmpmap/cavec-proctex-analysis.md).
 */
export const LANAI_PROCTEX_ARCHIVE = 0xd17b0000;
export const LANAI_PROCTEX_FILE = 'proctex_files/proctex_mud03.pctxbin';

const procTexCache = new WeakMap<LanaiSession, Map<string, Promise<ProcTex>>>();

/** A procedural texture of the RomFS (rom:/proctex_files/…), read once per session. */
export function lanaiProcTex(session: LanaiSession, path: string): Promise<ProcTex> {
  const m = procTexCache.get(session) ?? procTexCache.set(session, new Map()).get(session)!;
  let p = m.get(path);
  if (!p) {
    p = session.dump.readRomfs(path).then(parsePctx);
    p.catch(() => m.delete(path));
    m.set(path, p);
  }
  return p;
}

/** The model of a map object (a GSC or BCH entry of a root archive; MapObject +0x00 / +0x04), keyed by the entry's hash. */
export function lanaiObjectModels(session: LanaiSession, ref: LanaiPartRef): Promise<TilesetModels> {
  return lanaiTileModels(
    session,
    { mapData: -1, tileset: 0, partsName: '', resource: 0, textureArchive: 0, textureEntry: 0 },
    [ref],
  );
}
