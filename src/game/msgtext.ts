// Message text (the UTF-16 units of one GMSG message; elpulse docs/analysis.md "GMSG"):
//   unit 0          type code, skipped by the game when it shows the message (FUN_00310438)
//   0x0000          end; 0x000A line break
//   0x0001 X        tag (2 units; X = 0x24 / 0x2A take 2 more units): ruby 0x27 ' / 0x28 ( / 0x29 ),
//                   0x10 page break (eats the next line break), others see tagKind
//   0x0002 0x0026 ID 0x0000   another message inserted (place names etc.)

export const hex4 = (c: number): string => c.toString(16).toUpperCase().padStart(4, '0');

/** A piece of a message. */
export type MessageToken =
  | { t: 'text'; s: string }
  | { t: 'br' }
  | { t: 'tag'; x: number; args: number[] }
  | { t: 'ruby'; base: string; reading: string }
  | { t: 'ref'; id: number }
  | { t: 'raw'; c: number };

const TAG = 0x0001;
const REF = 0x0002;

/** Tokens of the body (after the type code) up to the terminator, and where the terminator starts. */
export function parseBody(u: Uint16Array): { tokens: MessageToken[]; end: number } {
  const out: MessageToken[] = [];
  let i = 1;
  for (; i < u.length; i++) {
    const c = u[i]!;
    if (c === 0) break;
    if (c === 0x0a) out.push({ t: 'br' });
    else if (c === TAG && i + 1 < u.length) {
      const x = u[i + 1]!;
      const n = x === 0x24 || x === 0x2a ? 2 : 0;
      if (i + 1 + n >= u.length) {
        out.push({ t: 'raw', c });
        continue;
      }
      out.push({ t: 'tag', x, args: [...u.subarray(i + 2, i + 2 + n)] });
      i += 1 + n;
    } else if (c === REF && i + 3 < u.length && u[i + 1] === 0x26 && u[i + 3] === 0) {
      out.push({ t: 'ref', id: u[i + 2]! });
      i += 3;
    } else if (c < 0x20) out.push({ t: 'raw', c });
    else {
      const last = out[out.length - 1];
      if (last?.t === 'text') last.s += String.fromCharCode(c);
      else out.push({ t: 'text', s: String.fromCharCode(c) });
    }
  }
  return { tokens: groupRuby(out), end: i };
}

/** tag 0x27, text, tag 0x28, text, tag 0x29 -> ruby. */
function groupRuby(ts: MessageToken[]): MessageToken[] {
  const out: MessageToken[] = [];
  const isTag = (t: MessageToken | undefined, x: number): boolean => t?.t === 'tag' && t.x === x;
  for (let i = 0; i < ts.length; i++) {
    const [a, b, c, d, e] = ts.slice(i, i + 5);
    if (isTag(a, 0x27) && b?.t === 'text' && isTag(c, 0x28) && d?.t === 'text' && isTag(e, 0x29)) {
      out.push({ t: 'ruby', base: b.s, reading: d.s });
      i += 4;
    } else out.push(ts[i]!);
  }
  return out;
}

function tokenUnits(t: MessageToken): number[] {
  switch (t.t) {
    case 'text': return Array.from({ length: t.s.length }, (_, k) => t.s.charCodeAt(k));
    case 'br': return [0x0a];
    case 'tag': return [TAG, t.x, ...t.args];
    case 'ruby': return [TAG, 0x27, ...tokenUnits({ t: 'text', s: t.base }), TAG, 0x28, ...tokenUnits({ t: 'text', s: t.reading }), TAG, 0x29];
    case 'ref': return [REF, 0x26, t.id, 0];
    case 'raw': return [t.c];
  }
}

/** Type code, body tokens, and the units from the terminator on (kept as they are). */
export interface MessageText {
  kind: number;
  text: string;
  tail: Uint16Array;
}

/**
 * The text form the editors show and take back (lossless):
 *   line breaks as they are, {ruby:親字|よみ}, {page} (page break), {tag:XXXX} / {tag:XXXX,AAAA,BBBB} (other tags),
 *   {msg:XXXX} (another message), {XXXX} (any other unit, and the braces themselves).
 */
export function unitsToText(u: Uint16Array): MessageText {
  if (!u.length) return { kind: 0, text: '', tail: new Uint16Array() };
  const { tokens, end } = parseBody(u);
  const text = tokens.map((t) => {
    switch (t.t) {
      case 'text': return t.s.replace(/[{}|]/g, (ch) => `{${hex4(ch.charCodeAt(0))}}`);
      case 'br': return '\n';
      case 'tag': return t.x === 0x10 && !t.args.length ? '{page}' : `{tag:${[t.x, ...t.args].map(hex4).join(',')}}`;
      case 'ruby': return /[{}|]/.test(t.base + t.reading) ? tokenUnits(t).map((c) => (c < 0x20 ? `{${hex4(c)}}` : String.fromCharCode(c))).join('') : `{ruby:${t.base}|${t.reading}}`;
      case 'ref': return `{msg:${hex4(t.id)}}`;
      case 'raw': return `{${hex4(t.c)}}`;
    }
  }).join('');
  return { kind: u[0]!, text, tail: u.slice(end) };
}

/** Inverse of unitsToText. A message always ends with a 0x0000. */
export function textToUnits(m: MessageText): Uint16Array {
  const out: number[] = [m.kind];
  const s = m.text.replace(/\r\n?/g, '\n');
  const hex = (v: string, at: number): number => {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(v)) throw new Error(`「${v}」は 16 進 4 桁ではありません (${at} 文字目)`);
    return parseInt(v, 16);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x7b) {
      const close = s.indexOf('}', i);
      if (close < 0) throw new Error(`「{」を閉じる「}」がありません (${i + 1} 文字目)`);
      const body = s.slice(i + 1, close);
      const at = i + 1;
      const [name, arg] = body.includes(':') ? [body.slice(0, body.indexOf(':')), body.slice(body.indexOf(':') + 1)] : [body, ''];
      if (name === 'page' && !arg) out.push(TAG, 0x10);
      else if (name === 'ruby') {
        const [base, reading] = arg.split('|');
        if (!base || reading === undefined) throw new Error(`ルビは {ruby:親字|よみ} で書きます (${at} 文字目)`);
        out.push(...tokenUnits({ t: 'ruby', base, reading }));
      } else if (name === 'tag') {
        const vs = arg.split(',').map((v) => hex(v.trim(), at));
        const x = vs[0]!;
        const n = x === 0x24 || x === 0x2a ? 2 : 0;
        if (vs.length !== 1 + n) throw new Error(`タグ ${hex4(x)} は引数が ${n} 個です (${at} 文字目)`);
        out.push(TAG, ...vs);
      } else if (name === 'msg') out.push(REF, 0x26, hex(arg, at), 0);
      else if (!arg && /^[0-9A-Fa-f]{1,4}$/.test(name)) out.push(parseInt(name, 16));
      else throw new Error(`「{${body}}」は分かりません。{ruby:親字|よみ}、{page}、{tag:XXXX}、{msg:XXXX}、{XXXX} が使えます (${at} 文字目)`);
      i = close;
    } else if (c === 0x7d) throw new Error(`対応する「{」のない「}」があります (${i + 1} 文字目)`);
    else if (c === 0x7c) throw new Error(`「|」は {007C} と書いてください (${i + 1} 文字目)`);
    else out.push(c);
  }
  const tail = m.tail.length ? [...m.tail] : [0];
  return Uint16Array.from([...out, ...tail]);
}

/** What a tag does (elpulse docs/analysis.md "制御コード"). */
export type TagKind = 'page' | 'number' | 'name' | 'fixed' | 'voice' | 'emotion' | 'colour' | 'deco' | 'other';

export function tagKind(x: number): TagKind {
  if (x === 0x10) return 'page';
  if ((x >= 0x02 && x <= 0x16) || x === 0x100) return 'number';
  if (FIXED_NAMES[x]) return 'fixed';
  if (x >= 0x10d && x <= 0x10f) return 'voice';
  if (x >= 0x122 && x <= 0x124) return 'emotion';
  if (x >= 0x113 && x <= 0x11f) return 'colour';
  if (x === 0x112) return 'deco';
  if (NAME_TAGS[x] || (x >= 0x100 && x <= 0x121)) return 'name';
  return 'other';
}

/** Tags replaced by a name or a string at run time (FUN_0018ff64). */
export const NAME_TAGS: Record<number, string> = {
  0x0101: '電波人間',
  0x0102: '電波人間',
  0x0103: 'モンスター',
  0x0104: 'モンスター',
  0x0105: 'A〜Z',
  0x0106: 'アイテム',
  0x0107: 'ワザ',
  0x0120: '…',
  0x0121: '入力',
};

/** Tags replaced by a fixed name: the message it comes from (0x10A-0x10C = $heroine$ / $child01$ / $child02$). */
export const FIXED_NAMES: Record<number, number> = { 0x10a: 0x176a, 0x10b: 0x176b, 0x10c: 0x176c, 0x110: 0x1772, 0x111: 0x1773 };

const FIXED_ROLES: Record<number, string> = { 0x10a: 'ヒロイン', 0x10b: '子供1', 0x10c: '子供2' };

/** Voice tags: the sound of the text (FUN_00190660: 0x44 / 0x43 / 0x42). */
export const VOICE_TAGS: Record<number, string> = { 0x10d: 'č その他の口調', 0x10e: 'Ď 地底人の片言', 0x10f: 'ď です調' };

/** Short label of a tag for previews. */
export function tagLabel(x: number): string {
  switch (tagKind(x)) {
    case 'page': return 'ページ送り';
    case 'number': return '数値';
    case 'name': return NAME_TAGS[x] ?? `名前など ${hex4(x)}`;
    case 'fixed': return FIXED_ROLES[x] ?? `名前 ${hex4(x)}`;
    case 'voice': return `声: ${VOICE_TAGS[x]}`;
    case 'emotion': return `感情${x - 0x121}`;
    case 'colour': return x === 0x11f ? '色を戻す' : `文字色 ${x - 0x113 + 0x20}`;
    case 'deco': return '色つきの ●';
    default: return `タグ ${hex4(x)}`;
  }
}

/**
 * Plain text, as the older readers expected it: ruby as the base, names as their tag character (e.g. Ą for a
 * monster, Ē for the colour decoration), voice / colour / emotion / page tags and references dropped, line breaks as
 * spaces.
 */
export function plainText(u: Uint16Array): string {
  return parseBody(u).tokens.map((t) => {
    switch (t.t) {
      case 'text': return t.s;
      case 'br': return ' ';
      case 'ruby': return t.base;
      case 'tag': {
        const k = tagKind(t.x);
        return k === 'name' || k === 'fixed' || k === 'deco' || t.x === 0x100 ? String.fromCharCode(t.x) : '';
      }
      default: return '';
    }
  }).join('');
}

/** Text as a reader would see it (lists): references and fixed names expanded, names as 〈…〉, formatting dropped. */
export function previewText(u: Uint16Array, lookup: (id: number) => string | undefined, depth = 0): string {
  const tokens = parseBody(u).tokens;
  return tokens.map((t, i) => {
    switch (t.t) {
      case 'text': return t.s;
      case 'br': return tokens[i - 1]?.t === 'tag' && (tokens[i - 1] as { x: number }).x === 0x10 ? '' : '\n';
      case 'ruby': return t.base;
      case 'ref': return (depth < 2 ? lookup(t.id) : undefined) ?? `〈メッセージ ${hex4(t.id)}〉`;
      case 'tag': {
        const k = tagKind(t.x);
        if (k === 'fixed') return (depth < 2 ? lookup(FIXED_NAMES[t.x]!) : undefined) ?? `〈${tagLabel(t.x)}〉`;
        if (k === 'page') return '\n';
        return k === 'name' || k === 'number' ? `〈${tagLabel(t.x)}〉` : '';
      }
      default: return '';
    }
  }).join('');
}

/** Type codes (the first unit) seen in the data. */
export const MESSAGE_KINDS: Record<number, string> = {
  0x0001: '名前・台詞',
  0x000c: '説明',
  0x000d: '説明 (メニュー)',
};
