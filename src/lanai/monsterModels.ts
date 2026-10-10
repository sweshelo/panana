// The models of RPG FREE!'s monsters for the viewer: the model BCH of a MonsterDesign row with the textures of its
// colour's BCH put in (by name, over any the model has: the colour variants are made that way) and the animations
// of its battle motion BCH. The BCHs are H3D version 0x21 (RPG3's are 8).
import type { TilesetModels } from '../cgfx/tileset';
import { parseBch, unwrapBch } from '../bch/bch';
import { bchModelSet } from '../bch/models';
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
    p = lanaiModelIndex(session).then((index) => {
      const model = index.body(d.model);
      if (!model) throw new Error(`モデルのエントリ ${hex8(d.model)} がありません`);
      const motion = motions ? index.body(d.motion) : null;
      const set = bchModelSet(model, [], motion ? [motion] : []);
      const tex = index.body(d.texture);
      if (tex) {
        try {
          for (const t of parseBch(unwrapBch(tex)).textures) set.textures.set(t.name, t);
        } catch (err) {
          set.errors.push((err as Error).message);
        }
      }
      return set;
    });
    sets.set(key, p);
  }
  return p;
}

/** The model of a design for ui/ModelView (null when the design has no model entry). */
export function lanaiMonsterModel(session: LanaiSession, d: LanaiMonsterDesign, motions = true): ModelRef | null {
  if (!d.model) return null;
  return { key: keyOf(d, motions), load: async () => ({ set: await lanaiMonsterSet(session, d, motions), hash: 0 }) };
}
