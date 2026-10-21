// Where RPG3's items are got, for the item book: the shops that sell them (ShopItem), the monsters that drop them
// (monsterParameter) and the chests that hold them (the chests' EventObject rows and treasureGroup).
import { oneIn, pct } from '../pages/monsteredit';
import type { ChestLink, SourceLink } from '../ui/ItemSources';
import { u32 } from '../util/bytes';
import { EO, type OahuEventEntry } from './events';
import { oahuDungeonLabel, oahuMapHref } from './MapPage';
import { oahuMonsterHref } from './pickers';
import type { OahuSession } from './session';
import { OAHU_PRICE_UNIT, oahuShopLabel } from './shops';
import { oahuShopHref } from './ShopPage';
import { OAHU_CHEST_KINDS, oahuTreasureSlots, oahuTreasureTable } from './treasure';

/** The shops that sell an item; a shop of ジュエル or points notes its price. */
export function oahuItemShops(session: OahuSession, item: number): SourceLink[] {
  const { shops } = session;
  if (!shops) return [];
  return shops.sellers(item).map((id) => {
    const shop = shops.shop(id);
    const unit = OAHU_PRICE_UNIT[shop?.settings?.payment ?? 0];
    const row = shops.rows(id).find((r) => r.item === item);
    return { label: shop ? oahuShopLabel(shop) : `店 ${id}`, href: oahuShopHref(id), note: unit && row ? `${row.price} ${unit}` : undefined };
  });
}

/** Item -> the monsters that drop it, with the class and the odds of the drop. */
export function oahuDropIndex(session: OahuSession): Map<number, SourceLink[]> {
  const { battle } = session;
  const out = new Map<number, SourceLink[]>();
  let monsters;
  try {
    monsters = battle.monsterList();
  } catch {
    return out; // a dump without monsterParameter
  }
  for (const m of monsters)
    for (const d of battle.drops(m.id)) {
      if (!d.item) continue;
      const odds = battle.dropOdds(d.rate);
      const link = { label: m.name, href: oahuMonsterHref(m.id), note: `${battle.dropClass(d.rate).label}・${pct(odds)} = ${oneIn(odds)}`, title: `ドロップ ${d.slot}、率の値 ${d.rate}` };
      out.set(d.item, [...(out.get(d.item) ?? []), link]);
    }
  return out;
}

/** Item -> the chests that can hold it: every placement of a chest's EventObject row (the row itself when unplaced). */
export function oahuChestIndex(session: OahuSession, entries: OahuEventEntry[]): Map<number, ChestLink[]> {
  const out = new Map<number, ChestLink[]>();
  if (!entries.some((e) => OAHU_CHEST_KINDS[e.kind])) return out;
  const t = oahuTreasureTable(session.master);
  for (const e of entries) {
    if (!OAHU_CHEST_KINDS[e.kind]) continue;
    const row = u32(e.raw, EO.args);
    const slots = oahuTreasureSlots(t, row).filter((s) => s.kind === 1);
    const total = oahuTreasureSlots(t, row).reduce((a, s) => a + s.weight, 0);
    const chance = new Map<number, number>();
    for (const s of slots) chance.set(s.value, (chance.get(s.value) ?? 0) + s.weight);
    const places = e.places.length
      ? e.places.map((p) => ({ place: `${oahuDungeonLabel(session, p.map.dungeon)} ${p.map.name}`, href: oahuMapHref(p.map), at: `(${Math.floor(p.x)}, ${Math.floor(p.y)})` }))
      : [{ place: `${oahuDungeonLabel(session, e.dungeon)} のイベント #${e.row} (マップに置かれていない)`, href: `#/events/${e.dungeon}.${e.row}`, at: undefined }];
    for (const [item, w] of chance)
      for (const p of places) out.set(item, [...(out.get(item) ?? []), { ...p, table: `#${row}`, chance: total ? (w / total) * 100 : 0 }]);
  }
  return out;
}
