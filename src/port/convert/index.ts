// Monster and item models from one game for another (#100): RPG2 (kahara, CGFX), RPG3 (oahu, H3D version 8) and RPG
// FREE! (lanai, H3D 0x21). Every file goes through an H3D object (gfx2h3d / h3d2gfx), gets the target game's
// conventions (retarget.ts), and is split into the files the target loads.
import { readGfx, writeGfx, emptyGfx } from '../gfx';
import { readH3D, writeH3D, type H3D, type H3DAnimation, type H3DMaterialAnim, type H3DTexture } from '../h3d';
import { BATTLE_MOTIONS, H3D_HEADER, motionKey, type PortTitle } from './common';
import { emptyH3D, gfxToH3D } from './gfx2h3d';
import { h3dToGfx } from './h3d2gfx';
import { retarget } from './retarget';

export { isPortTitle, type PortTitle } from './common';

/**
 * A monster look as the target / source game stores it: kahara = model bcres (all animations) + texture bcres (motion
 * null); oahu / lanai = model BCH + texture BCH + battle motion BCH. Bytes are the archive entry bodies as stored (the
 * monster entries of all three games are the bare files, without a header).
 */
export interface MonsterFiles {
  model: Uint8Array;
  texture: Uint8Array | null;
  motion: Uint8Array | null;
}

export interface ConvertOptions {
  /** New base name of the model, its LUTs, textures and the species tag of the animations (e.g. `enemy_k38`). */
  name?: string;
}

const isGfx = (b: Uint8Array): boolean => b[0] === 0x43 && b[1] === 0x47 && b[2] === 0x46 && b[3] === 0x58;

/** A file of any game as an H3D (CGFX files converted). */
function readAny(b: Uint8Array): H3D {
  return isGfx(b) ? gfxToH3D(readGfx(b)) : readH3D(b);
}

/** One look: the H3D with everything, and the names of the textures of the colour file. */
interface Look {
  h: H3D;
  colour: Set<string>;
  hadTextureFile: boolean;
}

function readLook(src: MonsterFiles): Look {
  const h = readAny(src.model);
  const colour = new Set<string>();
  if (src.texture) {
    const t = readAny(src.texture);
    for (const x of t.textures) {
      // The colour's textures win over the model's by name (as the games load them).
      const i = h.textures.findIndex((y) => y.name === x.name);
      if (i >= 0) h.textures[i] = x;
      else h.textures.push(x);
      colour.add(x.name);
    }
  }
  if (src.motion) {
    const m = readAny(src.motion);
    const have = new Set([...h.skeletalAnimations, ...h.materialAnimations].map((a) => a.name));
    h.skeletalAnimations.push(...m.skeletalAnimations.filter((a) => !have.has(a.name)));
    h.materialAnimations.push(...m.materialAnimations.filter((a) => !have.has(a.name)));
    h.visibilityAnimations.push(...m.visibilityAnimations);
  }
  return { h, colour, hadTextureFile: !!src.texture };
}

// ---- Names

/** The species part of a model name (`enemy_42_01` -> `enemy_42`). */
const species = (model: string): string => model.replace(/_\d+$/, '');

/** The motion tag of a new name (`enemy_k38` -> `Ek38`). */
const motionTag = (name: string): string => `E${name.replace(/^enemy_/, '')}`;

/** NNN_E42_wait -> NNN_Ek38_wait: the prefix (what the game plays it by) stays; a name that would clash stays as it is. */
function renameAnimations(list: H3DAnimation[], tag: string): void {
  const taken = new Set(list.map((a) => a.name));
  for (const a of list) {
    const n = a.name.replace(/^(\d{3}_)E[^_.]+/, `$1${tag}`);
    if (n === a.name || taken.has(n)) continue;
    taken.delete(a.name);
    taken.add(n);
    a.name = n;
  }
}

/** Renames the model, its LUTs, textures and animations consistently (in place); returns the textures' new names. */
export function renameLook(h: H3D, name: string): Map<string, string> {
  const model = h.models[0];
  const old = model?.name ?? h.luts[0]?.name ?? '';
  const prefixes = [old, species(old), ...h.luts.map((l) => l.name)].filter((x) => x).sort((a, b) => b.length - a.length);
  const lutNames = new Map<string, string>();
  h.luts.forEach((l, i) => {
    const n = i === 0 ? name : `${name}_${i}`;
    lutNames.set(l.name, n);
    l.name = n;
  });
  const texNames = new Map<string, string>();
  const used = new Set<string>();
  for (const t of h.textures) {
    const p = prefixes.find((x) => t.name.startsWith(x) && x.length);
    let n = p ? name + t.name.slice(p.length) : `${name}_${t.name}`;
    for (let k = 1; used.has(n); k++) n = `${name}_${k}_${t.name}`;
    used.add(n);
    texNames.set(t.name, n);
    t.name = n;
  }
  const tex = (s: string | null): string | null => (s === null ? null : texNames.get(s) ?? s);
  const lut = (s: string | null): string | null => (s === null ? null : lutNames.get(s) ?? s);
  for (const m of h.models) {
    m.name = name;
    for (const mat of m.materials) {
      mat.texture0Name = tex(mat.texture0Name);
      mat.texture1Name = tex(mat.texture1Name);
      mat.texture2Name = tex(mat.texture2Name);
      const p = mat.materialParams;
      p.lutDist0TableName = lut(p.lutDist0TableName);
      p.lutDist1TableName = lut(p.lutDist1TableName);
      p.lutFresnelTableName = lut(p.lutFresnelTableName);
      p.lutReflecRTableName = lut(p.lutReflecRTableName);
      p.lutReflecGTableName = lut(p.lutReflecGTableName);
      p.lutReflecBTableName = lut(p.lutReflecBTableName);
      p.modelReference = `${mat.name}@${name}`;
    }
  }
  const tag = motionTag(name);
  for (const list of [h.skeletalAnimations, h.materialAnimations, h.visibilityAnimations]) renameAnimations(list, tag);
  for (const a of h.materialAnimations) a.textureNames = a.textureNames.map((n) => tex(n) ?? n);
  return texNames;
}

// ---- Output

function h3dOf(parts: Partial<H3D>): H3D {
  const h = { ...emptyH3D(), ...parts };
  h.materials = h.models.flatMap((m) => m.materials.map((x) => x.materialParams));
  return h;
}

function writeFor(h: H3D, to: 'oahu' | 'lanai'): Uint8Array {
  return writeH3D(h, { ...H3D_HEADER[to], freshLayout: true });
}

function checkTextures(textures: H3DTexture[]): void {
  for (const t of textures) {
    if (t.width > 512 || t.height > 512) throw new Error(`texture ${t.name} is ${t.width}×${t.height} (the games' limit is 512×512)`);
    if (t.format > 13) throw new Error(`texture ${t.name} has format ${t.format}`);
  }
}

function writeLook(look: Look, to: PortTitle, from: PortTitle): MonsterFiles {
  const { h, colour } = look;
  checkTextures(h.textures);
  const variant = h.textures.filter((t) => colour.has(t.name));
  const own = h.textures.filter((t) => !colour.has(t.name));
  if (to === 'kahara') {
    const model = h3dToGfx(h3dOf({ models: h.models, luts: h.luts, textures: own, skeletalAnimations: h.skeletalAnimations, materialAnimations: h.materialAnimations, visibilityAnimations: h.visibilityAnimations }));
    const tex = emptyGfx();
    tex.textures = h3dToGfx(h3dOf({ textures: variant })).textures;
    return { model: writeGfx(model), texture: variant.length ? writeGfx(tex) : null, motion: null };
  }
  retarget(h, to, from !== 'kahara');
  const battle = (a: H3DAnimation): boolean => BATTLE_MOTIONS.has(motionKey(a.name));
  const model = h3dOf({
    models: h.models, luts: h.luts, textures: own,
    skeletalAnimations: h.skeletalAnimations.filter((a) => !battle(a)), materialAnimations: h.materialAnimations.filter((a) => !battle(a)) as H3DMaterialAnim[],
    visibilityAnimations: h.visibilityAnimations.filter((a) => !battle(a)),
  });
  const motion = h3dOf({
    skeletalAnimations: h.skeletalAnimations.filter(battle), materialAnimations: h.materialAnimations.filter(battle) as H3DMaterialAnim[],
    visibilityAnimations: h.visibilityAnimations.filter(battle),
  });
  const hasMotion = motion.skeletalAnimations.length + motion.materialAnimations.length + motion.visibilityAnimations.length > 0;
  return {
    model: writeFor(model, to),
    texture: variant.length ? writeFor(h3dOf({ textures: variant }), to) : null,
    motion: hasMotion ? writeFor(motion, to) : null,
  };
}

/** A monster's files of game `from` as the files of game `to`. */
export function convertMonster(src: MonsterFiles, from: PortTitle, to: PortTitle, opts: ConvertOptions = {}): MonsterFiles {
  if (from === to && !opts.name) return src;
  const look = readLook(src);
  if (opts.name) {
    const names = renameLook(look.h, opts.name);
    look.colour = new Set([...look.colour].map((n) => names.get(n) ?? n));
  }
  return writeLook(look, to, from);
}

/** An item model entry body (as stored in the source game's archive) as an entry body for the target game. */
export function convertItem(src: Uint8Array, from: PortTitle, to: PortTitle, opts: ConvertOptions = {}): Uint8Array {
  if (from === to && !opts.name) return src;
  const h = readAny(src);
  if (opts.name) renameLook(h, opts.name);
  checkTextures(h.textures);
  if (to === 'kahara') return writeGfx(h3dToGfx(h, false));
  retarget(h, to, from !== 'kahara');
  return writeFor(h3dOf(h), to);
}
