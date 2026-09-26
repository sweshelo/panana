// PICA200 fragment pipeline in GLSL: texture combiners (6 TEV stages), alpha test and blending, built
// from the CGFX material registers. Colours are handled like the 3DS (no colour-space conversion), so
// e.g. the crack decals that multiply the framebuffer (white = unchanged) look as in the game.
import * as THREE from 'three';
import type { CgfxMaterial, TevStage } from './cgfx';

const BLEND_FACTOR: THREE.BlendingDstFactor[] = [
  THREE.ZeroFactor, THREE.OneFactor, THREE.SrcColorFactor, THREE.OneMinusSrcColorFactor, THREE.DstColorFactor,
  THREE.OneMinusDstColorFactor, THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.DstAlphaFactor,
  THREE.OneMinusDstAlphaFactor, THREE.ConstantColorFactor, THREE.OneMinusConstantColorFactor,
  THREE.ConstantAlphaFactor, THREE.OneMinusConstantAlphaFactor, THREE.SrcAlphaSaturateFactor as THREE.BlendingDstFactor,
];
const BLEND_EQ: THREE.BlendingEquation[] = [
  THREE.AddEquation, THREE.SubtractEquation, THREE.ReverseSubtractEquation, THREE.MinEquation, THREE.MaxEquation,
];

function source(s: number, k: number): string {
  switch (s) {
    case 0: return 'vColor';
    case 1: return 'vec4(1.0)'; // fragment lighting (primary) — not emulated
    case 2: return 'vec4(0.0)'; // fragment lighting (secondary)
    case 3: return 't0';
    case 4: return 't1';
    case 5: return 't2';
    case 0x0d: return 'buf';
    case 0x0e: return `konst[${k}]`;
    default: return 'prev'; // 0x0F previous
  }
}

function rgbOperand(op: number, v: string): string {
  switch (op) {
    case 1: return `(1.0 - ${v}.rgb)`;
    case 2: return `${v}.aaa`;
    case 3: return `(1.0 - ${v}.aaa)`;
    case 4: return `${v}.rrr`;
    case 5: return `(1.0 - ${v}.rrr)`;
    case 8: return `${v}.ggg`;
    case 9: return `(1.0 - ${v}.ggg)`;
    case 12: return `${v}.bbb`;
    case 13: return `(1.0 - ${v}.bbb)`;
    default: return `${v}.rgb`;
  }
}

function alphaOperand(op: number, v: string): string {
  switch (op) {
    case 1: return `(1.0 - ${v}.a)`;
    case 2: return `${v}.r`;
    case 3: return `(1.0 - ${v}.r)`;
    case 4: return `${v}.g`;
    case 5: return `(1.0 - ${v}.g)`;
    case 6: return `${v}.b`;
    case 7: return `(1.0 - ${v}.b)`;
    default: return `${v}.a`;
  }
}

function combine(op: number, a: string, b: string, c: string, one: string, half: string): string {
  switch (op) {
    case 1: return `${a} * ${b}`;
    case 2: return `${a} + ${b}`;
    case 3: return `${a} + ${b} - ${half}`;
    case 4: return `${a} * ${c} + ${b} * (${one} - ${c})`;
    case 5: return `${a} - ${b}`;
    case 6: case 7: return `${one} * (4.0 * dot(vec3(${a}) - 0.5, vec3(${b}) - 0.5))`;
    case 8: return `${a} * ${b} + ${c}`;
    case 9: return `(${a} + ${b}) * ${c}`;
    default: return a;
  }
}

function stageCode(st: TevStage, k: number, m: CgfxMaterial): string {
  const s = (i: number): string => source(i, k);
  const ra = st.srcRgb.map((x, i) => rgbOperand(st.opRgb[i]!, s(x)));
  const aa = st.srcA.map((x, i) => alphaOperand(st.opA[i]!, s(x)));
  const dot4 = st.combRgb === 7;
  const rgb = combine(st.combRgb, ra[0]!, ra[1]!, ra[2]!, 'vec3(1.0)', 'vec3(0.5)');
  const alpha = dot4 ? 'rgb.r' : combine(st.combA, aa[0]!, aa[1]!, aa[2]!, '1.0', '0.5');
  return `
  {
    vec3 rgb = clamp((${rgb}) * ${1 << st.scaleRgb}.0, 0.0, 1.0);
    float a = clamp((${alpha}) * ${1 << st.scaleA}.0, 0.0, 1.0);
    prev = vec4(rgb, a);
  }
  buf = nextBuf;${k < 4 && (m.tevBuffer.updateRgb >> k) & 1 ? '\n  nextBuf.rgb = prev.rgb;' : ''}${k < 4 && (m.tevBuffer.updateA >> k) & 1 ? '\n  nextBuf.a = prev.a;' : ''}`;
}

// PICA test functions (never, always, ==, !=, <, <=, >, >=) as three.js depth functions.
const DEPTH_FUNC: THREE.DepthModes[] = [
  THREE.NeverDepth, THREE.AlwaysDepth, THREE.EqualDepth, THREE.NotEqualDepth,
  THREE.LessDepth, THREE.LessEqualDepth, THREE.GreaterDepth, THREE.GreaterEqualDepth,
];

const ALPHA_TEST = ['false', 'true', '==', '!=', '<', '<=', '>', '>='];

export interface TevTextures {
  /** Texture of unit 0..2 (null = unused). */
  maps: (THREE.Texture | null)[];
}

export function tevMaterial(m: CgfxMaterial, t: TevTextures, clipping: THREE.Plane[]): THREE.ShaderMaterial {
  const tev = m.tev!;
  const used = new Set<number>();
  for (const st of tev) for (const x of [...st.srcRgb, ...st.srcA]) if (x >= 3 && x <= 5) used.add(x - 3);
  const units = m.units;
  const uniforms: Record<string, THREE.IUniform> = {
    konst: { value: tev.map((st) => new THREE.Vector4(...(st.color as [number, number, number, number]))) },
    bufColor: { value: new THREE.Vector4(...(m.tevBuffer.color as [number, number, number, number])) },
  };
  let sampling = '';
  for (let i = 0; i < 3; i++) {
    const map = t.maps[i];
    if (!used.has(i) || !map) {
      sampling += `  vec4 t${i} = vec4(1.0);\n`;
      continue;
    }
    const u = units[i]!;
    const cos = Math.cos(u.rotate), sin = Math.sin(u.rotate);
    const su = u.scaleU || 1, sv = u.scaleV || 1;
    // uv' = R * S * uv + T (column-major mat3)
    uniforms[`map${i}`] = { value: map };
    uniforms[`uvm${i}`] = { value: new THREE.Matrix3().set(cos * su, -sin * sv, u.translateU, sin * su, cos * sv, u.translateV, 0, 0, 1) };
    sampling += `  vec4 t${i} = texture2D(map${i}, (uvm${i} * vec3(vUv${u.source}, 1.0)).xy);\n`;
  }
  const at = m.alphaFunc;
  let alphaTest = '';
  if (at?.enabled) {
    const f = ALPHA_TEST[at.func]!;
    if (f === 'false') alphaTest = '  discard;';
    else if (f !== 'true') alphaTest = `  if (!(prev.a ${f} ${at.ref.toFixed(5)})) discard;`;
  }

  const vertexShader = `
attribute vec2 aUv1;
attribute vec2 aUv2;
attribute vec4 aColor;
varying vec2 vUv0;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec4 vColor;
#include <clipping_planes_pars_vertex>
void main() {
  vUv0 = uv;
  vUv1 = aUv1;
  vUv2 = aUv2;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
  const fragmentShader = `
uniform vec4 konst[6];
uniform vec4 bufColor;
${[0, 1, 2].filter((i) => uniforms[`map${i}`]).map((i) => `uniform sampler2D map${i};\nuniform mat3 uvm${i};`).join('\n')}
varying vec2 vUv0;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec4 vColor;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
${sampling}
  vec4 prev = vec4(0.0);
  // Combiner buffer: a stage reads what the stages before the previous one wrote (as the PICA does).
  vec4 buf = vec4(0.0);
  vec4 nextBuf = bufColor;
${tev.map((st, k) => stageCode(st, k, m)).join('\n')}
${alphaTest}
  gl_FragColor = prev;
}`;

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, clipping: true, side: THREE.DoubleSide });
  mat.clippingPlanes = clipping;
  const bf = m.blendFunc;
  const opaque = !bf || !bf.blend || (bf.srcRgb === 1 && bf.dstRgb === 0 && bf.eqRgb === 0);
  if (opaque) mat.blending = THREE.NoBlending;
  else {
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = BLEND_EQ[bf.eqRgb] ?? THREE.AddEquation;
    mat.blendEquationAlpha = BLEND_EQ[bf.eqA] ?? THREE.AddEquation;
    mat.blendSrc = (BLEND_FACTOR[bf.srcRgb] ?? THREE.OneFactor) as THREE.BlendingSrcFactor;
    mat.blendDst = BLEND_FACTOR[bf.dstRgb] ?? THREE.ZeroFactor;
    mat.blendSrcAlpha = (BLEND_FACTOR[bf.srcA] ?? THREE.OneFactor) as THREE.BlendingSrcFactor;
    mat.blendDstAlpha = BLEND_FACTOR[bf.dstA] ?? THREE.ZeroFactor;
    mat.blendColor = new THREE.Color(bf.color[0]!, bf.color[1]!, bf.color[2]!);
    mat.blendAlpha = bf.color[3]!;
    mat.transparent = true;
  }
  // PICA writes depth by the material's depth flags, blending or not. Monster bodies blend (src alpha)
  // and are double sided, so without depth writes their back faces would show through.
  mat.depthWrite = m.depthWrite;
  // The game tests depth with "less" (0x107 = 0x41), so of two coplanar surfaces the first drawn stays:
  // e.g. eyes and cheeks drawn before the (translucent) body they lie on.
  mat.depthTest = m.depthTest.enabled;
  mat.depthFunc = DEPTH_FUNC[m.depthTest.func] ?? THREE.LessEqualDepth;
  // Decals lie on (or just above) the floor: pull them forward to avoid z-fighting. Only overlays that do
  // not write depth: a blended body that writes depth pulled forward would cover the decals on it.
  if (m.polygonOffset || (!opaque && !m.depthWrite) || (m.layer > 0 && !m.depthWrite)) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -4;
  }
  mat.name = m.name;
  return mat;
}
