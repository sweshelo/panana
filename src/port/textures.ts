// Replacing a texture of an RPG2 monster with an image: the file holding the texture (the colour file of the design
// row, +0x14, when it has a texture of that name, else the model, +0x10) is written again with the image encoded in
// the texture's own size, format and mipmap levels, added to the model archive as a new entry (store.ts), and the
// monster's design row points at it (a new row unless the monster alone shows one an edit added).
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { encodeTextureLevels } from '../cgfx/encode';
import { forgetArchives } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE } from '../game/monsters';
import type { Session } from '../session';
import { hex8, u32, w32 } from '../util/bytes';
import { readGfx, writeGfx } from './gfx';
import { takenIn } from './looks';
import { entryHash, PortStore } from './store';

export interface TextureImage {
  width: number;
  height: number;
  /** RGBA8, row 0 = top. */
  rgba: Uint8Array;
}

/** `body` (a CGFX file) with texture `name` replaced by `image`, or null when the file has no such texture. */
export function replaceGfxTexture(body: Uint8Array, name: string, image: TextureImage): Uint8Array | null {
  const gfx = readGfx(body);
  const t = gfx.textures.find((x) => x.name === name);
  if (!t) return null;
  if (t.kind !== 'image' || !t.image) throw new Error(`${name} はキューブマップなので差し替えられません`);
  if (image.width !== t.width || image.height !== t.height) throw new Error(`画像の大きさ ${image.width}×${image.height} がテクスチャ (${t.width}×${t.height}) と違います`);
  t.image.rawBuffer = encodeTextureLevels(image.rgba, t.width, t.height, t.hwFormat, t.mipmapSize, t.image.rawBuffer.length);
  return writeGfx(gfx);
}

/** Replaces texture `name` of monster `row` (RPG2) with `image`; returns the monster's design row. */
export async function replaceMonsterTexture(s: Session, row: number, name: string, image: TextureImage): Promise<number> {
  const book = s.book;
  const m = book?.monster(row);
  if (!book || !m) throw new Error('モンスターを読めていません');
  const design = book.designBytes(m.design);
  const model = u32(design, 0x10), colour = u32(design, 0x14);
  const read = (n: string): Promise<Uint8Array> => s.game.dump.readRomfs(n);
  const arc = parseArchive(await read(MONSTER_MODEL_ARCHIVE));
  const body = (hash: number): Uint8Array | null => {
    const e = hash ? findEntry(arc, hash) : undefined;
    return e ? unpackEntry(arc, e).body : null;
  };
  // the colour file's textures are drawn over the model's of the same name
  let at = colour && colour !== model ? 0x14 : 0x10;
  let file = at === 0x14 ? replaceGfxTexture(body(colour)!, name, image) : null;
  if (!file) {
    at = 0x10;
    const b = body(model);
    if (!b) throw new Error('モデルのエントリがありません');
    file = replaceGfxTexture(b, name, image);
  }
  if (!file) throw new Error(`テクスチャ ${name} が見つかりません`);
  const old = u32(design, at);
  const taken = await takenIn('kahara', read);
  const hash = entryHash(file, (h) => taken(MONSTER_MODEL_ARCHIVE, h));
  const store = await PortStore.of('kahara');
  store.add([{ archive: MONSTER_MODEL_ARCHIVE, hash, name: `${hex8(old)}_${name}.bcres`, body: file, like: old }]);
  forgetArchives(MONSTER_MODEL_ARCHIVE);
  const d = book.editOwnLook(row, (r) => {
    w32(r, at, hash);
    // a design without a colour file of its own names the model in both fields
    if (at === 0x10 && colour === model) w32(r, 0x14, hash);
  });
  // an entry an earlier replacement (or port) added and no design row names any more
  const used = (h: number): boolean => Array.from({ length: book.designRows }, (_, i) => book.designBytes(i)).some((r) => u32(r, 0x10) === h || u32(r, 0x14) === h);
  if (store.has(MONSTER_MODEL_ARCHIVE, old) && !used(old)) store.remove(MONSTER_MODEL_ARCHIVE, [old]);
  s.saveNow();
  return d;
}
