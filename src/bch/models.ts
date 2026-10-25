// BCH models as the model sets the three.js side draws (cgfx/tileset.ts TilesetModels), and model references for
// the viewer and the photos (pages/modelview.ts).
import { unpackEntry, type ArcEntry, type Archive } from '../archive/gsarc';
import type { TilesetModels } from '../cgfx/tileset';
import type { ModelRef } from '../pages/modelview';
import { hex8 } from '../util/bytes';
import { bchAnimations, parseBch, unwrapBch } from './bch';

/**
 * The models of a BCH (by index) with its textures, plus the textures of `extra` BCHs that are not already there and
 * the animations of `motions` BCHs (added to every model; a name already there is kept).
 */
export function bchModelSet(body: Uint8Array, extra: Uint8Array[] = [], motions: Uint8Array[] = []): TilesetModels {
  const f = parseBch(unwrapBch(body));
  const set: TilesetModels = { models: new Map(), paths: new Map(), textures: new Map(), errors: [] };
  f.models.forEach((m, i) => {
    set.models.set(i, m);
    set.paths.set(i, m.name);
  });
  for (const t of f.textures) set.textures.set(t.name, t);
  for (const b of extra) {
    try {
      for (const t of parseBch(unwrapBch(b)).textures) if (!set.textures.has(t.name)) set.textures.set(t.name, t);
    } catch (err) {
      set.errors.push((err as Error).message);
    }
  }
  for (const b of motions) {
    try {
      const anims = bchAnimations(unwrapBch(b));
      for (const m of set.models.values()) {
        const have = new Set(m.animations.map((a) => a.name));
        m.animations = [...m.animations, ...anims.filter((a) => !have.has(a.name))];
      }
    } catch (err) {
      set.errors.push((err as Error).message);
    }
  }
  return set;
}

/** An entry of a root archive found by its hash. */
export interface BchIndexEntry {
  hash: number;
  archive: string;
  entry: ArcEntry;
}

/**
 * The entries of root archives by hash: each archive is read and parsed once, and nothing is unpacked until asked (the
 * first archive with a hash wins). RPG3's and FREE!'s monster models are read through one, so a book of a few hundred
 * photos does not read its model archive once per photo.
 */
export class BchEntryIndex<E extends BchIndexEntry = BchIndexEntry> {
  protected constructor(
    readonly archives: Map<string, Archive>,
    readonly entries: Map<number, E>,
  ) {}

  /** The archives and their entries (`describe` makes an entry of the index, e.g. with its file name). */
  protected static async read<E extends BchIndexEntry>(names: readonly string[], archive: (name: string) => Promise<Archive>, describe: (e: BchIndexEntry, arc: Archive) => E): Promise<[Map<string, Archive>, Map<number, E>]> {
    const archives = new Map<string, Archive>();
    const entries = new Map<number, E>();
    for (const name of names) {
      const arc = await archive(name);
      archives.set(name, arc);
      for (const entry of arc.entries) if (!entries.has(entry.hash)) entries.set(entry.hash, describe({ hash: entry.hash, archive: name, entry }, arc));
    }
    return [archives, entries];
  }

  static async of(names: readonly string[], archive: (name: string) => Promise<Archive>): Promise<BchEntryIndex> {
    const [archives, entries] = await BchEntryIndex.read(names, archive, (e) => e);
    return new BchEntryIndex(archives, entries);
  }

  get(hash: number): E | undefined {
    return hash ? this.entries.get(hash) : undefined;
  }

  /** The unpacked bytes of an entry, or null when no archive has it. */
  body(hash: number): Uint8Array | null {
    const e = this.get(hash);
    return e ? unpackEntry(this.archives.get(e.archive)!, e.entry).body : null;
  }
}

/** The BCH entries of a monster's look (a design row): the model, its colour's textures and its motions (0 for none). */
export interface BchLook {
  model: number;
  texture: number;
  motion: number;
}

/**
 * The model set of a look (RPG3 and FREE!): the model BCH with the textures of its colour's BCH put in (by name, over
 * any the model has: the colour variants are made that way) and, with `motions`, the animations of the motion BCH.
 * Throws when the model entry is missing or unreadable.
 */
export function bchLookSet(index: BchEntryIndex<BchIndexEntry>, look: BchLook, motions: boolean): TilesetModels {
  const model = index.body(look.model);
  if (!model) throw new Error(`モデルのエントリ ${hex8(look.model)} がありません`);
  const motion = motions ? index.body(look.motion) : null;
  const set = bchModelSet(model, [], motion ? [motion] : []);
  const tex = index.body(look.texture);
  if (tex) {
    try {
      for (const t of parseBch(unwrapBch(tex)).textures) set.textures.set(t.name, t);
    } catch (err) {
      set.errors.push((err as Error).message);
    }
  }
  return set;
}

const ids = new WeakMap<Uint8Array, number>();
let nextId = 1;

/** Model `index` of BCH bytes held in memory (the RomFS viewer). */
export function bchBytesRef(body: Uint8Array, index = 0): ModelRef {
  let id = ids.get(body);
  if (id === undefined) ids.set(body, (id = nextId++));
  return { key: `bch-bytes/${id}/${index}`, load: async () => ({ set: bchModelSet(body), hash: index }) };
}
