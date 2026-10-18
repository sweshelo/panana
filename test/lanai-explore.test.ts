// TEMPORARY: prints ROM facts about RPG FREE!'s shops (Shop / ShopItem, the 店の人 NPCs). Removed before the PR.
import { beforeAll, describe, test } from 'bun:test';
import { disassemble, type Insn } from '../src/game/disasm';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { lanaiItems } from '../src/lanai/items';
import { LANAI_EVENT_ACTIONS, LANAI_EVENT_SECTIONS, LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const BASE = 0x100000;
const log = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => (v >>> 0).toString(16);
const hexRow = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').replace(/(.{8})/g, '$1 ');

describe.skipIf(!hasLanai)('explore', () => {
  let s: LanaiSession;
  let code: Uint8Array;
  let insns: Insn[];
  let contents: LanaiContent[];
  const at = (a: number): Insn => insns[(a - BASE) >> 2]!;
  const word = (a: number): number => u32(code, a - BASE);
  const dis = (tag: string, a: number, n: number): void => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = at(a + i * 4);
      if (!x) break;
      out.push(`${h(x.addr)} ${x.text}${x.literal !== undefined ? ` ; =${h(word(x.literal))}` : ''}`);
    }
    log(`DIS ${tag} @${h(a)}\n` + out.join('\n'));
  };
  const funcStart = (a: number): number => {
    for (let p = a; p > a - 0x4000; p -= 4) {
      const t = at(p)?.text ?? '';
      if (/^push \{.*lr\}/.test(t) || /^stmdb sp!, \{.*lr\}/.test(t)) return p;
    }
    return a;
  };

  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
    code = dump.code;
    insns = [];
    for (let o = 0; o + 4 <= code.length; o += 4) insns.push(disassemble(u32(code, o), BASE + o));
    contents = lanaiContents(s);
  }, 300000);

  test('round 1', async () => {
    const items = new Map(lanaiItems(s).map((it) => [it.id, it.name]));
    for (const t of s.tables) if (/shop/i.test(t.table.name)) log('MASTER', t.archive, h(t.entry), t.table.name, t.table.rows, h(t.table.rowSize), t.table.fields.map((f) => `${f.name}@${h(f.offset)}`).join(','));
    for (const c of contents) {
      const tables = await s.tablesIn(c.archive);
      for (const ref of tables) {
        const t = ref.table;
        if (!/^Shop/.test(t.name)) continue;
        log('TBL', c.index, c.archive, h(ref.entry), t.name, 'rows', t.rows, 'size', h(t.rowSize), 'ids', t.rowIds.slice(0, 4).map(h).join(','), 'fields', t.fields.map((f) => `${f.name}@${h(f.offset)}`).join(','), 'extra', t.extra.length);
        for (let r = 0; r < Math.min(t.rows, 80); r++) {
          const row = t.row(r);
          const it = t.name === 'ShopItem' ? items.get(u32(row, 4)) ?? items.get(u32(row, 0)) ?? '' : '';
          log('ROW', c.index, t.name, r, h(t.rowId(r)), hexRow(row), it);
        }
      }
      let maps: LanaiMaps;
      try { maps = await LanaiMaps.load(s, c); } catch { continue; }
      for (let g = 0; g < maps.groups.length; g++) {
        const t = maps.eventTable(g);
        if (!t) continue;
        const talk = maps.talkTable(g);
        for (let r = 1; r < t.rows; r++) {
          for (const o of LANAI_EVENT_ACTIONS) {
            if (t.u32(r, o) !== 0x80000032) continue;
            const args = [0, 1, 2, 3, 4].map((i) => h(t.u32(r, o + 4 + i * 4)));
            let line = '';
            if (talk) { const k = talk.find(t.u32(r, o + 4)); if (k >= 0) { const f = talk.fields.find((x) => /msg|message/.test(x.name)); if (f) line = s.plain(talk, k, f.name).slice(0, 40); } }
            const users: string[] = [];
            for (const m of maps.maps) {
              if (m.world || m.dungeon !== g) continue;
              const doc = maps.doc(m);
              for (const k of LANAI_EVENT_SECTIONS) (doc.recs[k] ?? []).forEach((rec, i) => { if (u32(rec.raw, 4) === r) users.push(`${m.name}/${k}#${i}:${hexRow(rec.raw)}`); });
            }
            log('SHOPNPC', c.index, 'grp', g, 'row', r, 'act', h(o), 'args', args.join(','), 'row', hexRow(t.row(r)), 'line', JSON.stringify(line), 'users', users.join(' | '));
          }
        }
      }
    }
    // strings "Shop" in code.bin
    const txt = new TextDecoder('latin1').decode(code);
    for (const m of txt.matchAll(/[A-Za-z_]*[Ss]hop[A-Za-z_0-9]*/g)) {
      const addr = BASE + m.index!;
      const refs = insns.filter((x) => x.literal !== undefined && x.literal - BASE < code.length && word(x.literal) === addr).map((x) => `${h(x.addr)}(fn ${h(funcStart(x.addr))})`);
      log('STR', h(addr), m[0], refs.slice(0, 8).join(' '));
    }
    // literal 0x80000032 / cmp #0x32 near action dispatch
    let n = 0;
    for (const x of insns) if (x.literal !== undefined && x.literal - BASE < code.length && word(x.literal) === 0x80000032 && n++ < 30) log('LIT32', h(x.addr), 'fn', h(funcStart(x.addr)));
  }, 600000);
});
