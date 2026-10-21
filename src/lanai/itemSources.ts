// Where RPG FREE!'s items are got, for the item book: the monsters that drop them (the ability rows' drop slots), the
// random slots of the shops that draw them, and, read from every content's archive when asked (127 contents: it takes
// a while), the shops that sell them (ShopItem) and the chests that hold them (TreasureGroup of the content's maps).
import { field, readField } from '../game/tabledef';
import type { ChestLink, SourceLink } from '../ui/ItemSources';
import { contentTitle, lanaiContents } from './contents';
import type { LanaiItem } from './items';
import { lanaiMapHref } from './MapPage';
import { lanaiMaps } from './maps';
import { DROP_DEN, dropClass } from './MonsterEditor';
import { lanaiMonsterHref, lanaiMonsters } from './monsters';
import { lanaiStatsOf } from './monsterStats';
import type { LanaiSession } from './session';
import { lanaiInSlotPool, lanaiShops } from './shops';
import { lanaiShopHref, lanaiShopSlotHref } from './ShopPage';
import { LANAI_STATS } from './tables';
import { LANAI_TREASURE_ITEM, lanaiChestUsers, lanaiTreasureSlots } from './treasure';

const RANKS = [1, 2, 3, 4].map((i) => field(LANAI_STATS[0]!, `rank${i}`));

/** Item ID -> the monsters that drop it, with the rank of the drop. */
export function lanaiDropIndex(session: LanaiSession): Map<number, SourceLink[]> {
  const out = new Map<number, SourceLink[]>();
  for (const m of lanaiMonsters(session)) {
    const ref = lanaiStatsOf(session, m.row);
    if (!ref || !m.name) continue;
    const r = session.need(ref.table).row(ref.row);
    for (let i = 0; i < 4; i++) {
      const item = readField(r, field(LANAI_STATS[0]!, `drop${i + 1}`));
      if (!item) continue;
      const rank = readField(r, RANKS[i]!);
      const link = { label: m.name, href: lanaiMonsterHref(m.row), note: `${dropClass(rank)}・${rank ? `約 1/${DROP_DEN[rank]}` : '100%'}`, title: `ドロップ ${i + 1}、ランク ${rank}` };
      out.set(item, [...(out.get(item) ?? []), link]);
    }
  }
  return out;
}

/** The random slot kind that can draw an item (the slots of 0x56 draw from 0x55), as a link to its page. */
export function lanaiSlotSource(session: LanaiSession, it: LanaiItem): SourceLink | null {
  if (!lanaiInSlotPool(session, it)) return null;
  return { label: 'ランダム枠の候補', href: lanaiShopSlotHref(it.kind === 0x56 ? 0x55 : it.kind), note: '店に毎日 1 つ選ばれる' };
}

export interface LanaiSourceIndex {
  shops: Map<number, SourceLink[]>;
  chests: Map<number, ChestLink[]>;
}

const scans = new WeakMap<LanaiSession, { revision: number; p: Promise<LanaiSourceIndex> }>();

/** Whether every content has been looked through once (the item book then keeps the index up to date by itself). */
export const lanaiSourcesScanned = (session: LanaiSession): boolean => scans.has(session);

/**
 * The shops and the chests of every content, by item ID. The contents' maps and shops are read once per session (the
 * pages share them), so after the first time this is quick; it is made again after each edit.
 */
export function lanaiSourceIndex(session: LanaiSession, progress?: (done: number, total: number) => void): Promise<LanaiSourceIndex> {
  const have = scans.get(session);
  if (have && have.revision === session.revision) return have.p;
  const p = (async (): Promise<LanaiSourceIndex> => {
    const shops = new Map<number, SourceLink[]>();
    const chests = new Map<number, ChestLink[]>();
    const contents = lanaiContents(session);
    let done = 0;
    for (const c of contents) {
      const title = `${c.index}: ${contentTitle(c)}`;
      const s = await lanaiShops(session, c).catch(() => null);
      for (const sh of s?.shops ?? []) {
        const seen = new Set<number>();
        for (const r of s!.rows(sh.row)) {
          if (!r.item || seen.has(r.item)) continue;
          seen.add(r.item);
          shops.set(r.item, [...(shops.get(r.item) ?? []), { label: `${title} の店 ${sh.row}`, href: lanaiShopHref(c.index, sh.row) }]);
        }
      }
      const maps = await lanaiMaps(session, c).catch(() => null);
      const t = maps?.treasureGroup;
      if (maps && t)
        for (const [row, users] of lanaiChestUsers(maps)) {
          const all = lanaiTreasureSlots(t, row);
          const total = all.reduce((a, x) => a + x.weight, 0);
          const weights = new Map<number, number>();
          for (const x of all) if (x.kind === LANAI_TREASURE_ITEM) weights.set(x.value, (weights.get(x.value) ?? 0) + x.weight);
          for (const [item, w] of weights)
            for (const u of users)
              chests.set(item, [...(chests.get(item) ?? []), {
                place: `${title} ${u.map}`, href: lanaiMapHref(c.index, u.map, u), at: `区画 ${u.section} #${u.index}`, table: `#${row}`, chance: total ? (w / total) * 100 : 0,
              }]);
        }
      progress?.(++done, contents.length);
    }
    return { shops, chests };
  })();
  scans.set(session, { revision: session.revision, p });
  p.catch(() => scans.get(session)?.p === p && scans.delete(session));
  return p;
}
