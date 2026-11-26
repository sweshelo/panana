/** Game-independent terrain topology. Directions are N,E,S,W; rotations are clockwise.
 *
 * Terrain is a graph: every side between two neighbouring tiles is closed, a narrow opening (a corridor or a doorway)
 * or a wide one (room floor continuing). Tiles joined by openings form an island. A brush gesture only opens the sides
 * it actually walks across, and room floor only appears where it fills 2×2 squares, so islands that merely touch stay
 * apart; painting a 2×2 band across the seam of two touching rooms merges them.
 */
export interface AutoPart {
  kind: number;
  wide: number;
  narrow: number;
  corners?: number;
  variation?: 'floor' | 'edge' | 'corner';
}
export interface AutoProfile {
  parts: readonly AutoPart[];
  isolated: number;
}
export interface AutoCell {
  x: number;
  y: number;
  kind: number;
  rot: number;
}
/** One brush gesture: the squares it covered and the sides between consecutive squares it walked across. */
export interface AutoStroke {
  cells: Set<string>;
  steps: Set<string>;
}
export type Link = 'narrow' | 'wide';
/** Open sides by `edgeKey`; a side that is absent is closed. */
export type EdgeGraph = Map<string, Link>;
export interface CellShape {
  wide: number;
  narrow: number;
  corners: number;
}

export const cellKey = (x: number, y: number): string => `${x},${y}`;
const parseKey = (key: string): [number, number] => key.split(',').map(Number) as [number, number];
export const DIRECTIONS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
export function turnMask(mask: number, rot: number): number {
  return ((mask << rot) | (mask >> (4 - rot))) & 15;
}
export function partOf(cell: AutoCell, profile: AutoProfile): AutoPart | undefined {
  return profile.parts.find((p) => p.kind === cell.kind);
}
/** The side `direction` of square (x, y), named the same from both squares that share it. */
export function edgeKey(x: number, y: number, direction: number): string {
  switch (direction) {
    case 0:
      return `${x},${y - 1}/S`;
    case 1:
      return `${x},${y}/E`;
    case 2:
      return `${x},${y}/S`;
    default:
      return `${x - 1},${y}/E`;
  }
}
function edgeCells(edge: string): [string, string] {
  const [cell, side] = edge.split('/') as [string, string];
  const [x, y] = parseKey(cell);
  return [cell, side === 'E' ? cellKey(x + 1, y) : cellKey(x, y + 1)];
}

export function emptyStroke(): AutoStroke {
  return { cells: new Set(), steps: new Set() };
}
/** Walk the brush from one square to another, four-connected (a diagonal jump goes across, then down). */
export function strokeTo(stroke: AutoStroke, from: readonly [number, number] | undefined, to: [number, number]): void {
  if (!from) {
    stroke.cells.add(cellKey(...to));
    return;
  }
  const [x0, y0] = from;
  const [tx, ty] = to;
  let x = x0,
    y = y0;
  const visit = (nx: number, ny: number): void => {
    if (nx === x && ny === y) return;
    const direction = nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0;
    stroke.steps.add(edgeKey(x, y, direction));
    stroke.cells.add(cellKey(nx, ny));
    x = nx;
    y = ny;
  };
  stroke.cells.add(cellKey(x0, y0));
  const steps = Math.max(Math.abs(tx - x0), Math.abs(ty - y0));
  for (let i = 1; i <= steps; i++) {
    const nx = Math.round(x0 + ((tx - x0) * i) / steps),
      ny = Math.round(y0 + ((ty - y0) * i) / steps);
    visit(nx, y);
    visit(nx, ny);
  }
}
/** A gesture along `path` (points are joined as the brush would walk between them). */
export function strokeAlong(path: readonly (readonly [number, number])[]): AutoStroke {
  const stroke = emptyStroke();
  path.forEach((point, i) => strokeTo(stroke, path[i - 1], [point[0], point[1]]));
  return stroke;
}

/** Tiles by square; the last record of a square wins, and only parts of the profile are terrain. */
function terrain(cells: readonly AutoCell[], profile: AutoProfile): Map<string, { cell: AutoCell; part: AutoPart }> {
  const grid = new Map<string, { cell: AutoCell; part: AutoPart }>();
  for (const cell of cells) {
    const key = cellKey(cell.x, cell.y);
    const part = partOf(cell, profile);
    if (part) grid.set(key, { cell, part });
    else grid.delete(key);
  }
  return grid;
}
/** Sides that both tiles open; wide when both open it as floor. */
export function edgeGraph(cells: readonly AutoCell[], profile: AutoProfile): EdgeGraph {
  const grid = terrain(cells, profile);
  const graph: EdgeGraph = new Map();
  for (const { cell, part } of grid.values())
    for (const direction of [1, 2]) {
      const [dx, dy] = DIRECTIONS[direction]!;
      const next = grid.get(cellKey(cell.x + dx, cell.y + dy));
      if (!next) continue;
      const bit = 1 << direction,
        opposite = 1 << ((direction + 2) % 4);
      const wide = turnMask(part.wide, cell.rot),
        open = wide | turnMask(part.narrow, cell.rot);
      const nextWide = turnMask(next.part.wide, next.cell.rot),
        nextOpen = nextWide | turnMask(next.part.narrow, next.cell.rot);
      if (!(open & bit) || !(nextOpen & opposite)) continue;
      graph.set(edgeKey(cell.x, cell.y, direction), wide & bit && nextWide & opposite ? 'wide' : 'narrow');
    }
  return graph;
}
/** A square's openings. An inward corner is a wall notch between two floor sides whose diagonal is not floor joined
 * to both: a room that merely touches the corner diagonally does not fill it. */
export function cellShape(graph: EdgeGraph, x: number, y: number): CellShape {
  let wide = 0,
    narrow = 0,
    corners = 0;
  for (let direction = 0; direction < 4; direction++) {
    const link = graph.get(edgeKey(x, y, direction));
    if (link === 'wide') wide |= 1 << direction;
    else if (link === 'narrow') narrow |= 1 << direction;
  }
  for (let corner = 0; corner < 4; corner++) {
    const a = corner,
      b = (corner + 1) % 4;
    if (!(wide & (1 << a)) || !(wide & (1 << b))) continue;
    const [ax, ay] = DIRECTIONS[a]!,
      [bx, by] = DIRECTIONS[b]!;
    const filled = graph.get(edgeKey(x + ax, y + ay, b)) === 'wide' && graph.get(edgeKey(x + bx, y + by, a)) === 'wide';
    if (!filled) corners |= 1 << corner;
  }
  return { wide, narrow, corners };
}
const sameShape = (a: CellShape, b: CellShape): boolean =>
  a.wide === b.wide && a.narrow === b.narrow && a.corners === b.corners;

function components(
  keys: Iterable<string>,
  graph: EdgeGraph,
  joins: (link: Link) => boolean,
  member: (key: string) => boolean,
): Map<string, number> {
  const groups = new Map<string, number>();
  let id = 0;
  for (const key of keys) {
    if (groups.has(key)) continue;
    groups.set(key, id);
    const queue = [key];
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = parseKey(queue[index]!);
      DIRECTIONS.forEach(([dx, dy], direction) => {
        const link = graph.get(edgeKey(x, y, direction));
        const next = cellKey(x + dx, y + dy);
        if (!link || !joins(link) || groups.has(next) || !member(next)) return;
        groups.set(next, id);
        queue.push(next);
      });
    }
    id++;
  }
  return groups;
}
/** Rooms: floor tiles joined through wide sides, never through a doorway or a corridor. */
export function roomGroups(cells: readonly AutoCell[], profile: AutoProfile): Map<string, number> {
  const grid = terrain(cells, profile);
  const rooms = [...grid].filter(([, { part }]) => part.wide).map(([key]) => key);
  const member = new Set(rooms);
  return components(
    rooms,
    edgeGraph(cells, profile),
    (link) => link === 'wide',
    (key) => member.has(key),
  );
}
/** Islands: tiles joined through any opening. Tiles that merely touch are separate islands. */
export function islands(cells: readonly AutoCell[], profile: AutoProfile): Map<string, number> {
  const grid = terrain(cells, profile);
  return components(
    grid.keys(),
    edgeGraph(cells, profile),
    () => true,
    (key) => grid.has(key),
  );
}

/** The part (and turn) that best fits a shape. */
export function partFor(shape: CellShape, profile: AutoProfile): { kind: number; rot: number } {
  if (!(shape.wide | shape.narrow)) return { kind: profile.isolated, rot: 0 };
  const bits = (v: number): number => v.toString(2).replace(/0/g, '').length;
  let best = { kind: profile.isolated, rot: 0 },
    score = Infinity;
  for (const p of profile.parts)
    for (let rot = 0; rot < 4; rot++) {
      const cost =
        bits(turnMask(p.wide, rot) ^ shape.wide) * 8 +
        bits(turnMask(p.narrow, rot) ^ shape.narrow) * 4 +
        bits(turnMask(p.corners ?? 0, rot) ^ shape.corners);
      if (cost < score) {
        score = cost;
        best = { kind: p.kind, rot };
      }
    }
  return best;
}

/** Erase squares as if they had never been there: their sides close, and the surrounding tiles take the walls (and
 * corners) that fill the gap. Returns the tiles to change around the erased squares, which the caller removes. */
export function autoErase(cells: readonly AutoCell[], erased: ReadonlySet<string>, profile: AutoProfile): AutoCell[] {
  const grid = terrain(cells, profile);
  const base = edgeGraph(cells, profile);
  const graph: EdgeGraph = new Map(base);
  const candidates = new Set<string>();
  for (const edge of base.keys()) {
    const ends = edgeCells(edge);
    if (!ends.some((key) => erased.has(key))) continue;
    graph.delete(edge);
    for (const key of ends) {
      const [x, y] = parseKey(key);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) candidates.add(cellKey(x + dx, y + dy));
    }
  }
  // Floor needs 2×2 squares, as when painting: a wide side left without a whole square of floor becomes narrow.
  const wideSquare = (sx: number, sy: number): boolean =>
    [edgeKey(sx, sy, 1), edgeKey(sx, sy, 2), edgeKey(sx + 1, sy, 2), edgeKey(sx, sy + 1, 1)].every(
      (edge) => graph.get(edge) === 'wide',
    );
  const near = new Set(candidates);
  const demoted: string[] = [];
  for (const [edge, link] of graph) {
    if (link !== 'wide') continue;
    const ends = edgeCells(edge);
    if (!ends.some((key) => near.has(key))) continue;
    const [x, y] = parseKey(ends[0]);
    const across = edge.endsWith('/E');
    const squares = across
      ? [
          [x, y - 1],
          [x, y],
        ]
      : [
          [x - 1, y],
          [x, y],
        ];
    if (!squares.some(([sx, sy]) => wideSquare(sx!, sy!))) demoted.push(edge);
  }
  for (const edge of demoted) {
    graph.set(edge, 'narrow');
    for (const key of edgeCells(edge)) {
      const [x, y] = parseKey(key);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) candidates.add(cellKey(x + dx, y + dy));
    }
  }
  const result: AutoCell[] = [];
  for (const key of candidates) {
    if (erased.has(key) || !grid.has(key)) continue;
    const [x, y] = parseKey(key);
    const shape = cellShape(graph, x, y);
    if (!sameShape(shape, cellShape(base, x, y))) result.push({ x, y, ...partFor(shape, profile) });
  }
  return result;
}

/** Resolve one gesture. Only sides the gesture opens change: tiles whose shape stays the same are not returned, so
 * unrelated (and manual) terrain stays untouched, however close it is.
 * - Each side walked across opens (a narrow opening unless it lies inside new room floor).
 * - A 2×2 square of painted squares becomes room floor. A gesture that starts on room floor may use that room as
 *   support, to expand it; another room counts only where the gesture painted it, so two touching rooms merge only
 *   when the band across their seam is painted, and a single line across the seam makes one doorway.
 * The start is measured against the pre-gesture terrain; for a fixed start the order of the squares is irrelevant.
 */
export function autoTiles(
  cells: readonly AutoCell[],
  stroke: AutoStroke,
  profile: AutoProfile,
  start = stroke.cells.values().next().value,
): AutoCell[] {
  const grid = terrain(cells, profile);
  const base = edgeGraph(cells, profile);
  const graph: EdgeGraph = new Map(base);
  const groups = roomGroups(cells, profile);
  const startRoom = start === undefined ? undefined : groups.get(start);
  const painted = (key: string): boolean => stroke.cells.has(key);
  const support = (key: string): boolean => painted(key) || (startRoom !== undefined && groups.get(key) === startRoom);
  const foreign = (key: string): boolean => groups.has(key) && groups.get(key) !== startRoom;
  for (const key of stroke.cells) {
    const [x, y] = parseKey(key);
    for (let dy = -1; dy <= 0; dy++)
      for (let dx = -1; dx <= 0; dx++) {
        const sx = x + dx,
          sy = y + dy;
        const square = [cellKey(sx, sy), cellKey(sx + 1, sy), cellKey(sx, sy + 1), cellKey(sx + 1, sy + 1)];
        if (!square.every(support)) continue;
        // Another room joins only through squares painted on both sides of the seam.
        if (square.some(foreign) && !square.every(painted)) continue;
        for (const edge of [edgeKey(sx, sy, 1), edgeKey(sx, sy, 2), edgeKey(sx + 1, sy, 2), edgeKey(sx, sy + 1, 1)])
          graph.set(edge, 'wide');
      }
  }
  for (const edge of stroke.steps) if (!graph.has(edge)) graph.set(edge, 'narrow');

  const candidates = new Set<string>();
  for (const key of stroke.cells) if (!grid.has(key)) candidates.add(key);
  for (const edge of new Set([...base.keys(), ...graph.keys()])) {
    if (base.get(edge) === graph.get(edge)) continue;
    for (const key of edgeCells(edge)) {
      const [x, y] = parseKey(key);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) candidates.add(cellKey(x + dx, y + dy));
    }
  }
  const result: AutoCell[] = [];
  for (const key of candidates) {
    const existing = grid.has(key);
    if (!existing && !painted(key)) continue;
    const [x, y] = parseKey(key);
    const shape = cellShape(graph, x, y);
    if (existing && sameShape(shape, cellShape(base, x, y))) continue;
    result.push({ x, y, ...partFor(shape, profile) });
  }
  return result;
}
