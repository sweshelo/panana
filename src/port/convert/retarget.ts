// What RPG3 (oahu) and RPG FREE! (lanai) want of a model beyond the file version, worked out from their own monsters:
//
// - Shader: materials name a program of the master's h3d_DefaultShader. The digit is 3 - the number of textures
//   (0@ three, 1@ two, 2@ one); with one texture, rigid / unskinned meshes use `2@DefaultShader-rs-nl`, smooth ones
//   `2@DefaultShader-ss-nl` and materials on both `2@DefaultShader-nl`.
// - Sub mesh skinning: RPG3 has rigid (2) and smooth (1) only (a single bone mesh is rigid with a fixed bone index 0);
//   RPG FREE!'s newer converter also has none (0). Mesh skinning: RPG3 always 0, RPG FREE! 2 smooth, 1 rigid, 0 else.
// - Bool uniforms (vertex shader switches, per sub mesh), bit by bit:
//     RPG3:     0x1 | smooth 0x2 | rigid 0x4 | 4 weights 0x100 | 0xE00 | 2+ textures 0x2000 | 3 textures 0x4000 | lit 0x8000
//     RPG FREE!: 0x1 | smooth 0x2 | rigid 0x4 | lit 0x8 | vertex colour 0x80 | 4 weights 0x100 | 0x200 |
//               2+ textures 0x2400 | 3 textures 0x4800
//   ("lit" = the material's fragment lighting flag; RPG3 has no vertex colour model, 0x80 is assumed as in RPG FREE!.)
// - Baked (quaternion) tracks: RPG3 numbers them in the flags (index << 16), RPG FREE! has 0xFFFF0000.
import { PICAAttributeName, type H3D, type H3DAnimation, type H3DFloatKeyFrameGroup, type H3DMaterial, type H3DMesh, type H3DModel, type H3DSubMesh, type KeyFrame } from '../h3d';

export type H3DTitle = 'oahu' | 'lanai';

const SHADER = /^(\d)@DefaultShader(-rs|-ss|-hs)?(-nl|-hs)?$/;

const textureCount = (m: H3DMaterial): number => m.enabledTextures.slice(0, 3).filter(Boolean).length;

/** The shader a material of the target game would name, given the sub mesh skinnings of the meshes using it. */
export function shaderFor(m: H3DMaterial, skinnings: Set<number>): string {
  const n = textureCount(m);
  const digit = Math.min(2, Math.max(0, 3 - Math.max(n, 1)));
  if (digit < 2) return `${digit}@DefaultShader-nl`;
  const smooth = skinnings.has(1);
  const rigid = skinnings.has(2) || skinnings.has(0);
  return smooth && rigid ? '2@DefaultShader-nl' : smooth ? '2@DefaultShader-ss-nl' : '2@DefaultShader-rs-nl';
}

function weightCount(mesh: H3DMesh): number {
  const find = (n: number): number | undefined => mesh.attributes.find((a) => a.name === n)?.elements;
  return find(PICAAttributeName.BoneWeight) ?? find(PICAAttributeName.BoneIndex) ?? 0;
}

const hasAttribute = (mesh: H3DMesh, name: number): boolean => mesh.attributes.some((a) => a.name === name) || mesh.fixedAttributes.some((a) => a.name === name);

/** The bool uniforms of a sub mesh in the target game. */
export function boolUniforms(title: H3DTitle, mesh: H3DMesh, sm: H3DSubMesh, m: H3DMaterial): number {
  const n = textureCount(m);
  const lit = (m.materialParams.flags & 1) !== 0;
  const color = hasAttribute(mesh, PICAAttributeName.Color);
  const four = weightCount(mesh) === 4;
  let b = 1 | (sm.skinning === 1 ? 2 : sm.skinning === 2 ? 4 : 0) | (four ? 0x100 : 0) | (color ? 0x80 : 0);
  if (title === 'oahu') b |= 0xe00 | (n >= 2 ? 0x2000 : 0) | (n >= 3 ? 0x4000 : 0) | (lit ? 0x8000 : 0);
  else b |= 0x200 | (lit ? 8 : 0) | (n >= 2 ? 0x2400 : 0) | (n >= 3 ? 0x4800 : 0);
  return b;
}

function retargetModel(title: H3DTitle, m: H3DModel, keepShaders: boolean): void {
  // Sub mesh skinning first (the shaders and bools depend on it).
  for (const mesh of m.meshes) {
    if (title === 'oahu' && mesh.subMeshes.some((s) => s.skinning === 0)) {
      for (const s of mesh.subMeshes) if (s.skinning === 0) s.skinning = 2;
      if (!hasAttribute(mesh, PICAAttributeName.BoneIndex)) {
        mesh.fixedAttributes.push({ name: PICAAttributeName.BoneIndex, value: [0, 0, 0, 1] });
        mesh.enableCommands = mesh.disableCommands = undefined;
      }
    }
    const kinds = new Set(mesh.subMeshes.map((s) => s.skinning));
    mesh.skinning = title === 'oahu' || kinds.size !== 1 ? 0 : kinds.has(1) ? 2 : kinds.has(2) ? 1 : 0;
  }
  m.materials.forEach((mat, i) => {
    const p = mat.materialParams;
    // Texture coordinate flags: RPG3 sets all three, RPG FREE! those of its textures.
    const n = textureCount(mat);
    p.textureCoords.forEach((t, k) => (t.flags = title === 'oahu' || k < n ? 1 : 0));
    const skinnings = new Set(m.meshes.filter((x) => x.materialIndex === i).flatMap((x) => x.subMeshes.map((s) => s.skinning)));
    const own = p.shaderReference ?? '';
    // A native name of the other game stays (both games' masters hold the 36 programs); other names are recomputed.
    if (!keepShaders || !SHADER.test(own)) p.shaderReference = shaderFor(mat, skinnings);
  });
  for (const mesh of m.meshes) {
    const mat = m.materials[mesh.materialIndex];
    if (!mat) continue;
    for (const s of mesh.subMeshes) {
      const b = boolUniforms(title, mesh, s, mat);
      if (b !== s.boolUniforms) {
        s.boolUniforms = b;
        s.commands = undefined;
      }
    }
  }
  // Render layers: RPG3's monsters are all on layer 1, RPG FREE!'s on 1 or 0 (RPG2 has 0-3).
  const layer = (l: number): number => (title === 'lanai' && l === 0 ? 0 : 1);
  if (m.meshes.some((x) => x.layer !== layer(x.layer))) {
    for (const x of m.meshes) x.layer = layer(x.layer);
    const layers = [0, 1, 2, 3].map((l) => m.meshes.filter((x) => x.layer === l));
    m.meshes = layers.flat();
    [m.meshesLayer0, m.meshesLayer1, m.meshesLayer2, m.meshesLayer3] = layers as [H3DMesh[], H3DMesh[], H3DMesh[], H3DMesh[]];
  }
  m.flags = m.skeleton.length ? m.flags | 2 : m.flags & ~2;
}

/**
 * One segment from a curve of several (version 0x20 and later have one per curve), as RPG FREE!'s converter merged
 * RPG3's: a segment's key frames count from the segment's start, the merged ones from the curve's; step keys hold their
 * value up to the next key (a second key there), linear ones get the line's slopes, keys repeated at a boundary go.
 */
export function mergeCurve(c: H3DFloatKeyFrameGroup): void {
  if (!c.moreSegments?.length) return;
  const segs = [{ ...c, startFrame: c.segmentStart ?? c.startFrame, endFrame: c.segmentEnd ?? c.endFrame }, ...c.moreSegments];
  const keys: KeyFrame[] = [];
  const push = (k: KeyFrame): void => {
    const last = keys[keys.length - 1];
    if (last && last.frame === k.frame && last.value === k.value) {
      last.outSlope = k.outSlope;
      return;
    }
    keys.push(k);
  };
  for (const s of segs) {
    const off = s.startFrame - c.startFrame;
    const k = s.keyFrames;
    k.forEach((x, i) => {
      const next = k[i + 1];
      if (s.interpolationType === 0) {
        push({ frame: off + x.frame, value: x.value, inSlope: 0, outSlope: 0 });
        if (next) push({ frame: off + next.frame, value: x.value, inSlope: 0, outSlope: 0 });
      } else if (s.interpolationType === 1) {
        const out = next ? (next.value - x.value) / (next.frame - x.frame || 1) : 0;
        const prev = k[i - 1];
        const inS = prev ? (x.value - prev.value) / (x.frame - prev.frame || 1) : out;
        push({ frame: off + x.frame, value: x.value, inSlope: inS, outSlope: next ? out : inS });
      } else push({ frame: off + x.frame, value: x.value, inSlope: x.inSlope, outSlope: x.outSlope });
    });
  }
  const dur = c.endFrame - c.startFrame;
  Object.assign(c, { interpolationType: 2, quantization: 0, valueScale: 1, valueOffset: 0, frameScale: 1, invDuration: dur ? 1 / dur : 0, keyFrames: keys });
  delete c.moreSegments;
  delete c.segmentStart;
  delete c.segmentEnd;
}

function curves(a: H3DAnimation): H3DFloatKeyFrameGroup[] {
  const out: H3DFloatKeyFrameGroup[] = [];
  for (const e of a.elements) {
    const c = e.content;
    const slots = c.kind === 'transform' ? [c.scaleX, c.scaleY, c.scaleZ, c.rotationX, c.rotationY, c.rotationZ, c.translationX, c.translationY, c.translationZ] : c.kind === 'vector' ? c.slots : [];
    for (const x of slots) if (x !== null && typeof x === 'object') out.push(x);
  }
  return out;
}

/** Sets the target game's conventions on an H3D (in place). `keepShaders`: the H3D comes from the other H3D game. */
export function retarget(h: H3D, title: H3DTitle, keepShaders: boolean): void {
  for (const m of h.models) retargetModel(title, m, keepShaders);
  if (title === 'lanai') for (const a of [...h.skeletalAnimations, ...h.materialAnimations, ...h.visibilityAnimations]) curves(a).forEach(mergeCurve);
  for (const a of h.skeletalAnimations) {
    let n = 0;
    for (const e of a.elements) {
      if (e.content.kind !== 'quatTransform') continue;
      const c = e.content;
      for (const t of [c.scales, c.rotations, c.translations]) {
        if (!t || t.constant) continue;
        t.flags = title === 'oahu' ? (n++ << 16) >>> 0 : 0xffff0000;
      }
    }
  }
}
