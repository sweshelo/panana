// Codes and delivered rewards of 電波人間のRPG FREE! (naauao lanai/codes.md, lanai/checkin.md §5; reference implementation
// roms/tools/lanaicode.py). A code is 16 characters of CampaignCharacter (7BF7000A) = 80 bits = 10 bytes, scrambled
// with multiplications and bit reversals (FUN_001B53D4). After the unscrambling:
//   0..3 (u32 LE)  bits 0..9 = version part 2, bits 10..23 = part 3, byte 3 = check (first byte of SHA-256(bytes 5..9))
//   4              bits 0..1 = kind (0 CampaignCodeLocal row, 1 expired, 2 support code, 3 invalid), bits 2..7 = part 1
//   5..8 (u32 LE)  payload, 9 = one more byte
// CampaignCodeLocal (the rows a kind 0 code names) and the checkin tables of A9DF0000 share the row shape of checkin.md
// §5.1: a row kind, 4 conditions (u32 a, u32 b, u8 kind), the message, then the reward (kind, value, count, 3 more
// arguments) and a group (u16). CampaignCodeLocal has one more string before the message, so the rest is 4 bytes later.
import { hex8, u16, u32 } from '../util/bytes';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** The characters in the order of CampaignCharacter (row number = 5-bit value). */
export const CODE_ALPHABET = 'C341PV0BTXLJYKM8FDHRQ7GNAEW6U592';
export const CODE_LENGTH = 16;

/** Version of a code (major.minor.micro: 6, 10 and 14 bits). */
export type CodeVersion = [number, number, number];

/** The version of the last Update (v17408), as the service-end code A4J8Y13ML7TAWWE1 asks for it (推定). */
export const LANAI_VERSION: CodeVersion = [1, 17, 0];
export const VERSION_BITS: CodeVersion = [6, 10, 14];

export const CODE_KINDS = ['ROM の表のコード (CampaignCodeLocal)', '期限切れ', 'サポートのコード', '無効'] as const;

/** The archive of the checkin tables, and the code table (a language archive). */
export const CHECKIN_ARCHIVE = 'A9DF0000';
export const CODE_TABLE = 'CampaignCodeLocal';
export const CHECKIN_TABLES = ['Checkin_Rom', 'CheckinData', 'CheckinDeliVersion', 'CheckinEVCK18', 'CheckinEVCK19', 'CheckinJewelBuy', 'CheckinCheckinCount'] as const;

// ---- SHA-256 (synchronous; only the first byte of the hash of 5 bytes is needed, crypto.subtle is async) ----

const prime = (n: number): boolean => {
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};
const PRIMES = Array.from({ length: 312 }, (_, i) => i).filter((n) => n > 1 && prime(n)); // the first 64 primes
const frac32 = (x: number): number => ((x - Math.floor(x)) * 0x100000000) >>> 0;
const SHA_K = PRIMES.slice(0, 64).map((p) => frac32(Math.cbrt(p)));
const SHA_H = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));

export function sha256(data: Uint8Array): Uint8Array {
  const len = Math.ceil((data.length + 9) / 64) * 64;
  const m = new Uint8Array(len);
  m.set(data);
  m[data.length] = 0x80;
  const bits = data.length * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(len - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(len - 4, bits >>> 0);
  const h = SHA_H.slice();
  const w = new Uint32Array(64);
  const ror = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < len; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = (w[i - 16]! + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[i - 7]! + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i]! + w[i]!) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] = (h[i]! + v) >>> 0));
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

// ---- the scrambling ----

const rev32 = (x: number): number => {
  x = ((x >>> 1) & 0x55555555) | ((x & 0x55555555) << 1);
  x = ((x >>> 2) & 0x33333333) | ((x & 0x33333333) << 2);
  x = ((x >>> 4) & 0x0f0f0f0f) | ((x & 0x0f0f0f0f) << 4);
  x = ((x >>> 8) & 0x00ff00ff) | ((x & 0x00ff00ff) << 8);
  return ((x >>> 16) | (x << 16)) >>> 0;
};
const rev16 = (x: number): number => rev32(x) >>> 16;
/** The inverse of an odd number mod 2^32 (Newton's iteration). */
const inverse = (a: number): number => {
  let x = a;
  for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x));
  return x >>> 0;
};
const M32 = [0x43bd527f, 0x950c6d7f] as const;
const M16 = [0x9fa5, 0x302d] as const;
const I32 = [inverse(M32[1]), inverse(M32[0])] as const;
const I16 = [inverse(M16[1]) & 0xffff, inverse(M16[0]) & 0xffff] as const;
const mix32 = (x: number, [m, n]: readonly [number, number]): number => Math.imul(rev32(Math.imul(x, m)), n) >>> 0;
const mix16 = (x: number, [m, n]: readonly [number, number]): number => Math.imul(rev16(Math.imul(x, m) & 0xffff), n) & 0xffff;

const put32 = (b: Uint8Array, o: number, v: number): void => {
  for (let i = 0; i < 4; i++) b[o + i] = (v >>> (8 * i)) & 0xff;
};
const put16 = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = v >>> 8;
};

/** Undoes the scrambling in the game's order (+6 u32, +0 u32, +4 u32, +8 u16; +4 and +6 overlap). */
function descramble(b: Uint8Array): void {
  put32(b, 6, mix32(u32(b, 6), M32));
  put32(b, 0, mix32(u32(b, 0), M32));
  put32(b, 4, mix32(u32(b, 4), M32));
  put16(b, 8, mix16(u16(b, 8), M16));
}

function scramble(b: Uint8Array): void {
  put16(b, 8, mix16(u16(b, 8), I16));
  put32(b, 4, mix32(u32(b, 4), I32));
  put32(b, 0, mix32(u32(b, 0), I32));
  put32(b, 6, mix32(u32(b, 6), I32));
}

// ---- decode / encode ----

export interface DecodedCode {
  /** The 10 bytes after the unscrambling. */
  bytes: Uint8Array;
  /** Byte 3, and whether it is the first byte of SHA-256(bytes 5..9). */
  check: number;
  checkOk: boolean;
  kind: number;
  version: CodeVersion;
  payload: number;
  extra: number;
}

/** The code as the game reads it: lowercase turned into uppercase (spaces and hyphens are dropped for pasting). */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** Decodes a 16-character code; throws an Error with the reason (in Japanese) when it cannot be read. */
export function decodeCode(input: string): DecodedCode {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) throw new Error(`コードは ${CODE_LENGTH} 文字です (いまは ${code.length} 文字)`);
  const bad = [...code].filter((c) => !/[0-9A-Z]/.test(c));
  if (bad.length) throw new Error(`使えない文字があります: ${[...new Set(bad)].join(' ')} (ゲームでは「入力されたコードの中に使用できない文字が含まれています。」)`);
  const missing = [...code].filter((c) => !CODE_ALPHABET.includes(c));
  if (missing.length) throw new Error(`CampaignCharacter にない文字があります: ${[...new Set(missing)].join(' ')} (I・O・S・Z は使われません)`);
  const b = new Uint8Array(10);
  [...code].forEach((c, i) => {
    const v = CODE_ALPHABET.indexOf(c);
    for (let k = 0; k < 5; k++) if ((v >> (4 - k)) & 1) {
      const bit = i * 5 + k;
      b[bit >> 3] = b[bit >> 3]! | (0x80 >> (bit & 7));
    }
  });
  descramble(b);
  const w0 = u32(b, 0);
  return {
    bytes: b,
    check: b[3]!,
    checkOk: sha256(b.subarray(5, 10))[0] === b[3],
    kind: b[4]! & 3,
    version: [b[4]! >> 2, w0 & 0x3ff, (w0 >>> 10) & 0x3fff],
    payload: u32(b, 5),
    extra: b[9]!,
  };
}

/** The code of (kind, payload, extra, version); the check byte is put in. */
export function encodeCode(kind: number, payload: number, extra = 0, version: CodeVersion = LANAI_VERSION): string {
  const [major, minor, micro] = version;
  if (!VERSION_BITS.every((n, i) => Number.isInteger(version[i]) && version[i]! >= 0 && version[i]! < 1 << n))
    throw new Error('版の数が大きすぎます (1 番目 0〜63、2 番目 0〜1023、3 番目 0〜16383)');
  const b = new Uint8Array(10);
  put32(b, 5, payload >>> 0);
  b[9] = extra & 0xff;
  b[4] = (major << 2) | (kind & 3);
  put32(b, 0, (micro << 10) | minor);
  b[3] = sha256(b.subarray(5, 10))[0]!;
  scramble(b);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    let v = 0;
    for (let k = 0; k < 5; k++) {
      const bit = i * 5 + k;
      v = (v << 1) | ((b[bit >> 3]! >> (7 - (bit & 7))) & 1);
    }
    out += CODE_ALPHABET[v];
  }
  return out;
}

/** The code of a CampaignCodeLocal row (kind 0). */
export const rowCode = (row: number, version: CodeVersion = LANAI_VERSION): string => encodeCode(0, row, 0, version);

export const versionText = (v: CodeVersion): string => v.join('.');

/** The number the game compares: (1st × 1000 + 2nd) << 16 | 3rd. */
export const versionValue = ([a, b, c]: CodeVersion): number => (a * 1000 + b) * 0x10000 + c;

/** "1.17.0" -> [1, 17, 0], or undefined. */
export function parseVersion(s: string): CodeVersion | undefined {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(s);
  if (!m) return undefined;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])] as CodeVersion;
  return VERSION_BITS.every((n, i) => v[i]! < 1 << n) ? v : undefined;
}

/** A support code's 5 bytes (FUN_00217B4C): operation p[1] (1..12), arguments p[2], p[3], 16-bit value p[0] | p[4] << 8. */
export function supportFields(c: DecodedCode): { op: number; args: [number, number]; value: number } {
  const p = c.bytes.subarray(5, 10);
  return { op: p[1]!, args: [p[2]!, p[3]!], value: p[0]! | (p[4]! << 8) };
}

/** What the game does with a code typed in the normal code entry: accepted (and the CampaignCodeLocal row), or its message. */
export interface CodeVerdict {
  ok: boolean;
  /** The message the game shows, or what happens. */
  text: string;
  row?: number;
}

export function codeVerdict(c: DecodedCode, rows: number, software: CodeVersion = LANAI_VERSION): CodeVerdict {
  const wrong = 'コードが間違っています (「入力されたコードが間違っています。」)';
  if (!c.checkOk) return { ok: false, text: `チェックの値が合いません: ${wrong}` };
  if (versionValue(c.version) > versionValue(software))
    return { ok: false, text: `ソフトの版 ${versionText(software)} より新しいコードです (「ソフトのバージョンが古い為…」)` };
  switch (c.kind) {
    case 0:
      if (c.extra !== 0) return { ok: false, text: `バイト 9 が 0 ではありません: ${wrong}` };
      if (c.payload >= rows) return { ok: false, text: `行 ${c.payload} は ${CODE_TABLE} (${rows} 行) にありません: ${wrong}` };
      return { ok: true, text: `${CODE_TABLE} の行 ${c.payload} の報酬を受け取る (使用済みなら「このコードは既に使用されています。」)`, row: c.payload };
    case 1:
      return { ok: false, text: '期限切れのコード (「有効期限が切れています」)' };
    case 2: {
      const { op } = supportFields(c);
      return { ok: false, text: `サポート専用のコード。サポートのコード入力では${op >= 1 && op <= 12 ? `操作 ${op} を行う (中身は未解析)` : `操作 ${op} がないので「コードが間違っています」`}` };
    }
    default:
      return { ok: false, text: `種類 3: ${wrong}` };
  }
}

// ---- the reward rows (CampaignCodeLocal and the checkin tables) ----

export interface RewardCondition {
  a: number;
  b: number;
  kind: number;
}

export interface RewardRow {
  row: number;
  id: number;
  /** +0x00 (0x80000008 = notice header, 0x80000000 = reward only, …). */
  kind: number;
  conditions: RewardCondition[];
  message: string;
  /** CampaignCodeLocal only (+0x34): the message when the conditions do not match ('' when none). */
  failMessage?: string;
  /** The reward kind without 0x80000000. */
  reward: number;
  value: number;
  count: number;
  /** +0x44, +0x48, +0x4C of a 0x54-byte row. */
  args: [number, number, number];
  /** 0xFFFF = none. */
  group: number;
}

const CONDITIONS = [0x04, 0x10, 0x1c, 0x28];
const MESSAGE = 0x34;

/** The rows of a table of the checkin row shape. The message field is found by its name; the reward follows it. */
export function rewardRows(session: LanaiSession, t: LanaiTable): RewardRow[] {
  const msg = t.fields.find((f) => f.name === 'message')?.offset ?? MESSAGE;
  const at = msg + 4;
  const out: RewardRow[] = [];
  for (let r = 0; r < t.rows; r++) {
    const d = t.data, o = t.at(r, 0);
    const fail = msg > MESSAGE ? t.stringOffset(r, MESSAGE) : -2;
    out.push({
      row: r,
      id: t.rowId(r),
      kind: u32(d, o),
      conditions: CONDITIONS.map((c) => ({ a: u32(d, o + c), b: u32(d, o + c + 4), kind: d[o + c + 8]! })),
      message: session.plain(t, r, 'message'),
      ...(fail !== -2 && { failMessage: fail < 0 ? '' : session.plainAt(t, fail) }),
      reward: u32(d, o + at) & 0x7fffffff,
      value: u32(d, o + at + 4),
      count: u32(d, o + at + 8),
      args: [u32(d, o + at + 0xc), u32(d, o + at + 0x10), u32(d, o + at + 0x14)],
      group: u16(d, o + at + 0x18),
    });
  }
  return out;
}

export const ROW_KINDS: Record<number, string> = { 0x80000008: 'お知らせの見出し', 0x80000000: '報酬だけ' };

export const rowKindLabel = (k: number): string => ROW_KINDS[k] ?? `種類 ${(k & 0x7fffffff).toString(16).toUpperCase()} (未解析)`;

const WEEKDAYS = ['', '月', '火', '水', '木', '金', '土', '日'];

/** A condition in words, or null when it is empty (kind 0, a = b = 0). */
export function conditionLabel(c: RewardCondition): string | null {
  if (!c.kind && !c.a && !c.b) return null;
  const raw = `種類 0x${c.kind.toString(16).toUpperCase()}, a = ${c.a}, b = ${c.b}`;
  // 0x39: 3 = 水, 4 = 木, 5 = 金 (checkin.md §5.1); the others from the messages of Checkin_Rom (「本日、月曜日の…」)
  if (c.kind === 0x39 && WEEKDAYS[c.b]) return `${WEEKDAYS[c.b]}曜日 (${raw})`;
  if (c.kind === 0x3a) return `毎月 ${c.b} 日 (推定; ${raw})`;
  if (c.kind === 0x2a) return `ジュエルの購入 ${c.b} 個以上 (推定; ${raw})`;
  return `${raw} (未解析)`;
}

/** Reward kinds that do nothing (FUN_003023E0). */
export const NOOP_REWARDS = new Set([0x06, 0x0b, 0x1a, 0x1c, 0x1d, 0x1f, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2a, 0x2b, 0x2c]);

/** The switch the service-end code sets (FlagData key 0x51): checkin does not go online while it is on. */
export const OFFLINE_SWITCH = 0x2a4;

const hx = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** The reward of a row in words. */
export function rewardLabel(session: LanaiSession, r: RewardRow): string {
  const { value: v, count: n } = r;
  switch (r.reward) {
    case 0x00:
      return `ゴールド ${v} (値を量と推定)`;
    case 0x01:
      return `ジュエル ${v} 個`;
    case 0x02:
      return `アイテム「${session.insert('ItemData', v, 'name') ?? hex8(v)}」× ${n}`;
    case 0x03:
      return `表の行 ${hx(v)} × ${n} (表は未特定)`;
    case 0x08:
      return `スイッチ 0x51[${hx(v)}] = ${n ? 1 : 0}${v === OFFLINE_SWITCH ? ' (サービス終了モード: チェックインで通信しなくなる)' : ''}`;
    case 0x09:
      return `FlagData キー 0x52 [${hx(v)}] = ${n & 0xff}`;
    case 0x0a:
      return `FlagData キー 0x53 のビット [${hx(v)}] に書く (数 ${n})`;
    case 0x17:
      return `電波人間 ${hex8(v)} (推定)`;
    case 0x1b:
      return `期間つきのステージの公開 (推定): 値 ${hx(v & 0xffff)}, 数 ${n}, 引数 ${r.args[0]}, ${hx(r.args[1] + r.args[2] * 0x100000000)}`;
    default:
      if (NOOP_REWARDS.has(r.reward)) return `何もしない (種類 ${hx(r.reward)})`;
      return `種類 ${hx(r.reward)} (未解析): 値 ${hx(v)}, 数 ${n}${r.args.some(Boolean) ? `, 引数 ${r.args.map(hx).join(', ')}` : ''}`;
  }
}
