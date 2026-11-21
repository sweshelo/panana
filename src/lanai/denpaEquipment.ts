// The equipment a Denpa person of the map wears (DenpaCustom +0x18〜+0x2C: ItemData IDs; read from the data of the 209
// rows, 2026-11-21: +0x18 head / glasses, +0x1C neck, +0x20 gloves / bracelets, +0x24 feet, +0x28 the back (weapons,
// capes, wings, skirts, tails), +0x2C clothes; +0x10 is an item carried, not worn).
// How a part is put on is read from the models, not from the code (to be checked in the game):
// - Models skinned to bones named as the body's (spine, L_hand, R_heel, L_wing, manteau1 …) are in the body's space and
//   follow those bones (gloves, shoes, collars, capes, wings).
// - The others are made at the origin of the bone their kind is put on: the head's (head and glasses, equ_face_*), the
//   back (shoulder_back: weapons, drums, the back's other things), the hip (skirts, swim rings), the tail.
// - Clothes (kinds 0xD1 / 0xD2) are a texture hum_base that takes the place of the body's pattern.
import * as THREE from 'three';
import { parseBch } from '../bch/bch';
import type { CgfxModel, CgfxTexture } from '../cgfx/cgfx';
import { attach, boneWorld } from '../oahu/denpaModels';
import { u32 } from '../util/bytes';
import { lanaiItemBody, lanaiItems, textureOnlyKind, type LanaiItem } from './items';
import type { LanaiSession } from './session';

/** DenpaCustom fields of the worn equipment (head, neck, hands, feet, back, clothes). */
export const LANAI_DENPA_EQUIP_FIELDS = [0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c] as const;

/** The items a DenpaCustom row wears (empty fields and IDs that are no item are left out). */
export function lanaiDenpaEquipment(session: LanaiSession, row: Uint8Array): LanaiItem[] {
  const data = session.need('ItemData');
  // lanaiItems leaves out the rows without ItemDataCore, so its index is not the row
  const byRow = new Map(lanaiItems(session).map((it) => [it.row, it]));
  const out: LanaiItem[] = [];
  for (const o of LANAI_DENPA_EQUIP_FIELDS) {
    const r = data.find(u32(row, o));
    const it = r > 0 ? byRow.get(r) : undefined;
    if (it && it.archive && it.model) out.push(it);
  }
  return out;
}

/** The body bone a part made at its origin is put on, by the item's kind (ItemDataCore +0x32). */
function originBone(kind: number): string {
  if (kind === 0x91) return 'spine';
  if (kind === 0xa1 || kind === 0xa2) return 'R_hand';
  if (kind === 0xb1 || kind === 0xc5) return 'hip';
  if (kind === 0xc6) return 'tail';
  return 'shoulder_back';
}

/** Whether a part is skinned to the body's bones by name: two of them, or one that its vertices lie at. */
function followsBody(part: CgfxModel, rest: Map<string, THREE.Vector3>): boolean {
  const named = part.bones.filter((b) => rest.has(b.name));
  if (named.length >= 2) return true;
  if (named.length !== 1) return false;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const m of part.meshes)
    for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(p.fromArray(m.positions, i));
  return !box.isEmpty() && box.getCenter(p).distanceTo(rest.get(named[0]!.name)!) < 15;
}

/** Add a part made in the body's space whose bones follow the body's bones of the same names. */
function attachByName(target: CgfxModel, part: CgfxModel, byName: Map<string, number>, fallback: number): void {
  const matrix = boneWorld(target.bones)[0] ?? new THREE.Matrix4();
  // a bone the body does not have follows its nearest named ancestor
  const map = part.bones.map((b) => byName.get(b.name) ?? -1);
  for (let i = 0; i < map.length; i++)
    if (map[i]! < 0) {
      let p = part.bones[i]!.parent;
      while (p >= 0 && map[p]! < 0) p = part.bones[p]!.parent;
      map[i] = p >= 0 ? map[p]! : fallback;
    }
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
      skinIndices: m.skinIndices?.map((i) => map[i] ?? fallback) ?? null,
    });
  }
}

/**
 * Put `items` on a Denpa person assembled from hum_body_01 (its bones keep their names in `target`); `headRoot` is the
 * bone of the head model's root. Returns the textures the parts use and the clothes' texture (null: none worn).
 */
export async function attachDenpaEquipment(
  session: LanaiSession,
  target: CgfxModel,
  items: readonly LanaiItem[],
  headRoot: number,
): Promise<{ textures: CgfxTexture[]; clothes: CgfxTexture | null }> {
  const textures: CgfxTexture[] = [];
  let clothes: CgfxTexture | null = null;
  const byName = new Map<string, number>();
  target.bones.forEach((b, i) => {
    if (!b.name.includes('/') && !byName.has(b.name)) byName.set(b.name, i);
  });
  // the body's bones at rest, in the body's own space (the parts are made in it)
  const world = boneWorld(target.bones);
  const rootInverse = (world[0] ?? new THREE.Matrix4()).clone().invert();
  const rest = new Map(
    [...byName].map(([name, i]) => [
      name,
      new THREE.Vector3().setFromMatrixPosition(rootInverse.clone().multiply(world[i]!)),
    ]),
  );
  const files = await Promise.all(items.map((it) => lanaiItemBody(session, it).then((b) => (b ? parseBch(b) : null))));
  items.forEach((it, i) => {
    const f = files[i];
    if (!f) return;
    if (textureOnlyKind(it.kind)) {
      clothes = f.textures[0] ?? clothes;
      return;
    }
    const part = f.models[0];
    if (!part || !part.meshes.length) return;
    textures.push(...f.textures);
    if (followsBody(part, rest)) attachByName(target, part, byName, byName.get('spine') ?? 0);
    else {
      const head = it.kind === 0x81 || it.kind === 0x82;
      const parent = head ? headRoot : (byName.get(originBone(it.kind)) ?? 0);
      const from = target.meshes.length;
      attach(target, part, parent);
      // glasses and masks lie on the face (its decals draw 1〜30 without depth writes): drawn after them
      if (head) for (const m of target.meshes.slice(from)) m.drawOrder = Math.max(m.drawOrder, 40);
    }
  });
  return { textures, clothes };
}
