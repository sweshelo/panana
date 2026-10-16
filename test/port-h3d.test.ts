// H3D (BCH) object model, reader and writer (src/port/h3d): every monster / item model BCH of RPG3 (version 8) and
// RPG FREE! (0x21) reads and writes back byte-identical, converts to the other version and reads back the same, and
// the converted files read in the renderer's reader (src/bch/bch.ts) like the originals. Needs the decrypted CIAs
// (test/env.ts); skipped when they are missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';
import { bchOffset, parseBch } from '../src/bch/bch';
import { mergeSegments, readH3D, writeH3D, type H3D } from '../src/port/h3d';
import { openImage, openImages, type Dump } from '../src/rom/dump';
import { hasLanai, hasOahuBase, hasOahuUpdate, LANAI_BASE, LANAI_UPDATE, OAHU_BASE, OAHU_UPDATE } from './env';

interface Bch {
  where: string;
  bytes: Uint8Array;
}

async function bchs(dump: Dump, archives: string[]): Promise<Bch[]> {
  const out: Bch[] = [];
  for (const name of archives) {
    const arc = parseArchive(await dump.readRomfs(name));
    for (const e of arc.entries) {
      const body = unpackEntry(arc, e).body;
      const o = bchOffset(body);
      if (o >= 0) out.push({ where: `${name}/${e.hash.toString(16).padStart(8, '0')}`, bytes: body.subarray(o) });
    }
  }
  return out;
}

/** The first differing byte of a rewrite, or null when identical. */
function rewriteDiff(b: Uint8Array): string | null {
  const o = writeH3D(readH3D(b));
  const n = Math.min(o.length, b.length);
  let i = 0;
  while (i < n && o[i] === b[i]) i++;
  return i === n && o.length === b.length ? null : `differs at 0x${i.toString(16)} (${o.length} / ${b.length} bytes)`;
}

// ---- Semantic comparison

const QUANT = new Set(['valueScale', 'valueOffset', 'frameScale', 'invDuration']);
/** Header fields a conversion changes on purpose. */
const HEADER = new Set(['backwardCompatibility', 'forwardCompatibility', 'converterVersion', 'flags']);

/** A version 8 curve of several segments as the one segment a version 0x21 file gets (write.ts mergeSegments). */
function asOneSegment(o: Record<string, unknown>): Record<string, unknown> {
  if (!('curveIndex' in o && 'keyFrames' in o)) return o;
  const merged: Record<string, unknown> = { ...o };
  if (o.moreSegments) {
    // the merged keys are encoded with new quantization parameters
    for (const k of QUANT) delete merged[k];
    Object.assign(merged, mergeSegments(o as never), { startFrame: o.startFrame, endFrame: o.endFrame });
  }
  delete merged.moreSegments;
  delete merged.segmentStart;
  delete merged.segmentEnd;
  return merged;
}

/** Where `a` and `b` differ (floats compared as float32, quantization parameters only when both have them). */
function semanticDiff(a: unknown, b: unknown, path = '', root = true): string | null {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.fround(a) === Math.fround(b) || Math.abs(a - b) < 1e-5 ? null : `${path}: ${a} != ${b}`;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return `${path}: length ${x.length} != ${y.length}`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${path}[${i}]: ${x[i]} != ${y[i]}`;
    return null;
  }
  if (a instanceof Map && b instanceof Map) return semanticDiff([...a], [...b], path, false);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = semanticDiff(a[i], b[i], `${path}[${i}]`, false);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = asOneSegment(a as Record<string, unknown>), y = asOneSegment(b as Record<string, unknown>);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (root && HEADER.has(k)) continue;
      if (QUANT.has(k) && (x[k] === undefined || y[k] === undefined)) continue;
      const d = semanticDiff(x[k], y[k], `${path}.${k}`, false);
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${String(a)} != ${String(b)}`;
}

/** The header each game's files have. */
const TARGET = {
  8: { backward: 8, forward: 8, converter: 39824, flags: 4 },
  0x21: { backward: 0x21, forward: 0x21, converter: 42921, flags: 5 },
} as const;

/** Convert to the other version, read back, compare; convert back and compare; read both in parseBch. */
function conversionDiff(b: Uint8Array): string | null {
  const h = readH3D(b);
  const to = h.backwardCompatibility === 8 ? 0x21 : 8;
  const out = writeH3D(h, TARGET[to]);
  const h2 = readH3D(out);
  if (h2.backwardCompatibility !== to) return 'version';
  const d = semanticDiff(h, h2);
  if (d) return `to ${to}: ${d}`;
  const back = readH3D(writeH3D(h2, TARGET[h.backwardCompatibility as 8 | 0x21]));
  const d2 = semanticDiff(h, back);
  if (d2) return `back: ${d2}`;
  return rendererDiff(b, out);
}

/** The renderer's reader sees the same models in both files. */
function rendererDiff(a: Uint8Array, b: Uint8Array): string | null {
  const x = parseBch(a), y = parseBch(b);
  if (x.models.length !== y.models.length || x.textures.length !== y.textures.length) return 'parseBch: model / texture count';
  for (let i = 0; i < x.textures.length; i++) if (x.textures[i]!.name !== y.textures[i]!.name || semanticDiff(x.textures[i]!.rgba, y.textures[i]!.rgba)) return `parseBch: texture ${i}`;
  for (let m = 0; m < x.models.length; m++) {
    const p = x.models[m]!, q = y.models[m]!;
    if (p.meshes.length !== q.meshes.length || p.bones.length !== q.bones.length || p.materials.length !== q.materials.length) return `parseBch: model ${m} counts`;
    if (p.animations.length !== q.animations.length || p.animations.some((an, k) => an.name !== q.animations[k]!.name || an.loop !== q.animations[k]!.loop)) return `parseBch: model ${m} animations`;
    for (let k = 0; k < p.meshes.length; k++) {
      const d = semanticDiff(p.meshes[k]!.positions, q.meshes[k]!.positions) ?? semanticDiff(p.meshes[k]!.uvs, q.meshes[k]!.uvs) ?? semanticDiff(p.meshes[k]!.indices, q.meshes[k]!.indices);
      if (d) return `parseBch: model ${m} mesh ${k} ${d}`;
    }
    const look = (t: (typeof p.materials)[number]): unknown => [t.textures, t.tev, t.tevBuffer, t.blendFunc, t.alphaFunc, t.depthTest, t.depthWrite, t.cull, t.units];
    const d = semanticDiff(p.bones, q.bones) ?? semanticDiff(p.materials.map(look), q.materials.map(look));
    if (d) return `parseBch: model ${m} ${d}`;
  }
  return null;
}

/** Drop every stored command list so the writer generates them (as for a converter's output). */
function stripCommands(h: H3D): void {
  for (const m of h.models) {
    for (const mesh of m.meshes) {
      mesh.enableCommands = undefined;
      mesh.disableCommands = undefined;
      for (const s of mesh.subMeshes) s.commands = undefined;
    }
    for (const mat of m.materials) {
      mat.textureCommands = undefined;
      mat.materialParams.fragmentShaderCommands = undefined;
    }
  }
  for (const t of h.textures) {
    t.texture0Commands = undefined;
    t.texture1Commands = undefined;
    t.texture2Commands = undefined;
  }
}

function check(list: Bch[], f: (b: Uint8Array) => string | null): string[] {
  const bad: string[] = [];
  for (const x of list) {
    let d: string | null;
    try {
      d = f(x.bytes);
    } catch (e) {
      d = (e as Error).message;
    }
    if (d) bad.push(`${x.where}: ${d}`);
  }
  return bad;
}

const OAHU_MONSTERS = ['28480000'];
const OAHU_ITEMS = ['838B0000', '96EB0000', 'D4270000', '982C0000', '980C0000', '21350000'];
const LANAI_MONSTERS = ['28480000', '719F0000'];

describe.skipIf(!hasOahuBase)('H3D port: RPG3 (version 8)', () => {
  let monsters: Bch[];
  let items: Bch[];
  beforeAll(async () => {
    const dump = hasOahuUpdate
      ? await openImages([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], (f) => (f as unknown as { name: string }).name)
      : await openImage(Bun.file(OAHU_BASE), 'base');
    monsters = await bchs(dump, OAHU_MONSTERS);
    items = await bchs(dump, OAHU_ITEMS);
  }, 120_000);

  test('every monster and item BCH reads and writes back byte-identical', () => {
    expect(monsters.length).toBeGreaterThan(290);
    expect(items.length).toBeGreaterThan(1300);
    expect(check(monsters, rewriteDiff)).toEqual([]);
    expect(check(items, rewriteDiff)).toEqual([]);
    expect(monsters.every((m) => readH3D(m.bytes).backwardCompatibility === 8)).toBe(true);
  }, 120_000);

  test('every monster BCH converts to version 0x21 and back, the renderer reads it the same', () => {
    expect(check(monsters, conversionDiff)).toEqual([]);
  }, 300_000);

  test('item BCHs (every 4th) convert to version 0x21 and back', () => {
    expect(check(items.filter((_, i) => i % 4 === 0), conversionDiff)).toEqual([]);
  }, 300_000);

  test('a fresh layout (no read layout) reads back the same', () => {
    const fresh = (b: Uint8Array): string | null => {
      const h = readH3D(b);
      const out = writeH3D(h, { freshLayout: true });
      return semanticDiff(h, readH3D(out)) ?? rendererDiff(b, out);
    };
    expect(check(monsters.filter((_, i) => i % 3 === 0), fresh)).toEqual([]);
  }, 300_000);

  test('generated commands (as for a converted model) draw the same meshes', () => {
    const generated = (b: Uint8Array): string | null => {
      const h = readH3D(b);
      if (!h.models.length && !h.textures.length) return null;
      stripCommands(h);
      return rendererDiff(b, writeH3D(h, TARGET[0x21]));
    };
    expect(check(monsters.filter((_, i) => i % 3 === 0), generated)).toEqual([]);
  }, 300_000);

  test('a monster: enemy_03_01 (skeleton, smooth skinning, layer ranges, curves of one segment per v8 curve list)', () => {
    const h = monsters.map((m) => readH3D(m.bytes)).find((x) => x.models[0]?.name === 'enemy_03_01')!;
    const m = h.models[0]!;
    expect([m.meshes.length, m.materials.length, m.skeleton.length]).toEqual([4, 3, 23]);
    expect(m.meshesLayer0.length + m.meshesLayer1.length + m.meshesLayer2.length + m.meshesLayer3.length).toBe(4);
    expect(h.materials.every((p, i) => p === m.materials[i]!.materialParams)).toBe(true);
    expect(m.materials.map((x) => x.materialParams.shaderReference)).toContain('2@DefaultShader-rs-nl');
    expect(h.skeletalAnimations.map((a) => a.name)).toEqual(['001_E03_wait', '003_E03_walk', '004_E03_run']);
  });
});

describe.skipIf(!hasLanai)('H3D port: RPG FREE! (version 0x21)', () => {
  let monsters: Bch[];
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    monsters = await bchs(dump, LANAI_MONSTERS);
  }, 120_000);

  test('every monster BCH (Base 28480000 and Update 719F0000) reads and writes back byte-identical', () => {
    expect(monsters.length).toBe(846);
    expect(check(monsters, rewriteDiff)).toEqual([]);
    expect(monsters.every((m) => readH3D(m.bytes).backwardCompatibility === 0x21)).toBe(true);
  }, 120_000);

  test('every monster BCH converts to version 8 and back, the renderer reads it the same', () => {
    expect(check(monsters, conversionDiff)).toEqual([]);
  }, 300_000);

  test('a fresh layout (no read layout) reads back the same', () => {
    const fresh = (b: Uint8Array): string | null => {
      const h = readH3D(b);
      const out = writeH3D(h, { freshLayout: true });
      return semanticDiff(h, readH3D(out)) ?? rendererDiff(b, out);
    };
    expect(check(monsters.filter((_, i) => i % 3 === 0), fresh)).toEqual([]);
  }, 300_000);

  test('generated commands (as for a converted model) draw the same meshes', () => {
    const generated = (b: Uint8Array): string | null => {
      const h = readH3D(b);
      stripCommands(h);
      return rendererDiff(b, writeH3D(h, TARGET[8]));
    };
    expect(check(monsters.filter((_, i) => i % 3 === 0), generated)).toEqual([]);
  }, 300_000);
});
