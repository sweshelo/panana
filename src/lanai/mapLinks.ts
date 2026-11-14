// The connections between the records of one lanai map, drawn as a layer of their own in the 2D view (mapview.ts):
// - a button (section 5 kinds 4 / 5 / 6) and the door its script opens (mapedit.ts lanaiButtonDoor);
// - a warp hole or warp gate (section 3 kinds 2 / 4) and where it leads, when that is a point of the same map (the
//   first action of its EventObject row: +0x14 the map's hash, +0x18 the point ID = section 3 +0x00; map.md §5.1).
//   Two warps that lead to each other are one link without a direction; a warp whose destination does not lead back
//   (an arrival point, or a warp that leads elsewhere: "exit only") is a link with an arrow towards the destination.
import { recCellPos, type MapDoc } from '../game/sections';
import { u32 } from '../util/bytes';
import { LANAI_DESTINATION_ACTIONS } from './actions';
import { lanaiButtonDoor } from './mapedit';
import { LANAI_EVENT_ACTIONS, LANAI_LAYOUTS, lanaiExitKind, type LanaiMapInfo, type LanaiMaps } from './maps';

/** Exit kinds (+0x15) of the warp hole and the warp gate. */
export const LANAI_WARP_KINDS: readonly number[] = [2, 4];
/** The exit kind of the wall door, which has no point ID. */
const WALL_DOOR = 100;

export interface LanaiMapLink {
  type: 'button' | 'warp';
  /** Section and index of the record the link starts at and of the one it leads to. */
  from: [section: number, index: number];
  to: [section: number, index: number];
  /** Cell coordinates of the two ends. */
  a: [number, number];
  b: [number, number];
  /** The link leads from `from` to `to` only (drawn with an arrow); else both ways (a line). */
  oneWay: boolean;
}

/** Where a section 3 record leads (map hash, point ID), or null when its event's first action names no destination. */
function destination(maps: LanaiMaps, group: number, raw: Uint8Array): [map: number, point: number] | null {
  const events = maps.eventTable(group);
  const row = u32(raw, 4);
  if (!events || !row || row >= events.rows) return null;
  const o = LANAI_EVENT_ACTIONS[0]!;
  if (!LANAI_DESTINATION_ACTIONS.includes(events.u32(row, o))) return null;
  return [events.u32(row, o + 4), events.u32(row, o + 8)];
}

export function lanaiMapLinks(maps: LanaiMaps, info: LanaiMapInfo, doc: MapDoc): LanaiMapLink[] {
  const out: LanaiMapLink[] = [];
  const exits = doc.recs[3] ?? [];
  const at = (section: number, index: number): [number, number] =>
    recCellPos(doc.recs[section]![index]!, LANAI_LAYOUTS[section]!);

  const doorOf = new Map(exits.map((r, i) => [u32(r.raw, 4), i]));
  (doc.recs[5] ?? []).forEach((button, i) => {
    if (![4, 5, 6].includes(u32(button.raw, 0))) return;
    const target = lanaiButtonDoor(maps, info.dungeon, u32(button.raw, 4));
    const door = target === null ? undefined : doorOf.get(target);
    if (door === undefined) return;
    out.push({ type: 'button', from: [5, i], to: [3, door], a: at(5, i), b: at(3, door), oneWay: true });
  });

  // the point IDs of the map (the first record of an ID is the one the game arrives at)
  const byId = new Map<number, number>();
  exits.forEach((r, i) => {
    const id = u32(r.raw, 0);
    if (lanaiExitKind(r.raw) !== WALL_DOOR && id && !byId.has(id)) byId.set(id, i);
  });
  /** The record of this map exit `i` leads to, -1 when it leads nowhere here. */
  const leadsTo = (i: number): number => {
    const d = destination(maps, info.dungeon, exits[i]!.raw);
    return d && d[0] === info.hash ? (byId.get(d[1]) ?? -1) : -1;
  };
  const paired = new Set<string>();
  exits.forEach((r, i) => {
    if (!LANAI_WARP_KINDS.includes(lanaiExitKind(r.raw))) return;
    const j = leadsTo(i);
    if (j < 0 || j === i) return;
    const back = leadsTo(j) === i;
    if (back) {
      const key = `${Math.min(i, j)}/${Math.max(i, j)}`;
      if (paired.has(key)) return;
      paired.add(key);
    }
    out.push({ type: 'warp', from: [3, i], to: [3, j], a: at(3, i), b: at(3, j), oneWay: !back });
  });
  return out;
}
