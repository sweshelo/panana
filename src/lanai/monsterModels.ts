// The models of RPG FREE!'s monsters for the viewer: the model BCH of a MonsterDesign row with the textures of its
// colour's BCH and the animations of its battle motion BCH (bch/models.ts bchLookSet, shared with RPG3). The BCHs are
// H3D version 0x21 (RPG3's are 8).
import type { TilesetModels } from '../cgfx/tileset';
import { bchLookSet } from '../bch/models';
import type { ModelRef } from '../pages/modelview';
import { hex8 } from '../util/bytes';
import { lanaiModelIndex, type LanaiMonsterDesign } from './monsters';
import type { LanaiSession } from './session';

const sets = new Map<string, Promise<TilesetModels>>();

const keyOf = (d: LanaiMonsterDesign, motions: boolean): string => `lanai-monster/${hex8(d.model)}/${hex8(d.texture)}${motions ? `/${hex8(d.motion)}` : ''}`;

/** The model set of a design (built once; rejects when the model BCH cannot be read). */
export function lanaiMonsterSet(session: LanaiSession, d: LanaiMonsterDesign, motions = true): Promise<TilesetModels> {
  const key = keyOf(d, motions);
  let p = sets.get(key);
  if (!p) {
    p = lanaiModelIndex(session).then((index) => bchLookSet(index, d, motions));
    sets.set(key, p);
  }
  return p;
}

/** The model of a design for ui/ModelView (null when the design has no model entry). */
export function lanaiMonsterModel(session: LanaiSession, d: LanaiMonsterDesign, motions = true): ModelRef | null {
  if (!d.model) return null;
  return { key: keyOf(d, motions), load: async () => ({ set: await lanaiMonsterSet(session, d, motions), hash: 0 }) };
}
