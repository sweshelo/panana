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
  0x310798: { name: 'セリフを出す (話者の指定はない。自動 ≠ 0 ならボタンを待たず s0 秒)', args: ['メッセージ ID', '書式の引数 1', '書式の引数 2', '自動'] },
  0x311250: { name: 'メッセージ関連', args: ['メッセージ ID'], guess: true },
  0x311280: { name: 'メッセージ関連', args: ['メッセージ ID'], guess: true },
  0x2d7404: { name: '床スイッチの判定 (毎フレーム)' },
  0x2d7548: { name: '床スイッチを踏んだとき (コルーチン)' },
  0x318e4c: { name: '床スイッチ (押されたまま) のクラスを作る' },
  0x318b34: { name: '床スイッチ (離れると戻る) のクラスを作る' },
  0x31b170: { name: '動作のクラスの基底を作る', args: ['this', '行'] },
  // ボス戦前のイベントの部品 (docs/kahara/cutscene.md §3)
  0x319a6c: { name: '主人公 (先頭) のオブジェクト' },
  0x31bb10: { name: 'パーティの人数' },
  0x303db0: { name: 'パーティの i 人目 (0 = 主人公)', args: ['i'] },
  0x31c948: { name: 'オブジェクトの位置 (f32 x 3) へのポインタ', args: ['ハンドル'] },
  0x31d710: { name: '値 0x91[n] を書く', args: ['n', '値'] },
  0x31ba8c: { name: 'アクターのハンドルを作る', args: ['ハンドル', 'オブジェクト'] },
  0x31b67c: { name: 'アクターのハンドルを壊す', args: ['ハンドル'] },
  0x3080e4: { name: '動かす (s0 = 秒、0 = 距離 x 0.002。待たない)', args: ['ハンドル', '&位置', '0', '0'] },
  0x308068: { name: '動き・向きが終わるまで待つ', args: ['ハンドル'] },
  0x319a7c: { name: '向きを変える (s0 = 角度 0 南 / π 北、s1 = 秒、[sp] = 1 近い回り)', args: ['ハンドル', '0', '0', '0'] },
  0x301c50: { name: '点の方を向く (s0 = 秒)', args: ['ハンドル', '&点'] },
  0x31b400: { name: '位置を即座に変える', args: ['ハンドル', '&位置'] },
  0x30150c: { name: 'パーティを隊列で並べる (向き 0 東 1 南 2 西 3 北)', args: ['&位置', '向き', '主人公も', '向きも'] },
  0x2f8eb0: { name: 'パーティを隊列で歩かせる (s0 = 秒)', args: ['&位置', '?', '向き', '主人公も'] },
  0x302740: { name: 'パーティを隊列で並べる', args: ['&位置', '向き', '1'], guess: true },
  0x30250c: { name: 'パーティ全員にアニメ (s0 = 速さ, s1 = 開始。操作も止める)', args: ['アニメ', 'くり返す', 'ばらつき', '浮くキャラは 0x26'] },
  0x30cca4: { name: 'アクターのアニメ (s0 = 速さ, s1 = 開始。主人公 0x1F = 話す、1 = 立ち、3 = 歩く)', args: ['ハンドル', 'アニメ', 'くり返す'] },
  0x30cbd8: { name: 'アニメが終わるまで待つ', args: ['ハンドル', 'アニメ'], guess: true },
  0x305f98: { name: '浮くキャラか', args: ['ハンドル'] },
  0x311878: { name: '顔の表情 (6 = 普通)', args: ['ハンドル', '表情'], guess: true },
  0x311880: { name: '顔の表情 (6 = 普通)', args: ['オブジェクト', '表情'], guess: true },
  0x301d80: { name: '頭をカメラへ向ける / 戻す (話者を示す)', args: ['ハンドル', '1 / 0'], guess: true },
  0x31c4bc: { name: '隠す / 出す (モデル)', args: ['ハンドル', '0 / 1'] },
  0x31c580: { name: '隠す / 出す', args: ['ハンドル', '0 / 1'] },
  0x3024c8: { name: '影を隠す / 出す', args: ['オブジェクト', '0 / 1'], guess: true },
  0x3024f8: { name: '操作の可否', args: ['0 = 止める / 1 = 戻す'] },
  0x31bc08: { name: '頭上のマーク (s0 = 秒)', args: ['ハンドル', '組', '番号', '出す'] },
  0x2e77d0: { name: '会話の相手が主人公を向く' },
  0x2e3298: { name: '会話のカメラ (寄る、待つ)' },
  0x2e3258: { name: '会話のカメラを戻す (待つ)' },
  0x31b1b4: { name: 'カメラを作る', args: ['カメラ', '0', '1'] },
  0x301764: { name: 'カメラを壊す', args: ['カメラ'] },
  0x3179b8: { name: 'カメラの制御を取る', args: ['カメラ'] },
  0x301888: { name: 'カメラを追従に戻す', args: ['カメラ'] },
  0x301f80: { name: 'カメラの今の視点を覚える', args: ['カメラ'] },
  0x317210: { name: 'カメラを動かす (s0 = 秒)', args: ['カメラ', '&視点', '&注視点', '3'] },
  0x3178e8: { name: 'カメラを即座に切り替える (話者を映す)', args: ['カメラ', '&視点', '&注視点', '&上'] },
  0x301e08: { name: 'カメラを寄せる (s0 = 距離)', args: ['カメラ', '2'], guess: true },
  0x301a44: { name: 'カメラを戻す (s0 = 秒)', args: ['カメラ', '2 / 3', '0'], guess: true },
  0x301d9c: { name: 'カメラが着くまで待つ', args: ['カメラ'] },
  0x2fc358: { name: 'カメラを揺らす (s0 = 強さ, s1 = 1 回の秒)', args: ['カメラ', '回数', '0'], guess: true },
  0x3174e8: { name: 'フェードの色', args: ['r', 'g', 'b', '2'] },
  0x300dbc: { name: 'フェードアウトして待つ (s0 = 秒)' },
  0x31745c: { name: 'フェードイン (s0 = 秒)', args: ['2'] },
  0x31747c: { name: 'フェードが終わるまで待つ' },
  0x3086e4: { name: '待つ (s0 = 秒)' },
  0x307d10: { name: '効果音を遅らせて鳴らす (s0 = 秒)', args: ['番号'] },
  0x300e4c: { name: 'イベント開始の共通処理 (主人公を止めてカメラを寄せ、話すアニメ)', args: ['this'] },
  0x300d3c: { name: 'イベント終了の共通処理 (操作とカメラを戻す)', args: ['this'] },
  0x317f68: { name: '範囲を止める (マップを読み直すまで)', args: ['行', '0'] },
  0x2fc790: { name: '決まった敵との戦闘', args: ['monsterFixGroup の行', 'BGM'] },
  0x319b00: { name: '新しいキャラのモデルを作る', args: ['ハンドル', 'デザイン'], guess: true },
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
