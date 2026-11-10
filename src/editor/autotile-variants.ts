import { cellKey, partOf, roomGroups, type AutoCell, type AutoProfile } from './autotile';

/** A discrete normal distribution centred on the default (index zero), truncated to available variants.
 * sigma=1: weights 1, exp(-1/2), exp(-2), ...; the default always has the highest probability.
 */
export function normalVariant(letters: readonly number[], sample: number): number {
  const ordered = [...new Set([0, ...letters.filter(letter => letter > 0)])].sort((a,b) => a-b);
  const weights = ordered.map((_,index) => Math.exp(-index*index/2));
  let cursor = Math.max(0,Math.min(1-Number.EPSILON,sample)) * weights.reduce((sum,weight) => sum+weight,0);
  for (let index=0;index<ordered.length;index++) {
    cursor -= weights[index]!;
    if (cursor < 0) return ordered[index]!;
  }
  return 0;
}

/** One floor nearest the room's centroid; ties go to the topmost, then leftmost floor. Doorways
 * separate rooms, even when they touch directly. Rooms without central floor have no floor variation.
 */
export function roomCenters(cells: readonly AutoCell[], profile: AutoProfile): Set<string> {
  const groups = roomGroups(cells,profile);
  const rooms = new Map<number,AutoCell[]>();
  for (const cell of cells) {
    const group = groups.get(cellKey(cell.x,cell.y));
    if (group === undefined) continue;
    const list = rooms.get(group) ?? [];
    list.push(cell);
    rooms.set(group,list);
  }
  const centers = new Set<string>();
  for (const room of rooms.values()) {
    const x = room.reduce((sum,cell) => sum+cell.x,0)/room.length;
    const y = room.reduce((sum,cell) => sum+cell.y,0)/room.length;
    const floors = room.filter(cell => partOf(cell,profile)?.variation === 'floor');
    floors.sort((a,b) => ((a.x-x)**2+(a.y-y)**2)-((b.x-x)**2+(b.y-y)**2) || a.y-b.y || a.x-b.x);
    if (floors[0]) centers.add(cellKey(floors[0].x,floors[0].y));
  }
  return centers;
}

/** Return variant indices, leaving conversion to each game's letter-byte codec to the caller. */
export function roomVariantLetters(
  cells: readonly AutoCell[], profile: AutoProfile, letters: (kind: number) => readonly number[],
  enabled: boolean, sample: (cell: AutoCell) => number,
): Map<string,number> {
  const centers = roomCenters(cells,profile);
  return new Map(cells.map(cell => {
    const key = cellKey(cell.x,cell.y);
    const role = partOf(cell,profile)?.variation;
    const eligible = role === 'edge' || role === 'corner' || (role === 'floor' && centers.has(key));
    return [key, enabled && eligible ? normalVariant(letters(cell.kind),sample(cell)) : 0];
  }));
}
