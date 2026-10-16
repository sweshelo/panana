// RPG FREE!'s items (naauao lanai/items.md): an item ID is a row ID of ItemData (name), whose +0x0C is the row of
// ItemDataCore (prices, kind, rarity, the description, and the model: +0x18 a root archive, +0x1C its entry). The
// models are bare BCH (version 0x21); clothes, floors and walls are a texture only.
import { findEntry, unpackEntry } from '../archive/gsarc';
import { parseBch } from '../bch/bch';
import { bchModelSet } from '../bch/models';
import type { CgfxTexture } from '../cgfx/cgfx';
import type { ModelRef } from '../pages/modelview';
import { hex8 } from '../util/bytes';
import type { LanaiSession } from './session';

export interface LanaiItem {
  /** Row of ItemData. */
  row: number;
  /** The item ID (ItemData's row ID). */
  id: number;
  name: string;
  /** Row of ItemDataCore. */
  core: number;
  kind: number;
  rarity: number;
  buy: number;
  sell: number;
  /** Root archive of the model (its name as a number; 0 = none) and the entry. */
  archive: number;
  model: number;
}

/** ItemDataCore +0x32 (naauao lanai/items.md §6). */
export const LANAI_ITEM_KINDS: Record<number, string> = {
  0x01: 'まとめ売り', 0x02: 'ふくぶくろ', 0x11: '回復', 0x12: 'えんまく', 0x13: 'テレポーター', 0x14: 'ヒロビーロ', 0x15: 'ランプ', 0x16: 'かぎ', 0x17: 'ペイント',
  0x21: 'ジュエル', 0x22: '宝石のかけら', 0x23: 'つりばチェッカー', 0x24: 'けんり・おたから', 0x25: 'おたから', 0x26: '〜のモト', 0x27: 'あかし', 0x28: 'ふくびきけん',
  0x31: 'みずいらず', 0x32: 'しんめ', 0x33: '色のくすり', 0x34: '花のたね', 0x35: '木のたね', 0x36: '花', 0x37: 'フルーツ', 0x38: 'おかし', 0x39: '実', 0x3a: 'タケノコなど',
  0x41: 'つりざお', 0x42: 'エサ', 0x43: '魚',
  0x51: '庭: いえ', 0x52: '庭: き', 0x53: '庭: おきもの', 0x54: '庭: ランプ', 0x55: '庭: テーブル', 0x56: '庭: いす', 0x57: '庭: もん', 0x58: '庭: かべ', 0x59: '庭: タイル',
  0x61: '家具: しょくぶつ・おきもの', 0x62: '家具: テーブル', 0x63: '家具: いす', 0x64: '家具: ランプ', 0x65: '家具: ベッド', 0x66: '家具: トレーニング', 0x67: '家の床', 0x68: '家の壁',
  0x81: '頭', 0x82: 'めがね', 0x91: '首', 0xa1: 'グラブ', 0xa2: 'うでわ', 0xb1: '足',
  0xc1: 'マント', 0xc2: 'はね', 0xc3: 'ぶき・まきもの', 0xc4: 'だいこ', 0xc5: 'うきわ・スカート', 0xc6: 'しっぽ', 0xd1: 'ふく (よろい)', 0xd2: 'ふく (もよう)',
};

/** Kinds whose BCH is a texture only (clothes, the house's floors and walls). */
export const textureOnlyKind = (kind: number): boolean => (kind & 0xf0) === 0xd0 || kind === 0x67 || kind === 0x68;

const lists = new WeakMap<LanaiSession, { revision: number; items: LanaiItem[] }>();

/** The valid items (ItemData rows with an ItemDataCore row), read again after an edit. */
export function lanaiItems(session: LanaiSession): LanaiItem[] {
  const have = lists.get(session);
  if (have && have.revision === session.revision) return have.items;
  const data = session.need('ItemData');
  const core = session.need('ItemDataCore');
  const items: LanaiItem[] = [];
  for (let row = 0; row < data.rows; row++) {
    const c = data.u16(row, 0x0c);
    if (!c || c >= core.rows) continue;
    items.push({
      row, id: data.rowId(row), name: session.plain(data, row, 'name'), core: c,
      kind: core.u8(c, 0x32), rarity: core.u8(c, 0x33) & 15, buy: core.u32(c, 0x04), sell: core.u32(c, 0x08),
      archive: core.u32(c, 0x18), model: core.u32(c, 0x1c),
    });
  }
  lists.set(session, { revision: session.revision, items });
  return items;
}

/** The description (ItemDataCore +0x28: a MessageItemFlavor row ID; +0x38: which of the three tables). */
export function lanaiItemDescription(session: LanaiSession, it: LanaiItem): string {
  const core = session.need('ItemDataCore');
  const id = core.u32(it.core, 0x28);
  if (!id) return '';
  const flavors = session.tables.filter((t) => t.table.name === 'MessageItemFlavor').map((t) => t.table);
  const which = core.u8(it.core, 0x38);
  for (const t of [flavors[which === 1 || which === 2 ? which : 0], ...flavors]) {
    const r = t?.find(id) ?? -1;
    if (t && r >= 0) return session.plain(t, r, 'message');
  }
  return '';
}

/** The entry body of an item's model, or null. */
export async function lanaiItemBody(session: LanaiSession, it: Pick<LanaiItem, 'archive' | 'model'>): Promise<Uint8Array | null> {
  if (!it.archive || !it.model) return null;
  const arc = await session.archive(hex8(it.archive)).catch(() => null);
  const e = arc && findEntry(arc, it.model);
  return arc && e ? unpackEntry(arc, e).body : null;
}

export type LanaiItemModel = { kind: 'model'; ref: ModelRef } | { kind: 'texture'; texture: CgfxTexture } | null;

/** An item's model for the viewer, or its texture (clothes, floors, walls). */
export async function lanaiItemModel(session: LanaiSession, it: Pick<LanaiItem, 'archive' | 'model'>): Promise<LanaiItemModel> {
  const body = await lanaiItemBody(session, it);
  if (!body) return null;
  const f = parseBch(body);
  if (!f.models.length) return f.textures[0] ? { kind: 'texture', texture: f.textures[0] } : null;
  return { kind: 'model', ref: { key: `lanai-item/${hex8(it.archive)}/${hex8(it.model)}`, load: async () => ({ set: bchModelSet(body), hash: 0 }) } };
}

/** Gives an item another model (an entry of the root archive `archive`). */
export function lanaiSetItemModel(session: LanaiSession, it: LanaiItem, archive: string, hash: number): void {
  const core = session.need('ItemDataCore');
  core.setU32(it.core, 0x18, parseInt(archive, 16) >>> 0);
  core.setU32(it.core, 0x1c, hash);
  session.edited();
}

/** An item's model (or its texture, which the photo shows as a picture) for ui/Photo and ui/ModelView; null without one. */
export function lanaiItemRef(session: LanaiSession, it: Pick<LanaiItem, 'archive' | 'model'>): ModelRef | null {
  if (!it.archive || !it.model) return null;
  return {
    key: `lanai-item/${hex8(it.archive)}/${hex8(it.model)}`,
    load: async () => {
      const body = await lanaiItemBody(session, it);
      return body ? { set: bchModelSet(body), hash: 0 } : null;
    },
  };
}
