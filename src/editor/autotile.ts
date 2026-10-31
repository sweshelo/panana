/** Game-independent terrain topology. Directions are N,E,S,W; rotations are clockwise. */
export interface AutoPart { kind: number; wide: number; narrow: number; corners?: number }
export interface AutoProfile { parts: readonly AutoPart[]; isolated: number }
export interface AutoCell { x: number; y: number; kind: number; rot: number }
export const cellKey = (x: number, y: number): string => `${x},${y}`;
const dirs = [[0,-1],[1,0],[0,1],[-1,0]] as const;
const diagonals = [[1,-1],[1,1],[-1,1],[-1,-1]] as const;
export function turnMask(mask: number, rot: number): number {
  return ((mask << rot) | (mask >> (4 - rot))) & 15;
}
export function partOf(cell: AutoCell, profile: AutoProfile): AutoPart | undefined {
  return profile.parts.find(p => p.kind === cell.kind);
}
/** Resolve only the stroke and its immediate neighbours; unrelated/manual terrain stays untouched.
 * The start is measured against the pre-gesture terrain, never the evolving preview. A gesture
 * starting outside a room forms rooms only from its own filled squares; one starting in a room
 * may use the existing room to support an expansion. For a fixed start, visitation order is irrelevant.
 */
export function autoTiles(cells: readonly AutoCell[], stroke: ReadonlySet<string>, profile: AutoProfile, start = stroke.values().next().value): AutoCell[] {
  const grid = new Map(cells.map(c => [cellKey(c.x,c.y), c]));
  const occupied = (x: number,y: number): boolean => stroke.has(cellKey(x,y)) || !!(grid.get(cellKey(x,y)) && partOf(grid.get(cellKey(x,y))!,profile));
  const room = new Set<string>();
  for (const c of cells) if ((partOf(c,profile)?.wide ?? 0) !== 0) room.add(cellKey(c.x,c.y));
  const originalRoom = new Set(room);
  const expanding = start !== undefined && originalRoom.has(start);
  const roomCandidate = (x: number, y: number): boolean => stroke.has(cellKey(x,y)) || (expanding && originalRoom.has(cellKey(x,y)));
  // Only squares touching the gesture can create new room floor.
  for (const key of stroke) {
    const [x,y] = key.split(',').map(Number) as [number,number];
    for (let dy=-1;dy<=0;dy++) for(let dx=-1;dx<=0;dx++) {
      const square = [[x+dx,y+dy],[x+dx+1,y+dy],[x+dx,y+dy+1],[x+dx+1,y+dy+1]] as const;
      if(square.every(([a,b])=>roomCandidate(a,b))) for(const [a,b] of square) room.add(cellKey(a,b));
    }
  }
  const affected = new Set(stroke);
  for(const key of stroke) { const [x,y]=key.split(',').map(Number) as [number,number];
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) affected.add(cellKey(x+dx,y+dy));
  }
  const result: AutoCell[] = [];
  // Merely passing alongside a room must not punch entrances into its closed walls.
  // Painting that boundary explicitly, or expanding room floor from inside, opens the join.
  const allowsJoin = (key: string, neighbour: string, direction: number): boolean => {
    if (!originalRoom.has(key) || stroke.has(key)) return true;
    if (expanding && room.has(neighbour) && stroke.has(neighbour)) return true;
    const cell = grid.get(key)!;
    const part = partOf(cell,profile)!;
    return !!(turnMask(part.wide | part.narrow,cell.rot) & (1 << direction));
  };
  for(const key of affected) {
    const c=grid.get(key);
    if(!stroke.has(key) && (!c || !partOf(c,profile))) continue;
    const [x,y]=key.split(',').map(Number) as [number,number];
    let wide=0,narrow=0,corners=0;
    dirs.forEach(([dx,dy],i)=>{
      if(!occupied(x+dx,y+dy)) return;
      const neighbour = cellKey(x+dx,y+dy);
      if (!allowsJoin(key,neighbour,i) || !allowsJoin(neighbour,key,(i+2)%4)) return;
      // Wide joins need room floor on both sides and a supporting square beside the edge.
      const sideX=dy,sideY=-dx;
      const support=[-1,1].some(s=>room.has(cellKey(x+sideX*s,y+sideY*s)) && room.has(cellKey(x+dx+sideX*s,y+dy+sideY*s)));
      if(room.has(key) && room.has(cellKey(x+dx,y+dy)) && support) wide|=1<<i;
      else narrow|=1<<i;
    });
    diagonals.forEach(([dx,dy],i)=>{if((wide&(1<<i)) && (wide&(1<<((i+1)%4))) && !room.has(cellKey(x+dx,y+dy))) corners|=1<<i;});
    if(!(wide|narrow)) {result.push({x,y,kind:profile.isolated,rot:0});continue;}
    let best: AutoCell | undefined, score=Infinity;
    for(const p of profile.parts) for(let rot=0;rot<4;rot++) {
      const w=turnMask(p.wide,rot), n=turnMask(p.narrow,rot), co=turnMask(p.corners??0,rot);
      const bits=(v:number):number=>v.toString(2).replace(/0/g,'').length;
      const cost=bits(w^wide)*8+bits(n^narrow)*4+bits(co^corners);
      if(cost<score) {score=cost;best={x,y,kind:p.kind,rot};}
    }
    if(best) result.push(best);
  }
  return result;
}
