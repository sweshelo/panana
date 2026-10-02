// Code patches written by hand or by an AI: assembly in blocks that either overwrite code.bin in place or go into
// the code cave at the end of .text, assembled with game/asm.ts and exported in code.ips. docs/event-list.md §5.
//
//   ; comment
//   @0x2587A4            overwrite from this address (the instructions there are replaced one for one)
//     mov r0, #11
//   @cave open_two       new code in the code cave; `open_two` is its address
//     push {r4, lr}
//     ldr r0, =0x1C77    literal pool at the end of the block
//     bl FUN_00310798
//     pop {r4, pc}
//   @0x4FECAC            data: point a vtable entry at the new code
//     .word open_two
import { assembleLine, AsmError, literalValue } from './asm';
import { BASE } from './codeconst';
import { disassemble } from './disasm';
import { HOOK_ADDR } from './mappatch';
import { u32 } from '../util/bytes';

/**
 * Where a game's code.bin takes patches: the code cave (zero padding at the end of .text, filled from the top down)
 * and the end of what an @0x… block may overwrite (.text and .rodata).
 */
export interface CodeLayout {
  caveStart: number;
  caveEnd: number;
  /** End of the area only @cave may write ([caveStart, reservedEnd)); RPG2's new-map hook sits above the cave. */
  reservedEnd: number;
  writableEnd: number;
}

/** The code cave of RPG2 (elpulse mod/build_code.py), up to the new-map hook. */
export const CAVE_START = 0x4bf020;
export const CAVE_END = HOOK_ADDR;

/** RPG2 (v1.1.0). */
export const KAHARA_LAYOUT: CodeLayout = { caveStart: CAVE_START, caveEnd: CAVE_END, reservedEnd: 0x4c0000, writableEnd: 0x511000 };

export interface CodePatch {
  id: string;
  title: string;
  source: string;
  enabled: boolean;
  /** The event it was written for ("dungeon.row"), if any. */
  event?: string;
}

export interface PatchLine {
  /** 1-based line in the source. */
  line: number;
  addr: number;
  text: string;
  word: number;
  /** The word that was there before. */
  before: number;
}

export interface PatchBlock {
  kind: 'at' | 'cave';
  addr: number;
  label?: string;
  lines: PatchLine[];
}

export interface PatchError {
  line: number;
  message: string;
}

export interface BuiltPatch {
  blocks: PatchBlock[];
  errors: PatchError[];
  labels: Map<string, number>;
  /** Cave bytes used [start, end). */
  cave: [number, number] | null;
}

interface RawBlock {
  kind: 'at' | 'cave';
  addr: number;
  label?: string;
  line: number;
  items: { line: number; text: string; label?: string }[];
}

function parse(source: string, errors: PatchError[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let cur: RawBlock | null = null;
  let pendingLabel: string | undefined;
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    let text = raw.replace(/;.*$/, '').replace(/\/\/.*$/, '').trim();
    if (!text) return;
    const at = /^@\s*(0x[0-9a-f]+)$/i.exec(text);
    const cave = /^@\s*cave(?:\s+([A-Za-z_]\w*))?$/i.exec(text);
    if (at || cave) {
      cur = at ? { kind: 'at', addr: Number(at[1]), line, items: [] } : { kind: 'cave', addr: 0, label: cave![1], line, items: [] };
      blocks.push(cur);
      return;
    }
    const lab = /^([A-Za-z_]\w*):\s*(.*)$/.exec(text);
    if (lab) {
      pendingLabel = lab[1];
      text = lab[2]!.trim();
      if (!text) {
        if (cur) (cur as RawBlock).items.push({ line, text: '', label: pendingLabel });
        pendingLabel = undefined;
        return;
      }
    }
    if (!cur) {
      errors.push({ line, message: '最初に @0x… か @cave でブロックを始めてください' });
      return;
    }
    (cur as RawBlock).items.push({ line, text, label: pendingLabel });
    pendingLabel = undefined;
  });
  return blocks;
}

const isLiteral = (t: string): boolean => /,\s*=/.test(t) && /^v?ldr/i.test(t);

/** The top of the cave that is still free in `code` (the base MOD fills it from the bottom). */
export function caveFreeStart(code: Uint8Array, layout: CodeLayout = KAHARA_LAYOUT): number {
  const { caveStart, caveEnd } = layout;
  let last = caveStart;
  for (let a = caveStart; a < caveEnd && a - BASE + 4 <= code.length; a += 4) if (u32(code, a - BASE)) last = a + 4;
  return Math.min(caveEnd, (last + 0x1f) & ~0xf);
}

/**
 * Assemble patches in order against `code` (with the base MOD applied). Cave blocks are placed from the top of the
 * cave down, so they stay clear of the base MOD's routines.
 */
export function buildPatches(code: Uint8Array, patches: CodePatch[], layout: CodeLayout = KAHARA_LAYOUT): Map<string, BuiltPatch> {
  const out = new Map<string, BuiltPatch>();
  let top = layout.caveEnd;
  const floor = caveFreeStart(code, layout);
  const written = new Map<number, string>(); // address -> patch id
  for (const p of patches) {
    const errors: PatchError[] = [];
    const raws = parse(p.source, errors);
    const labels = new Map<string, number>();
    // pass 1: sizes and addresses
    const caveBlocks = raws.filter((b) => b.kind === 'cave');
    const sizeOf = (b: RawBlock): number => {
      const lits = new Set(b.items.filter((it) => it.text && isLiteral(it.text)).map((it) => it.text.split('=')[1]!.trim()));
      return (b.items.filter((it) => it.text).length + lits.size) * 4;
    };
    const caveSize = caveBlocks.reduce((n, b) => n + sizeOf(b), 0);
    let caveRange: [number, number] | null = null;
    if (caveSize) {
      const start = (top - caveSize) & ~3;
      if (start < floor) errors.push({ line: caveBlocks[0]!.line, message: `code cave が足りません (${caveSize} バイト要り、空きは ${Math.max(0, top - floor)} バイト)` });
      caveRange = [start, top];
      let a = start;
      for (const b of caveBlocks) {
        b.addr = a;
        a += sizeOf(b);
      }
      top = start;
    }
    for (const b of raws) {
      if (b.label) labels.set(b.label, b.addr);
      let a = b.addr;
      for (const it of b.items) {
        if (it.label) labels.set(it.label, a);
        if (it.text) a += 4;
      }
    }
    const resolve = (name: string): number | undefined => {
      const fn = /^FUN_([0-9a-f]{8})$/i.exec(name);
      if (fn) return parseInt(fn[1]!, 16);
      return labels.get(name);
    };
    // pass 2: assemble
    const blocks: PatchBlock[] = [];
    for (const b of raws) {
      const block: PatchBlock = { kind: b.kind, addr: b.addr, label: b.label, lines: [] };
      if (b.kind === 'at') {
        if (b.addr & 3) errors.push({ line: b.line, message: 'アドレスは 4 の倍数にしてください' });
        if (b.addr < BASE || b.addr >= layout.writableEnd) errors.push({ line: b.line, message: '.text / .rodata の外です' });
        if (b.addr >= layout.caveStart && b.addr < layout.reservedEnd) errors.push({ line: b.line, message: 'code cave には @cave で書いてください' });
      }
      const pool: { value: string; float: boolean; fix: PatchLine[] }[] = [];
      let a = b.addr;
      for (const it of b.items) {
        if (!it.text) continue;
        const before = a - BASE + 4 <= code.length ? u32(code, a - BASE) : 0;
        let text = it.text;
        let word = 0;
        try {
          if (/^\.float\s+/i.test(text)) word = literalValue(text.replace(/^\.float\s+/i, ''), true);
          else {
            const r = assembleLine(text, a, resolve);
            word = r.words[0]!;
            if (r.literal) {
              if (b.kind === 'at') throw new AsmError('ldr =値 は @cave のブロックでだけ使えます');
              const key = String(r.literal.value);
              let e = pool.find((x) => x.value === key && x.float === !!r.literal!.float);
              if (!e) pool.push((e = { value: key, float: !!r.literal.float, fix: [] }));
            }
          }
        } catch (e) {
          errors.push({ line: it.line, message: e instanceof Error ? e.message : String(e) });
        }
        const other = written.get(a);
        if (other && other !== p.id) errors.push({ line: it.line, message: `0x${a.toString(16).toUpperCase()} はほかのパッチも書き換えています` });
        written.set(a, p.id);
        const pl: PatchLine = { line: it.line, addr: a, text, word, before };
        if (isLiteral(text)) pool.find((x) => x.value === text.split('=')[1]!.trim())?.fix.push(pl);
        block.lines.push(pl);
        a += 4;
      }
      // literal pool: fix the pc-relative offsets
      for (const e of pool) {
        const at = a;
        let value = 0;
        try {
          value = literalValue(e.value, e.float, resolve);
        } catch (err) {
          errors.push({ line: e.fix[0]?.line ?? b.line, message: err instanceof Error ? err.message : String(err) });
        }
        for (const f of e.fix) {
          const off = at - (f.addr + 8);
          if (off < 0 || off > (e.float ? 1020 : 4095)) errors.push({ line: f.line, message: 'リテラルが遠すぎます' });
          f.word = e.float ? (f.word & ~0xff) | (off >> 2) | (1 << 23) : (f.word & ~0xfff) | off | (1 << 23);
          f.word >>>= 0;
        }
        block.lines.push({ line: e.fix[0]?.line ?? b.line, addr: at, text: `.word ${e.value}`, word: value, before: 0 });
        a += 4;
      }
      blocks.push(block);
    }
    out.set(p.id, { blocks, errors, labels, cave: caveRange });
  }
  return out;
}

/** IPS records (file offset, bytes) of built patches without errors. */
export function patchRecords(built: Iterable<BuiltPatch>): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [];
  for (const b of built) {
    if (b.errors.length) continue;
    for (const block of b.blocks) {
      if (!block.lines.length) continue;
      const bytes = new Uint8Array(block.lines.length * 4);
      const dv = new DataView(bytes.buffer);
      block.lines.forEach((l, i) => dv.setUint32(i * 4, l.word, true));
      out.push([block.addr - BASE, bytes]);
    }
  }
  return out;
}

/** code.bin with the records written. */
export function applyRecords(code: Uint8Array, records: [number, Uint8Array][]): Uint8Array {
  const out = code.slice();
  for (const [off, bytes] of records) out.set(bytes, off);
  return out;
}

/** "before -> after" disassembly of a block's lines. */
export function blockDiff(block: PatchBlock): { addr: number; before: string; after: string }[] {
  return block.lines.map((l) => ({
    addr: l.addr,
    before: block.kind === 'at' ? disassemble(l.before, l.addr).text : '',
    after: l.text.startsWith('.word') || l.text.startsWith('.float') ? `${l.text}  (0x${l.word.toString(16).toUpperCase()})` : disassemble(l.word, l.addr).text,
  }));
}

/** How to write a patch, for the AI. */
export const PATCH_FORMAT = `パッチの書式 (\`\`\`patch のコードブロックに書く):
- 「@0xアドレス」の行から、そのアドレスの命令を 1 命令ずつ上書きする。元の命令の数を超えて書くと、後ろの命令も上書きされる。
- 「@cave 名前」の行から、code cave (.text の末尾の空き) に新しいコードを置く。名前はそのコードの先頭のアドレスになる。
- 命令は ARM (A32、ARMv6K、ARM モード) の GNU / capstone 形式。movw / movt、Thumb、NEON は使えない。VFPv2 の vldr / vstr / vmov / vadd などは使える。
- 分岐先・呼び先は 0x… のアドレス、FUN_xxxxxxxx、ラベル (「名前:」) で書く。
- ldr rX, =値 (と vldr sN, =1.0) は @cave のブロックでだけ使える (リテラルはブロックの末尾に置かれる)。.word 値 / .word ラベル でデータを書ける。
- 関数を呼ぶ前後でレジスタの規約 (AAPCS) を守り、push / pop を対にする。呼ばれる関数が r0-r3, ip, lr を壊すことに注意。
- 元のコードに戻る必要があるときは、上書きで消した命令を cave の中で実行してから b で戻る。
- 1 つの変更は小さくし、何をするパッチかをコメント (; の後ろ) に書く。`;
