import { cellKey, partOf, roomGroups, turnMask, type AutoCell, type AutoProfile } from './autotile';

const directions = [[0,-1],[1,0],[0,1],[-1,0]] as const;
export interface MinimapCell extends AutoCell {
  room: boolean;
  connected: number;
  doors: number;
  corners: number;
  walls: { direction: number; from: number; to: number }[];
}

/** Geometry follows reciprocal tile openings, not mere adjacency or section 6 encounter metadata. */
export function minimapCells(cells: readonly AutoCell[], profile: AutoProfile): MinimapCell[] {
  const grid = new Map(cells.map(cell => [cellKey(cell.x,cell.y),cell]));
  const groups = roomGroups(cells,profile);
  const result: MinimapCell[] = [];
  for (const cell of grid.values()) {
    const part = partOf(cell,profile);
    if (!part) continue;
    const wide = turnMask(part.wide,cell.rot), narrow = turnMask(part.narrow,cell.rot);
    const room = !!part.wide;
    let connected = 0, doors = 0;
    const walls: MinimapCell['walls'] = [];
    directions.forEach(([dx,dy],direction) => {
      const bit = 1 << direction, opposite = 1 << ((direction+2)%4);
      const next = grid.get(cellKey(cell.x+dx,cell.y+dy));
      const nextPart = next && partOf(next,profile);
      const nextWide = next && nextPart ? turnMask(nextPart.wide,next.rot) : 0;
      const nextNarrow = next && nextPart ? turnMask(nextPart.narrow,next.rot) : 0;
      const open = !!((wide|narrow) & bit) && !!((nextWide|nextNarrow) & opposite);
      if (open) connected |= bit;
      const full = open && !!(wide & bit) && !!(nextWide & opposite);
      if (!room || full) return;
      if (open) {
        walls.push({direction,from:0,to:0.3},{direction,from:0.7,to:1});
        if ((narrow & bit) || groups.get(cellKey(cell.x,cell.y)) !== groups.get(cellKey(next!.x,next!.y))) doors |= bit;
      } else walls.push({direction,from:0,to:1});
    });
    result.push({...cell,room,connected,doors,corners:turnMask(part.corners??0,cell.rot),walls});
  }
  return result;
}

export function drawTerrainMinimap(g: CanvasRenderingContext2D, scale: number, cells: readonly AutoCell[], profile: AutoProfile): void {
  const terrain = minimapCells(cells,profile);
  const edge = (cell: AutoCell, direction: number, from: number, to: number): void => {
    const x = cell.x*scale, y = cell.y*scale;
    const horizontal = direction%2 === 0;
    const offset = direction === 1 || direction === 2 ? scale : 0;
    g.moveTo(x+(horizontal ? from*scale : offset),y+(horizontal ? offset : from*scale));
    g.lineTo(x+(horizontal ? to*scale : offset),y+(horizontal ? offset : to*scale));
  };
  for (const cell of terrain) {
    const x = cell.x*scale, y = cell.y*scale;
    g.fillStyle = cell.room ? '#3f7fd9' : '#5d95d6';
    if (cell.room) { g.fillRect(x,y,scale,scale); continue; }
    const mid = scale/2, half = scale*0.2;
    g.fillRect(x+mid-half,y+mid-half,half*2,half*2);
    directions.forEach(([dx,dy],direction) => {
      if (!(cell.connected & (1 << direction))) return;
      if (dx) g.fillRect(x+(dx>0?mid:0),y+mid-half,mid,half*2);
      else g.fillRect(x+mid-half,y+(dy>0?mid:0),half*2,mid);
    });
  }
  g.strokeStyle = '#cfe3ff';
  g.lineWidth = Math.max(1,Math.min(2,scale*0.06));
  g.beginPath();
  for (const cell of terrain) for (const wall of cell.walls) edge(cell,wall.direction,wall.from,wall.to);
  g.stroke();
  // Inward wall corners occupy a small notch in the room floor.
  for (const cell of terrain) for (let corner=0;corner<4;corner++) {
    if (!(cell.corners & (1 << corner))) continue;
    const right = corner === 0 || corner === 1, bottom = corner === 1 || corner === 2;
    const size = scale*0.18;
    const x = (cell.x+(right?1:0))*scale, y = (cell.y+(bottom?1:0))*scale;
    const innerX = x+(right?-size:size), innerY = y+(bottom?-size:size);
    g.fillStyle = '#15171c';
    g.fillRect(Math.min(x,innerX),Math.min(y,innerY),size,size);
    g.beginPath();g.moveTo(x,innerY);g.lineTo(innerX,innerY);g.lineTo(innerX,y);g.stroke();
  }
  // A short amber threshold makes room-to-room and room-to-corridor entrances legible.
  g.strokeStyle = '#f5d68a';
  g.beginPath();
  for (const cell of terrain) for (let direction=0;direction<4;direction++) {
    if (cell.doors & (1 << direction)) edge(cell,direction,0.34,0.66);
  }
  g.stroke();
}
