// Read-only survey of the f32 offsets (+0x0C / +0x10 etc.) of RPG FREE!'s map records, for the snapping of the map
// editor: which values the ROM uses, and on which grids the resulting positions sit under a few scale hypotheses.
// Usage: bun scripts/research/lanai-offsets.ts [roms/lanai-base.cia] [roms/lanai-update.cia]
import { lanaiContents } from '../../src/lanai/contents';
import { LANAI_LAYOUTS, LanaiMaps } from '../../src/lanai/maps';
import { LanaiSession } from '../../src/lanai/session';
import { openImages } from '../../src/rom/dump';
import { f32 } from '../../src/util/bytes';

const base = process.argv[2] ?? 'roms/lanai-base.cia',
  update = process.argv[3] ?? 'roms/lanai-update.cia';
const dump = await openImages([Bun.file(base), Bun.file(update)], (f) => (f as unknown as { name: string }).name);
const s = await LanaiSession.open(dump);

const values = new Map<number, Map<string, number>>();
const total = new Map<number, number>();
const nonzero = new Map<number, number>();
// world = base(v) + d * scale, for each scale: how many positions are on multiples of 50 / 100 / 250 / 500(+250)
const SCALES = [50, 100, 250, 500];
const onGrid = new Map<string, number>();
const examples: string[] = [];
const inc = <K>(m: Map<K, number>, k: K, n = 1): void => void m.set(k, (m.get(k) ?? 0) + n);
const base0 = (unit: string, v: number): number => (unit === 'cell' ? 250 + v * 500 : 50 + v * 100);

for (const c of lanaiContents(s)) {
  let m: LanaiMaps;
  try {
    m = await LanaiMaps.load(s, c);
  } catch {
    continue;
  }
  for (const info of m.maps) {
    if (info.world) continue;
    const doc = m.doc(info);
    for (const [k, L] of Object.entries(LANAI_LAYOUTS)) {
      const sec = Number(k);
      if (L.fxo === undefined || L.fyo === undefined) continue;
      for (const r of doc.recs[sec] ?? []) {
        inc(total, sec);
        const dx = f32(r.raw, L.fxo),
          dy = f32(r.raw, L.fyo);
        if (dx || dy) inc(nonzero, sec);
        if (!values.has(sec)) values.set(sec, new Map());
        for (const d of [dx, dy]) inc(values.get(sec)!, String(Math.round(d * 1000) / 1000));
        for (const sc of SCALES) {
          const wx = base0(L.unit, r.x) + dx * sc,
            wy = base0(L.unit, r.y) + dy * sc;
          for (const g of [50, 100, 250])
            if (Math.abs(wx / g - Math.round(wx / g)) < 1e-3 && Math.abs(wy / g - Math.round(wy / g)) < 1e-3)
              inc(onGrid, `${sec}/x${sc}/${g}`);
          const cx = (wx - 250) / 500,
            cy = (wy - 250) / 500;
          if (Math.abs(cx - Math.round(cx)) < 1e-3 && Math.abs(cy - Math.round(cy)) < 1e-3)
            inc(onGrid, `${sec}/x${sc}/centre`);
        }
        if ((dx || dy) && examples.length < 40)
          examples.push(
            `c${c.index} ${info.name} s${sec} raw (${r.x}, ${r.y}) d (${dx}, ${dy}) -> cell x100 (${((base0(L.unit, r.x) + dx * 100) / 500).toFixed(3)}, ${((base0(L.unit, r.y) + dy * 100) / 500).toFixed(3)})`,
          );
      }
    }
  }
}

for (const [sec, n] of [...total].sort((a, b) => a[0] - b[0])) {
  console.log(`section ${sec}: ${n} records, ${nonzero.get(sec) ?? 0} with an offset`);
  const top = [...values.get(sec)!].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`  offset values (x and y): ${top.map(([v, c]) => `${v}:${c}`).join(' ')}`);
  for (const sc of SCALES)
    console.log(
      `  scale ${sc}: on 50 ${onGrid.get(`${sec}/x${sc}/50`) ?? 0}, on 100 ${onGrid.get(`${sec}/x${sc}/100`) ?? 0}, on 250 ${onGrid.get(`${sec}/x${sc}/250`) ?? 0}, cell centre ${onGrid.get(`${sec}/x${sc}/centre`) ?? 0}`,
    );
}
console.log('examples:');
for (const e of examples) console.log(`  ${e}`);
