// Porting monster and item models between RPG2 (kahara, CGFX), RPG3 (oahu, H3D 8) and RPG FREE! (lanai, H3D 0x21)
// (src/port/convert, #100): every monster design of each game converts to each other game; the outputs read with our
// format readers and with the renderer's readers (parseCgfx / parseBch) and give the same geometry, skinning, bones,
// textures, materials and animations (bone poses evaluated at a few frames); the values the target games' own files
// have are checked against those files; a sample of items converts too, and round trips keep everything. Needs the
// decrypted CIAs (test/env.ts); skipped when they are missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findByName, findEntry, parseArchive, unpackEntry, type Archive } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { bchAnimations, bchOffset, parseBch } from '../src/bch/bch';
import { evalBaked, evalChannel, type CgfxAnimation, type SkeletalTrack } from '../src/cgfx/anim';
import { parseCgfx, type CgfxFile, type CgfxMaterial, type CgfxTexture } from '../src/cgfx/cgfx';
import { Game } from '../src/game/game';
import { ITEM_MODEL_ARCHIVES } from '../src/game/items';
import { lanaiModelIndex, lanaiMonsterDesign } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import { composeTRS, invert34, mul34, worldMatrices, type Mat34 } from '../src/port/convert/common';
import { setMaterialHashes } from '../src/port/convert/gfxhash';
import { boolUniforms } from '../src/port/convert/retarget';
import { convertItem, convertMonster, type MonsterFiles, type PortTitle } from '../src/port/convert';
import { decodeKeys, faceIndices, readGfx, type Gfx, type GfxAnimChannel } from '../src/port/gfx';
import { readH3D, type H3D, type H3DAnimSlot } from '../src/port/h3d';
import { openImage, openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia, hasLanai, hasOahuBase, hasOahuUpdate, LANAI_BASE, LANAI_UPDATE, OAHU_BASE, OAHU_UPDATE } from './env';

const TITLES: PortTitle[] = ['kahara', 'oahu', 'lanai'];

interface Design {
  key: string;
  files: MonsterFiles;
}

const isGfx = (b: Uint8Array): boolean => b[0] === 0x43 && b[1] === 0x47 && b[2] === 0x46 && b[3] === 0x58;

// ---- The renderer's view of a look

interface View {
  /** Texture coordinate curves of the material animations: animation -> track -> value at a frame (every segment). */
  coords: Map<string, Map<string, (frame: number) => number[]>>;
  file: CgfxFile;
  textures: Map<string, CgfxTexture>;
  animations: CgfxAnimation[];
  /** Segment scale compensate of each bone (from our format readers; parseCgfx does not read it). */
  ssc: boolean[];
}

function sscOf(b: Uint8Array): boolean[] {
  if (isGfx(b)) {
    const sk = readGfx(b).models[0]?.skeleton;
    return (sk?.bones ?? []).map((x) => sk!.scalingRule === 1 && (x.flags & 0x20) !== 0);
  }
  const m = readH3D(b).models[0];
  return (m?.skeleton ?? []).map((x) => m!.boneScaling === 1 && (x.flags & (1 << 22)) !== 0);
}

/** A curve's value at a frame with all its segments (the renderer's readers take the first one only). */
type Segment = { start: number; end: number; interp: number; keys: { frame: number; value: number; inSlope: number; outSlope: number }[] };

function evalSegments(segs: Segment[], frame: number): number {
  const s = segs.find((x) => frame >= x.start && frame <= x.end) ?? (frame < segs[0]!.start ? segs[0]! : segs[segs.length - 1]!);
  // Key frames count from the segment's start.
  const k = new Float32Array(s.keys.flatMap((x) => [x.frame, x.value, x.inSlope, x.outSlope]));
  return evalChannel({ start: 0, end: s.end - s.start, interp: s.interp, keys: k }, frame - s.start, 0);
}

function gfxCurve(c: GfxAnimChannel): (frame: number) => number {
  if (c === null) return () => 0;
  if (typeof c === 'number') return () => c;
  const segs = c.segments.map((x) => ({ start: x.startFrame, end: x.endFrame, interp: (x.formatFlags >>> 2) & 7, keys: decodeKeys(x) }));
  return (f) => evalSegments(segs, f);
}

function h3dCurve(c: H3DAnimSlot): (frame: number) => number {
  if (c === null) return () => 0;
  if (typeof c === 'number') return () => c;
  const segs = [{ start: c.segmentStart ?? c.startFrame, end: c.segmentEnd ?? c.endFrame, interp: c.interpolationType, keys: c.keyFrames }, ...(c.moreSegments ?? []).map((x) => ({ start: x.startFrame, end: x.endFrame, interp: x.interpolationType, keys: x.keyFrames }))];
  return (f) => evalSegments(segs, f);
}

const COORD = /^Materials\["(.+)"\]\.TextureCoordinators\[(\d)\]\.(Translate|Scale)$/;

function coordCurves(files: Uint8Array[]): View['coords'] {
  const out: View['coords'] = new Map();
  for (const b of files) {
    // An animation of a later file with a name already there is not loaded (as the games and convertMonster do).
    const before = new Set(out.keys());
    const add = (anim: string, track: string, f: (frame: number) => number[]): void => {
      if (before.has(anim)) return;
      let m = out.get(anim);
      if (!m) out.set(anim, (m = new Map()));
      if (!m.has(track)) m.set(track, f);
    };
    if (isGfx(b)) {
      for (const a of readGfx(b).materialAnimations)
        for (const e of a.elements) {
          const m = COORD.exec(e.name);
          if (!m || !('channels' in e.content)) continue;
          const ch = e.content.channels.map(gfxCurve);
          add(a.name, `${m[1]} ${m[2]} ${m[3] === 'Scale' ? 'scale' : 'translate'}`, (f) => ch.map((x) => x(f)));
        }
    } else {
      for (const a of readH3D(b).materialAnimations)
        for (const e of a.elements) {
          const t = e.targetType - 19;
          if (t < 0 || t > 8 || t % 3 === 1 || e.content.kind !== 'vector') continue;
          const ch = e.content.slots.map(h3dCurve);
          add(a.name, `${e.name} ${Math.floor(t / 3)} ${t % 3 === 0 ? 'scale' : 'translate'}`, (f) => ch.map((x) => x(f)));
        }
    }
  }
  return out;
}

/**
 * parseCgfx moves rigid vertices by bone matrices without segment scale compensation (parseBch has it): redo that move
 * with it, so that both readers give the rest pose the same way.
 */
function compensateRigid(file: CgfxFile, g: Gfx): void {
  const m = file.models[0], gm = g.models[0], sk = gm?.skeleton;
  if (!m || !gm || !sk || sk.scalingRule !== 1 || !sk.bones.some((b) => b.flags & 0x20)) return;
  const poses = sk.bones.map((b) => ({ parent: b.parentIndex, scale: b.scale, rotation: b.rotation, translation: b.translation, ssc: (b.flags & 0x20) !== 0 }));
  const plain = worldMatrices(poses.map((p) => ({ ...p, ssc: false }))), ssc = worldMatrices(poses);
  const apply = (x: Mat34, v: number[], w: number): number[] => [0, 1, 2].map((r) => x[r * 4]! * v[0]! + x[r * 4 + 1]! * v[1]! + x[r * 4 + 2]! * v[2]! + x[r * 4 + 3]! * w);
  gm.meshes.forEach((gmesh, mi) => {
    const mesh = m.meshes[mi], shape = gm.shapes[gmesh.shapeIndex];
    if (!mesh || !shape) return;
    let v = 0;
    for (const sm of shape.subMeshes) {
      const n = new Set(sm.faces.flatMap((fc) => fc.faceDescriptors.flatMap((fd) => [...faceIndices(fd)]))).size;
      if (sm.skinning !== 2)
        for (let k = v; k < v + n; k++) {
          const bone = mesh.skinIndices?.[k * 4];
          if (bone === undefined || !mesh.skinWeights![k * 4]) continue;
          const back = invert34(plain[bone]!);
          const p = apply(ssc[bone]!, apply(back, [...mesh.positions.slice(k * 3, k * 3 + 3)], 1), 1);
          mesh.positions.set(p, k * 3);
          if (mesh.normals) mesh.normals.set(apply(ssc[bone]!, apply(back, [...mesh.normals.slice(k * 3, k * 3 + 3)], 0), 0), k * 3);
        }
      v += n;
    }
  });
}

function view(f: MonsterFiles): View {
  const gfx = isGfx(f.model);
  const file = gfx ? parseCgfx(f.model) : parseBch(f.model.subarray(bchOffset(f.model)));
  if (gfx) {
    // The texture combiners' constants are the material's constant colours (as parseBch sets them; parseCgfx takes the
    // stage's command colour, which the runtime replaces).
    const g = readGfx(f.model);
    compensateRigid(file, g);
    file.models.forEach((m, i) =>
      m.materials.forEach((x, j) => {
        const src = g.models[i]?.materials[j];
        if (!src?.fragmentShader || !x.tev) return;
        const c = src.colors;
        const consts = [c.constant0, c.constant1, c.constant2, c.constant3, c.constant4, c.constant5];
        src.fragmentShader.textureEnvironments.forEach((t, k) => {
          const cc = consts[t.constant];
          if (cc && x.tev![k]) x.tev![k]!.color = [cc.r, cc.g, cc.b, cc.a].map((v) => v / 255);
        });
      }),
    );
  }
  const textures = new Map<string, CgfxTexture>();
  for (const t of file.textures) textures.set(t.name, t);
  if (f.texture) for (const t of (isGfx(f.texture) ? parseCgfx(f.texture) : parseBch(f.texture)).textures) textures.set(t.name, t);
  const animations = [...(file.models[0]?.animations ?? (gfx ? [] : bchAnimations(f.model)))];
  if (f.motion) {
    const have = new Set(animations.map((a) => a.name));
    animations.push(...bchAnimations(f.motion).filter((a) => !have.has(a.name)));
  }
  // A lone identity bone (RPG2's models always have one; H3D items may have none) moves nothing.
  const m = file.models[0];
  const b0 = m?.bones[0];
  if (m && m.bones.length === 1 && b0 && [...b0.scale, ...b0.rotation, ...b0.translation].join() === '1,1,1,0,0,0,0,0,0') {
    m.bones = [];
    for (const x of m.meshes) x.skinIndices = x.skinWeights = null;
  }
  return { file, textures, animations, ssc: m?.bones.length ? sscOf(f.model) : [], coords: coordCurves([f.model, ...(f.motion ? [f.motion] : [])]) };
}

// ---- Comparisons

const close = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function arrayDiff(what: string, a: ArrayLike<number> | null, b: ArrayLike<number> | null, tol = 1e-3): string | null {
  if (!a || !b) return (a === null) === (b === null) ? null : `${what}: ${a ? 'only in the source' : 'only in the output'}`;
  if (a.length !== b.length) return `${what}: length ${a.length} != ${b.length}`;
  for (let i = 0; i < a.length; i++) if (!close(a[i]!, b[i]!, tol)) return `${what}[${i}]: ${a[i]} != ${b[i]}`;
  return null;
}

/** FNV hash of decoded pixels. */
function pixels(t: CgfxTexture | undefined): string {
  if (!t) return 'none';
  let h = 0x811c9dc5;
  for (let i = 0; i < t.rgba.length; i++) h = Math.imul(h ^ t.rgba[i]!, 0x01000193);
  return `${t.width}x${t.height}:${(h >>> 0).toString(16)}`;
}

/** What a material draws like (renderer view; texture names replaced by their pixels). */
function look(m: CgfxMaterial, textures: Map<string, CgfxTexture>): unknown {
  return {
    textures: m.textures.map((n) => (n ? pixels(textures.get(n)) : null)),
    tev: m.tev, tevBuffer: m.tevBuffer, blendFunc: m.blendFunc, alphaFunc: m.alphaFunc, depthTest: m.depthTest, cull: m.cull,
    // Units without a texture: parseCgfx reports repeat, parseBch the zeros the files have.
    units: m.units.map((u, i) => (m.textures[i] ? { ...u, name: null } : null)), polygonOffset: m.polygonOffset,
  };
}

function deepDiff(path: string, a: unknown, b: unknown): string | null {
  if (typeof a === 'number' && typeof b === 'number') return close(a, b, 2e-3) ? null : `${path}: ${a} != ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = deepDiff(`${path}[${i}]`, a[i], b[i]);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = deepDiff(`${path}.${k}`, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${String(a)} != ${String(b)}`;
}

/** Skin of each vertex: (bone, weight) pairs with a weight. */
function skinOf(m: { skinIndices: Uint16Array | null; skinWeights: Float32Array | null; positions: Float32Array }): string[] {
  const n = m.positions.length / 3;
  const out: string[] = [];
  for (let v = 0; v < n; v++) {
    const pairs: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const w = m.skinWeights ? m.skinWeights[v * 4 + k]! : 0;
      if (w > 1e-4) pairs.push([m.skinIndices![v * 4 + k]!, Math.round(w * 100)]);
    }
    const merged = new Map<number, number>();
    for (const [b, w] of pairs) merged.set(b, (merged.get(b) ?? 0) + w);
    out.push([...merged].sort((x, y) => x[0] - y[0]).map(([b, w]) => `${b}:${w}`).join(' '));
  }
  return out;
}

/** The species tag of an animation name is renamed by a port (`001_E42_wait` / `001_Ek38_wait`). */
const motionName = (n: string): string => n.replace(/^(\d{3}_)E[^_.]+/, '$1E*');

// Bone poses: the player's evaluation (cgfx/player.ts) without three.js.
function quatMatrix(q: number[], s: number[], t: number[]): Mat34 {
  const [x, y, z, w] = q as [number, number, number, number];
  const l = Math.hypot(x, y, z, w) || 1;
  const [a, b, c, d] = [x / l, y / l, z / l, w / l];
  return [
    (1 - 2 * (b * b + c * c)) * s[0]!, 2 * (a * b - c * d) * s[1]!, 2 * (a * c + b * d) * s[2]!, t[0]!,
    2 * (a * b + c * d) * s[0]!, (1 - 2 * (a * a + c * c)) * s[1]!, 2 * (b * c - a * d) * s[2]!, t[1]!,
    2 * (a * c - b * d) * s[0]!, 2 * (b * c + a * d) * s[1]!, (1 - 2 * (a * a + b * b)) * s[2]!, t[2]!,
  ];
}

function poseWorlds(v: View, anim: CgfxAnimation | null, frame: number): Mat34[] {
  const bones = v.file.models[0]?.bones ?? [];
  const tracks = new Map<string, SkeletalTrack>();
  for (const t of anim?.skeletal ?? []) tracks.set(t.bone, t);
  const world: Mat34[] = [], scale: number[][] = [];
  const tmp = [0, 0, 0, 0];
  const visit = (i: number, depth = 0): Mat34 => {
    if (world[i]) return world[i]!;
    const b = bones[i]!;
    const tr = tracks.get(b.name);
    let s = [...b.scale], local: Mat34;
    if (tr?.channels) {
      const c = tr.channels;
      s = [0, 1, 2].map((k) => evalChannel(c[k]!, frame, b.scale[k]!));
      const r = [3, 4, 5].map((k, j) => evalChannel(c[k]!, frame, b.rotation[j]!));
      const t = [7, 8, 9].map((k, j) => evalChannel(c[k]!, frame, b.translation[j]!));
      local = composeTRS(s, r, t);
    } else if (tr?.baked) {
      const x = tr.baked;
      if (x.scale) { evalBaked(x.scale, 3, x.start, frame, tmp); s = tmp.slice(0, 3); }
      const t = x.translation ? (evalBaked(x.translation, 3, x.start, frame, tmp), tmp.slice(0, 3)) : [...b.translation];
      if (x.rotation) { evalBaked(x.rotation, 4, x.start, frame, tmp); local = quatMatrix(tmp.slice(), s, t); }
      else local = composeTRS(s, b.rotation, t);
    } else local = composeTRS(b.scale, b.rotation, b.translation);
    scale[i] = s;
    const p = b.parent;
    if (p >= 0 && p < bones.length && p !== i && depth < 128) {
      const pw = visit(p, depth + 1);
      if (v.ssc[i]) for (let row = 0; row < 3; row++) {
        const k = scale[p]![row] ? 1 / scale[p]![row]! : 1;
        for (let col = 0; col < 3; col++) local[row * 4 + col]! *= k;
      }
      world[i] = mul34(pw, local);
    } else world[i] = local;
    return world[i]!;
  };
  bones.forEach((_, i) => visit(i));
  return world;
}

/** Where two looks differ for the renderer (null = the same). */
function lookDiff(a: View, b: View, poses: boolean): string | null {
  const ma = a.file.models[0], mb = b.file.models[0];
  if (!ma || !mb) return ma === mb ? null : 'model count';
  if (ma.bones.length !== mb.bones.length) return `bones ${ma.bones.length} != ${mb.bones.length}`;
  for (let i = 0; i < ma.bones.length; i++) {
    const x = ma.bones[i]!, y = mb.bones[i]!;
    if (x.name !== y.name || x.parent !== y.parent) return `bone ${i} ${x.name} ${y.name}`;
    const d = arrayDiff(`bone ${x.name}`, [...x.scale, ...x.rotation, ...x.translation], [...y.scale, ...y.rotation, ...y.translation]);
    if (d) return d;
  }
  if (a.ssc.join() !== b.ssc.join()) return 'segment scale compensate';
  if (ma.meshes.length !== mb.meshes.length) return `meshes ${ma.meshes.length} != ${mb.meshes.length}`;
  // Meshes may be ordered by render layer in H3D: match by material, size and first vertex.
  const key = (m: (typeof ma.meshes)[number]): string => `${m.material}|${m.indices.length}|${m.positions.length}|${[...m.positions.slice(0, 3)].map((x) => x.toFixed(1))}`;
  const sa = [...ma.meshes].sort((x, y) => key(x).localeCompare(key(y))), sb = [...mb.meshes].sort((x, y) => key(x).localeCompare(key(y)));
  for (let i = 0; i < sa.length; i++) {
    const x = sa[i]!, y = sb[i]!;
    if (x.material !== y.material) return `mesh ${i} material`;
    const d = arrayDiff(`mesh ${i} positions`, x.positions, y.positions, 2e-3) ?? arrayDiff(`mesh ${i} uvs`, x.uvs, y.uvs) ?? arrayDiff(`mesh ${i} uvs1`, x.uvs1, y.uvs1)
      ?? arrayDiff(`mesh ${i} indices`, x.indices, y.indices, 0) ?? arrayDiff(`mesh ${i} normals`, x.normals, y.normals, 2e-3) ?? arrayDiff(`mesh ${i} colours`, x.colors, y.colors);
    if (d) return d;
    if (skinOf(x).join('|') !== skinOf(y).join('|')) return `mesh ${i} skin`;
    if (x.visible !== y.visible) return `mesh ${i} visibility`;
    // RPG2 and the H3D games order the render priority oppositely; the port keeps the draw order (#78)
    if (x.drawOrder !== y.drawOrder) return `mesh ${i} draw order ${x.drawOrder} != ${y.drawOrder}`;
  }
  if (ma.materials.length !== mb.materials.length) return 'material count';
  for (let i = 0; i < ma.materials.length; i++) {
    const d = deepDiff(`material ${ma.materials[i]!.name}`, look(ma.materials[i]!, a.textures), look(mb.materials[i]!, b.textures));
    if (d) return d;
  }
  // Animations: the same names (but the species tag), lengths and loops.
  const sig = (v: View): string[] => v.animations.map((x) => `${x.kind} ${motionName(x.name)} ${x.frames} ${x.loop}`).sort();
  const d = deepDiff('animations', sig(a), sig(b));
  if (d) return d;
  if (poses) {
    // Animations by name; names that only differ in the species tag pair up in order.
    const groups = new Map<string, CgfxAnimation[]>();
    for (const x of b.animations) {
      const k = `${x.kind} ${motionName(x.name)}`;
      groups.set(k, [...(groups.get(k) ?? []), x]);
    }
    const taken = new Map<string, number>();
    for (const x of a.animations) {
      const k = `${x.kind} ${motionName(x.name)}`;
      const n = taken.get(k) ?? 0;
      taken.set(k, n + 1);
      const y = groups.get(k)?.[n];
      if (!y) return `${x.name}: missing`;
      for (const frame of [0, Math.floor(x.frames / 3), Math.floor(x.frames / 2) + 0.5, x.frames]) {
        if (x.kind === 'skeletal') {
          const wa = poseWorlds(a, x, frame), wb = poseWorlds(b, y, frame);
          for (let i = 0; i < wa.length; i++) {
            const e = arrayDiff(`${x.name} frame ${frame} bone ${ma.bones[i]!.name}`, wa[i]!, wb[i]!, 5e-3);
            if (e) return e;
          }
        } else {
          const ca = a.coords.get(x.name), cb = b.coords.get(y.name);
          for (const [track, f] of ca ?? []) {
            const g = cb?.get(track);
            if (!g) return `${x.name}: no track ${track}`;
            const e = arrayDiff(`${x.name} ${track} frame ${frame}`, f(frame), g(frame));
            if (e) return e;
          }
        }
      }
    }
  }
  return null;
}

// ---- Native values of each game

interface Natives {
  shaders: Set<string>;
  bools: Set<number>;
  modelFlags: Set<number>;
  boneScaling: Set<number>;
  layers: Set<number>;
  header: string;
}

function h3dNatives(designs: Design[]): Natives {
  const n: Natives = { shaders: new Set(), bools: new Set(), modelFlags: new Set(), boneScaling: new Set(), layers: new Set(), header: '' };
  for (const d of designs) {
    const h = readH3D(d.files.model);
    n.header = `${h.backwardCompatibility} ${h.forwardCompatibility} ${h.converterVersion} ${h.flags}`;
    for (const m of h.models) {
      n.modelFlags.add(m.flags);
      n.boneScaling.add(m.boneScaling);
      for (const x of m.materials) n.shaders.add(x.materialParams.shaderReference ?? '');
      for (const x of m.meshes) {
        n.layers.add(x.layer);
        for (const s of x.subMeshes) n.bools.add(s.boolUniforms);
      }
    }
  }
  return n;
}

/** Where a converted H3D model differs from what the target game's own files have. */
function h3dPlausible(h: H3D, title: 'oahu' | 'lanai', n: Natives): string | null {
  if (`${h.backwardCompatibility} ${h.forwardCompatibility} ${h.converterVersion} ${h.flags}` !== n.header) return 'header';
  for (const m of h.models) {
    if (!n.modelFlags.has(m.flags) || !n.boneScaling.has(m.boneScaling)) return `model flags ${m.flags} / bone scaling ${m.boneScaling}`;
    for (const x of m.materials) {
      const s = x.materialParams.shaderReference ?? '';
      // RPG3 has no three-texture monster material; its master holds 0@DefaultShader-nl all the same.
      if (!n.shaders.has(s) && !(title === 'oahu' && s === '0@DefaultShader-nl')) return `shader ${s}`;
    }
    for (const x of m.meshes) {
      if (!n.layers.has(x.layer)) return `layer ${x.layer}`;
      if (!x.metaData?.some((md) => md.name === 'OBBox' && md.type === 4)) return 'mesh without OBBox';
      if (title === 'oahu' && (x.skinning !== 0 || x.subMeshes.some((s) => s.skinning === 0))) return 'RPG3 skinning';
      for (const s of x.subMeshes) {
        if (s.boolUniforms !== boolUniforms(title, x, s, m.materials[x.materialIndex]!)) return 'bool uniforms';
        if (s.boneIndices.length > 20) return 'bone palette';
      }
    }
    for (const t of h.textures) if (t.width > 512 || t.height > 512) return 'texture size';
  }
  return null;
}

/** Where a converted CGFX model differs from what RPG2's own files have. */
function gfxPlausible(g: Gfx): string | null {
  for (const m of g.models) {
    if (m.animationsGroup.map((x) => x.name).join() !== 'SkeletalAnimation,VisibilityAnimation,MaterialAnimation') return 'animation groups';
    const bones = m.animationsGroup[0]!.elements.map((e) => e.name);
    if (bones.join() !== (m.skeleton?.bones ?? []).map((b) => b.name).join()) return 'skeletal animation group';
    if (m.animationsGroup[1]!.elements.length !== m.meshes.length + 2) return 'visibility animation group';
    for (const x of m.materials) {
      if (x.shader?.path !== 'DefaultShader') return 'shader';
      const c = structuredClone(x);
      setMaterialHashes(c);
      if (c.fragOpHash !== x.fragOpHash || c.textureEnvironmentHash !== x.textureEnvironmentHash || c.materialColorsHash !== x.materialColorsHash) return 'material hashes';
    }
    if (m.skeleton?.scalingRule !== 1) return 'scaling rule';
    for (const s of m.shapes) if (s.subMeshes.some((x) => x.boneIndices.length > 20)) return 'bone palette';
  }
  return null;
}

// ---- Loading

async function kaharaDesigns(): Promise<{ designs: Design[]; items: Uint8Array[] }> {
  const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  const book = await game.monsters();
  const arc = await game.archive('470D2848');
  const body = (h: number): Uint8Array | null => {
    const e = h ? findEntry(arc, h) : undefined;
    return e ? unpackEntry(arc, e).body : null;
  };
  const designs: Design[] = [];
  const seen = new Set<string>();
  for (const m of book.monsters) {
    const ref = book.modelOf(m);
    const model = ref && body(ref.model);
    const key = `kahara ${ref?.model.toString(16)}/${ref?.texture.toString(16)}`;
    if (!ref || !model || seen.has(key)) continue;
    seen.add(key);
    designs.push({ key: `${key} (design ${m.design})`, files: { model, texture: body(ref.texture), motion: null } });
  }
  const items: Uint8Array[] = [];
  const t = game.master.itemData;
  const done = new Set<number>();
  for (const name of ITEM_MODEL_ARCHIVES) {
    const a = await game.archive(name);
    for (let id = 1; id < t.rows; id++) {
      const h = u32(t.row(id), 0x20);
      const e = h && !done.has(h) ? findEntry(a, h) : undefined;
      if (e) {
        done.add(h);
        items.push(unpackEntry(a, e).body);
      }
    }
  }
  return { designs, items };
}

function bodyOf(arcs: Archive[], h: number): Uint8Array | null {
  for (const a of arcs) {
    const e = h ? findEntry(a, h) : undefined;
    if (e) return unpackEntry(a, e).body;
  }
  return null;
}

async function oahuDesigns(): Promise<{ designs: Design[]; items: Uint8Array[] }> {
  const dump = hasOahuUpdate ? await openImages([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], (f) => (f as unknown as { name: string }).name) : await openImage(Bun.file(OAHU_BASE), 'base');
  const arc = parseArchive(await dump.readRomfs('28480000'));
  const table = new GsTable(findByName(parseArchive(await dump.readRomfs('402F0000')), 'monsterDesign.bin')!.body);
  const designs: Design[] = [];
  const seen = new Set<string>();
  for (let row = 0; row < table.rows; row++) {
    const r = table.row(row);
    const [m, t, mo] = [u32(r, 0x0c), u32(r, 0x10), u32(r, 0x14)];
    const model = bodyOf([arc], m);
    const key = `oahu ${m.toString(16)}/${t.toString(16)}/${mo.toString(16)}`;
    if (!model || seen.has(key)) continue;
    seen.add(key);
    designs.push({ key: `${key} (design ${row})`, files: { model, texture: bodyOf([arc], t), motion: bodyOf([arc], mo) } });
  }
  const items: Uint8Array[] = [];
  for (const name of ['838B0000', '96EB0000', 'D4270000']) {
    const a = parseArchive(await dump.readRomfs(name));
    for (const e of a.entries) {
      const b = unpackEntry(a, e).body;
      if (bchOffset(b) === 0 && readH3D(b).models.length) items.push(b);
    }
  }
  return { designs, items };
}

async function lanaiDesigns(): Promise<{ designs: Design[]; items: Uint8Array[] }> {
  const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
  const s = await LanaiSession.open(dump);
  const index = await lanaiModelIndex(s);
  const designs: Design[] = [];
  const seen = new Set<string>();
  for (let row = 0; row < s.need('MonsterDesign').rows; row++) {
    const d = lanaiMonsterDesign(s, row)!;
    const model = d.model ? index.body(d.model) : null;
    const key = `lanai ${d.model.toString(16)}/${d.texture.toString(16)}/${d.motion.toString(16)}`;
    if (!model || seen.has(key) || (index.name(d.model) ?? '').startsWith('dummy')) continue;
    seen.add(key);
    designs.push({ key: `${key} (design ${row})`, files: { model, texture: index.body(d.texture), motion: index.body(d.motion) } });
  }
  const items: Uint8Array[] = [];
  for (const name of ['1B270000', '96EB0000', 'D4270000']) {
    const a = parseArchive(await dump.readRomfs(name));
    for (const e of a.entries) {
      const b = unpackEntry(a, e).body;
      if (bchOffset(b) === 0 && readH3D(b).models.length) items.push(b);
    }
  }
  return { designs, items };
}

// ---- Tests


describe.skipIf(!hasCia || !hasOahuBase || !hasLanai)('model ports between the three games', () => {
  const designs = {} as Record<PortTitle, Design[]>;
  const items = {} as Record<PortTitle, Uint8Array[]>;
  const natives = {} as Record<'oahu' | 'lanai', Natives>;

  beforeAll(async () => {
    for (const [t, f] of [['kahara', kaharaDesigns], ['oahu', oahuDesigns], ['lanai', lanaiDesigns]] as const) {
      const x = await f();
      designs[t] = x.designs;
      items[t] = x.items;
    }
    natives.oahu = h3dNatives(designs.oahu);
    natives.lanai = h3dNatives(designs.lanai);
  }, 300_000);

  const name = (from: PortTitle, i: number): string => `enemy_${from[0]}${i}`;

  /** Converts every design `from` -> `to`; returns the problems (conversion errors, reader errors, differences). */
  function monsters(from: PortTitle, to: PortTitle, poses: boolean): string[] {
    const bad: string[] = [];
    designs[from].forEach((d, i) => {
      try {
        const out = convertMonster(d.files, from, to, { name: name(from, i) });
        for (const b of [out.model, out.texture, out.motion]) if (b) (to === 'kahara' ? readGfx(b) : readH3D(b));
        if (to === 'kahara') {
          if (out.motion) throw new Error('RPG2 has no motion file');
          const p = gfxPlausible(readGfx(out.model));
          if (p) throw new Error(`not like RPG2's files: ${p}`);
        } else {
          for (const b of [out.model, out.texture, out.motion]) {
            const p = b && h3dPlausible(readH3D(b), to, natives[to]);
            if (p) throw new Error(`not like ${to}'s files: ${p}`);
          }
          // Battle motions in the battle file, the rest in the model file.
          const battle = new Set(['002_', '005_', '006_', '007_', '008_', '009_', '010_', '011_', '012_', '013_']);
          const m = readH3D(out.model);
          if ([...m.skeletalAnimations, ...m.materialAnimations].some((a) => battle.has(a.name.slice(0, 4)))) throw new Error('a battle motion in the model file');
          if (out.motion && [...readH3D(out.motion).skeletalAnimations].some((a) => !battle.has(a.name.slice(0, 4)))) throw new Error('a field motion in the motion file');
        }
        // The colour's textures stay in a texture file of their own (RPG2's colour variants too).
        const count = (b: Uint8Array | null): number => (!b ? 0 : isGfx(b) ? readGfx(b).textures.length : readH3D(b).textures.length);
        if (count(d.files.texture) !== count(out.texture)) throw new Error(`colour textures ${count(d.files.texture)} -> ${count(out.texture)}`);
        const diff = lookDiff(view(d.files), view(out), poses);
        if (diff) bad.push(`${d.key}: ${diff}`);
      } catch (e) {
        bad.push(`${d.key}: ${(e as Error).message}`);
      }
    });
    return bad;
  }

  for (const from of TITLES)
    for (const to of TITLES) {
      if (from === to) continue;
      test(`every ${from} monster converts to ${to}: same geometry, skin, bones, textures, materials and poses`, () => {
        expect(designs[from].length).toBeGreaterThan(100);
        expect(monsters(from, to, true)).toEqual([]);
      }, 600_000);
    }

  test('round trips keep geometry and animation (kahara -> oahu -> kahara, oahu -> lanai -> oahu, lanai -> kahara -> lanai)', () => {
    const bad: string[] = [];
    for (const [a, b] of [['kahara', 'oahu'], ['oahu', 'lanai'], ['lanai', 'kahara']] as const)
      designs[a].forEach((d, i) => {
        try {
          const there = convertMonster(d.files, a, b, { name: name(a, i) });
          const back = convertMonster(there, b, a);
          const diff = lookDiff(view(d.files), view(back), true);
          if (diff) bad.push(`${a} -> ${b} -> ${a} ${d.key}: ${diff}`);
        } catch (e) {
          bad.push(`${a} -> ${b} -> ${a} ${d.key}: ${(e as Error).message}`);
        }
      });
    expect(bad).toEqual([]);
  }, 600_000);

  test('items (30 per pair) convert with the same geometry, materials and textures', () => {
    const bad: string[] = [];
    for (const from of TITLES)
      for (const to of TITLES) {
        if (from === to) continue;
        const list = items[from];
        expect(list.length).toBeGreaterThan(100);
        const step = Math.floor(list.length / 30);
        for (let k = 0; k < 30; k++) {
          const src = list[k * step]!;
          try {
            const out = convertItem(src, from, to, { name: `item_${from[0]}${k}` });
            const diff = lookDiff(view({ model: src, texture: null, motion: null }), view({ model: out, texture: null, motion: null }), true);
            if (diff) bad.push(`${from} -> ${to} item ${k * step}: ${diff}`);
          } catch (e) {
            bad.push(`${from} -> ${to} item ${k * step}: ${(e as Error).message}`);
          }
        }
      }
    expect(bad).toEqual([]);
  }, 600_000);

  test('names: the model, LUTs, textures and the animations\' species tag follow the new name', () => {
    const d = designs.kahara[0]!;
    const out = convertMonster(d.files, 'kahara', 'oahu', { name: 'enemy_k0' });
    const m = readH3D(out.model);
    expect(m.models[0]!.name).toBe('enemy_k0');
    expect(m.luts.every((l) => l.name.startsWith('enemy_k0'))).toBe(true);
    for (const x of m.models[0]!.materials) {
      const p = x.materialParams;
      for (const t of [p.lutDist0TableName, p.lutDist1TableName]) if (t) expect(m.luts.some((l) => l.name === t)).toBe(true);
      expect(p.modelReference.endsWith('@enemy_k0')).toBe(true);
    }
    const textures = [...m.textures, ...(out.texture ? readH3D(out.texture).textures : [])].map((t) => t.name);
    expect(textures.every((t) => t.startsWith('enemy_k0'))).toBe(true);
    expect(m.skeletalAnimations.map((a) => a.name).filter((n) => /^\d{3}_E/.test(n)).every((n) => n.slice(4).startsWith('Ek0'))).toBe(true);
  });
});
