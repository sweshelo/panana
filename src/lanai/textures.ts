import { findEntry, unpackEntry } from '../archive/gsarc';
import { encodeTextureLevels } from '../cgfx/encode';
import { readH3D, writeH3D } from '../port/h3d';
import { entryHash, PortStore } from '../port/store';
import type { TextureImage } from '../port/textures';
import { hex8 } from '../util/bytes';
import { lanaiItems } from './items';
import { forgetLanaiModelIndex, forgetLanaiMonsters, lanaiModelIndex } from './monsters';
import type { LanaiSession } from './session';

export function replaceBchTexture(body: Uint8Array, name: string, image: TextureImage): Uint8Array | null {
  const h = readH3D(body);
  const t = h.textures.find((t) => t.name === name);
  if (!t) return null;
  if (t.rawBuffers.length !== 1) throw new Error('キューブマップは差し替えられません');
  if (t.width !== image.width || t.height !== image.height) throw new Error('画像の大きさが違います');
  t.rawBuffers[0] = encodeTextureLevels(image.rgba, t.width, t.height, t.format, t.mipmapSize, t.rawBuffers[0]!.length);
  return writeH3D(h);
}

async function replacement(
  s: LanaiSession,
  archive: string,
  old: number,
  name: string,
  image: TextureImage,
): Promise<number | null> {
  const arc = await s.archive(archive);
  const e = findEntry(arc, old);
  if (!e) return null;
  const file = replaceBchTexture(unpackEntry(arc, e).body, name, image);
  if (!file) return null;
  const hash = entryHash(file, (h) => !!findEntry(arc, h));
  const store = await PortStore.of('lanai');
  store.add([{ archive, hash, name: `${hex8(old)}_${name}.bch`, body: file, like: old }]);
  s.forgetArchive(archive);
  return hash;
}

export async function replaceLanaiMonsterTexture(
  s: LanaiSession,
  row: number,
  name: string,
  image: TextureImage,
): Promise<void> {
  const p = s.need('MonsterParameter');
  const d = s.need('MonsterDesign');
  const current = p.bits(row, 0, 20, 10);
  if (current >= d.rows || d.rows >= 1024) throw new Error('デザインの行を追加できません');
  const index = await lanaiModelIndex(s);
  for (const offset of [0x0c, 0x08]) {
    const old = d.u32(current, offset);
    const entry = index.get(old);
    if (!entry) continue;
    const hash = await replacement(s, entry.archive, old, name, image);
    if (hash === null) continue;
    const next = d.addRow(current);
    d.setU32(next, offset, hash);
    p.setBits(row, 0, 20, 10, next);
    forgetLanaiModelIndex(s);
    forgetLanaiMonsters(s);
    s.edited();
    return;
  }
  throw new Error(`テクスチャ ${name} がありません`);
}

export async function replaceLanaiItemTexture(
  s: LanaiSession,
  row: number,
  name: string,
  image: TextureImage,
): Promise<void> {
  const it = lanaiItems(s).find((it) => it.row === row);
  if (!it) throw new Error('アイテムがありません');
  const core = s.need('ItemDataCore');
  if (core.rows > 0xffff) throw new Error('アイテムのモデル参照を追加できません');
  const hash = await replacement(s, hex8(it.archive), it.model, name, image);
  if (hash === null) throw new Error(`テクスチャ ${name} がありません`);
  const next = core.addRow(it.core);
  core.setU32(next, 0x1c, hash);
  s.need('ItemData').setU16(row, 0x0c, next);
  s.edited();
}
