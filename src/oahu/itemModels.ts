// The models of RPG3's items (itemData +0x28 is the hash of an entry holding a BCH). They live in a few root
// archives: tools 838B0000, equipment 96EB0000, interior D4270000, roofs 982C0000, floors and walls 980C0000, and
// clothes patterns in the master 21350000. Textures a model names but does not hold come from another entry of the
// same archive or of the master (equipment's equ_all, the houses' body and shadow). Floors, walls and clothes
// patterns are a texture only.
import { findEntry, parseArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { bchOffset, bchSummary, parseBch, unwrapBch } from '../bch/bch';
import { bchModelSet } from '../bch/models';
import type { CgfxTexture } from '../cgfx/cgfx';
import { modelPhoto, type ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';
import { hex8 } from '../util/bytes';

const ARCHIVES = ['838B0000', '96EB0000', 'D4270000', '982C0000', '980C0000', '21350000'];
const COMMON = '21350000';

export type OahuItemModel =
  | { kind: 'model'; ref: ModelRef; archive: string }
  | { kind: 'texture'; texture: CgfxTexture; archive: string };

export class OahuItemModels {
  private archives = new Map<string, Promise<Archive | null>>();
  private textureIndex = new Map<string, Promise<Map<string, number>>>();
  private models = new Map<number, Promise<OahuItemModel | null>>();
  private photos = new Map<number, Promise<string | null>>();

  constructor(readonly dump: Dump) {}

  private archive(name: string): Promise<Archive | null> {
    let p = this.archives.get(name);
    if (!p) this.archives.set(name, (p = this.dump.readRomfs(name).then(parseArchive, () => null)));
    return p;
  }

  private async locate(hash: number): Promise<{ name: string; arc: Archive; body: Uint8Array } | null> {
    for (const name of ARCHIVES) {
      const arc = await this.archive(name);
      const e = arc && findEntry(arc, hash);
      if (arc && e) return { name, arc, body: unpackEntry(arc, e).body };
    }
    return null;
  }

  /** Texture name -> the first entry of the archive holding a texture of that name. */
  private textures(name: string): Promise<Map<string, number>> {
    let p = this.textureIndex.get(name);
    if (!p) {
      p = this.archive(name).then((arc) => {
        const index = new Map<string, number>();
        for (const e of arc?.entries ?? []) {
          const body = unpackEntry(arc!, e).body;
          const o = bchOffset(body);
          if (o < 0) continue;
          try {
            for (const t of bchSummary(body.subarray(o)).textures) if (!index.has(t)) index.set(t, e.hash);
          } catch {
            // not every entry that looks like a BCH reads; its textures are simply not offered
          }
        }
        return index;
      });
      this.textureIndex.set(name, p);
    }
    return p;
  }

  /** The bodies of the entries (same archive first, then the master) holding the textures in `names`. */
  private async extraTextures(archive: string, names: string[]): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    const seen = new Set<string>();
    for (const name of names) {
      for (const where of archive === COMMON ? [COMMON] : [archive, COMMON]) {
        const hash = (await this.textures(where)).get(name);
        if (hash === undefined) continue;
        const key = `${where}/${hash}`;
        if (!seen.has(key)) {
          seen.add(key);
          const arc = (await this.archive(where))!;
          out.push(unpackEntry(arc, findEntry(arc, hash)!).body);
        }
        break;
      }
    }
    return out;
  }

  /** The model (or the texture) of an item's model hash; null when no archive holds it. */
  model(hash: number): Promise<OahuItemModel | null> {
    let p = this.models.get(hash);
    if (!p) {
      p = (async (): Promise<OahuItemModel | null> => {
        if (!hash) return null;
        const at = await this.locate(hash);
        if (!at || bchOffset(at.body) < 0) return null;
        const f = parseBch(unwrapBch(at.body));
        if (!f.models.length) return f.textures[0] ? { kind: 'texture', texture: f.textures[0], archive: at.name } : null;
        const have = new Set(f.textures.map((t) => t.name));
        const missing = [...new Set(f.models.flatMap((m) => m.materials.flatMap((x) => x.textures)))].filter((t): t is string => !!t && !have.has(t));
        const extra = await this.extraTextures(at.name, missing);
        const ref: ModelRef = {
          key: `oahu-item/${this.dump.title.key}/${hex8(hash)}`,
          load: async () => ({ set: bchModelSet(at.body, extra), hash: 0 }),
        };
        return { kind: 'model', ref, archive: at.name };
      })();
      this.models.set(hash, p);
    }
    return p;
  }

  /** A photo (data or object URL) of an item's model, or its texture. */
  photo(hash: number): Promise<string | null> {
    let p = this.photos.get(hash);
    if (!p) {
      p = this.model(hash).then((m) => (!m ? null : m.kind === 'model' ? modelPhoto(m.ref) : textureUrl(m.texture)));
      this.photos.set(hash, p);
    }
    return p;
  }
}

/** A texture as a PNG data URL. */
export function textureUrl(t: CgfxTexture): string {
  const c = document.createElement('canvas');
  c.width = t.width;
  c.height = t.height;
  c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
  return c.toDataURL();
}
