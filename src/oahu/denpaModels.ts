// RPG3 Denpa people: mapChara -> denpaCustom -> body, head, face atlas and body colour (naauao oahu/map.md §9.5).
// No ROM bytes are embedded. The same assembler can take an appearance from another source (e.g. a QR record).
import * as THREE from 'three';
import { findEntry, parseArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { bchAnimations, parseBch, unwrapBch } from '../bch/bch';
import type { CgfxBone, CgfxMaterial, CgfxModel } from '../cgfx/cgfx';
import type { TilesetModels } from '../cgfx/tileset';
import type { Dump } from '../rom/dump';
import { f32, u16, u32 } from '../util/bytes';
import type { OahuRecordModel } from './mapObjects';
import type { OahuMaster } from './master';

export type DenpaSource = Extract<OahuRecordModel, { type: 'denpa' }>;

/** Zero-based model / atlas selectors after FUN_0038ACFC converts denpaCustom's one-based fields. */
export interface DenpaAppearance {
  antennaGroup: number;
  level: number;
  bodyColor: number;
  head: number;
  body: number;
  hair: number;
  face: number;
  skinColor: number;
  hairColor: number;
  brow: number;
  eye: number;
  nose: number;
  mouth: number;
  cheek: number;
  glasses: number;
}

export function denpaAppearance(row: Uint8Array): DenpaAppearance {
  if (row.length < 0x28) throw new Error('denpaCustom の行が短すぎます');
  return {
    antennaGroup: u16(row, 4), level: row[0x11]!, bodyColor: row[0x18]!, head: row[0x19]! - 1, body: row[0x1a]! - 1,
    face: row[0x1b]! - 1, hair: row[0x1c]!, skinColor: row[0x1d]! - 1, hairColor: row[0x1e]! - 1,
    brow: row[0x1f]! - 1, eye: row[0x20]! - 1, nose: row[0x21]! - 1, mouth: row[0x22]! - 1,
    cheek: row[0x23]! - 1, glasses: row[0x24]! - 1,
  };
}

/** Kind 3 resolves through save key 0x49; without that unit FUN_00221A94 falls back to denpaCustom #92. */
export const denpaPreviewRow = (source: DenpaSource): number => source.kind === 3 ? 92 : source.id;

export function denpaSourceLabel(source: DenpaSource): string {
  return source.kind === 2
    ? `denpaCustom #${source.id}${[79, 82, 83].includes(source.id) ? ' (セーブによる変更前の姿)' : ''}`
    : `セーブ内の個体 #${source.id} (セーブ未読込: 既定の姿で表示)`;
}

/** FUN_001EA958's runtime atlas offsets; negate them for the renderer's Maya translation fields. */
export function denpaFaceUv(part: string, value: number): [number, number] {
  const counts: Record<string, number> = { Brow: 20, Eye: 48, Nose: 32, Mouth: 40, Cheek: 12, Megane: 24, Skin: 12, Hair: 40 };
  if (!Number.isInteger(value) || value < 0 || value >= (counts[part] ?? 0)) throw new Error(`顔パーツ ${part} #${value} が範囲外です`);
  switch (part) {
    case 'Brow': return [(value < 16 ? 4 : 5) / 16, -(value < 16 ? value - 8 : value - 12) / 16];
    case 'Eye': return [Math.floor(value / 16) / 16, -(value % 16) / 16];
    case 'Nose': return [(Math.floor(value / 16) + 3) / 16, -(value % 16) / 16];
    case 'Mouth': return [(Math.floor(value / 16) * 2 + 1) / 16, -(value % 16) / 16];
    case 'Cheek': return [0.25, -((value < 8 ? value : value - 12) + 4) / 16];
    case 'Megane': return [(Math.floor(value / 16) + 4) / 16, -(value % 16) / 16];
    case 'Skin': return [-(value < 8 ? value % 8 : 7 - value % 8) / 8, -Math.floor(value / 8) / 4];
    case 'Hair': {
      if (value >= 32) return [(value - 32) / 8, -3 / 8];
      if (value % 4) return [Math.floor(value / 4) / 8, -(value % 4 - 1) / 8];
      const row = Math.floor(value / 4);
      return [(4 + row % 4) / 8, -(Math.floor(row / 4) - 2) / 8];
    }
    default: throw new Error(`顔パーツ ${part} がありません`);
  }
}

const SKIN_COLORS = [[248, 219, 199], [255, 215, 128], [255, 190, 170], [230, 140, 80], [210, 105, 70], [144, 60, 40]];
const HAIR_COLORS = [[40, 40, 40], [255, 255, 255], [128, 69, 7], [205, 144, 42], [148, 42, 0], [255, 221, 32], [0, 89, 255], [9, 166, 0], [161, 40, 255], [255, 110, 128], [247, 87, 0], [240, 0, 17]];

function faceMaterials(face: CgfxModel, a: DenpaAppearance): CgfxMaterial[] {
  const values: Record<string, number> = { Brow: a.brow, Eye: a.eye, Nose: a.nose, Mouth: a.mouth, Cheek: a.cheek, Megane: a.glasses, Hair: a.hair, Skin: a.face };
  const skin = SKIN_COLORS[a.skinColor], hair = HAIR_COLORS[a.hairColor];
  if (!skin || !hair) throw new Error('顔の色が範囲外です');
  return face.materials.map((m) => {
    const [offsetU, offsetV] = denpaFaceUv(m.name, values[m.name]!);
    const translateU = -offsetU, translateV = -offsetV;
    // FUN_001EA390 / 334 / 42C / 2BC: skin, hair, coloured mouth 25..27 and coloured eyebrows 15.
    const rgb = m.name === 'Skin' ? skin : m.name === 'Hair' || (m.name === 'Mouth' && a.mouth >= 25 && a.mouth <= 27) || (m.name === 'Brow' && a.brow === 15) ? hair : null;
    return {
      ...m,
      units: m.units.map((u, i) => i === 0 ? { ...u, translateU, translateV } : u),
      uv: { ...m.uv, translateU, translateV },
      tev: m.tev?.map((t) => ({ ...t, color: rgb ? [...rgb.map((v) => v / 255), 1] : t.color })) ?? null,
    };
  });
}

function boneWorld(bones: CgfxBone[]): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  for (const b of bones) {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...b.translation), new THREE.Quaternion().setFromEuler(new THREE.Euler(...b.rotation, 'ZYX')), new THREE.Vector3(...b.scale));
    out.push(b.parent >= 0 ? out[b.parent]!.clone().multiply(local) : local);
  }
  return out;
}

/** Attach models to named bones, remapping skin indices and bind positions so the body motion moves all parts. */
function attach(target: CgfxModel, part: CgfxModel, parent: number, scale: [number, number, number] = [1, 1, 1]): number {
  const boneOffset = target.bones.length, materialOffset = target.materials.length;
  const matrix = (boneWorld(target.bones)[parent] ?? new THREE.Matrix4()).clone().scale(new THREE.Vector3(...scale));
  const point = new THREE.Vector3();
  target.bones.push(...part.bones.map((b) => ({
    ...b, name: `${boneOffset}/${b.name}`, parent: b.parent < 0 ? parent : b.parent + boneOffset,
    scale: b.parent < 0 ? b.scale.map((v, i) => v * scale[i]!) as [number, number, number] : b.scale,
    translation: b.parent < 0 ? b.translation.map((v, i) => v * scale[i]!) as [number, number, number] : b.translation,
  })));
  target.materials.push(...part.materials);
  target.meshes.push(...part.meshes.map((m) => {
    const positions = m.positions.slice();
    for (let i = 0; i < positions.length; i += 3) point.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    const normals = m.normals?.slice() ?? null;
    if (normals) for (let i = 0; i < normals.length; i += 3) point.fromArray(normals, i).transformDirection(matrix).toArray(normals, i);
    return { ...m, positions, normals, material: m.material + materialOffset, skinIndices: m.skinIndices?.map((i) => i + boneOffset) ?? null };
  }));
  return boneOffset;
}

export class OahuDenpaModels {
  private readonly archives = new Map<string, Promise<Archive>>();
  private antennas: Promise<Map<number, CgfxModel>> | null = null;
  private heads: Promise<Map<number, CgfxModel>> | null = null;

  constructor(readonly dump: Dump, readonly master: OahuMaster) {}

  private archive(name: string): Promise<Archive> {
    let p = this.archives.get(name);
    if (!p) {
      p = this.dump.readRomfs(name).then(parseArchive);
      this.archives.set(name, p);
      p.catch(() => this.archives.delete(name));
    }
    return p;
  }

  private async file(name: string, hash: number) {
    const arc = name === '21350000' ? this.master.archive : await this.archive(name);
    const e = findEntry(arc, hash);
    if (!e) throw new Error(`電波人間のパーツ ${name}/${hash.toString(16)} がありません`);
    return parseBch(unwrapBch(unpackEntry(arc, e).body));
  }

  private headModels(): Promise<Map<number, CgfxModel>> {
    this.heads ??= this.archive('15920000').then((arc) => {
      const models = new Map<number, CgfxModel>();
      for (const e of arc.entries) for (const m of parseBch(unwrapBch(unpackEntry(arc, e).body)).models) {
        const match = /^hum_head_(\d+)$/.exec(m.name);
        if (match) models.set(Number(match[1]) - 1, m);
      }
      return models;
    });
    return this.heads;
  }

  private async antenna(a: DenpaAppearance): Promise<{ model: CgfxModel; textureHash: number; scale: number }> {
    const group = this.master.table('antennaGroup.bin').row(a.antennaGroup);
    // FUN_0029B398 selects the ability stage by level. Save-dependent level 0 previews the first learned stage.
    let rank = 0;
    for (let i = 0; i < 4; i++) {
      if (Math.max(1, a.level) < (u32(group, i * 8 + 4) & 1023)) break;
      rank = i + 1;
    }
    const phase = Math.max(0, rank - 1), bits = u32(group, phase * 8 + 4);
    const type = (bits >>> 19) & 7;
    const selector = Math.min(type < 2 ? type : (bits >>> 22) & 255, 65);
    this.antennas ??= this.archive('E50D0000').then((arc) => {
      const models = new Map<number, CgfxModel>();
      for (const e of arc.entries) for (const m of parseBch(unwrapBch(unpackEntry(arc, e).body)).models) {
        const match = /^antenna_(\d+)$/.exec(m.name);
        if (match) models.set(Number(match[1]), m);
        else if (m.name === 'antenna_empty') models.set(65, m);
      }
      return models;
    });
    const model = (await this.antennas).get(selector);
    if (!model) throw new Error(`アンテナ #${selector} がありません`);
    const icon = type < 2 ? ((bits >>> 22) & 255) - 1 : 0;
    const textureHash = bits >>> 31 ? 0x33945c00 : 0x75f22000;
    const materials = model.materials.map((m, i) => {
      if (selector >= 2 || i !== 0) return m;
      const n = icon >= 0 && icon < 30 ? icon : 0;
      const translateU = -Math.floor(n / 8) / 8, translateV = (n % 8) / 8;
      return { ...m, units: m.units.map((u, j) => j === 0 ? { ...u, translateU, translateV } : u), uv: { ...m.uv, translateU, translateV } };
    });
    const size = (group[0x32]! & 3) === 1 && rank ? rank - 1 : 1;
    const scale = size === 0 ? 0.65 : size === 1 ? 0.9 : size === 2 || size === 3 ? 1.3 : 1;
    return { model: { ...model, materials }, textureHash, scale };
  }

  async load(source: DenpaSource): Promise<{ set: TilesetModels; hash: number }> {
    const custom = this.master.table('denpaCustom.bin'), row = denpaPreviewRow(source);
    const a = denpaAppearance(custom.row(row));
    return this.assemble(a);
  }

  /** Assemble an appearance using ROM assets; callers need not know mapChara or denpaCustom. */
  async assemble(a: DenpaAppearance): Promise<{ set: TilesetModels; hash: number }> {
    const bodyRow = this.master.table('bodyData.bin').row(a.body);
    const colorRow = this.master.table('bodyColorData.bin').row(a.bodyColor);
    const [bodyFile, faceFile, heads, colorFile, antenna, motionArc] = await Promise.all([
      this.file('96EB0000', 0x679f6c00), this.file('96EB0000', 0x1ea28800), this.headModels(),
      this.file('21350000', u32(colorRow, 0)), this.antenna(a), this.archive('F48B0000'),
    ]);
    const antennaTexture = await this.file('21350000', antenna.textureHash);
    const body = bodyFile.models[0]!, face = faceFile.models[0]!, head = heads.get(a.head);
    if (!head) throw new Error(`頭のパーツ #${a.head} がありません`);
    const motion = findEntry(motionArc, 0x6f8f7000);
    if (!motion) throw new Error('電波人間の待機モーションがありません');
    // FUN_004AEB00 / 4AEDD4: body X/Z = +8, Y = +4; head uses +0 uniformly.
    const scale = f32(bodyRow, 0), height = f32(bodyRow, 4), width = f32(bodyRow, 8);
    if ([scale, height, width].some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('電波人間の大きさが不正です');
    const model: CgfxModel = {
      name: `denpa/head${a.head}/body${a.body}/color${a.bodyColor}`, meshes: [], materials: [],
      bones: [{ name: 'denpa', parent: -1, scale: [width, height, width], rotation: [0, 0, 0], translation: [0, 0, 0] }],
      animations: bchAnimations(unwrapBch(unpackEntry(motionArc, motion).body)),
    };
    attach(model, body, 0);
    // Keep the body's bone names for the shared skeletal motion; attached parts have distinct names.
    body.bones.forEach((b, i) => { model.bones[i + 1]!.name = b.name; });
    const headBone = model.bones.findIndex((b) => b.name === 'head');
    if (headBone < 0) throw new Error('体に head ボーンがありません');
    const headOffset = attach(model, head, headBone, [scale / width, scale / height, scale / width]);
    const faceBone = head.bones.findIndex((b) => b.name === 'm_Face');
    if (faceBone < 0) throw new Error('頭に m_Face ボーンがありません');
    attach(model, { ...face, materials: faceMaterials(face, a) }, headOffset + faceBone);
    // FUN_001EAD90 / 1EAECC / 1EADF4 resolve the learned ability's model and atlas icon.
    const antennaBone = head.bones.findIndex((b) => b.name === 'ante');
    const antennaScale = antenna.scale;
    if (antennaBone >= 0) attach(model, antenna.model, headOffset + antennaBone, [antennaScale / scale, antennaScale / scale, antennaScale / scale]);
    const set: TilesetModels = { models: new Map([[0, model]]), paths: new Map([[0, model.name]]), textures: new Map(), errors: [] };
    for (const t of [...bodyFile.textures, ...faceFile.textures, ...antennaTexture.textures, ...colorFile.textures]) set.textures.set(t.name, t);
    return { set, hash: 0 };
  }
}
