// Item models across the games (#100): the items of the opened dumps that have a 3D model, and giving an item of the
// shown game the model of another game's item. The converted file goes into the archive the item's own model is in
// (each kind of item is read from a fixed archive), and the item's model field points at it.
import { forgetArchives } from '../cgfx/loader';
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { itemModelArchive } from '../game/items';
import { itemRef } from '../pages/items';
import type { ModelRef } from '../pages/modelview';
import type { TitleKey } from '../rom/titles';
import type { Opened } from '../ui/workspace';
import { bchOffset } from '../bch/bch';
import { convertItem } from './convert';
import { readH3D, writeH3D } from './h3d';
import { entryHash, PortStore } from './store';
import { hex8 } from '../util/bytes';
import { lanaiItemBody, lanaiItemRef, lanaiItems, lanaiSetItemModel, textureOnlyKind } from '../lanai/items';

/** RPG FREE!: the archive ported item models go into (in the Update's patchList), and an entry of it to pack like. */
const LANAI_ITEM_ARCHIVE = '719F0000';
const LANAI_ITEM_LIKE = 0;

export interface ItemLook {
  title: TitleKey;
  id: number;
  name: string;
  model: ModelRef | null;
  /** The model's entry hash in its game. */
  hash: number;
  /** The model's entry body, and (RPG3) the bodies holding textures it names but does not have. */
  files(): Promise<{ body: Uint8Array; extra: Uint8Array[] }>;
}

/** The items of an opened game with a 3D model. */
export async function itemLooks(o: Opened, title: TitleKey): Promise<ItemLook[]> {
  if (title === 'kahara') {
    const s = o.kahara?.session;
    if (!s) return [];
    const game = s.game;
    const { items } = await s.items();
    return items.items.filter((it) => it.model && it.name).map((it) => ({
      title, id: it.id, name: it.name, model: itemRef(game, it), hash: it.model,
      files: async () => {
        const name = await itemModelArchive(game, it.model);
        const arc = name ? await game.archive(name) : null;
        const e = arc && findEntry(arc, it.model);
        if (!arc || !e) throw new Error('モデルのエントリがありません');
        return { body: unpackEntry(arc, e).body, extra: [] };
      },
    }));
  }
  if (title === 'oahu') {
    const s = o.oahu;
    if (!s) return [];
    const out: ItemLook[] = [];
    for (const it of s.items.items) {
      if (!it.model || !it.name) continue;
      const m = await s.itemModels.model(it.model);
      if (m?.kind !== 'model') continue; // floors, walls and clothes patterns are a texture only
      out.push({
        title, id: it.id, name: it.name, model: m.ref, hash: it.model,
        files: async () => {
          const f = await s.itemModels.sourceFiles(it.model);
          if (!f) throw new Error('モデルのエントリがありません');
          return { body: f.body, extra: f.extra };
        },
      });
    }
    return out;
  }
  const s = o.lanai;
  if (!s) return [];
  return lanaiItems(s).filter((it) => it.model && it.name && !textureOnlyKind(it.kind)).map((it) => ({
    title, id: it.row, name: it.name, model: lanaiItemRef(s, it), hash: it.model,
    files: async () => {
      const body = await lanaiItemBody(s, it);
      if (!body) throw new Error('モデルのエントリがありません');
      return { body, extra: [] };
    },
  }));
}

/** A BCH with the textures of `extra` it does not have put in (RPG3's items share some textures in other entries). */
function withTextures(body: Uint8Array, extra: Uint8Array[]): Uint8Array {
  if (!extra.length) return body;
  const h = readH3D(body.subarray(bchOffset(body)));
  const have = new Set(h.textures.map((t) => t.name));
  for (const b of extra) {
    for (const t of readH3D(b.subarray(bchOffset(b))).textures) {
      if (have.has(t.name)) continue;
      have.add(t.name);
      h.textures.push(t);
    }
  }
  return writeH3D(h, { freshLayout: true });
}

/** Gives item `id` of `target` the model of `look`. */
export async function giveItemModel(o: Opened, target: TitleKey, id: number, look: ItemLook): Promise<number> {
  if (look.title === target && target === 'lanai') {
    // the game reads any archive ItemDataCore +0x18 names: point the item at the other item's entry
    const s = o.lanai!;
    const all = lanaiItems(s);
    const it = all.find((x) => x.row === id);
    const src = all.find((x) => x.row === look.id);
    if (!it || !src?.model) throw new Error('モデルのあるアイテムを選んでください');
    lanaiSetItemModel(s, it, hex8(src.archive), src.model);
    return src.model;
  }
  const src = await look.files();
  // the same game's model goes in as it is (into the archive the item is read from), another game's is converted
  const whole = look.title === 'kahara' ? src.body : withTextures(src.body, src.extra);
  const body = look.title === target ? whole : convertItem(whole, look.title, target, { name: `item_${look.title[0]}${look.id}` });
  const store = await PortStore.of(target);
  const add = async (archive: string, current: number, read: (n: string) => Promise<Uint8Array>): Promise<number> => {
    const arc = parseArchive(await read(archive));
    // an entry with the same bytes (the same game's model in the same archive) is named as it is
    const same = arc.entries.find((e) => e.hash === look.hash);
    if (same && look.title === target) return same.hash;
    const hash = entryHash(body, (h) => !!findEntry(arc, h) || store.has(archive, h));
    store.add([{ archive, hash, name: `item_${look.title[0]}${look.id}.${target === 'kahara' ? 'bcres' : 'bch'}`, body, like: current }]);
    return hash;
  };
  if (target === 'kahara') {
    const s = o.kahara?.session;
    if (!s) throw new Error('電波人間のRPG2 を開いていません');
    const { items } = await s.items();
    const it = items.item(id);
    const archive = it?.model ? await itemModelArchive(s.game, it.model) : null;
    if (!it || !archive) throw new Error('このアイテムにはモデルがないので、どのアーカイブから読まれるか分かりません');
    const hash = await add(archive, it.model, (n) => s.game.dump.readRomfs(n));
    s.game.forgetArchive(archive);
    forgetArchives(archive);
    items.setModel(id, hash);
    s.saveNow();
    return hash;
  }
  if (target === 'oahu') {
    const s = o.oahu;
    if (!s) throw new Error('電波人間のRPG3 を開いていません');
    const it = s.items.item(id);
    const archive = it?.model ? await s.itemModels.archiveOf(it.model) : null;
    if (!it || !archive) throw new Error('このアイテムにはモデルがないので、どのアーカイブから読まれるか分かりません');
    const hash = await add(archive, it.model, (n) => s.dump.readRomfs(n));
    s.itemModels.forget();
    s.items.setModel(id, hash);
    s.saveNow();
    return hash;
  }
  const s = o.lanai;
  if (!s) throw new Error('電波人間のRPG FREE! を開いていません');
  const it = lanaiItems(s).find((x) => x.row === id);
  if (!it?.model || textureOnlyKind(it.kind)) throw new Error('このアイテムはモデルを差し替えられません');
  // the game reads any archive ItemDataCore +0x18 names: the ported ones go into the Update's monster archive
  const hash = await add(LANAI_ITEM_ARCHIVE, LANAI_ITEM_LIKE, (n) => s.dump.readRomfs(n));
  s.forgetArchive(LANAI_ITEM_ARCHIVE);
  lanaiSetItemModel(s, it, LANAI_ITEM_ARCHIVE, hash);
  return hash;
}
