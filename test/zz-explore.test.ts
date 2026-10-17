// Temporary ROM probe (lanai MonsterGroup / TreasureGroup / EventObject actions of NPCs). Not for merge.
import { expect, test } from 'bun:test';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const L = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const hexRow = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

test.skipIf(!hasLanai)('explore', async () => {
  const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
  const s = await LanaiSession.open(dump, { fresh: true });
  const mp = s.need('MonsterParameter');
  L('MonsterParameter rows', mp.rows, 'rowSize', mp.rowSize, 'ids', mp.rowIds.length, 'first ids', mp.rowIds.slice(0, 6).map(h).join(','));
  let mpIdIsRow = 0;
  for (let r = 0; r < mp.rows; r++) if (mp.rowId(r) === ((0x80000000 | r) >>> 0)) mpIdIsRow++;
  L('MonsterParameter rowId==0x80000000|row', mpIdIsRow);
  for (const r of [0, 1, 2, 3, 40, 100]) if (r < mp.rows) L('MP', r, h(mp.rowId(r)), s.plain(mp, r, 'name'));
  const item = s.table('ItemData');
  L('ItemData rows', item?.rows, 'firstIds', item?.rowIds.slice(0, 4).map(h).join(','));
  const mpIds = new Set(mp.rowIds.length ? mp.rowIds : Array.from({ length: mp.rows }, (_, r) => (0x80000000 | r) >>> 0));
  const itemIds = new Set(item ? (item.rowIds.length ? item.rowIds : Array.from({ length: item.rows }, (_, r) => (0x80000000 | r) >>> 0)) : []);

  type Stat = { n: number; zero: number; x80: number; mp: number; item: number; small: number; vals: Map<number, number> };
  const mg: Map<number, Stat> = new Map();
  const tg: Map<number, Stat> = new Map();
  const add = (m: Map<number, Stat>, o: number, v: number): void => {
    let st = m.get(o);
    if (!st) m.set(o, (st = { n: 0, zero: 0, x80: 0, mp: 0, item: 0, small: 0, vals: new Map() }));
    st.n++;
    if (v === 0) st.zero++;
    else if (v === 0x80000000) st.x80++;
    if (mpIds.has(v)) st.mp++;
    if (itemIds.has(v)) st.item++;
    if (v > 0 && v < 0x10000) st.small++;
    if (st.vals.size < 400) st.vals.set(v, (st.vals.get(v) ?? 0) + 1);
  };
  const actions = new Map<string, number>();
  const actionSamples = new Map<string, string[]>();
  let dumped = 0;
  const contents = lanaiContents(s);
  for (const c of contents) {
    let maps;
    try { maps = await lanaiMaps(s, c); } catch { continue; }
    const g = maps.contentTable('MonsterGroup');
    const t = maps.contentTable('TreasureGroup');
    if (dumped < 2 && g && t) {
      dumped++;
      L('content', c.index ?? '?', c.archive, 'MonsterGroup rows', g.rows, 'rowSize', g.rowSize, 'fields', JSON.stringify(g.fields), 'extra', g.extra.length);
      for (let r = 0; r < Math.min(g.rows, 8); r++) L('MG', r, h(g.rowId(r)), hexRow(g.row(r)));
      L('TreasureGroup rows', t.rows, 'rowSize', t.rowSize, 'fields', JSON.stringify(t.fields));
      for (let r = 0; r < Math.min(t.rows, 8); r++) L('TG', r, h(t.rowId(r)), hexRow(t.row(r)));
    }
    if (g) for (let r = 0; r < g.rows; r++) for (let o = 0; o + 4 <= g.rowSize; o += 4) add(mg, o, g.u32(r, o));
    if (t) for (let r = 0; r < t.rows; r++) for (let o = 0; o + 4 <= t.rowSize; o += 4) add(tg, o, t.u32(r, o));
    // section 5 records: kind -> EO action types
    for (const m of maps.maps) {
      if (m.world) continue;
      const ev = maps.eventTable(m.dungeon);
      if (!ev) continue;
      const doc = maps.doc(m);
      for (const sec of [5, 7, 8]) for (const rec of doc.recs[sec] ?? []) {
        const row = u32(rec.raw, 4);
        if (!row || row >= ev.rows) continue;
        const kind = u32(rec.raw, 0);
        for (const ao of [0x10, 0x28, 0x40]) {
          const type = ev.u32(row, ao);
          if (!type || type === 0x80000000) continue;
          const k = `s${sec} kind${kind} a${(ao - 0x10) / 0x18 + 1} ${h(type)}`;
          actions.set(k, (actions.get(k) ?? 0) + 1);
          const arr = actionSamples.get(k) ?? [];
          if (arr.length < 3) arr.push(`${m.name}#${row}: ${[0, 1, 2, 3, 4].map((i) => h(ev.u32(row, ao + 4 + i * 4))).join(' ')}`);
          actionSamples.set(k, arr);
        }
      }
    }
  }
  const show = (name: string, m: Map<number, Stat>): void => {
    for (const [o, st] of [...m].sort((a, b) => a[0] - b[0])) {
      const top = [...st.vals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => `${h(v)}x${n}`).join(' ');
      L(name, `+0x${o.toString(16)}`, `n=${st.n} zero=${st.zero} x80=${st.x80} mpId=${st.mp} itemId=${st.item} small=${st.small} distinct=${st.vals.size}`, top);
    }
  };
  show('MGcol', mg);
  show('TGcol', tg);
  for (const [k, n] of [...actions].sort((a, b) => b[1] - a[1]).slice(0, 60)) L('ACT', k, n, '|', actionSamples.get(k)!.join(' || '));
  expect(true).toBe(true);
}, 900000);
