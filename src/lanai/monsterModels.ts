// The models of RPG FREE!'s monsters for the viewer: the model BCH of a MonsterDesign row with the textures of its
// colour's BCH put in (by name, over any the model has: the colour variants are made that way) and the animations
// of its battle motion BCH. The BCHs are H3D version 0x21 (RPG3's are 8).
import type { CgfxTexture } from '../cgfx/cgfx';
import type { TilesetModels } from '../cgfx/tileset';
import { bchSummary, parseBch, unwrapBch } from '../bch/bch';
import { bchModelSet } from '../bch/models';
import type { ModelRef } from '../pages/modelview';
import { hex8 } from '../util/bytes';
import { lanaiModelIndex, type LanaiMonsterDesign } from './monsters';
import type { LanaiSession } from './session';

/** What the detail shows of a design's BCHs (read without building the 3D model). */
export interface LanaiDesignFiles {
  /** H3D version of the model BCH. */
  version: number | null;
  /** Names of the model's models, its own textures and animations. */
  models: string[];
  modelTextures: string[];
  modelAnimations: string[];
  /** The textures of the colour's BCH. */
  textures: CgfxTexture[];
  /** The animations of the battle motion BCH (skeletal, then material ones). */
  motions: string[];
  materialMotions: string[];
  errors: string[];
}

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

/** The names in a design's BCHs and the colour's textures. */
export async function lanaiDesignFiles(session: LanaiSession, d: LanaiMonsterDesign): Promise<LanaiDesignFiles> {
  const index = await lanaiModelIndex(session);
  const out: LanaiDesignFiles = { version: null, models: [], modelTextures: [], modelAnimations: [], textures: [], motions: [], materialMotions: [], errors: [] };
  const read = (what: string, hash: number, f: (b: Uint8Array) => void): void => {
    if (!hash) return;
    const b = index.body(hash);
    if (!b) {
      out.errors.push(`${what}のエントリ ${hex8(hash)} がありません`);
      return;
    }
    try {
      f(unwrapBch(b));
    } catch (err) {
      out.errors.push(`${what}: ${(err as Error).message}`);
    }
  };
  read('モデル', d.model, (b) => {
    const s = bchSummary(b);
    out.version = s.header.backward;
    out.models = s.models;
    out.modelTextures = s.textures;
    out.modelAnimations = [...s.skeletalAnimations, ...s.materialAnimations];
  });
  read('テクスチャ', d.texture, (b) => {
    out.textures = parseBch(b).textures;
  });
  read('モーション', d.motion, (b) => {
    const s = bchSummary(b);
    out.motions = s.skeletalAnimations;
    out.materialMotions = s.materialAnimations;
  });
  return out;
}
