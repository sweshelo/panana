// Temporary ROM probe round 2 (lanai NPC action args vs talk tables, MonsterGroup slots, TreasureGroup kinds). Not for merge.
import { expect, test } from 'bun:test';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { lanaiMonsters } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import type { LanaiTable } from '../src/lanai/table';
import { openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const L = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

test.skipIf(!hasLanai)('explore2', async () => {
  const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
  const s = await LanaiSession.open(dump, { fresh: true });
  const mp = s.need('MonsterParameter');
  const mons = lanaiMonsters(s);
  const mname = (id: number): string => { const r = mp.find(id); return r >= 0 ? `${mons[r]?.name || '?'}(r${r})` : `?${h(id)}`; };
  const item = s.need('ItemData');
  const iname = (id: number): string => { const r = item.find(id); return r >= 0 ? s.plain(item, r, 'name') || `item r${r}` : `?${h(id)}`; };
  const kinds = new Map<number, number>();
  const kindSamples = new Map<number, string[]>();
  let printed = 0, npcPrinted = 0;
  const typeHit = new Map<string, [number, number]>();
  for (const c of lanaiContents(s)) {
    let maps;
    try { maps = await lanaiMaps(s, c); } catch { continue; }
    const tables = (maps as unknown as { tables: { entry: number; table: LanaiTable }[] }).tables;
    const g = maps.contentTable('MonsterGroup');
    const tg = maps.contentTable('TreasureGroup');
    const mgT = maps.contentTable('MapGroup');
    if (g && c.index === 38) {
      for (let r = 0; r < g.rows; r++) {
        const slots: string[] = [];
        for (let o = 4; o < 0x68; o += 4) { const v = g.u32(r, o); if (v) slots.push(`+${o.toString(16)}:${mname(v)}`); }
        const bytes = [...g.row(r).subarray(0x68, 0x98)].map((b) => b.toString(16).padStart(2, '0')).join('');
        L('MG38', r, h(g.rowId(r)), '+0', h(g.u32(r, 0)), slots.join(' '), '| tail', bytes);
      }
    }
    if (tg) for (let r = 0; r < tg.rows; r++) for (let i = 0; i < 10; i++) {
      const o = i * 8; const v = tg.u32(r, o); const k = tg.u8(r, o + 6);
      if (v === 0x80000000) continue;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      const arr = kindSamples.get(k) ?? [];
      if (arr.length < 6) arr.push(`c${c.index}r${r}s${i} v=${h(v)} w=${tg.u16(r, o + 4)} ${k === 1 ? iname(v) : ''}`);
      kindSamples.set(k, arr);
    }
    if (!mgT) continue;
    for (const m of maps.maps) {
      if (m.world) continue;
      const ev = maps.eventTable(m.dungeon);
      if (!ev) continue;
      const msgEntry = mgT.u32(m.dungeon, 0x24);
      const msg = tables.find((t) => t.entry === msgEntry)?.table;
      if (printed < 3 && msg) { printed++; L('msgtable', c.index, m.name, h(msgEntry), msg.name, 'rows', msg.rows, 'rowSize', msg.rowSize); }
      for (const rec of maps.doc(m).recs[5] ?? []) {
        const row = u32(rec.raw, 4);
        if (!row || row >= ev.rows) continue;
        const type = ev.u32(row, 0x10);
        if (![0x80000001, 0x80000002, 0x80000003, 0x80000037, 0x80000032, 0x8000002f, 0x80000030, 0x80000025].includes(type)) continue;
        const a = [0, 1, 2, 3, 4].map((i) => ev.u32(row, 0x14 + i * 4));
        const k = h(type);
        const hit = typeHit.get(k) ?? [0, 0];
        hit[0]++;
        if (msg && a[0]! < msg.rows) hit[1]++;
        typeHit.set(k, hit);
        if (npcPrinted < 40 && msg) {
          npcPrinted++;
          const txt = a.slice(0, 4).map((v) => (v && v < msg.rows ? JSON.stringify(s.plain(msg, v, 'message').slice(0, 40)) : String(v))).join(' / ');
          L('NPC', c.index, m.name, 'kind', u32(rec.raw, 0), 'row', row, k, 'args', a.map(h).join(' '), '=>', txt);
        }
      }
    }
  }
  for (const [k, v] of typeHit) L('TYPEHIT', k, 'n', v[0], 'arg1<msgRows', v[1]);
  for (const [k, n] of kinds) L('TGKIND', k, n, (kindSamples.get(k) ?? []).join(' || '));
  expect(true).toBe(true);
}, 900000);
