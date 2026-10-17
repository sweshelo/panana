// TEMPORARY: prints the checkin / network code of lanai's code.bin (disassembly, strings and their references) for the
// checkin investigation. Removed before the PR.
import { beforeAll, describe, test } from 'bun:test';
import { disassemble, type Insn } from '../src/game/disasm';
import { openImages } from '../src/rom/dump';
import { LanaiSession } from '../src/lanai/session';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';
import { SPEC } from './lanai-explore-spec';

const BASE = 0x100000;
const TEXT_END = 0x4bf01c;
const out: string[] = [];
const log = (s: string): void => {
  out.push(s);
};
const h = (v: number): string => '0x' + (v >>> 0).toString(16).toUpperCase();

let code: Uint8Array;
let session: LanaiSession;
const w = (a: number): number => u32(code, a - BASE);
const inCode = (a: number): boolean => a >= BASE && a < BASE + code.length - 4;
const isPush = (i: Insn): boolean => /^push(\s|\b)/.test(i.text) && /lr/.test(i.text) || /^stmdb sp!, .*lr/.test(i.text);

function str(a: number): string | undefined {
  if (!inCode(a)) return undefined;
  let s = '';
  for (let k = 0; k < 200; k++) {
    const c = code[a - BASE + k]!;
    if (c === 0) break;
    if (c < 0x20 || c > 0x7e) return undefined;
    s += String.fromCharCode(c);
  }
  if (s.length >= 3) return s;
  // UTF-16LE
  let t = '';
  for (let k = 0; k < 120; k++) {
    const c = code[a - BASE + 2 * k]! | (code[a - BASE + 2 * k + 1]! << 8);
    if (c === 0) break;
    if (c < 0x20) return undefined;
    t += String.fromCharCode(c);
  }
  return t.length >= 2 && /[　-鿿＀-￯]/.test(t) ? 'u"' + t + '"' : undefined;
}

function annotate(v: number): string {
  const s = str(v);
  if (s !== undefined) return ` ; "${s.slice(0, 120)}"`;
  return '';
}

/** Start of the function holding addr: the nearest push {.., lr} at or before it. */
function funcStart(a: number): number {
  for (let p = a & ~3; p > a - 0x4000 && p >= BASE; p -= 4) if (isPush(disassemble(w(p), p))) return p;
  return -1;
}

let lastPools = new Set<number>();
function dumpFunc(start: number, max = 900, linear = false): void {
  log(`== FUN_${h(start).slice(2).padStart(8, '0')}`);
  const pools = new Set<number>();
  let returned = false;
  for (let k = 0, a = start; k < max && a < TEXT_END; k++, a += 4) {
    if (pools.has(a)) {
      const v = w(a);
      log(`  ${h(a)}: .word ${h(v)}${annotate(v)}`);
      continue;
    }
    const i = disassemble(w(a), a);
    if (!linear && k > 0 && returned && isPush(i)) break;
    if (i.text === 'nop') continue;
    let note = '';
    if (i.literal !== undefined) {
      pools.add(i.literal);
      const v = w(i.literal);
      note = ` ; =${h(v)}${annotate(v)}`;
    }
    log(`  ${h(a)}: ${i.text}${note}`);
    if (/^(pop|ldm\w* sp!).*pc/.test(i.text) || i.text === 'bx lr') returned = true;
    // a return followed by a branch target later in the function: keep going while pools / targets stay ahead
  }
  lastPools = pools;
}

describe.skipIf(!hasLanai)('explore checkin', () => {
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    code = dump.code;
    session = await LanaiSession.open(dump);
  }, 300000);

  test('explore', async () => {
    log(`code.bin ${h(code.length)}`);
    // strings
    if (SPEC.strings.length) {
      const n = code.length;
      const words = new Map<number, number[]>(); // value -> addresses of words holding it (text range)
      for (let o = 0; o + 4 <= TEXT_END - BASE; o += 4) {
        const v = u32(code, o);
        if (v >= BASE && v < BASE + n) {
          let l = words.get(v);
          if (!l) words.set(v, (l = []));
          if (l.length < 40) l.push(o + BASE);
        }
      }
      for (const key of SPEC.strings) {
        const enc = new TextEncoder().encode(key);
        const u16 = new Uint8Array(key.length * 2);
        for (let k = 0; k < key.length; k++) {
          u16[2 * k] = key.charCodeAt(k) & 0xff;
          u16[2 * k + 1] = key.charCodeAt(k) >> 8;
        }
        let hits = 0;
        for (const pat of [enc, u16]) {
          for (let o = 0; o + pat.length <= n && hits < 40; o++) {
            let ok = true;
            for (let k = 0; k < pat.length; k++) if (code[o + k] !== pat[k]) { ok = false; break; }
            if (!ok) continue;
            hits++;
            // the start of the string: back to a NUL
            let s = o;
            if (pat === enc) while (s > 0 && code[s - 1]! >= 0x20 && code[s - 1]! < 0x7f && o - s < 200) s--;
            else while (s > 1 && (code[s - 2]! | (code[s - 1]! << 8)) >= 0x20 && o - s < 300) s -= 2;
            const a = s + BASE;
            const refs = (words.get(a) ?? []).map((r) => `${h(r)}@${h(funcStart(r))}`);
            log(`STR "${key}" ${h(a)}${annotate(a)} refs=${refs.join(' ') || '-'}`);
            o += pat.length - 1;
          }
        }
        if (!hits) log(`STR "${key}" none`);
      }
    }
    // callers
    for (const t of SPEC.callers) {
      const sites: string[] = [];
      for (let a = BASE; a < TEXT_END; a += 4) {
        const v = w(a);
        if ((v & 0x0f000000) === 0x0b000000 && v >>> 28 !== 0xf) {
          const i = disassemble(v, a);
          if (i.target === t) sites.push(`${h(a)}@${h(funcStart(a))}`);
        }
      }
      log(`CALLERS ${h(t)} (${sites.length}): ${sites.slice(0, 60).join(' ')}`);
    }
    for (const [a, len] of SPEC.hex) {
      for (let o = 0; o < len; o += 16) {
        const b = [...code.subarray(a - BASE + o, a - BASE + Math.min(len, o + 16))];
        log(`HEX ${h(a + o)}: ${b.map((x) => x.toString(16).padStart(2, '0')).join(' ')}  ${b.map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('')}`);
      }
    }
    // words in .text that hold a value in [lo, hi) (pointers into a data block)
    for (const [lo, hi] of SPEC.refsTo) {
      const sites: string[] = [];
      for (let a = BASE; a < TEXT_END; a += 4) {
        const v = w(a);
        if (v >= lo && v < hi) sites.push(`${h(a)}=${h(v)}@${h(funcStart(a))}`);
      }
      log(`REFS ${h(lo)}..${h(hi)} (${sites.length}): ${sites.slice(0, 80).join(' ')}`);
    }
    for (const arc of SPEC.archives) {
      const ts = await session.tablesIn(arc).catch(() => []);
      if (SPEC.onlyEntries) { for (const t of ts) if (!SPEC.entries.includes(t.entry >>> 0)) (t as { skip?: boolean }).skip = true; }
      for (const t of ts) {
        if ((t as { skip?: boolean }).skip) continue;
        const sites: string[] = [];
        for (let a = BASE; a < TEXT_END; a += 4) if (w(a) === t.entry) sites.push(`${h(a)}@${h(funcStart(a))}`);
        log(`TABLE ${arc} #${t.index} ${h(t.entry)} ${t.file ?? '-'} name=${t.table.name} ${t.table.rows}x${h(t.table.rowSize)} refs=${sites.slice(0, 12).join(' ') || '-'}`);
        if (SPEC.rowsOf.includes(t.table.name) || SPEC.entries.includes(t.entry >>> 0)) {
          const d = t.table.data;
          const sl = u32(d, 0x0c);
          log(`  STRS ${[...d.subarray(0x40, 0x40 + Math.min(sl, 1200))].map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : x ? '~' : '|')).join('')}`);
          log(`  IDS ${t.table.rowIds.map((x) => h(x)).join(' ')}`);
          for (let r = 0; r < Math.min(t.table.rows, 6); r++) log(`  ROW ${r}: ${[...t.table.row(r)].map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);
        }
      }
    }
    for (const f of SPEC.funcs) dumpFunc(f, SPEC.max);
    for (const [a, b] of SPEC.ranges) dumpFunc(a, (b - a) / 4, true);
    void lastPools;
    // one line per console.log is slow in CI logs; print in blocks
    for (let k = 0; k < out.length; k += 200) console.log(out.slice(k, k + 200).map((l) => 'EXPLORE ' + l).join('\n'));
  });
});
