// A tileset's models and textures: every CGFX in the model archive + the texture bcres of mapResource [2].
import { findEntry, parseArchive, unpackEntry, type Archive } from '../archive/gsarc';
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

/** Object models (mapObject rows): each entry is a bcres with its own textures. */
export function buildObjects(archive: Uint8Array, entries: number[]): Map<number, TilesetModels> {
  const arc = parseArchive(archive);
  const out = new Map<number, TilesetModels>();
  for (const h of entries) {
    const set: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
    try {
      const e = findEntry(arc, h);
      if (!e) throw new Error('エントリがありません');
      const f = parseCgfx(unpackEntry(arc, e).body);
      for (const t of f.textures) set.textures.set(t.name, t);
      const m = f.models[0];
      if (m) {
        set.models.set(h, m);
        set.paths.set(h, m.name);
      }
    } catch (err) {
      set.errors.push(`${hex8(h)}: ${(err as Error).message}`);
    }
    out.set(h, set);
  }
  return out;
}

/**
 * A model bcres combined with a texture bcres of the same archive (monsters: MonsterDesign w4 = model with
 * its animations, w5 = textures of the colour variant, which win by name). texture 0 = the model's own.
 */
export function buildComposite(arc: Archive, model: number, texture: number): TilesetModels {
  const set: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
  try {
    const e = findEntry(arc, model);
    if (!e) throw new Error('モデルのエントリがありません');
    const f = parseCgfx(unpackEntry(arc, e).body);
    for (const t of f.textures) set.textures.set(t.name, t);
    const te = texture ? findEntry(arc, texture) : undefined;
    if (te) for (const t of parseCgfx(unpackEntry(arc, te).body).textures) if (t.name !== 'dummy') set.textures.set(t.name, t);
    const m = f.models[0];
    if (m) {
      set.models.set(model, m);
      set.paths.set(model, m.name);
    }
  } catch (err) {
    set.errors.push(`${hex8(model)}: ${(err as Error).message}`);
  }
  return set;
}

/** Typed arrays of a tileset (for transferring from the worker). */
export function transferables(t: TilesetModels): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: { buffer: ArrayBufferLike } | null): void => {
    if (a && a.buffer instanceof ArrayBuffer && !out.includes(a.buffer)) out.push(a.buffer);
  };
  for (const m of t.models.values())
    for (const me of m.meshes) {
      add(me.positions); add(me.normals); add(me.uvs); add(me.uvs1); add(me.uvs2); add(me.colors); add(me.indices);
      add(me.skinIndices); add(me.skinWeights);
    }
  for (const m of t.models.values())
    for (const a of m.animations) {
      for (const tr of a.skeletal) {
        for (const c of tr.channels ?? []) if (c && typeof c === 'object') add(c.keys);
        if (tr.baked) { add(tr.baked.rotation); add(tr.baked.translation); add(tr.baked.scale); }
      }
      for (const tr of a.material) for (const c of tr.channels) if (c && typeof c === 'object') add(c.keys);
    }
  for (const x of t.textures.values()) add(x.rgba);
  return out;
}
