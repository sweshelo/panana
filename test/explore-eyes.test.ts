// TEMPORARY (#78): log RPG2's eye (atlas) material animations from the ROM. Removed before the PR.
import { describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { Game } from '../src/game/game';
import { openImage } from '../src/rom/dump';
import { CIA, hasCia } from './env';
import { readGfx } from '../src/port/gfx/read';
import { decodeKeys } from '../src/port/gfx/util';
import { evalChannel } from '../src/cgfx/anim';
import { uvMatrix } from '../src/cgfx/tev';
import * as THREE from 'three';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const L = (...a: unknown[]): void => console.log('EXPLORE', ...a);

describe.skipIf(!hasCia)('explore eyes', () => {
  test('RPG2 eye material animations', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await game.monsters();
    const { buildComposite } = await import('../src/cgfx/tileset');
    const { MONSTER_MODEL_ARCHIVE } = await import('../src/game/monsters');
    const arc = parseArchive(await game.dump.readRomfs(MONSTER_MODEL_ARCHIVE));
    const seen = new Set<number>();
    const stats = new Map<string, number>();
    const inc = (k: string): void => void stats.set(k, (stats.get(k) ?? 0) + 1);
    let detailed = 0;
    for (const mon of book.monsters) {
      const x = book.modelOf(mon);
      if (!x || seen.has(x.model)) continue;
      seen.add(x.model);
      const set = buildComposite(arc, x.model, x.texture);
      const model = set.models.get(x.model)!;
      const body = unpackEntry(arc, findEntry(arc, x.model)!).body;
      let gfx;
      try {
        gfx = readGfx(body);
      } catch (e) {
        inc(`readGfx error ${(e as Error).message.slice(0, 40)}`);
        continue;
      }
      const texGfx = x.texture && findEntry(arc, x.texture) ? (() => { try { return readGfx(unpackEntry(arc, findEntry(arc, x.texture)!).body); } catch { return null; } })() : null;
      if (texGfx) {
        for (const kind of ['materialAnimations', 'skeletalAnimations', 'visibilityAnimations'] as const) if (texGfx[kind].length) inc(`texture file has ${kind}`);
      }
      for (const kind of ['visibilityAnimations', 'lightAnimations', 'cameraAnimations'] as const) if (gfx[kind].length) inc(`model file has ${kind}`);
      const animNames = model.animations.map((a) => `${a.kind[0]}:${a.name}`);
      const eyeMats = new Set<string>();
      for (const a of gfx.materialAnimations) for (const e of a.elements) {
        const m = /^Materials\["(.+)"\]\.(.+)$/.exec(e.name);
        if (m) eyeMats.add(m[1]!);
        inc(`element path ${e.name.replace(/"[^"]*"/g, '""')} type ${e.content.type}`);
        for (const c of (e.content as { channels?: unknown[] }).channels ?? []) {
          if (c === null) { inc('ch absent'); continue; }
          if (typeof c === 'number') { inc('ch const'); continue; }
          const g = c as { curveFlags: number; preRepeat: number; postRepeat: number; startFrame: number; endFrame: number; segments: { startFrame: number; endFrame: number; formatFlags: number }[] };
          inc(`curve flags ${g.curveFlags} pre ${g.preRepeat} post ${g.postRepeat} segs ${g.segments.length}`);
          for (const s of g.segments) inc(`seg quant ${s.formatFlags >>> 5} interp ${(s.formatFlags >> 2) & 7} const ${s.formatFlags & 1} start0 ${s.startFrame === 0} startEqCurve ${s.startFrame === g.startFrame}`);
        }
      }
      for (const name of eyeMats) {
        const mat = model.materials.find((m) => m.name === name);
        if (!mat) { inc('animated material missing from model'); continue; }
        for (const [i, u] of mat.units.entries()) {
          if (!u.name) continue;
          const t = set.textures.get(u.name);
          inc(`unit${i} tex ${t ? 'found' : 'MISSING'} wrap ${u.wrapS}/${u.wrapT} src ${u.source} tf ${u.transform}`);
        }
        const used = new Set<number>();
        for (const st of mat.tev ?? []) for (const s of [...st.srcRgb, ...st.srcA]) if (s >= 3 && s <= 5) used.add(s - 3);
        inc(`tev uses units ${[...used].sort().join(',')}`);
        const meshes = model.meshes.filter((me) => model.materials[me.material]?.name === name);
        for (const me of meshes) inc(`mesh visible ${me.visible} uvs ${!!me.uvs} uvs1 ${!!me.uvs1}`);
        // UV range of unit 0..2 at frames of the 001 material animation (renderer evaluation)
        const anims = model.animations.filter((a) => a.kind === 'material' && a.name.startsWith('001_'));
        const outFrames: string[] = [];
        for (let i = 0; i < 3; i++) {
          const u = mat.units[i];
          if (!u?.name || !used.has(i)) continue;
          const tex = set.textures.get(u.name);
          for (const a of anims) for (let f = 0; f <= a.frames; f += 1) {
            let tu = u.translateU, tv = u.translateV, su = u.scaleU || 1, sv = u.scaleV || 1;
            for (const t of a.material) {
              if (t.material !== name || t.coordinator !== i) continue;
              if (t.target === 'translate') { tu = evalChannel(t.channels[0], f, tu); tv = evalChannel(t.channels[1], f, tv); }
              else { su = evalChannel(t.channels[0], f, su); sv = evalChannel(t.channels[1], f, sv); }
            }
            const M = uvMatrix(new THREE.Matrix3(), u.transform, su, sv, u.rotate, tu, tv);
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            for (const me of meshes) {
              const uv = [me.uvs, me.uvs1, me.uvs2][u.source];
              if (!uv) continue;
              for (let k = 0; k < uv.length; k += 2) {
                const p = new THREE.Vector3(uv[k]!, uv[k + 1]!, 1).applyMatrix3(M);
                minU = Math.min(minU, p.x); maxU = Math.max(maxU, p.x); minV = Math.min(minV, p.y); maxV = Math.max(maxV, p.y);
              }
            }
            const out = minU < -0.01 || maxU > 1.01 || minV < -0.01 || maxV > 1.01;
            if (out) outFrames.push(`u${i} f${f}`);
            if (detailed < 6 && f % 6 === 0) L(`  ${mon.name} ${name} unit${i} ${a.name} f${f} t=(${r3(tu)},${r3(tv)}) s=(${r3(su)},${r3(sv)}) uv u[${r3(minU)},${r3(maxU)}] v[${r3(minV)},${r3(maxV)}] tex ${tex?.width}x${tex?.height} f${tex?.format}`);
          }
        }
        inc(outFrames.length ? 'eye uv leaves [0,1] in 001' : 'eye uv stays in [0,1] in 001');
        if (detailed < 6) {
          detailed++;
          L(`MODEL ${mon.name} ${x.model.toString(16)} anims ${animNames.join(' ')}`);
          L(`  material ${name} layer ${mat.layer} units ${JSON.stringify(mat.units.map((u) => ({ n: u.name, ws: u.wrapS, wt: u.wrapT, src: u.source, tf: u.transform, s: [u.scaleU, u.scaleV], r: u.rotate, t: [u.translateU, u.translateV] })))}`);
          L(`  tev ${JSON.stringify(mat.tev?.map((s) => [s.srcRgb, s.opRgb, s.combRgb, s.srcA, s.opA, s.combA]))} alphaTest ${JSON.stringify(mat.alphaFunc)} blend ${JSON.stringify(mat.blendFunc)}`);
          for (const me of meshes) L(`  mesh ${me.name} visible ${me.visible} prio ${me.priority} uv0 ${me.uvs ? Array.from(me.uvs.slice(0, 8)).map(r3).join(',') : '-'}`);
          for (const a of gfx.materialAnimations) for (const e of a.elements) {
            if (!e.name.includes(`"${name}"`)) continue;
            const chs = ((e.content as { channels?: unknown[] }).channels ?? []).map((c) => {
              if (c === null || typeof c === 'number') return c;
              const g = c as Parameters<typeof decodeKeys>[0] extends infer _ ? { curveFlags: number; startFrame: number; endFrame: number; preRepeat: number; postRepeat: number; segments: Parameters<typeof decodeKeys>[0][] } : never;
              return { cf: g.curveFlags, f: [g.startFrame, g.endFrame], rep: [g.preRepeat, g.postRepeat], segs: g.segments.map((s) => ({ f: [s.startFrame, s.endFrame], q: s.formatFlags >>> 5, i: (s.formatFlags >> 2) & 7, sc: [s.valueScale, s.valueOffset, s.frameScale], keys: decodeKeys(s).map((k) => [r3(k.frame), r3(k.value)]), raw: s.keys.slice(0, 6) })) };
            });
            L(`  anim ${a.name} loop ${a.loopMode} frames ${a.framesCount} ${e.name} ${JSON.stringify(chs)}`);
          }
          const ra = model.animations.filter((a) => a.kind === 'material');
          for (const a of ra) for (const t of a.material) if (t.material === name) L(`  renderer ${a.name} c${t.coordinator} ${t.target} ${JSON.stringify(t.channels.map((c) => (c === null || typeof c === 'number' ? c : { i: c.interp, q: c.quant, f: [c.start, c.end], k: Array.from(c.keys).map(r3) })))}`);
          L(`  depth write ${mat.depthWrite} test ${JSON.stringify(mat.depthTest)} offset ${mat.polygonOffset} cull ${mat.cull}`);
          for (const me of meshes) {
            const c = me.colors;
            let amin = Infinity, amax = -Infinity;
            if (c) for (let k = 3; k < c.length; k += 4) { amin = Math.min(amin, c[k]!); amax = Math.max(amax, c[k]!); }
            const bones = new Set<number>();
            if (me.skinIndices && me.skinWeights) for (let k = 0; k < me.skinIndices.length; k++) if (me.skinWeights[k]! > 0) bones.add(me.skinIndices[k]!);
            L(`  mesh colors ${c ? `alpha [${r3(amin)},${r3(amax)}]` : 'none'} bones ${[...bones].map((b) => model.bones[b]?.name).join(',')}`);
          }
          for (const other of model.meshes) {
            const om = model.materials[other.material];
            L(`  all mesh ${other.name} mat ${om?.name} prio ${other.priority} layer ${om?.layer} dw ${om?.depthWrite} dt ${JSON.stringify(om?.depthTest)} blend ${om?.blendFunc?.blend} visible ${other.visible}`);
          }
          // Positions during 001 (skeleton) vs rest
          const { ModelFactory } = await import('../src/cgfx/three');
          const { AnimatedModel } = await import('../src/cgfx/player');
          const am = new AnimatedModel(new ModelFactory(set), x.model);
          const motion = am.motions.find((a) => a.name.startsWith('001_'));
          const box = (f: number | null): string => {
            am.select(f === null ? null : motion?.name ?? null);
            am.update(f ?? 0);
            const parts: string[] = [];
            am.group.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              const pos = mesh.geometry.getAttribute('position');
              const b = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
              const sz = b.getSize(new THREE.Vector3());
              const ce = b.getCenter(new THREE.Vector3());
              parts.push(`${mesh.name || (mesh.material as THREE.Material).name}: c(${r3(ce.x)},${r3(ce.y)},${r3(ce.z)}) s(${r3(sz.x)},${r3(sz.y)},${r3(sz.z)})`);
            });
            return parts.join(' | ');
          };
          L(`  rest: ${box(null)}`);
          for (const f of [0, 20, 40]) L(`  001 f${f}: ${box(f)}`);
          L(`  out-of-range frames: ${outFrames.slice(0, 20).join(' ')}`);
        }
      }
    }
    L('STATS', JSON.stringify([...stats].sort((a, b) => b[1] - a[1]), null, 0));
    expect(seen.size).toBeGreaterThan(0);
  }, 300_000);
});
