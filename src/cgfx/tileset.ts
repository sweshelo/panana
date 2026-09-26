// A tileset's models and textures: every CGFX in the model archive + the texture bcres of mapResource [2].
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { hex8 } from '../util/bytes';
import { parseCgfx, unwrapT8, type CgfxModel, type CgfxTexture } from './cgfx';

export interface TilesetModels {
  /** Model archive entry hash -> model. */
  models: Map<number, CgfxModel>;
  /** Model hash -> file path (for names). */
  paths: Map<number, string>;
  textures: Map<string, CgfxTexture>;
  errors: string[];
}

export function buildTileset(modelArchive: Uint8Array, textureArchive: Uint8Array | null, textureEntry: number): TilesetModels {
  const out: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
  if (textureArchive && textureEntry) {
    try {
      const ta = parseArchive(textureArchive);
      const e = findEntry(ta, textureEntry);
      if (e) for (const t of parseCgfx(unpackEntry(ta, e).body).textures) out.textures.set(t.name, t);
      else out.errors.push(`テクスチャ ${hex8(textureEntry)} がありません`);
    } catch (err) {
      out.errors.push(`テクスチャ ${hex8(textureEntry)}: ${(err as Error).message}`);
    }
  }
  const arc = parseArchive(modelArchive);
  for (const e of arc.entries) {
    try {
      const { path, cgfx } = unwrapT8(unpackEntry(arc, e).body);
      const f = parseCgfx(cgfx);
      // Textures inside a model file take precedence for that file but are shared by name.
      for (const t of f.textures) if (!out.textures.has(t.name)) out.textures.set(t.name, t);
      const m = f.models[0];
      if (m) {
        out.models.set(e.hash, m);
        out.paths.set(e.hash, path);
      }
    } catch (err) {
      out.errors.push(`${hex8(e.hash)}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Typed arrays of a tileset (for transferring from the worker). */
export function transferables(t: TilesetModels): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: { buffer: ArrayBufferLike } | null): void => {
    if (a && a.buffer instanceof ArrayBuffer && !out.includes(a.buffer)) out.push(a.buffer);
  };
  for (const m of t.models.values())
    for (const me of m.meshes) {
      add(me.positions); add(me.normals); add(me.uvs); add(me.colors); add(me.indices);
    }
  for (const x of t.textures.values()) add(x.rgba);
  return out;
}
