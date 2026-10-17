// Temporary ROM probe (#133: MapGroup +0x24 talk tables vs NPC action args). Not for merge.
import { expect, test } from 'bun:test';
import { findEntry } from '../src/archive/gsarc';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import type { LanaiTable } from '../src/lanai/table';
import { openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const L = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const TALK = [0x80000001, 0x80000002, 0x80000003, 0x80000037, 0x80000032, 0x8000002f, 0x80000025];

test.skipIf(!hasLanai)('explore133', async () => {
  const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
  const s = await LanaiSession.open(dump, { fresh: true });
  const stat = new Map<string, number>();
  const bump = (k: string): void => void stat.set(k, (stat.get(k) ?? 0) + 1);
  let miss = 0;
  const talkMaster = s.tables.filter((t) => t.table.rowSize === 12);
  L('MASTER12', talkMaster.map((t) => `${t.archive}:${t.table.name}x${t.table.rows}`).join(','));
  const groupsSeen = new Set<string>();
  for (const c of lanaiContents(s)) {
    let maps;
    try { maps = await lanaiMaps(s, c); } catch { continue; }
    const tables = (maps as unknown as { tables: { entry: number; table: LanaiTable }[] }).tables;
    const mgT = maps.contentTable('MapGroup');
    if (!mgT) continue;
    const msgs = tables.filter((t) => t.table.rowSize === 12 && /_msg/i.test(t.table.name));
    for (const m of maps.maps) {
      if (m.world) continue;
      const ev = maps.eventTable(m.dungeon);
      if (!ev) continue;
      const msgEntry = mgT.u32(m.dungeon, 0x24);
      const msg = tables.find((t) => t.entry === msgEntry)?.table;
      const gk = `${c.index}:${m.dungeon}`;
      if (!groupsSeen.has(gk)) {
        groupsSeen.add(gk);
        if (!msg && (c.index === 12 || c.index === 17)) L('TABLES', c.index, tables.map((t) => `${t.table.name}/${t.table.rowSize}x${t.table.rows}`).join(','));
        const inArc = msgEntry ? !!findEntry(maps.archive, msgEntry) : false;
        L('GROUP', gk, 'msgEntry', h(msgEntry), 'table', msg?.name ?? '-', msg?.rows ?? '-', 'inArchive', inArc, '+20', h(mgT.u32(m.dungeon, 0x20)), 'msgs', msgs.map((t) => `${t.table.name}@${h(t.entry)}x${t.table.rows}`).join(','));
      }
      for (const [k, recs] of Object.entries(maps.doc(m).recs)) for (const rec of recs ?? []) {
        if (rec.raw.length < 8) continue;
        const row = u32(rec.raw, 4);
        if (!row || row >= ev.rows) continue;
        for (const o of [0x10, 0x28, 0x40]) {
          const type = ev.u32(row, o);
          if (!TALK.includes(type)) continue;
          const a1 = ev.u32(row, o + 4);
          const tk = `sec${k}:${h(type)}`;
          if (!msg) bump(`${tk}:noTable`);
          else if (a1 < msg.rows) bump(`${tk}:inRows`);
          else if (msg.find(a1) >= 0) bump(`${tk}:rowId`);
          else bump(`${tk}:outside`);
          if (msg && a1 >= msg.rows && msg.find(a1) < 0 && miss++ < 25) {
            const other = msgs.filter((t) => a1 < t.table.rows).map((t) => t.table.name).join(',');
            L('MISS', c.index, m.name, gk, 'sec', k, 'row', row, h(type), 'a', [0, 1, 2, 3, 4].map((i) => h(ev.u32(row, o + 4 + i * 4))).join(' '), 'msg', msg.name, msg.rows, 'fits', other);
          }
          if (!msg && miss++ < 60) {
            const cand = [...talkMaster, ...tables.filter((t) => t.table.rowSize === 12)].filter((t) => a1 < t.table.rows).slice(0, 6)
              .map((t) => `${t.table.name}=${JSON.stringify(t.table.isString(a1, 0) ? s.plainAt(t.table, t.table.u32(a1, 0)).slice(0, 24) : '?')}`);
            L('NOTAB', c.index, m.name, gk, 'sec', k, h(type), 'a1', h(a1), 'cand', cand.join(' | '));
          }
        }
      }
    }
  }
  for (const [k, n] of [...stat].sort()) L('STAT', k, n);
  expect(true).toBe(true);
}, 900000);
