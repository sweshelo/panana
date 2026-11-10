// TEMPORARY probe of ActionData (removed before the PR).
import { test } from 'bun:test';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const h = (v: number, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
test.skipIf(!hasLanai)('probe ActionData', async () => {
  const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
  const s = await LanaiSession.open(dump, { fresh: true });
  const out: string[] = [];
  const t = s.need('ActionData');
  out.push(`ActionData rows ${t.rows} size ${t.rowSize} ids ${t.rowIds.length} fields ${JSON.stringify(t.fields)} relocs ${t.relocs.size} extra ${t.extra.length}`);
  for (let o = 0; o < t.rowSize; o += 4) {
    const c = new Map<number, number>();
    for (let r = 0; r < t.rows; r++) { const v = t.u32(r, o); c.set(v, (c.get(v) ?? 0) + 1); }
    const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => `${h(v)}:${n}`).join(' ');
    out.push(`+${h(o, 2)} distinct ${c.size} str ${t.isString(1, o)} | ${top}`);
  }
  for (let o = 0x10; o < t.rowSize; o += 1) {
    const c = new Map<number, number>();
    for (let r = 0; r < t.rows; r++) { const v = t.row(r)[o]!; c.set(v, (c.get(v) ?? 0) + 1); }
    out.push(`b+${h(o, 2)} distinct ${c.size} | ${[...c].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([v, n]) => `${h(v, 2)}:${n}`).join(' ')}`);
  }
  const ma = s.table('MessageAction');
  out.push(`MessageAction ${ma?.rows} fields ${JSON.stringify(ma?.fields)}`);
  const sys = new Map<number, number>();
  for (let r = 0; r < t.rows; r++) { const k = (t.u32(r, 0x14) >>> 4) & 0xff; sys.set(k, (sys.get(k) ?? 0) + 1); }
  out.push(`systems ${[...sys].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(' ')}`);
  const sample = (r: number) => {
    const b = t.row(r);
    const words = Array.from({ length: t.rowSize / 4 }, (_, i) => h(t.u32(r, i * 4))).join(' ');
    const msg = s.insert('MessageAction', t.u32(r, 0x0c), 'individual') ?? '';
    void b;
    return `#${r} ${h(t.rowId(r))} ${words} | ${msg.slice(0, 40)}`;
  };
  for (let r = 0; r < 120; r++) out.push(sample(r));
  // one sample per system
  const seen = new Set<number>();
  for (let r = 0; r < t.rows; r++) { const k = (t.u32(r, 0x14) >>> 4) & 0xff; if (seen.has(k)) continue; seen.add(k); out.push(`sys ${k}: ${sample(r)}`); }
  for (const r of [142, 143, 420, 421, 658, 659, 660, 1000, 2000, 3000, 4000, 5000]) if (r < t.rows) out.push(sample(r));
  // tables that hold ActionData IDs / rows in some u32 column (master only)
  const ids = new Set(t.rowIds);
  for (const ref of s.tables) {
    const x = ref.table;
    if (x === t || x.rowSize < 4) continue;
    for (let o = 0; o + 4 <= x.rowSize; o += 4) {
      let hit = 0, nz = 0;
      for (let r = 0; r < x.rows; r++) { const v = x.u32(r, o); if (v && v !== 0x80000000) { nz++; if (ids.has(v)) hit++; } }
      if (nz >= 3 && hit / nz > 0.9) out.push(`ref ${ref.archive} ${x.name} +${h(o, 2)} ${hit}/${nz}/${x.rows}`);
    }
  }
  const u = s.table('UseItemInfo');
  if (u) { out.push(`UseItemInfo ${u.rows}x${u.rowSize} fields ${JSON.stringify(u.fields)}`); for (let r = 0; r < Math.min(u.rows, 40); r++) out.push(`U#${r} ${h(u.rowId(r))} ${h(u.u32(r, 0))} ${h(u.u32(r, 4))}`); }
  console.log(`PROBE-BEGIN\n${out.join('\n')}\nPROBE-END`);
}, 120000);
