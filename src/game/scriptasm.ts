// The code of an event script as annotated assembly: the functions of its class (game/scripts.ts) and the ones they
// call, disassembled (game/disasm.ts), with what is known next to each line: names of known functions and the
// constant arguments they get, message text for message IDs, rows it completes, labels for jumps.
// Meant to be read by a person or handed to an AI to explain or patch. docs/event-list.md §5.
import { BASE } from './codeconst';
import { disassemble, type Insn } from './disasm';
import { CodeIndex, type ScriptClass } from './scripts';
import { u32 } from '../util/bytes';

export interface KnownFunction {
  name: string;
  /** Argument names (r0..r3). */
  args?: string[];
  guess?: boolean;
}

/** Functions whose meaning is known (docs/events.md, docs/event-list.md). */
export const KNOWN_FUNCTIONS: Record<number, KnownFunction> = {
  0x31aa2c: { name: '行を完了する', args: ['行'] },
  0x31b0d8: { name: '行の状態を書く', args: ['行', '値'] },
  0x31b10c: { name: '行の状態を読む', args: ['行'] },
  0x3048f8: { name: '行の状態を書く (ダンジョン指定)', args: ['ダンジョン', '行', '値'] },
  0x31bff4: { name: '行の状態を読む (ダンジョン指定)', args: ['ダンジョン', '行'] },
  0x31bac4: { name: '進行 0x8D[n-1] を読む', args: ['n'] },
  0x31d774: { name: '値 0x91[i] を読む', args: ['i'] },
  0x319744: { name: 'フラグ 0x92[i] を読む', args: ['i'] },
  0x31c3d8: { name: 'ダンジョン d のフラグ i を読む', args: ['d', 'i'] },
  0x319b68: { name: 'このダンジョンのフラグ i を読む', args: ['i'] },
  0x2df540: { name: 'このダンジョンの値 i を読む', args: ['i'] },
  0x304adc: { name: 'セーブ変数を読む', args: ['セーブ', 'キー', '添字', '&出力'] },
  0x3129bc: { name: 'セーブ変数を書く', args: ['セーブ', 'キー', '添字', '値'], guess: true },
  0x30b788: { name: '今のダンジョン (0x4F) を読む' },
  0x30b8a4: { name: '出現条件を判定する', args: ['行', '種類', '値'] },
  0x33d690: { name: 'new (確保)', args: ['大きさ'] },
  0x31c970: { name: '行のオブジェクトを得る', args: ['行'] },
  0x31c958: { name: 'オブジェクトのハンドルを作る', args: ['ハンドル', 'オブジェクト'] },
  0x31c834: { name: 'アニメを再生する (s0 = 速さ, s1 = 開始位置)', args: ['ハンドル', 'アニメ'] },
  0x31c89c: { name: 'ハンドルを解放する', args: ['ハンドル'] },
  0x317524: { name: '効果音を鳴らす', args: ['番号'] },
  0x310798: { name: 'メッセージを出す', args: ['メッセージ ID'], guess: true },
  0x311250: { name: 'メッセージ関連', args: ['メッセージ ID'], guess: true },
  0x311280: { name: 'メッセージ関連', args: ['メッセージ ID'], guess: true },
  0x2d7404: { name: '床スイッチの判定 (毎フレーム)' },
  0x2d7548: { name: '床スイッチを踏んだとき (コルーチン)' },
  0x318e4c: { name: '床スイッチ (押されたまま) のクラスを作る' },
  0x318b34: { name: '床スイッチ (離れると戻る) のクラスを作る' },
  0x31b170: { name: '動作のクラスの基底を作る', args: ['this', '行'] },
};

export interface AsmLine {
  insn: Insn;
  label?: string;
  note?: string;
}

export interface AsmFunction {
  addr: number;
  /** Why it is listed: a vtable entry, a registered callback, or a callee. */
  role: string;
  callers: number;
  lines: AsmLine[];
}

const hex = (v: number): string => `0x${v.toString(16).toUpperCase()}`;
export const fnLabel = (a: number): string => `FUN_${a.toString(16).toUpperCase().padStart(8, '0')}`;

export interface AsmContext {
  code: Uint8Array;
  /** Message text by ID (one line). */
  message: (id: number) => string | undefined;
}

/** Disassemble one function with notes. */
export function annotateFunction(ctx: AsmContext, index: CodeIndex, addr: number): AsmLine[] {
  const { code } = ctx;
  const end = index.end(addr);
  const insns: Insn[] = [];
  for (let a = addr; a < end && a - BASE + 4 <= code.length; a += 4) insns.push(disassemble(u32(code, a - BASE), a));
  // literal-pool words: loaded by ldr [pc] inside this function
  const pool = new Set<number>();
  for (const i of insns) if (i.literal !== undefined && i.literal >= addr && i.literal < end) pool.add(i.literal);
  const targets = new Set<number>();
  for (const i of insns) if (i.target !== undefined && !i.call && i.target >= addr && i.target < end) targets.add(i.target);

  const lines: AsmLine[] = [];
  // constants known in r0-r3 (reset at jump targets and after calls)
  let regs: (number | undefined)[] = [];
  for (const insn of insns) {
    const a = insn.addr;
    if (targets.has(a)) regs = [];
    if (pool.has(a)) {
      lines.push({ insn: { ...insn, text: `.word ${hex(insn.word)}` }, note: describeValue(ctx, insn.word) });
      continue;
    }
    const line: AsmLine = { insn, label: targets.has(a) ? `L_${a.toString(16).toUpperCase()}` : undefined };
    const notes: string[] = [];
    const m = /^(mov|mvn)\s+r([0-3]), #(0x[0-9a-f]+|\d+)$/.exec(insn.text);
    const ld = /^ldr\s+r([0-3]), \[pc/.exec(insn.text);
    if (m) {
      const v = Number(m[3]);
      regs[Number(m[2])] = m[1] === 'mov' ? v : ~v >>> 0;
    } else if (ld && insn.literal !== undefined) {
      const v = u32(code, insn.literal - BASE);
      regs[Number(ld[1])] = v;
      const d = describeValue(ctx, v);
      notes.push(`= ${hex(v)}${d ? ` ${d}` : ''}`);
    } else {
      // any other write to r0-r3 forgets it
      const w = /^\w+\s+r([0-3])\b/.exec(insn.text);
      if (w && !/^(cmp|cmn|tst|teq|str|push|b)/.test(insn.text)) regs[Number(w[1])] = undefined;
    }
    if (insn.target !== undefined && insn.call) {
      const k = KNOWN_FUNCTIONS[insn.target];
      if (k) {
        const args = (k.args ?? []).map((n, j) => (regs[j] === undefined ? null : `${n}=${n === '行' ? regs[j] : fmtArg(ctx, regs[j]!)}`)).filter(Boolean);
        notes.push(`${k.name}${k.guess ? ' (推定)' : ''}${args.length ? ` (${args.join(', ')})` : ''}`);
      } else notes.push(fnLabel(insn.target));
      regs = [];
    } else if (insn.target !== undefined && targets.has(insn.target)) {
      line.insn = { ...insn, text: insn.text.replace(/#0x[0-9a-f]+$/, `L_${insn.target.toString(16).toUpperCase()}`) };
    } else if (insn.target !== undefined) {
      const k = KNOWN_FUNCTIONS[insn.target];
      notes.push(`末尾呼び出し ${k ? k.name : fnLabel(insn.target)}`);
    }
    if (notes.length) line.note = notes.join(' / ');
    lines.push(line);
  }
  return lines;
}

function fmtArg(ctx: AsmContext, v: number): string {
  if (v >= 0x1bdf && v <= 0x21af) {
    const t = ctx.message(v);
    return t ? `${hex(v)}「${clip(t)}」` : hex(v);
  }
  return v < 10 ? String(v) : hex(v);
}

const clip = (t: string, n = 40): string => (t.length > n ? t.slice(0, n) + '…' : t);

/** What a 32-bit constant probably is. */
export function describeValue(ctx: AsmContext, v: number): string | undefined {
  if (v >= 0x1bdf && v <= 0x21af) {
    const t = ctx.message(v);
    return t !== undefined ? `メッセージ「${clip(t)}」` : undefined;
  }
  if (v >= BASE && v < BASE + 0x3bf01c) return KNOWN_FUNCTIONS[v]?.name ?? fnLabel(v);
  if (v >= 0x4c0000 && v < 0x511000) return '.rodata (vtable など)';
  if (v >= 0x511000 && v < 0x600000) return '.data / .bss';
  return undefined;
}

/**
 * The functions of a script class in the order a reader wants them: its own vtable entries and callbacks, then
 * the callees reached from them (the same walk as ScriptClass.messages), each with its annotated lines.
 */
export function scriptListing(ctx: AsmContext, index: CodeIndex, cls: ScriptClass, maxFunctions = 60): AsmFunction[] {
  const vt = new Map<number, number>();
  for (let k = 0; k < 8; k++) vt.set(u32(ctx.code, cls.vtable - BASE + k * 4), k);
  const order: { addr: number; role: string }[] = cls.roots.map((r) => ({ addr: r, role: vt.has(r) ? `vtable[${vt.get(r)}]${vt.get(r) === 1 ? ' 後始末' : vt.get(r) === 2 ? ' 毎フレーム' : ''}` : 'コールバック' }));
  const { functions } = index.reach(cls.roots);
  const seen = new Set(order.map((o) => o.addr));
  // callees in call order (breadth first from the roots)
  const queue = [...cls.roots];
  const reach = new Set(functions);
  while (queue.length && order.length < maxFunctions) {
    const f = queue.shift()!;
    for (const t of index.scan(f).calls)
      if (reach.has(t) && !seen.has(t)) {
        seen.add(t);
        order.push({ addr: t, role: `${fnLabel(f)} から呼ばれる` });
        queue.push(t);
      }
  }
  return order.slice(0, maxFunctions).map(({ addr, role }) => ({ addr, role, callers: index.fanin.get(addr) ?? 0, lines: annotateFunction(ctx, index, addr) }));
}

/** Plain text of a listing (for copying to an AI or a file). */
export function listingText(fns: AsmFunction[]): string {
  const out: string[] = [];
  for (const f of fns) {
    out.push(`; ---- ${fnLabel(f.addr)} (${f.role}、呼び出し元 ${f.callers} か所)`);
    for (const l of f.lines) {
      if (l.label) out.push(`${l.label}:`);
      const body = `  ${l.insn.addr.toString(16).toUpperCase().padStart(8, '0')}  ${l.insn.text}`;
      out.push(l.note ? `${body.padEnd(52)} ; ${l.note}` : body);
    }
    out.push('');
  }
  return out.join('\n');
}
