// TEMPORARY: prints facts about MapObject / MapChara / EventObject +0x5A for the map objects work (#120). Removed later.
import { beforeAll, describe, test } from 'bun:test';
import { findEntry, unpackEntry } from '../src/archive/gsarc';
import { parseBch, unwrapBch } from '../src/bch/bch';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import type { LanaiTable } from '../src/lanai/table';
import { openImages } from '../src/rom/dump';
import { hex8, u16, u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const log = (...a: unknown[]): void => console.log('EXPLORE', ...a);

function dumpTable(name: string, t: LanaiTable, rows: number[]): void {
  log(`${name}: ${t.rows} rows x ${hex8(t.rowSize)} ids=${t.rowIds.length ? hex8(t.rowIds[0]!) + '..' : 'none'} fields=${t.fields.map((f) => `${f.name}@${f.offset.toString(16)}`).join(',')}`);
  for (const r of rows) if (r < t.rows) log(`  ${name}[${r}] id=${t.rowIds[r] !== undefined ? hex8(t.rowIds[r]!) : '-'} ${hex(t.row(r))}`);
}

describe.skipIf(!hasLanai)('explore', () => {
  let s: LanaiSession;
  let all: LanaiMaps[];
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump);
    all = [];
    for (const c of lanaiContents(s)) {
      try {
        all.push(await LanaiMaps.load(s, c));
      } catch {}
    }
  }, 300000);

  test('explore', async () => {
    const mo = s.table('MapObject')!;
    dumpTable('MapObject', mo, [0, 1, 2, 53, 118, 119, 120, 200, 300, 400, 500, 600, 700, 734, 735, 778, 783]);
    // names of a few MapObject models
    const name = async (arcH: number, entry: number): Promise<string> => {
      try {
        const arc = await s.archive(hex8(arcH));
        const e = findEntry(arc, entry);
        if (!e) return `(no entry ${hex8(entry)} in ${hex8(arcH)})`;
        const body = unpackEntry(arc, e).body;
        const f = parseBch(unwrapBch(body));
        return `type=${e.type} model=${f.models[0]?.name ?? '-'} anims=${(f as unknown as { animations?: unknown[] }).animations?.length ?? '?'} size=${body.length}`;
      } catch (err) {
        return `(err ${(err as Error).message})`;
      }
    };
    let ok = 0, bad = 0;
    for (let r = 0; r < mo.rows; r++) {
      const a = mo.u32(r, 0), e = mo.u32(r, 4);
      if (!a || !e) continue;
      const n = await name(a, e);
      if (n.startsWith('(')) bad++;
      else ok++;
      if (r % 25 === 0 || [53, 734, 735].includes(r)) log(`MapObject ${r}: ${hex8(a)}/${hex8(e)} ${n} f10=${new DataView(mo.row(r).buffer, mo.row(r).byteOffset).getFloat32(0x10, true)} f20=${new DataView(mo.row(r).buffer, mo.row(r).byteOffset).getFloat32(0x20, true)}`);
    }
    log(`MapObject models ok=${ok} bad=${bad}`);
    // other tables with Chara / Npc in the name, in master and in content 38
    for (const n of ['MapChara', 'NpcChara', 'MapCharaModel', 'CharaModel', 'Npc', 'MapNpc']) {
      const t = s.table(n);
      if (t) dumpTable(`master ${n}`, t, [0, 1, 2, 3, 10, 50]);
    }
    const c38 = all.find((m) => m.content.index === 38)!;
    const tabs = await s.tablesIn(c38.content.archive);
    log('content 38 tables', tabs.map((t) => `${t.table.name}(${t.table.rows}x${t.table.rowSize.toString(16)})`).join(' '));
    const mc = tabs.find((t) => t.table.name === 'MapChara')?.table;
    if (mc) dumpTable('c38 MapChara', mc, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30]);
    // section 5 kinds and EO +0x5A / +0x5C, section 3 / 4 too
    const stats = new Map<string, Map<string, number>>();
    const bump = (k: string, v: string): void => {
      const m = stats.get(k) ?? new Map<string, number>();
      stats.set(k, m);
      m.set(v, (m.get(v) ?? 0) + 1);
    };
    const examples: string[] = [];
    for (const maps of all) {
      const ctabs = await s.tablesIn(maps.content.archive);
      const chara = ctabs.find((t) => t.table.name === 'MapChara')?.table;
      bump('MapChara rows', chara ? `${chara.rows}x${chara.rowSize.toString(16)}` : 'none');
      for (const info of maps.maps) {
        if (info.world) continue;
        const doc = maps.doc(info);
        const ev = maps.eventTable(info.dungeon);
        for (const k of [3, 4, 5, 8]) {
          for (const r of doc.recs[k] ?? []) {
            const row = u32(r.raw, 4);
            const kind = k === 3 ? r.raw[0x15]! : u32(r.raw, 0);
            if (!ev || row >= ev.rows) continue;
            const e = ev.row(row);
            const a = u16(e, 0x5a), b = u16(e, 0x5c);
            bump(`s${k} kind ${kind} 5A`, a === 0 ? '0' : chara && a < chara.rows ? (a < mo.rows ? 'chara&obj' : 'chara') : a < mo.rows ? 'obj' : 'big');
            bump(`s${k} kind ${kind} 5C`, `${b >> 15}/${b & 0x7fff}`);
            if (k === 5 && examples.length < 60 && a) examples.push(`${info.name} s5 kind ${kind} ev ${row} 5A=${a} 5C=${hex8(b)} 5E=${e[0x5e]} raw=${hex(r.raw)} chara=${chara && a < chara.rows ? hex(chara.row(a)) : '-'}`);
          }
        }
      }
    }
    for (const [k, m] of [...stats].sort()) log(k, [...m].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([v, n]) => `${v}:${n}`).join(' '));
    for (const e of examples) log(e);
  }, 600000);
});
