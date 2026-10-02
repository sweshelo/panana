// BCH models as the model sets the three.js side draws (cgfx/tileset.ts TilesetModels), and model references for
// the viewer and the photos (pages/modelview.ts).
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import type { TilesetModels } from '../cgfx/tileset';
import type { ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';
import { hex8 } from '../util/bytes';
import { parseBch, unwrapBch } from './bch';

/** The models of a BCH (by index) with its textures, plus the textures of `extra` BCHs that are not already there. */
export function bchModelSet(body: Uint8Array, extra: Uint8Array[] = []): TilesetModels {
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

/**
 * Model `index` of the BCH in entry `entry` of the root archive `archive` of an RPG3 dump (for the books' photos and
 * viewers). `textures` are entries of the same archive whose textures the model also uses.
 */
export function bchEntryRef(dump: Dump, archive: string, entry: number, index = 0, textures: number[] = []): ModelRef {
  return {
    key: `bch/${dump.title.key}/${archive}/${hex8(entry)}/${index}/${textures.map(hex8).join('+')}`,
    load: async () => {
      const arc = parseArchive(await dump.readRomfs(archive));
      const e = findEntry(arc, entry);
      if (!e) return null;
      const extra = textures.flatMap((t) => {
        const x = findEntry(arc, t);
        return x ? [unpackEntry(arc, x).body] : [];
      });
      return { set: bchModelSet(unpackEntry(arc, e).body, extra), hash: index };
    },
  };
}
