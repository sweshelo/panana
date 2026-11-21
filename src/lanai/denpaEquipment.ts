// The equipment a Denpa person of the map wears (DenpaCustom +0x18〜+0x2C: ItemData IDs; read from the data of the 209
// rows, 2026-11-21: +0x18 head / glasses, +0x1C neck, +0x20 gloves / bracelets, +0x24 feet, +0x28 the back (weapons,
// capes, wings, skirts, tails, drums), +0x2C clothes; +0x10 is an item carried, not worn).
// How the field puts them on (Update v17408, the loop 0x1B6440〜0x1B64E4; read by a Sonnet subagent, 2026-11-21,
// roms/tmpmap/equip-code-analysis.md):
// - Necks, gloves, bracelets, feet, capes and wings follow the body's bones of the same names, from a fixed list per
//   kind (0x4479F0 → 0x3DE744); their models are made in the body's space. A bone not in the list stays on the kind's
//   base bone (0x3018CC).
// - Heads, weapons, drums, skirts and tails are one rigid part on one bone (0x3018CC): the head, shoulder_back, the
//   head, hip, tail; their models are made at the bone's origin.
// - Glasses (0x82) are no part: equipInfo_face +0x00 bits 0〜4 pick a cell of the face's Megane (0x2D3418 → 0x26CE7C).
// - Clothes (0xD1 / 0xD2) are no part: a hum_base texture in place of the body's pattern, the body's constants white
//   and black (0x2D3C18〜0x2D3C5C); not drawn on the map (animationModels.ts).
import * as THREE from 'three';
import { parseBch } from '../bch/bch';
import type { CgfxModel, CgfxTexture } from '../cgfx/cgfx';
import { attach, boneWorld } from '../oahu/denpaModels';
import { u32 } from '../util/bytes';
import { lanaiEquipRow } from './equipment';
import { lanaiItemBody, lanaiItems, textureOnlyKind, type LanaiItem } from './items';
import type { LanaiSession } from './session';

/** DenpaCustom fields of the worn equipment (head, neck, hands, feet, back, clothes). */
export const LANAI_DENPA_EQUIP_FIELDS = [0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c] as const;

/** The item kind of glasses (a cell of the face, not a model). */
export const LANAI_GLASSES = 0x82;

/** The items a DenpaCustom row wears (empty fields and IDs that are no item are left out). */
export function lanaiDenpaEquipment(session: LanaiSession, row: Uint8Array): LanaiItem[] {
  const data = session.need('ItemData');
  // lanaiItems leaves out the rows without ItemDataCore, so its index is not the row
  const byRow = new Map(lanaiItems(session).map((it) => [it.row, it]));
  const out: LanaiItem[] = [];
  for (const o of LANAI_DENPA_EQUIP_FIELDS) {
    const r = data.find(u32(row, o));
    const it = r > 0 ? byRow.get(r) : undefined;
    if (it) out.push(it);
  }
  return out;
}

/** The face's glasses cell (the Megane value of the face) of the items worn: equipInfo_face +0x00 & 31, 0 = none. */
export function lanaiDenpaGlasses(session: LanaiSession, items: readonly LanaiItem[]): number {
  const it = items.find((i) => i.kind === LANAI_GLASSES);
  const ref = it && lanaiEquipRow(session, it);
  return ref ? ref.table.u32(ref.row, 0) & 31 : 0;
}

/** Bones a part follows by name, by item kind (the tables at 0x447B00〜0x447BC8), and the kind's base bone. */
const FOLLOW: Record<number, { names: readonly string[]; base: string }> = {
  0x91: { names: ['root', 'hip', 'spine', 'L_arm', 'R_arm', 'head', 'scarf'], base: 'head' },
  0xa1: { names: ['spine', 'L_elbow', 'L_hand', 'R_elbow', 'R_hand'], base: 'Root' },
  0xa2: { names: ['L_hand', 'R_hand'], base: 'Root' },
  0xb1: { names: ['hip', 'L_foot', 'L_knee', 'L_heel', 'R_foot', 'R_knee', 'R_heel'], base: 'hip' },
};
const CAPE = {
  names: [
    'root',
    'hip',
    'tail',
    'spine',
    'L_arm',
    'R_arm',
    'head',
    'manteau1',
    'manteau2',
    'manteau3',
    'L_wing',
    'R_wing',
  ],
  base: 'spine',
};
FOLLOW[0xc1] = CAPE;
FOLLOW[0xc2] = CAPE;

/** The bone a rigid part is put on, by item kind (0x3018CC); the head's items take the head model's root. */
function rigidBone(kind: number): string {
  if (kind === 0xc4) return 'head';
  if (kind === 0xc5) return 'hip';
  if (kind === 0xc6) return 'tail';
  if (kind === 0xc3) return 'shoulder_back';
  return 'spine';
}

/** Add a part made in the body's space whose bones in `names` follow the body's bones of the same names. */
function attachByName(
  target: CgfxModel,
  part: CgfxModel,
  byName: Map<string, number>,
  names: readonly string[],
  base: number,
): void {
  const matrix = boneWorld(target.bones)[0] ?? new THREE.Matrix4();
  const map = part.bones.map((b) => (names.includes(b.name) ? (byName.get(b.name) ?? base) : base));
  const materialOffset = target.materials.length;
  target.materials.push(...part.materials);
  const point = new THREE.Vector3();
  for (const m of part.meshes) {
    const positions = m.positions.slice();
    for (let i = 0; i < positions.length; i += 3)
      point.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    const normals = m.normals?.slice() ?? null;
    if (normals)
      for (let i = 0; i < normals.length; i += 3)
        point.fromArray(normals, i).transformDirection(matrix).toArray(normals, i);
    target.meshes.push({
      ...m,
      positions,
      normals,
      material: m.material + materialOffset,
      skinIndices: m.skinIndices?.map((i) => map[i] ?? base) ?? null,
    });
  }
}

/**
 * Put `items` on a Denpa person assembled from hum_body_01 (its bones keep their names in `target`); `headRoot` is the
 * bone of the head model's root. Returns the textures the parts use. Glasses (lanaiDenpaGlasses gives the face's
 * cell) and clothes are not put on here.
 */
export async function attachDenpaEquipment(
  session: LanaiSession,
  target: CgfxModel,
  items: readonly LanaiItem[],
  headRoot: number,
): Promise<CgfxTexture[]> {
  const textures: CgfxTexture[] = [];
  const byName = new Map<string, number>();
  target.bones.forEach((b, i) => {
    if (!b.name.includes('/') && !byName.has(b.name)) byName.set(b.name, i);
  });
  const worn = items.filter((it) => it.kind !== LANAI_GLASSES && !textureOnlyKind(it.kind) && it.archive && it.model);
  const files = await Promise.all(worn.map((it) => lanaiItemBody(session, it).then((b) => (b ? parseBch(b) : null))));
  worn.forEach((it, i) => {
    const f = files[i];
    if (!f) return;
    const part = f.models[0];
    if (!part || !part.meshes.length) return;
    textures.push(...f.textures);
    const follow = FOLLOW[it.kind];
    if (follow) {
      attachByName(target, part, byName, follow.names, byName.get(follow.base) ?? 0);
      return;
    }
    const head = it.kind === 0x81;
    const from = target.meshes.length;
    attach(target, part, head ? headRoot : (byName.get(rigidBone(it.kind)) ?? 0));
    // masks and hats lie on the face, whose decals draw 1〜30 without depth writes: drawn after them (the order is
    // not in the code; an assumption)
    if (head) for (const m of target.meshes.slice(from)) m.drawOrder = Math.max(m.drawOrder, 40);
  });
  return textures;
}
