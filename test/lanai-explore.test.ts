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

  test.skip('round 1', async () => {
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

  test.skip('round 2', async () => {
    const items = new Map(lanaiItems(s).map((it) => [it.id, it.name]));
    log('ITEM 800001bf', items.get(0x800001bf));
    const mts = s.need('MessageTalkShop');
    for (let r = 0; r < mts.rows; r++) log('MTS', r, h(mts.rowId(r)), JSON.stringify(s.plain(mts, r, 'message').slice(0, 60)));
    for (const t of s.tables) if (t.table.name === 'ShopIsland' || t.table.name === 'JewelShopInfo') for (let r = 0; r < t.table.rows; r++) log('MROW', t.table.name, r, h(t.table.rowId(r)), hexRow(t.table.row(r)), t.table.name === 'ShopIsland' ? JSON.stringify(s.plain(t.table, r, 'flavor_msg').slice(0, 50)) : '');
    const stats = new Map<string, Map<string, number>>();
    const add = (k: string, v: string): void => { const m = stats.get(k) ?? new Map<string, number>(); m.set(v, (m.get(v) ?? 0) + 1); stats.set(k, m); };
    for (const c of contents) {
      for (const ref of await s.tablesIn(c.archive)) {
        const t = ref.table;
        if (t.name === 'ShopItem') for (let r = 0; r < t.rows; r++) {
          const head = t.u32(r, 0) === 0 && t.u32(r, 0x24) === 1 ? 'H' : 'I';
          for (const o of [4, 8, 0xc, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x28]) add(`SI${head}+${h(o)}`, h(t.u32(r, o)));
          for (const o of [0x24, 0x25, 0x26, 0x27, 0x14, 0x15, 0x16, 0x17]) add(`SI${head}b+${h(o)}`, h(t.u8(r, o)));
          add(`SI${head}u16+26`, String(t.u16(r, 0x26)));
        }
        if (t.name === 'Shop') for (let r = 0; r < t.rows; r++) for (const o of [0xc, 0x10, 0x14, 0x18, 0x19, 0x1a, 0x1b]) add(`SH+${h(o)}`, h(o >= 0x18 ? t.u8(r, o) : t.u32(r, o)));
      }
    }
    for (const [k, m] of [...stats].sort()) log('STAT', k, [...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([v, n]) => `${v}x${n}`).join(' '));
    for (const lit of [0xd5cef800, 0x67297400, 0x800001bf, 0xf01a6c00, 0x50beb000]) {
      const at2 = insns.filter((x) => x.literal !== undefined && x.literal - BASE < code.length && word(x.literal) === lit);
      log('LIT', h(lit), at2.length, at2.slice(0, 12).map((x) => `${h(x.addr)}(fn ${h(funcStart(x.addr))})`).join(' '));
      for (const x of at2.slice(0, 4)) dis(`lit ${h(lit)}`, funcStart(x.addr), Math.min(140, ((x.addr - funcStart(x.addr)) >> 2) + 40));
    }
  }, 600000);

  test('round 3', () => {
    dis('FUN_002E0690', 0x2e0690, 160);
    dis('@2E0834', 0x2e0800, 80);
    const hits: string[] = [];
    for (const x of insns) {
      if (x.addr < 0x180000 || x.addr > 0x480000) continue;
      if (/^cmp \w+, #0x32$/.test(x.text) || /#0x80000032/.test(x.text)) hits.push(`${h(x.addr)}(fn ${h(funcStart(x.addr))})`);
    }
    log('CMP32', hits.length, hits.slice(0, 200).join(' '));
    // jump tables: "addls pc, pc, rX, lsl #2" with a bound >= 0x32
    for (let i = 1; i < insns.length; i++) {
      const x = insns[i]!;
      if (!/^addls pc, pc, \w+, lsl #2$/.test(x.text)) continue;
      const m = /^cmp \w+, #(0x[0-9a-f]+|\d+)$/.exec(insns[i - 1]!.text);
      const n = m ? Number(m[1]) : 0;
      if (n >= 0x32 && n <= 0x60) { log('JT', h(x.addr), 'n', h(n), 'fn', h(funcStart(x.addr))); dis(`JT ${h(x.addr)} case32`, x.addr + 8 + 0x32 * 4, 2); const t = at(x.addr + 8 + 0x32 * 4); if (t?.target) dis(`case32 target`, t.target, 40); }
    }
  }, 600000);
});
