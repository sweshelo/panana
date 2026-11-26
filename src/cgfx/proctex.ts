// PICA procedural textures (texture unit 3) as the RPG FREE! (lanai) and kahara fields keep them: rom:/proctex_files/
// *.pctxbin (0x165C bytes, little endian, float32 arrays). The loader (update code 0x233C5C) writes the bytes to the
// GPUREG_PROCTEX registers and LUTs; the scene update (0x233364) moves only the noise phase. The layout and the
// animation are in roms/tmpmap/cavec-proctex-format-notes.md / cavec-proctex-analysis.md. The texture itself is
// evaluated as Azahar's renderer does (video_core sw_proctex / the GLSL generator): cgfx/tev.ts.
import * as THREE from 'three';

export const PCTX_SIZE = 0x165c;

export interface ProcTex {
  /** Colour combiner (0 U … 5 (U²+V²)/2 … 9 RMax), the alpha one and whether alpha has its own (0x09 / 0x0A). */
  combiner: number;
  alphaCombiner: number;
  alphaSeparate: boolean;
  /** Clamp modes (0 to zero, 1 to edge, 2 repeat, 3 mirrored repeat, 4 pulse) and shift modes (0 none, 1 odd, 2 even). */
  clampU: number;
  clampV: number;
  shiftU: number;
  shiftV: number;
  /** Colour LUT offset and width (0x14 / 0x15; a width byte 0 is 256). */
  lutOffset: number;
  lutWidth: number;
  noise: boolean;
  /** Noise amplitude, frequency and initial phase (U, V). */
  amplitude: [number, number];
  frequency: [number, number];
  phase: [number, number];
  /** Phase animation: on, mode (1 = sin, else adds the step) and the step per 1/60 s (U, V). */
  animate: [boolean, boolean];
  mode: [number, number];
  step: [number, number];
  /** 0x141B & 0x7F: texture coordinates per tile (the field's UV matrix). */
  coordScale: number;
  /** 0x164C..0x1658: the UV range (u0, u1, v0, v1) of the field's UV matrix. */
  uvRange: [number, number, number, number];
  /** 128 entries each: the noise curve and the RGB / alpha maps; 256 RGBA entries: the colour LUT. */
  noiseLut: Float32Array;
  rgbMap: Float32Array;
  alphaMap: Float32Array;
  color: Float32Array;
}

export function parsePctx(b: Uint8Array): ProcTex {
  if (b.length < PCTX_SIZE) throw new Error(`pctxbin が短すぎます (${b.length} B)`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const f = (o: number): number => v.getFloat32(o, true);
  const floats = (o: number, n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => f(o + i * 4));
  const color = new Float32Array(256 * 4);
  for (let c = 0; c < 4; c++) for (let i = 0; i < 256; i++) color[i * 4 + c] = f(0x418 + c * 0x400 + i * 4);
  return {
    // 0x08 is overwritten by 0x09 in the loader; the alpha combiner is never set (it stays the colour one's value).
    combiner: b[0x09]!,
    alphaCombiner: b[0x09]!,
    alphaSeparate: b[0x0a]! !== 0,
    clampU: b[0x0b]!,
    clampV: b[0x0c]!,
    shiftU: b[0x0d]!,
    shiftV: b[0x0e]!,
    lutOffset: b[0x14]!,
    lutWidth: b[0x15]! || 256,
    noise: b[0x1418]! !== 0,
    amplitude: [f(0x141c), f(0x1420)],
    frequency: [f(0x1424), f(0x1428)],
    phase: [f(0x142c), f(0x1430)],
    animate: [b[0x1419]! !== 0, b[0x141a]! !== 0],
    mode: [b[0x16]!, b[0x17]!],
    step: [f(0x1434), f(0x1438)],
    coordScale: b[0x141b]! & 0x7f,
    uvRange: [f(0x164c), f(0x1650), f(0x1654), f(0x1658)],
    noiseLut: floats(0x143c, 128),
    rgbMap: floats(0x18, 128),
    alphaMap: floats(0x218, 128),
    color,
  };
}

/**
 * The noise phase after `ticks` 1/60 s ticks (0x2333BC..0x2334D4): mode 1 swings P0·sin(2π·fmod(n·step, P0)/P0);
 * the others add 2·step a field frame (30 fps: one step a tick) from P0. A phase with frequency·phase ≥ 16 restarts at 0.
 */
export function procTexPhase(p: ProcTex, ticks: number): [number, number] {
  const axis = (i: 0 | 1): number => {
    const p0 = p.phase[i],
      step = p.step[i],
      freq = p.frequency[i];
    if (!p.animate[i]) return p0;
    if (p.mode[i] === 1) {
      if (!p0) return 0;
      const t = (((ticks * step) % p0) + p0) % p0;
      const ph = p0 * Math.sin((2 * Math.PI * t) / p0);
      return freq * ph >= 16 ? 0 : ph;
    }
    const ph = p0 + ticks * step;
    if (!freq || freq * ph < 16) return ph;
    // after the first restart at 0 it runs from 0 to 16 / frequency
    const span = 16 / freq;
    return (ph - span) % span;
  };
  return [axis(0), axis(1)];
}

/**
 * The LUTs as one float texture (256 × 4, red channel for the 128-entry maps): row 0 the colour LUT, 1 the noise
 * curve, 2 the RGB map, 3 the alpha map. The shader reads the entries with texelFetch (the PICA's value + delta).
 */
export function procTexLut(p: ProcTex): THREE.DataTexture {
  const data = new Float32Array(256 * 4 * 4);
  data.set(p.color, 0);
  [p.noiseLut, p.rgbMap, p.alphaMap].forEach((lut, k) => {
    for (let i = 0; i < 128; i++) data[((k + 1) * 256 + i) * 4] = lut[i]!;
  });
  const t = new THREE.DataTexture(data, 256, 4, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const num = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

function clampCode(mode: number, x: string): string {
  switch (mode) {
    case 0:
      return `if (${x} > 1.0) ${x} = 0.0;`;
    case 1:
      return `${x} = min(${x}, 1.0);`;
    case 2:
      return `${x} = fract(${x});`;
    case 3:
      return `${x} = (int(${x}) % 2 != 0) ? 1.0 - fract(${x}) : fract(${x});`;
    default:
      return `${x} = ${x} > 0.5 ? 1.0 : 0.0;`;
  }
}

function shiftCode(mode: number, clamp: number, other: string): string {
  const offset = clamp === 3 ? '1.0' : '0.5';
  if (mode === 1) return `${offset} * float((int(${other}) / 2) % 2)`;
  if (mode === 2) return `${offset} * float(((int(${other}) + 1) / 2) % 2)`;
  return '0.0';
}

function combinerCode(c: number): string {
  switch (c) {
    case 0:
      return 'uv.x';
    case 1:
      return 'uv.x * uv.x';
    case 2:
      return 'uv.y';
    case 3:
      return 'uv.y * uv.y';
    case 4:
      return '(uv.x + uv.y) * 0.5';
    case 5:
      return '(uv.x * uv.x + uv.y * uv.y) * 0.5';
    case 6:
      return 'min(sqrt(uv.x * uv.x + uv.y * uv.y), 1.0)';
    case 7:
      return 'min(uv.x, uv.y)';
    case 8:
      return 'max(uv.x, uv.y)';
    default:
      return 'min(((uv.x + uv.y) * 0.5 + sqrt(uv.x * uv.x + uv.y * uv.y)) * 0.5, 1.0)';
  }
}

/**
 * GLSL (ES 3.0) of a procedural texture for the TEV shader: the vertex shader turns texcoord 0 into the field's
 * coordinates (uniform ptTile = column, row, tile angle: u' = s(R(u) + column), v' = s(R(v) − row), 0x233228), the
 * fragment shader evaluates `vec4 t3` as Azahar does (noise → shift → clamp → combiner → RGB / alpha map → colour LUT).
 */
export function procTexGlsl(p: ProcTex): {
  vertexDecl: string;
  vertex: string;
  fragmentDecl: string;
  fragment: string;
} {
  const su = p.coordScale * (p.uvRange[1] - p.uvRange[0]) || 1,
    sv = p.coordScale * (p.uvRange[3] - p.uvRange[2]) || 1;
  const vertexDecl = 'uniform vec3 ptTile;\nvarying vec2 vPt;';
  const vertex = `
  {
    vec2 c = uv - 0.5;
    float ca = cos(ptTile.z), sa = sin(ptTile.z);
    vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) + 0.5;
    vPt = vec2(${num(su)} * (r.x + ptTile.x), ${num(sv)} * (r.y - ptTile.y));
  }`;
  const fragmentDecl = `
uniform sampler2D ptLut;
uniform vec2 ptPhase;
varying vec2 vPt;
float ptMap(int row, float x) {
  x *= 128.0;
  float i = clamp(floor(x), 0.0, 127.0);
  int k = int(i);
  float a = texelFetch(ptLut, ivec2(k, row), 0).r;
  float b = k < 127 ? texelFetch(ptLut, ivec2(k + 1, row), 0).r : a;
  return clamp(a + (b - a) * (x - i), 0.0, 1.0);
}
float ptRand1(int v) {
  const int table[16] = int[16](0, 4, 10, 8, 4, 9, 7, 12, 5, 15, 13, 14, 11, 15, 2, 11);
  return float((((v % 9) + 2) * 3 & 15) ^ table[(v / 9) & 15]);
}
float ptRand2(vec2 point) {
  const int table[16] = int[16](10, 2, 15, 8, 0, 7, 4, 5, 5, 13, 2, 6, 13, 9, 3, 14);
  int u2 = int(ptRand1(int(point.x)));
  int v2 = int(ptRand1(int(point.y)));
  v2 += ((u2 & 3) == 1) ? 4 : 0;
  v2 ^= (u2 & 1) * 6;
  v2 += 10 + u2;
  v2 &= 15;
  v2 ^= table[u2];
  return -1.0 + float(v2) * 2.0 / 15.0;
}
float ptNoise(vec2 x) {
  vec2 grid = 9.0 * vec2(${num(p.frequency[0])}, ${num(p.frequency[1])}) * abs(x + ptPhase);
  vec2 point = floor(grid);
  vec2 frac = grid - point;
  float g0 = ptRand2(point) * (frac.x + frac.y);
  float g1 = ptRand2(point + vec2(1.0, 0.0)) * (frac.x + frac.y - 1.0);
  float g2 = ptRand2(point + vec2(0.0, 1.0)) * (frac.x + frac.y - 1.0);
  float g3 = ptRand2(point + vec2(1.0, 1.0)) * (frac.x + frac.y - 2.0);
  float xn = ptMap(1, frac.x);
  float yn = ptMap(1, frac.y);
  return mix(mix(g0, g1, xn), mix(g2, g3, xn), yn);
}
vec4 ptColor(float x) {
  x *= ${num(p.lutWidth - 1)};
  int i = int(x) + ${p.lutOffset};
  vec4 a = texelFetch(ptLut, ivec2(i, 0), 0);
  vec4 b = i < 255 ? texelFetch(ptLut, ivec2(i + 1, 0), 0) : a;
  return a + fract(x) * (b - a);
}`;
  const fragment = `
  vec4 t3;
  {
    vec2 uv = abs(vPt);${
      p.noise
        ? `
    uv.x += ${num(p.amplitude[0])} * ptNoise(uv);
    uv.y += ${num(p.amplitude[1])} * ptNoise(uv.yx);
    uv = abs(uv);`
        : ''
    }
    float su = ${shiftCode(p.shiftU, p.clampU, 'uv.y')};
    float sv = ${shiftCode(p.shiftV, p.clampV, 'uv.x')};
    uv.x += su;
    uv.y += sv;
    ${clampCode(p.clampU, 'uv.x')}
    ${clampCode(p.clampV, 'uv.y')}
    t3 = ptColor(ptMap(2, ${combinerCode(p.combiner)}));${
      p.alphaSeparate ? `\n    t3.a = ptColor(ptMap(3, ${combinerCode(p.alphaCombiner)})).a;` : ''
    }
  }`;
  return { vertexDecl, vertex, fragmentDecl, fragment };
}
