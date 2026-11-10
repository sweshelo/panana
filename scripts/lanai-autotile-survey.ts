// Survey of RPG FREE!'s placed tiles for the automatic brush (one-off; run: bun scripts/lanai-autotile-survey.ts).
// For every tile of the outdoor / dungeon maps: its kind, and the occupancy of its four neighbours (N,E,S,W with
// N = y - 1) and four diagonals (NE,SE,SW,NW), turned back into the tile's own frame (rot 0). Prints, per kind, the
// most common local masks, and the master's MapPartsCommon rows. Compare with src/game/autotile.ts (KAHARA_AUTO).
import { LANAI_BASE, LANAI_UPDATE } from '../test/env';
import { openImages } from '../src/rom/dump';
import { LanaiSession } from '../src/lanai/session';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { KAHARA_AUTO } from '../src/game/autotile';

const turnBack = (mask: number, rot: number): number => ((mask >> rot) | (mask << (4 - rot))) & 15;
const bits = (m: number, names: string): string => [...names].filter((_, i) => m & (1 << i)).join('') || '-';
const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
const s = await LanaiSession.open(dump, { fresh: true });

const EMPTY = 33;
type Stat = { n: number; rot: number[]; letters: Map<number, number>; occ: Map<string, number>; nb: Map<string, number> };
const stats = new Map<number, Stat>();
const tilesets = new Map<number, number>();
let maps = 0;
for (const c of lanaiContents(s)) {
  const m = await lanaiMaps(s, c).catch(() => null);
  if (!m) continue;
  for (const info of m.maps) {
    if (info.world) continue;
    const doc = m.doc(info);
    if (doc.tiles.some((t) => t.kind >= 15 && t.kind <= 27)) continue;
    maps++;
    const ts = m.tileSource(info, doc).tileset;
    tilesets.set(ts, (tilesets.get(ts) ?? 0) + 1);
    const grid = new Map(doc.tiles.map((t) => [`${t.x},${t.y}`, t]));
    const at = (x: number, y: number) => {
      const t = grid.get(`${x},${y}`);
      return t && t.kind !== EMPTY ? t : undefined;
    };
    for (const t of doc.tiles) {
      const st = stats.get(t.kind) ?? { n: 0, rot: [0, 0, 0, 0], letters: new Map(), occ: new Map(), nb: new Map() };
      stats.set(t.kind, st);
      st.n++;
      st.rot[t.rot]!++;
      st.letters.set(t.letter, (st.letters.get(t.letter) ?? 0) + 1);
      let o = 0, d = 0;
      const nbKinds: string[] = [];
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy], i) => { const n = at(t.x + dx!, t.y + dy!); if (n) o |= 1 << i; });
      [[1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([dx, dy], i) => { if (at(t.x + dx!, t.y + dy!)) d |= 1 << i; });
      // neighbours in the local frame: local direction j is world direction (j + rot) % 4
      for (let j = 0; j < 4; j++) {
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][(j + t.rot) % 4]!;
        const n = at(t.x + dx!, t.y + dy!);
        nbKinds.push(n ? `${n.kind}r${(n.rot - t.rot + 4) % 4}` : '.');
      }
      const key = `o=${bits(turnBack(o, t.rot), 'NESW')} d=${bits(turnBack(d, t.rot), '1234')}`;
      st.occ.set(key, (st.occ.get(key) ?? 0) + 1);
      const nk = nbKinds.join(' ');
      st.nb.set(nk, (st.nb.get(nk) ?? 0) + 1);
    }
  }
}
console.log(`maps: ${maps}, tilesets: ${JSON.stringify([...tilesets])}`);
const top = (m: Map<string, number>, k: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([key, v]) => `${v}×[${key}]`).join('  ');
for (const [kind, st] of [...stats].sort((a, b) => a[0] - b[0])) {
  const kp = KAHARA_AUTO.parts.find((p) => p.kind === kind);
  console.log(`\nkind ${kind}: n=${st.n} rot=${st.rot.join('/')} letters=${JSON.stringify([...st.letters])}` + (kp ? ` kahara wide=${bits(kp.wide, 'NESW')} narrow=${bits(kp.narrow, 'NESW')} corners=${bits(kp.corners ?? 0, '1234')}` : ''));
  console.log(`  occ: ${top(st.occ, 6)}`);
  console.log(`  nb (N E S W, local): ${top(st.nb, 6)}`);
}
const common = s.table('MapPartsCommon');
if (common) {
  console.log('\nMapPartsCommon (row: u32 +0, +4, +8 hex):');
  for (let r = 0; r < common.rows; r++) console.log(`  ${r} (kind ${r - 1}): ${common.u32(r, 0)} ${common.u32(r, 4)} ${common.u32(r, 8).toString(16)}`);
}
