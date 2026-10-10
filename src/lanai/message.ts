// Messages of 電波人間のRPG FREE! (naauao lanai/analysis.md §2.2): UTF-16LE strings in the pools of the tables. A tag is
// 0x0001, code, number of arguments n, then n arguments (u16 type + value; type 2 = u32, type 3 = u16 length in units
// + ASCII padded with NULs). The string ends at a 0x0000 outside a tag.
//   0x38 / 0x39 / 0x3A  ruby: base, reading, end
//   0x37 (table, row ID, field)  the string of another table inserted (e.g. ItemData, 0x800000C7, name)
//   0x22  page break (assumed)
//   0x02..0x24 (variable name), 0x100..0x13D  numbers, names and button marks put in at run time
import { u16, u32 } from '../util/bytes';

export type LanaiArg = number | string;

export type LanaiToken =
  | { t: 'text'; s: string }
  | { t: 'br' }
  | { t: 'tag'; code: number; args: LanaiArg[] }
  | { t: 'ruby'; base: string; reading: string }
  | { t: 'ins'; table: string; id: number; field: string };

export const TAG_RUBY = [0x38, 0x39, 0x3a] as const;
export const TAG_INSERT = 0x37;
export const TAG_PAGE = 0x22;

/** The tokens of the string at `o` of `b`, and the offset just after its terminator. */
export function parseLanaiMessage(b: Uint8Array, o: number): { tokens: LanaiToken[]; end: number } {
  const raw: LanaiToken[] = [];
  const text = (s: string): void => {
    const last = raw[raw.length - 1];
    if (last?.t === 'text') last.s += s;
    else raw.push({ t: 'text', s });
  };
  while (o + 1 < b.length) {
    const c = u16(b, o);
    if (c === 0) {
      o += 2;
      break;
    }
    if (c === 1 && o + 6 <= b.length) {
      const code = u16(b, o + 2), n = u16(b, o + 4);
      o += 6;
      const args: LanaiArg[] = [];
      for (let k = 0; k < n && o + 2 <= b.length; k++) {
        const type = u16(b, o);
        o += 2;
        if (type === 2) {
          args.push(u32(b, o));
          o += 4;
        } else if (type === 3) {
          const len = u16(b, o);
          o += 2;
          let s = '';
          for (let i = 0; i < len * 2 && b[o + i]; i++) s += String.fromCharCode(b[o + i]!);
          args.push(s);
          o += len * 2;
        } else {
          args.push(`?${type}`);
          break;
        }
      }
      if (code === TAG_INSERT && typeof args[0] === 'string' && typeof args[1] === 'number' && typeof args[2] === 'string')
        raw.push({ t: 'ins', table: args[0], id: args[1], field: args[2] });
      else raw.push({ t: 'tag', code, args });
      continue;
    }
    if (c === 0x0a) raw.push({ t: 'br' });
    else text(String.fromCharCode(c));
    o += 2;
  }
  return { tokens: groupRuby(raw), end: o };
}

/** Ruby tag, text, tag, text, tag -> ruby. */
function groupRuby(ts: LanaiToken[]): LanaiToken[] {
  const out: LanaiToken[] = [];
  const isTag = (t: LanaiToken | undefined, code: number): boolean => t?.t === 'tag' && t.code === code && !t.args.length;
  for (let i = 0; i < ts.length; i++) {
    const [a, b, c, d, e] = ts.slice(i, i + 5);
    if (isTag(a, TAG_RUBY[0]) && b?.t === 'text' && isTag(c, TAG_RUBY[1]) && d?.t === 'text' && isTag(e, TAG_RUBY[2])) {
      out.push({ t: 'ruby', base: b.s, reading: d.s });
      i += 4;
    } else out.push(ts[i]!);
  }
  return out;
}

const hexArg = (v: LanaiArg): string => (typeof v === 'number' ? `0x${v.toString(16).toUpperCase()}` : v);

export const tagCode = (code: number): string => code.toString(16).toUpperCase().padStart(2, '0');

/**
 * The text form (for searching and copying): {ruby:親字|よみ}, {page}, {ins:表:行 ID:欄} (another table's string),
 * {tag:XX} / {tag:XX,引数,…} (other tags).
 */
export function lanaiText(tokens: LanaiToken[]): string {
  return tokens.map((t) => {
    switch (t.t) {
      case 'text': return t.s;
      case 'br': return '\n';
      case 'ruby': return `{ruby:${t.base}|${t.reading}}`;
      case 'ins': return `{ins:${t.table}:${hexArg(t.id)}:${t.field}}`;
      case 'tag': return t.code === TAG_PAGE && !t.args.length ? '{page}' : `{tag:${[tagCode(t.code), ...t.args.map(hexArg)].join(',')}}`;
    }
  }).join('');
}

/** The text as a reader sees it, without markup: ruby as the base only, inserted strings through `insert`. */
export function lanaiPlain(tokens: LanaiToken[], insert?: (t: Extract<LanaiToken, { t: 'ins' }>) => string | undefined): string {
  return tokens.map((t) => {
    switch (t.t) {
      case 'text': return t.s;
      case 'br': return '\n';
      case 'ruby': return t.base;
      case 'ins': return insert?.(t) ?? `〈${t.table}〉`;
      case 'tag': return t.args.length && typeof t.args[0] === 'string' ? `〈${t.args[0]}〉` : '';
    }
  }).join('');
}
