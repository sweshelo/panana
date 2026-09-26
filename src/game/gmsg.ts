// Message files (GMSG, *.gsmb; elpulse docs/analysis.md "GMSG"): lossless parsing, rebuilding with edited
// messages, and the text form used by the editors.
//
// File: +0x04 file size, +0x08 / +0x0C first / last message ID (IDs are global), +0x18 offset table (u32 per
// message, relative to +0x1C), +0x1C string base. A message runs to the next offset (the last one to the end of
// the file); it is UTF-16LE whose first unit is a type code, and control codes may carry 0x0000 arguments, so it
// is not NUL-terminated.
import { equalBytes, u16, u32, w16, w32 } from '../util/bytes';

export class Gmsg {
  readonly first: number;
  readonly last: number;
  /** Bytes before the offset table (the header), with +0x04 patched on build. */
  private readonly head: Uint8Array;
  /** Bytes between the end of the offset table and the string base. */
  private readonly gap: Uint8Array;
  /** Raw bytes of each message (index = id - first). */
  readonly raw: Uint8Array[];
  /** +0x04 minus the file length (kept on rebuild). */
  private readonly sizeDelta: number;

  constructor(private readonly data: Uint8Array) {
    if (String.fromCharCode(...data.subarray(0, 4)) !== 'GMSG') throw new Error('GMSG ではありません');
    this.first = u32(data, 8);
    this.last = u32(data, 12);
    const n = this.last - this.first + 1;
    const tbl = u32(data, 0x18);
    const base = u32(data, 0x1c);
    if (n <= 0 || tbl < 0x20 || tbl + n * 4 > base || base > data.length) throw new Error('GMSG のヘッダーが読めません');
    this.head = data.slice(0, tbl);
    this.gap = data.slice(tbl + n * 4, base);
    this.sizeDelta = u32(data, 4) - data.length;
    this.raw = [];
    for (let i = 0; i < n; i++) {
      const a = base + u32(data, tbl + i * 4);
      const b = i + 1 < n ? base + u32(data, tbl + i * 4 + 4) : data.length;
      // The rebuild writes the messages back to back in ID order, so it needs them stored that way.
      if (a > b || b > data.length || (a - base) % 2) throw new Error('GMSG のメッセージが ID 順に並んでいません');
      this.raw.push(data.slice(a, b));
    }
  }

  has(id: number): boolean {
    return id >= this.first && id <= this.last;
  }

  /** Message units (UTF-16 code units). */
  units(id: number): Uint16Array | undefined {
    if (!this.has(id)) return undefined;
    return toUnits(this.raw[id - this.first]!);
  }

  /** The file with some messages replaced (id -> units); the other bytes are kept. */
  build(replace: Map<number, Uint16Array> = new Map()): Uint8Array {
    const bodies = this.raw.map((r, i) => {
      const u = replace.get(this.first + i);
      return u ? fromUnits(u) : r;
    });
    const n = bodies.length;
    const tbl = this.head.length;
    const base = tbl + n * 4 + this.gap.length;
    const size = base + bodies.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(size);
    out.set(this.head);
    w32(out, 4, (size + this.sizeDelta) >>> 0);
    let o = 0;
    bodies.forEach((b, i) => {
      w32(out, tbl + i * 4, o);
      out.set(b, base + o);
      o += b.length;
    });
    out.set(this.gap, tbl + n * 4);
    return out;
  }

  /** Whether build() gives back the original bytes (checked before offering edits). */
  roundTrips(): boolean {
    return equalBytes(this.build(), this.data);
  }
}

export function toUnits(b: Uint8Array): Uint16Array {
  const u = new Uint16Array(b.length >> 1);
  for (let i = 0; i < u.length; i++) u[i] = u16(b, i * 2);
  return u;
}

export function fromUnits(u: Uint16Array): Uint8Array {
  const b = new Uint8Array(u.length * 2);
  u.forEach((c, i) => w16(b, i * 2, c));
  return b;
}

/** Units 0x0100-0x017F in the text are placeholders filled in at run time (names etc.), not letters. */
export const isPlaceholder = (c: number): boolean => c >= 0x0100 && c < 0x0180;
const isControl = (c: number): boolean => c < 0x20 || (c >= 0xe000 && c < 0xf900) || isPlaceholder(c) || c === 0x7b || c === 0x7d;
/** "&" followed by one unit: that unit is the ID of another message, shown in its place. */
const REF = 0x26;
const hex4 = (c: number): string => c.toString(16).toUpperCase().padStart(4, '0');

/**
 * Message units -> the text the editors show and take back:
 * - kind: the first unit (type code; the game skips it when it shows the message),
 * - text: the rest up to the trailing zeros, with 0x000A as a line break, "&" + a message ID as {&XXXX}, and every
 *   other control code (below 0x20, private use 0xE000-0xF8FF), placeholder (0x0100-0x017F) and the braces and
 *   a lone "&" written as {XXXX} (hex),
 * - tail: the trailing zeros (and anything after them the text cannot hold), kept as they are.
 */
export interface MessageText {
  kind: number;
  text: string;
  tail: Uint16Array;
}

export function unitsToText(u: Uint16Array): MessageText {
  if (!u.length) return { kind: 0, text: '', tail: new Uint16Array() };
  let end = u.length;
  while (end > 1 && u[end - 1] === 0) end--;
  let text = '';
  for (let i = 1; i < end; i++) {
    const c = u[i]!;
    if (c === 0x0a) text += '\n';
    else if (c === REF && i + 1 < end) text += `{&${hex4(u[++i]!)}}`;
    else if (c === REF || isControl(c)) text += `{${hex4(c)}}`;
    else text += String.fromCharCode(c);
  }
  return { kind: u[0]!, text, tail: u.slice(end) };
}

/** Inverse of unitsToText. A message always ends with at least one 0x0000. */
export function textToUnits(m: MessageText): Uint16Array {
  const out: number[] = [m.kind];
  const s = m.text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x7b) {
      const e = /^\{(&?)([0-9A-Fa-f]{1,4})\}/.exec(s.slice(i));
      if (!e) throw new Error(`「{」の後に 16 進 4 桁 (ほかのメッセージなら & と ID) と「}」が要ります (${i + 1} 文字目)`);
      if (e[1]) out.push(REF);
      out.push(parseInt(e[2]!, 16));
      i += e[0].length - 1;
    } else if (c === 0x7d) throw new Error(`対応する「{」のない「}」があります (${i + 1} 文字目)`);
    else if (c === REF) throw new Error(`「&」は次の文字をメッセージ ID として読むので、ほかのメッセージを入れるときは {&XXXX}、記号の & は ＆ (全角) で書いてください (${i + 1} 文字目)`);
    else out.push(c);
  }
  const tail = m.tail.length ? [...m.tail] : [0];
  return Uint16Array.from([...out, ...tail]);
}

/**
 * Plain text (same as the reader in master.ts): the type code skipped as the game does, line breaks as spaces, ruby
 * "{X}'base{X}(reading{X})" as the base, other control codes dropped; placeholders and "&" references kept.
 */
export function plainText(u: Uint16Array): string {
  let s = '';
  for (let i = 1; i < u.length; i++) {
    const c = u[i]!;
    if (c === 0) {
      if (s) break;
      continue;
    }
    if (c === 0x0a) s += ' ';
    else if (c >= 0x20 && !(c >= 0xe000 && c < 0xf900)) s += String.fromCharCode(c);
    else s += '\u0001';
  }
  return s.replace(/\u0001'(.*?)\u0001\((.*?)\u0001\)/g, '$1').replace(/\u0001/g, '');
}

export const equalUnits = (a: Uint16Array, b: Uint16Array): boolean => a.length === b.length && a.every((c, i) => c === b[i]);

/** The message files of an archive and the edited messages (id -> units). */
export class MessageStore {
  private readonly edits = new Map<number, Uint16Array>();

  constructor(
    /** In archive order; the game uses the first file whose range holds an ID (FUN_00310438). */
    readonly files: { name: string; entryIndex: number; gmsg: Gmsg; editable: boolean }[],
  ) {}

  file(id: number): MessageStore['files'][number] | undefined {
    return this.files.find((f) => f.gmsg.has(id));
  }

  /** Current units of a message (edited or original). */
  units(id: number): Uint16Array | undefined {
    return this.edits.get(id) ?? this.file(id)?.gmsg.units(id);
  }

  original(id: number): Uint16Array | undefined {
    return this.file(id)?.gmsg.units(id);
  }

  plain(id: number): string | undefined {
    const u = this.units(id);
    return u && plainText(u);
  }

  /** What the reader sees (see previewText); `oneLine` turns line breaks into spaces. */
  preview(id: number, oneLine = false, depth = 0): string | undefined {
    const u = this.units(id);
    if (!u) return undefined;
    const s = previewText(u, (ref) => this.preview(ref, true, depth + 1), depth);
    return oneLine ? s.replace(/\n/g, ' ') : s;
  }

  text(id: number): MessageText | undefined {
    const u = this.units(id);
    return u && unitsToText(u);
  }

  editable(id: number): boolean {
    return !!this.file(id)?.editable;
  }

  /** Replace a message (an edit equal to the original is dropped). */
  set(id: number, units: Uint16Array): void {
    const f = this.file(id);
    if (!f?.editable) throw new Error(`メッセージ ${id} は書き換えられません`);
    if (equalUnits(units, f.gmsg.units(id)!)) this.edits.delete(id);
    else this.edits.set(id, units.slice());
  }

  setText(id: number, text: string): void {
    const cur = this.text(id);
    if (!cur) throw new Error(`メッセージ ${id} がありません`);
    const orig = unitsToText(this.original(id)!);
    if (text.replace(/\r\n?/g, '\n') === orig.text && cur.kind === orig.kind) this.revert(id);
    else this.set(id, textToUnits({ ...cur, text }));
  }

  /** Change the type code (the first unit), keeping the text. */
  setKind(id: number, kind: number): void {
    const u = this.units(id);
    if (!u?.length) throw new Error(`メッセージ ${id} がありません`);
    const next = u.slice();
    next[0] = kind;
    this.set(id, next);
  }

  revert(id: number): void {
    this.edits.delete(id);
  }

  isEdited(id: number): boolean {
    return this.edits.has(id);
  }

  changed(): boolean {
    return this.edits.size > 0;
  }

  /** Edited IDs, sorted. */
  editedIds(): number[] {
    return [...this.edits.keys()].sort((a, b) => a - b);
  }

  /** For saving: [id, units][]. */
  saved(): [number, Uint16Array][] {
    return [...this.edits];
  }

  restore(saved: [number, Uint16Array][]): void {
    this.edits.clear();
    for (const [id, u] of saved) if (this.editable(id)) this.set(id, Uint16Array.from(u));
  }

  /** Rebuilt files that hold an edit: archive entry index -> file bytes. */
  replacements(): Map<number, Uint8Array> {
    const out = new Map<number, Uint8Array>();
    for (const f of this.files) {
      const mine = new Map([...this.edits].filter(([id]) => this.file(id) === f));
      if (mine.size) out.set(f.entryIndex, f.gmsg.build(mine));
    }
    return out;
  }
}

/** Label of a placeholder in previews. */
export const placeholderLabel = (c: number): string => `〔${hex4(c)}〕`;

/**
 * Text as a reader would see it, for previews: the type code skipped, line breaks kept, "&" references replaced
 * by the referenced message (`lookup`), placeholders as 〔XXXX〕, ruby as the base, other control codes dropped.
 */
export function previewText(u: Uint16Array, lookup: (id: number) => string | undefined, depth = 0): string {
  let s = '';
  for (let i = 1; i < u.length; i++) {
    const c = u[i]!;
    if (c === 0) {
      if (s) break;
      continue;
    }
    if (c === REF && i + 1 < u.length && u[i + 1]) {
      const id = u[++i]!;
      s += (depth < 2 ? lookup(id) : undefined) ?? `〔&${hex4(id)}〕`;
    } else if (c === 0x0a) s += '\n';
    else if (isPlaceholder(c)) s += placeholderLabel(c);
    else if (c >= 0x20 && !(c >= 0xe000 && c < 0xf900)) s += String.fromCharCode(c);
    else s += '\u0001';
  }
  return s.replace(/\u0001'(.*?)\u0001\((.*?)\u0001\)/g, '$1').replace(/\u0001/g, '');
}

/**
 * Type codes (the first unit) seen in the data. The game skips it when it shows a message; what it selects for
 * the field lines (0x010D-0x0124) is inferred from who says them.
 */
export const MESSAGE_KINDS: Record<number, string> = {
  0x0001: '名前',
  0x000c: '説明',
  0x000d: '説明 (メニュー)',
  0x010d: 'č: 台詞 (荒い・うめく声など、推定)',
  0x010e: 'Ď: 台詞 (男性「オレ」、推定)',
  0x010f: 'ď: 台詞 (女性・です調、推定)',
  0x0123: 'ģ: 台詞 (子ども「ボク」、推定)',
  0x0124: 'Ĥ: 台詞 (子ども「ボク」、推定)',
};
