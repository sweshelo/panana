// TEMPORARY: prints code.bin facts for the remaining unknown fields of RPG FREE! (#129). Removed before the PR.
import { beforeAll, describe, test } from 'bun:test';
import { disassemble, type Insn } from '../src/game/disasm';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiActionName, lanaiMonsterName } from '../src/lanai/monsterBook';
import { lanaiStatsOf } from '../src/lanai/monsterStats';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const BASE = 0x100000;
const log = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => v.toString(16);

describe.skipIf(!hasLanai)('explore', () => {
  let s: LanaiSession;
  let code: Uint8Array;
  let insns: Insn[];
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
  const callers = (t: number): number[] => insns.filter((x) => x.call && x.target === t).map((x) => x.addr);
  const funcStart = (a: number): number => {
    for (let p = a; p > a - 0x4000; p -= 4) {
      const t = at(p).text;
      if (/^push \{.*lr\}/.test(t) || /^stmdb sp!, \{.*lr\}/.test(t)) return p;
    }
    return a;
  };

  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump);
    code = dump.code;
    insns = [];
    for (let o = 0; o + 4 <= code.length; o += 4) insns.push(disassemble(u32(code, o), BASE + o));
    log('code size', h(code.length));
  }, 300000);

  test.skip('round 1', () => {
    // unit +0x00 test used by the conditions 0xA8-0xAC
    dis('FUN_0045CBAC', 0x45cbac, 24);
    for (const c of callers(0x45cbac).slice(0, 40)) log('caller 45cbac', h(c), 'fn', h(funcStart(c)));
    // +0x3C reader
    dis('FUN_002F4900', 0x2f4900, 90);
    for (const c of callers(0x2f4900).slice(0, 20)) { log('caller 2f4900', h(c), 'fn', h(funcStart(c))); dis('ctx 2f4900', c - 0x30, 20); }
    // MapData +0x00 bit0
    dis('FUN_0045A6B0', 0x45a6b0, 24);
    for (const c of callers(0x45a6b0).slice(0, 20)) { log('caller 45a6b0', h(c)); dis('ctx 45a6b0', c - 0x20, 16); }
    // monster fields
    dis('+0x90 bit3 @195A18', 0x195a18 - 0x40, 40);
    dis('+0x92 bit4 @171B04', 0x171b04 - 0x40, 40);
    dis('0x4B @173A48', 0x173a48 - 0x40, 48);
    dis('+0x86 @176FB8', 0x176fb8 - 0x30, 30);
    // MapData lookups: +0x16FC (MapData holder) and field object +0x546C (current MapData id)
    let n = 0;
    for (let i = 0; i < insns.length && n < 60; i++) {
      const t = insns[i]!.text;
      if (/#0x5400\b/.test(t) && /^add/.test(t)) {
        for (let k = 1; k <= 3; k++) if (/#0x6c\]/.test(insns[i + k]?.text ?? '')) { log('546c at', h(insns[i]!.addr), 'fn', h(funcStart(insns[i]!.addr))); n++; break; }
      }
    }
    n = 0;
    for (let i = 0; i < insns.length && n < 60; i++) {
      const x = insns[i]!;
      if (x.literal !== undefined && x.literal - BASE < code.length && word(x.literal) === 0x546c) { log('546c lit at', h(x.addr), 'fn', h(funcStart(x.addr))); n++; }
    }
    n = 0;
    for (let i = 0; i < insns.length && n < 60; i++) {
      const t = insns[i]!.text;
      if (/^add/.test(t) && /#0x1600\b/.test(t)) {
        for (let k = 1; k <= 4; k++) if (/#0xfc\]/.test(insns[i + k]?.text ?? '') || /#0xfc$/.test(insns[i + k]?.text ?? '')) { log('16fc at', h(insns[i]!.addr), 'fn', h(funcStart(insns[i]!.addr))); n++; break; }
      }
      const x = insns[i]!;
      if (x.literal !== undefined && x.literal - BASE < code.length && word(x.literal) === 0x16fc) { log('16fc lit at', h(x.addr), 'fn', h(funcStart(x.addr))); n++; }
    }
    dis('@44F0FC', 0x44f0fc - 0x60, 40);
  });
  // after `bl 31c038` with r0 = master + a + b (two adds), the reads of the row in the next instructions
  const holderReads = (tag: string, a: number, b: number, n = 10): void => {
    const re1 = new RegExp(`^add (\\w+), \\w+, #${'0x' + a.toString(16)}$`);
    let k = 0;
    for (let i = 0; i < insns.length - 8; i++) {
      const m = re1.exec(insns[i]!.text);
      if (!m) continue;
      let ok = false;
      for (let j = 1; j <= 3; j++) if (new RegExp(`^add \\w+, ${m[1]}, #${'0x' + b.toString(16)}$`).test(insns[i + j]?.text ?? '')) ok = true;
      if (!ok) continue;
      let c = -1;
      for (let j = 1; j <= 8; j++) if (insns[i + j]?.call && insns[i + j]!.target === 0x31c038) { c = i + j; break; }
      if (c < 0) continue;
      const after = insns.slice(c + 1, c + 1 + n).map((x) => x.text).filter((t) => /\[r0(, #[^\]]+)?\]/.test(t) || /, r0\b/.test(t)).slice(0, 4);
      log(`HOLD ${tag} ${h(insns[c]!.addr)} fn ${h(funcStart(insns[c]!.addr))} | ${after.join(' ; ')}`);
      if (++k > 120) break;
    }
  };

  test.skip('round 2', () => {
    dis('FUN_00301BA8', 0x301ba8, 16);
    dis('FUN_002F82B8', 0x2f82b8, 12);
    dis('ctx 45cbac @16d074', 0x16d074 - 0x40, 32);
    dis('ctx 45cbac @175068', 0x175068 - 0x40, 32);
    dis('0x4B rest', 0x173ac0, 40);
    dis('+0x90 loop', 0x195910, 50);
    dis('fn 1f538c', 0x1f538c, 72);
    dis('fn 21b37c', 0x21b37c, 72);
    for (const n of [0x197, 0x1a4, 0x1a5, 0x3c5]) log('ACTION', h(n), lanaiActionName(s, n), '/', lanaiActionName(s, (0x80000000 | n) >>> 0));
    holderReads('MapData', 0x1400, 0x2fc);
    holderReads('MapGroup', 0x1400, 0x374);
    // section 3 kind: ldrb #0x15 then cmp #0x64 close by
    let k = 0;
    for (let i = 0; i < insns.length - 12 && k < 40; i++) {
      if (!/^ldrb \w+, \[\w+, #0x15\]$/.test(insns[i]!.text)) continue;
      if (insns.slice(i + 1, i + 14).some((x) => /^cmp \w+, #0x64$/.test(x.text))) { log('SEC3KIND', h(insns[i]!.addr), 'fn', h(funcStart(insns[i]!.addr))); k++; }
    }
    // stride 0x4C (map table rows)
    k = 0;
    for (let i = 0; i < insns.length && k < 40; i++) {
      if (/^mov \w+, #0x4c$/.test(insns[i]!.text) && insns.slice(i + 1, i + 6).some((x) => /^(mla|mul)/.test(x.text))) { log('STRIDE4C', h(insns[i]!.addr), 'fn', h(funcStart(insns[i]!.addr))); k++; }
    }
    // monster data
    const p = s.need('MonsterParameter');
    const groups = new Map<string, string[]>();
    const add = (key: string, m: number): void => { const l = groups.get(key) ?? []; l.push(`${m}:${lanaiMonsterName(s, m)}`); groups.set(key, l); };
    for (let m = 1; m < p.rows; m++) {
      const ref = lanaiStatsOf(s, m);
      if (!ref) continue;
      const t = s.need(ref.table);
      const w0 = t.u32(ref.row, 0), w2 = t.u32(ref.row, 8);
      const b = (o: number): number => t.row(ref.row)[o]!;
      add(`w0b10-11=${(w0 >>> 10) & 3}`, m);
      if ((w2 >>> 22) & 1) add('w2b22', m);
      if (!(b(0x90) & 8)) add('90b3=0', m);
      if (b(0x92) & 0x10) add('92b4', m);
      if (b(0x74) & 1) add('74b0', m);
      add(`86=${b(0x86)}`, m);
      if (b(0x91) !== 100 || b(0x92) & 15) add(`91=${b(0x91)}/92lo=${b(0x92) & 15}`, m);
      if (b(0x93)) add(`93=${b(0x93)}`, m);
      if (b(0x9a) >> 6) add(`9a hi=${b(0x9a) >> 6}`, m);
      const f16 = p.u16(m, 0x16), f18 = p.row(m)[0x18]!;
      if (f16 & 8) add('p16b3', m);
      add(`p18=${h(f18)}`, m);
    }
    for (const [key, l] of [...groups].sort()) log(`MON ${key} (${l.length}) ${l.slice(0, 60).join(' ')}`);
  });
  test.skip('round 3', async () => {
    dis('FUN_002029AC', 0x2029ac, 170);
    for (const c of callers(0x2029ac).slice(0, 12)) log('caller 2029ac', h(c), 'fn', h(funcStart(c)));
    dis('MapData +6 @1dad58', 0x1dad58 - 0x40, 40);
    dis('MapData +0 bits1-4 @277d14', 0x277d14 - 0x40, 40);
    dis('MapData +C @2ffc10', 0x2ffc10 - 0x30, 36);
    dis('MapData +C @30470c', 0x30470c - 0x30, 36);
    dis('MapData +C @3e6718', 0x3e6718 - 0x10, 50);
    dis('FUN_002E3230', 0x2e3230, 40);
    dis('sec3 kind @21bbe0', 0x21bbe0 - 0x20, 70);
    dis('sec3 kind @21d7a8', 0x21d7a8 - 0x40, 70);
    for (const a of [0x11f474, 0x3b4b4c, 0x46a060]) dis('stride 4c', a - 0x30, 36);
    // the holder: names in sorted order (master + one content's tables)
    const names = new Set(s.tables.map((t) => t.table.name));
    const c38 = lanaiContents(s)[38]!;
    const ct = await s.tablesIn(c38.archive);
    for (const t of ct) names.add(t.table.name);
    const sorted = [...names].sort();
    const md = sorted.indexOf('MapData');
    log('HOLDER count', sorted.length, 'MapData at', md);
    for (const off of [0x2a8, 0x16a8, 0x1748, 0x1770, 0x179c - 4, 0x17c4 - 4, 0x730, 0x1310, 0x1358, 0x1428, 0x16f8]) log('HOLDER', h(off), sorted[md + (off - 0x16f8) / 0x28]);
    log('HOLDER list', sorted.map((n, i) => `${h(0x16f8 + (i - md) * 0x28)}=${n}`).join(' '));
    // MapData rows of every content
    const seen = new Map<string, number>();
    for (const c of lanaiContents(s)) {
      let tabs;
      try { tabs = await s.tablesIn(c.archive); } catch { continue; }
      const t = tabs.find((x) => x.table.name === 'MapData')?.table;
      if (!t) continue;
      for (let r = 0; r < t.rows; r++) {
        const b = [...t.row(r)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
        seen.set(b, (seen.get(b) ?? 0) + 1);
        if (c.index === 38 || r >= 5 && r <= 7) log('MAPDATA', `c${c.index} r${r} id=${h(t.rowIds[r] ?? 0)} ${b}`);
      }
    }
    log('MAPDATA unique', seen.size);
    for (const [b, n] of [...seen].sort((a, b) => b[1] - a[1]).slice(0, 80)) log('MAPDATA', n, b);
    const ad = s.need('ActionData');
    for (const r of [0x197, 0x1a3, 0x1a4, 0x1a5, 0x1a6, 0x3c5]) log('ACTROW', h(r), h(ad.rowId(r)), [...Array(8)].map((_, i) => h(ad.u32(r, i * 4))).join(' '), lanaiActionName(s, r));
  }, 600000);
  test('round 4', () => {
    dis('FUN_002F2004', 0x2f2004, 440);
    dis('FUN_0031E98C (+6)', 0x31e98c, 30);
    dis('FUN_001A0AC4 (+8)', 0x1a0ac4, 40);
    dis('FUN_00459228 (world map state)', 0x459228, 40);
    dis('FUN_0044E464 (+C)', 0x44e464, 30);
    dis('FUN_001325DC', 0x1325dc, 24);
    dis('fn 17109c head', 0x17109c, 60);
    dis('ctx 171944', 0x1718c0, 40);
    for (const c of callers(0x11f464).slice(0, 10)) dis('caller 11f464', c - 0x28, 18);
    // all MapData lookups: 14 instructions after the call
    for (let i = 0; i < insns.length - 20; i++) {
      if (insns[i]!.text !== 'add r0, r0, #0x2fc' || !/#0x1400$/.test(insns[i - 1]?.text ?? '')) continue;
      for (let j = 1; j <= 3; j++) if (insns[i + j]?.call && insns[i + j]!.target === 0x31c038) { dis('MAPDATA use', insns[i + j]!.addr, 14); break; }
    }
    const ad = s.need('ActionData');
    const t = s.table('MessageAction');
    if (t) log('MessageAction fields', t.fields.map((f) => f.name).join(','));
    for (const r of [0x197, 0x1a4, 0x1a5, 0x3c5]) {
      const id = ad.u32(r, 0x0c);
      const texts = (t?.fields ?? []).map((f) => `${f.name}=${s.insert('MessageAction', id, f.name) ?? ''}`).join(' | ');
      log('ACTMSG', h(r), h(id), texts);
    }
  });
});
