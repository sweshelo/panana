import {
  cellShape,
  cellKey,
  DIRECTIONS,
  edgeGraph,
  partOf,
  turnMask,
  type AutoCell,
  type AutoProfile,
} from './autotile';

/** A wall segment inside a square, in fractions of the square (0..1). */
export interface WallSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface MinimapCell extends AutoCell {
  room: boolean;
  /** Open sides (N,E,S,W bits): both tiles open them. */
  connected: number;
  /** Doorways: narrow openings of a room tile. */
  doors: number;
  corners: number;
  /** Walkable thirds of the square, bit `row * 3 + column`. A side tile of a room walks 2/3 of its square; a corridor
   * the middle third. */
  walk: number;
  walls: WallSegment[];
  /** Sides the tile opens but its neighbour does not open back: a misplaced tile (drawn in red). */
  loose: number;
}

const third = (column: number, row: number): number => 1 << (row * 3 + column);
/** The walkable thirds of a square with these openings. */
export function walkable(wide: number, narrow: number, corners: number): number {
  const open = wide | narrow;
  let walk = third(1, 1);
  const sides = [
    [1, 0],
    [2, 1],
    [1, 2],
    [0, 1],
  ] as const;
  sides.forEach(([c, r], direction) => {
    if (open & (1 << direction)) walk |= third(c, r);
  });
  const cornerThirds = [
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ] as const;
  cornerThirds.forEach(([c, r], corner) => {
    const a = 1 << corner,
      b = 1 << ((corner + 1) % 4);
    if (wide & a && wide & b && !(corners & a)) walk |= third(c, r);
  });
  return walk;
}

/** Boundaries between walkable and blocked thirds of a square, merged into straight runs. */
function wallsOf(walk: number): WallSegment[] {
  const at = (c: number, r: number): boolean => c >= 0 && c < 3 && r >= 0 && r < 3 && !!(walk & third(c, r));
  const segments: WallSegment[] = [];
  // Vertical boundaries at x = 1/3, 2/3, horizontal at y = 1/3, 2/3 (the square's border is an opening or empty).
  for (const line of [1, 2]) {
    let runV: number | undefined, runH: number | undefined;
    for (let i = 0; i <= 3; i++) {
      const wallV = i < 3 && at(line - 1, i) !== at(line, i);
      if (wallV && runV === undefined) runV = i;
      if (!wallV && runV !== undefined) {
        segments.push({ x0: line / 3, y0: runV / 3, x1: line / 3, y1: i / 3 });
        runV = undefined;
      }
      const wallH = i < 3 && at(i, line - 1) !== at(i, line);
      if (wallH && runH === undefined) runH = i;
      if (!wallH && runH !== undefined) {
        segments.push({ x0: runH / 3, y0: line / 3, x1: i / 3, y1: line / 3 });
        runH = undefined;
      }
    }
  }
  return segments;
}

/** Each square is drawn as its own tile is shaped (kind and turn), so the minimap shows what is actually placed: a
 * floor tile left at the edge of an island shows floor running out of it. Openings that the neighbour does not open
 * back are flagged as `loose`; `connected` keeps only the reciprocal ones. */
export function minimapCells(cells: readonly AutoCell[], profile: AutoProfile): MinimapCell[] {
  const graph = edgeGraph(cells, profile);
  const grid = new Map(cells.map((cell) => [cellKey(cell.x, cell.y), cell]));
  const result: MinimapCell[] = [];
  for (const cell of grid.values()) {
    const part = partOf(cell, profile);
    if (!part) continue;
    const shape = cellShape(graph, cell.x, cell.y);
    const room = !!part.wide;
    const connected = shape.wide | shape.narrow;
    const wide = turnMask(part.wide, cell.rot),
      narrow = turnMask(part.narrow, cell.rot);
    const corners = turnMask(part.corners ?? 0, cell.rot);
    const walk = walkable(wide, narrow, corners);
    result.push({
      ...cell,
      room,
      connected,
      doors: room ? narrow : 0,
      corners,
      walk,
      walls: room ? wallsOf(walk) : [],
      loose: (wide | narrow) & ~connected,
    });
  }
  return result;
}

export function drawTerrainMinimap(
  g: CanvasRenderingContext2D,
  scale: number,
  cells: readonly AutoCell[],
  profile: AutoProfile,
): void {
  const terrain = minimapCells(cells, profile);
  const t = scale / 3;
  for (const cell of terrain) {
    g.fillStyle = cell.room ? '#3f7fd9' : '#5d95d6';
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        if (cell.walk & third(c, r)) g.fillRect(cell.x * scale + c * t, cell.y * scale + r * t, t + 0.5, t + 0.5);
  }
  g.strokeStyle = '#cfe3ff';
  g.lineWidth = Math.max(1, Math.min(2, scale * 0.06));
  g.beginPath();
  for (const cell of terrain)
    for (const w of cell.walls) {
      g.moveTo((cell.x + w.x0) * scale, (cell.y + w.y0) * scale);
      g.lineTo((cell.x + w.x1) * scale, (cell.y + w.y1) * scale);
    }
  g.stroke();
  // A short amber threshold makes room-to-room and room-to-corridor entrances legible.
  g.strokeStyle = '#f5d68a';
  g.beginPath();
  for (const cell of terrain)
    DIRECTIONS.forEach(([dx, dy], direction) => {
      if (!(cell.doors & (1 << direction))) return;
      const cx = cell.x + 0.5 + dx / 6,
        cy = cell.y + 0.5 + dy / 6;
      g.moveTo((cx - Math.abs(dy) / 6) * scale, (cy - Math.abs(dx) / 6) * scale);
      g.lineTo((cx + Math.abs(dy) / 6) * scale, (cy + Math.abs(dx) / 6) * scale);
    });
  g.stroke();
  // An opening into nothing (or into a closed side) marks a tile that does not fit its neighbours.
  g.strokeStyle = '#ff5c5c';
  g.beginPath();
  for (const cell of terrain)
    DIRECTIONS.forEach(([dx, dy], direction) => {
      if (!(cell.loose & (1 << direction))) return;
      const span = walkSpan(cell.walk, direction);
      const bx = cell.x + 0.5 + dx / 2,
        by = cell.y + 0.5 + dy / 2;
      // Along the side: x for north/south, y for east/west.
      if (dy) {
        g.moveTo((cell.x + span[0]) * scale, by * scale);
        g.lineTo((cell.x + span[1]) * scale, by * scale);
      } else {
        g.moveTo(bx * scale, (cell.y + span[0]) * scale);
        g.lineTo(bx * scale, (cell.y + span[1]) * scale);
      }
    });
  g.stroke();
}

/** The extent of the walkable thirds along one side of a square (fractions of the side). */
function walkSpan(walk: number, direction: number): [number, number] {
  const along = [0, 1, 2].filter((i) => {
    const [c, r] = direction === 0 ? [i, 0] : direction === 1 ? [2, i] : direction === 2 ? [i, 2] : [0, i];
    return !!(walk & third(c, r));
  });
  return along.length ? [Math.min(...along) / 3, (Math.max(...along) + 1) / 3] : [1 / 3, 2 / 3];
}
