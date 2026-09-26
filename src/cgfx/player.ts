// Plays CGFX animations on a model: skeletal animations move the vertices on the CPU (the TEV shader stays
// as is), material animations move the texture coordinates (eyes). Frames run at 60 per second, like the
// game (FUN_0033555c: speed x 60 / frame rate).
import * as THREE from 'three';
import { evalBaked, evalChannel, type CgfxAnimation, type SkeletalTrack } from './anim';
import type { CgfxBone, CgfxMesh, CgfxModel } from './cgfx';
import type { ModelFactory } from './three';

export const ANIMATION_FPS = 60;

/** The game matches an animation number's name by its first 4 bytes ("001_"), so one number drives both kinds. */
export const animationKey = (name: string): string => name.slice(0, 4);

const euler = new THREE.Euler(0, 0, 0, 'ZYX'); // R = Rz * Ry * Rx
const quat = new THREE.Quaternion();
const vPos = new THREE.Vector3();
const vScale = new THREE.Vector3();
const tmp4 = [0, 0, 0, 0];

function localMatrix(bone: CgfxBone, track: SkeletalTrack | undefined, frame: number, out: THREE.Matrix4): void {
  const [sx, sy, sz] = bone.scale, [rx, ry, rz] = bone.rotation, [tx, ty, tz] = bone.translation;
  if (track?.channels) {
    const c = track.channels;
    vScale.set(evalChannel(c[0]!, frame, sx), evalChannel(c[1]!, frame, sy), evalChannel(c[2]!, frame, sz));
    euler.set(evalChannel(c[3]!, frame, rx), evalChannel(c[4]!, frame, ry), evalChannel(c[5]!, frame, rz));
    quat.setFromEuler(euler);
    vPos.set(evalChannel(c[7]!, frame, tx), evalChannel(c[8]!, frame, ty), evalChannel(c[9]!, frame, tz));
  } else if (track?.baked) {
    const b = track.baked;
    if (b.scale) {
      evalBaked(b.scale, 3, b.start, frame, tmp4);
      vScale.set(tmp4[0]!, tmp4[1]!, tmp4[2]!);
    } else vScale.set(sx, sy, sz);
    if (b.rotation) {
      evalBaked(b.rotation, 4, b.start, frame, tmp4);
      quat.set(tmp4[0]!, tmp4[1]!, tmp4[2]!, tmp4[3]!).normalize();
    } else quat.setFromEuler(euler.set(rx, ry, rz));
    if (b.translation) {
      evalBaked(b.translation, 3, b.start, frame, tmp4);
      vPos.set(tmp4[0]!, tmp4[1]!, tmp4[2]!);
    } else vPos.set(tx, ty, tz);
  } else {
    vScale.set(sx, sy, sz);
    quat.setFromEuler(euler.set(rx, ry, rz));
    vPos.set(tx, ty, tz);
  }
  out.compose(vPos, quat, vScale);
}

interface Part {
  mesh: THREE.Mesh;
  src: CgfxMesh;
  material: string;
}

export class AnimatedModel {
  readonly group: THREE.Group;
  readonly model: CgfxModel;
  private readonly parts: Part[];
  private readonly restInverse: THREE.Matrix4[];
  private readonly world: THREE.Matrix4[];
  private readonly skin: Float32Array;
  private skeletal: CgfxAnimation | null = null;
  private material: CgfxAnimation[] = [];

  constructor(factory: ModelFactory, hash: number) {
    const own = factory.buildOwn(hash);
    if (!own) throw new Error('モデルがありません');
    this.model = own.model;
    this.group = own.group;
    this.parts = own.parts.map((p) => ({ ...p, material: own.model.materials[p.src.material]?.name ?? '' }));
    const n = this.model.bones.length;
    this.world = Array.from({ length: n }, () => new THREE.Matrix4());
    this.skin = new Float32Array(n * 12);
    this.pose(null, 0);
    this.restInverse = this.world.map((m) => m.clone().invert());
  }

  /** Skeletal animations (the motions). */
  get motions(): CgfxAnimation[] {
    return this.model.animations.filter((a) => a.kind === 'skeletal' && a.skeletal.length);
  }

  /** Length of the current motion in frames (0 when none). */
  get frames(): number {
    return this.skeletal?.frames ?? Math.max(0, ...this.material.map((a) => a.frames));
  }

  get loop(): boolean {
    return this.skeletal?.loop ?? this.material.some((a) => a.loop);
  }

  /** Frame of an animation at a time: looping ones wrap on their own length (eyes often differ from the body). */
  static frameAt(a: CgfxAnimation, time: number): number {
    if (a.frames <= 0) return 0;
    return a.loop ? time % a.frames : Math.min(time, a.frames);
  }

  /** Select a motion by name (null = rest pose); material animations with the same key come with it. */
  select(name: string | null): void {
    this.skeletal = this.model.animations.find((a) => a.kind === 'skeletal' && a.name === name) ?? null;
    const key = name ? animationKey(name) : null;
    this.material = key ? this.model.animations.filter((a) => a.kind === 'material' && a.material.length && animationKey(a.name) === key) : [];
    this.update(0);
  }

  /** Put the model at a time (frames since the motion started). */
  update(time: number): void {
    if (this.model.bones.length) {
      this.pose(this.skeletal, this.skeletal ? AnimatedModel.frameAt(this.skeletal, time) : 0);
      this.deform();
    }
    this.moveTextures(time);
  }

  /** World matrices of the bones at a frame (parents first, the skeleton is small). */
  private pose(anim: CgfxAnimation | null, frame: number): void {
    const bones = this.model.bones;
    const tracks = new Map<string, SkeletalTrack>();
    for (const t of anim?.skeletal ?? []) tracks.set(t.bone, t);
    const done = new Uint8Array(bones.length);
    const local = new THREE.Matrix4();
    const visit = (i: number, depth: number): THREE.Matrix4 => {
      if (done[i]) return this.world[i]!;
      const bone = bones[i]!;
      localMatrix(bone, tracks.get(bone.name), frame, local);
      const p = bone.parent;
      if (p >= 0 && p < bones.length && p !== i && depth < 64) this.world[i]!.multiplyMatrices(visit(p, depth + 1), local);
      else this.world[i]!.copy(local);
      done[i] = 1;
      return this.world[i]!;
    };
    for (let i = 0; i < bones.length; i++) visit(i, 0);
  }

  /** Move the vertices: p = sum(weight x world x inverse rest world x rest position). */
  private deform(): void {
    const m = new THREE.Matrix4();
    for (let b = 0; b < this.world.length; b++) {
      m.multiplyMatrices(this.world[b]!, this.restInverse[b]!);
      const e = m.elements, o = b * 12;
      // Row-major 3x4 from the column-major 4x4.
      this.skin.set([e[0]!, e[4]!, e[8]!, e[12]!, e[1]!, e[5]!, e[9]!, e[13]!, e[2]!, e[6]!, e[10]!, e[14]!], o);
    }
    const s = this.skin;
    for (const { mesh, src } of this.parts) {
      const idx = src.skinIndices, wt = src.skinWeights;
      if (!idx || !wt) continue;
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      const rest = src.positions;
      for (let v = 0, n = rest.length / 3; v < n; v++) {
        const x = rest[v * 3]!, y = rest[v * 3 + 1]!, z = rest[v * 3 + 2]!;
        let ox = 0, oy = 0, oz = 0, total = 0;
        for (let k = 0; k < 4; k++) {
          const w = wt[v * 4 + k]!;
          if (!w) continue;
          const o = idx[v * 4 + k]! * 12;
          ox += w * (s[o]! * x + s[o + 1]! * y + s[o + 2]! * z + s[o + 3]!);
          oy += w * (s[o + 4]! * x + s[o + 5]! * y + s[o + 6]! * z + s[o + 7]!);
          oz += w * (s[o + 8]! * x + s[o + 9]! * y + s[o + 10]! * z + s[o + 11]!);
          total += w;
        }
        if (total > 0) {
          out[v * 3] = ox / total;
          out[v * 3 + 1] = oy / total;
          out[v * 3 + 2] = oz / total;
        } else {
          out[v * 3] = x;
          out[v * 3 + 1] = y;
          out[v * 3 + 2] = z;
        }
      }
      attr.needsUpdate = true;
    }
  }

  /** Texture coordinator translate / scale of the TEV materials (uniform uvm<unit>, see cgfx/tev.ts). */
  private moveTextures(time: number): void {
    for (const { mesh, src, material } of this.parts) {
      const mat = mesh.material as THREE.ShaderMaterial;
      const def = this.model.materials[src.material];
      if (!mat.uniforms || !def) continue;
      for (let i = 0; i < 3; i++) {
        const uni = mat.uniforms[`uvm${i}`];
        const u = def.units[i];
        if (!uni || !u) continue;
        let tu = u.translateU, tv = u.translateV, su = u.scaleU || 1, sv = u.scaleV || 1;
        for (const a of this.material)
          for (const t of a.material) {
            if (t.material !== material || t.coordinator !== i) continue;
            const f = AnimatedModel.frameAt(a, time);
            if (t.target === 'translate') {
              tu = evalChannel(t.channels[0], f, tu);
              tv = evalChannel(t.channels[1], f, tv);
            } else {
              su = evalChannel(t.channels[0], f, su);
              sv = evalChannel(t.channels[1], f, sv);
            }
          }
        const cos = Math.cos(u.rotate), sin = Math.sin(u.rotate);
        (uni.value as THREE.Matrix3).set(cos * su, -sin * sv, tu, sin * su, cos * sv, tv, 0, 0, 1);
      }
    }
  }
}
