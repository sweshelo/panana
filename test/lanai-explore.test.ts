// TEMPORARY: prints code.bin facts for the remaining unknown fields of RPG FREE! (#129). Removed before the PR.
import { beforeAll, describe, test } from 'bun:test';
import { disassemble, type Insn } from '../src/game/disasm';
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

  test('round 1', () => {
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
});
