// TEMPORARY probe of ActionData (removed before the PR).
import { test } from 'bun:test';
import { LanaiSession } from '../src/lanai/session';
import { lanaiItems } from '../src/lanai/items';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const h = (v: number, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
test.skipIf(!hasLanai)('probe ActionData 2', async () => {
  const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
  const s = await LanaiSession.open(dump, { fresh: true });
  const out: string[] = [];
  const t = s.need('ActionData');
  out.push('TABLES ' + s.tables.map((r) => `${r.archive}:${r.table.name}:${r.table.rows}x${r.table.rowSize}:${r.table.fields.map((f) => f.name).join('/')}`).join(' | '));
  // which tables hold the row IDs of each u32 column / u16 half
  const cols: [string, (r: number) => number][] = [];
  for (let o = 0; o < 0x2c; o += 4) cols.push([`u32+${h(o, 2)}`, (r) => t.u32(r, o)]);
  for (let o = 0x18; o < 0x2c; o += 2) cols.push([`u16+${h(o, 2)}`, (r) => t.u16(r, o)]);
  for (const [label, get] of cols) {
    const vals = new Set<number>();
    for (let r = 0; r < t.rows; r++) { const v = get(r); if (v && v !== 0x80000000) vals.add(v); }
    if (vals.size < 3) continue;
    const hits: string[] = [];
    for (const ref of s.tables) {
      const x = ref.table;
      if (!x.rowIds.length) continue;
      const ids = new Set(x.rowIds);
      let n = 0, nr = 0;
      for (const v of vals) { if (ids.has(v) || ids.has((v | 0x80000000) >>> 0)) n++; if (v < x.rows) nr++; }
      if (n / vals.size > 0.85) hits.push(`${x.name}(id ${n}/${vals.size})`);
    }
    out.push(`${label} distinct ${vals.size} max ${h(Math.max(...vals))} -> ${hits.join(', ')}`);
  }
  const ma = s.need('MessageAction');
  const msg = (id: number, f = 'individual') => (s.insert('MessageAction', id, f) ?? '?').replace(/\n/g, '⏎').slice(0, 40);
  for (const r of [2, 20, 26, 56, 110, 142, 180, 407, 415, 422, 433, 540, 658, 856, 977, 1000, 1096, 1289, 2000, 4000, 5000]) {
    out.push(`#${r} c=${msg(t.u32(r, 0x0c))} | c.multi=${msg(t.u32(r, 0x0c), 'multiple')} | 10=${msg(t.u32(r, 0x10))} | 10.multi=${msg(t.u32(r, 0x10), 'multiple')}`);
  }
  out.push(`MA rows ${ma.rows}; 80000016=${msg(0x80000016)} 80000017=${msg(0x80000017)} 80000020=${msg(0x80000020)} 80000014=${msg(0x80000014)}`);
  // the items' use effects
  const u = s.need('UseItemInfo');
  const core = s.need('ItemDataCore');
  let shown = 0;
  for (const it of lanaiItems(s)) {
    const k = it.kind;
    if (!((k & 0xf0) === 0x10 || k === 0x02 || k === 0x37)) continue;
    const ur = u.find(core.u32(it.core, 0x00));
    if (ur < 0) { out.push(`ITEM ${it.row} ${it.name} k${h(k, 2)} no UseItemInfo`); continue; }
    const a = u.u32(ur, 4), b = u.u32(ur, 0);
    const ar = a < t.rows ? a : -1;
    if (shown++ < 140) out.push(`ITEM ${it.row} ${it.name} k${h(k, 2)} U#${ur} +0=${h(b)} +4=${h(a)} -> A#${ar} sys ${ar >= 0 ? (t.u32(ar, 0x14) >>> 4) & 0xff : '-'} ${ar >= 0 ? msg(t.u32(ar, 0x0c)) + ' / ' + msg(t.u32(ar, 0x10)) : ''}`);
  }
  console.log(`PROBE-BEGIN\n${out.join('\n')}\nPROBE-END`);
}, 120000);
