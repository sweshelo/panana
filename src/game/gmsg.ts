// Message files (GMSG, *.gsmb; elpulse docs/analysis.md "GMSG"): lossless parsing, rebuilding with edited
// messages, and the text form used by the editors.
//
// File: +0x04 file size, +0x08 / +0x0C first / last message ID (IDs are global), +0x10 0 = text / 1 = reading for
// the voice (*_IN), +0x14 ID step (1), +0x18 offset table (u32 per message, relative to +0x1C), +0x1C string base.
// A message runs to the next offset (the last one to the end of the file). Text messages are UTF-16LE (msgtext.ts);
// readings are 1-byte strings. The game checks neither the size nor the end (FUN_001e78f0).
import { equalBytes, u16, u32, w16, w32 } from '../util/bytes';
import { plainText, previewText, textToUnits, unitsToText, type MessageText } from './msgtext';

export class Gmsg {
  readonly first: number;
  readonly last: number;
  /** +0x10: 1 = readings for the voice (*_IN). */
  readonly reading: boolean;
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
    this.reading = u32(data, 0x10) === 1;
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
      if (a > b || b > data.length) throw new Error('GMSG のメッセージが ID 順に並んでいません');
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

  /**
   * The file with some messages replaced (id -> bytes) and `extra` messages appended (IDs last + 1 ...; +0x0C is
   * moved on); the other bytes are kept.
   */
  build(replace: Map<number, Uint8Array> = new Map(), extra: Uint8Array[] = []): Uint8Array {
    const bodies = [...this.raw.map((r, i) => replace.get(this.first + i) ?? r), ...extra];
    const n = bodies.length;
    const tbl = this.head.length;
    const base = tbl + n * 4 + this.gap.length;
    const size = base + bodies.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(size);
    out.set(this.head);
    w32(out, 4, (size + this.sizeDelta) >>> 0);
    if (extra.length) {
      w32(out, 12, this.last + extra.length);
      w32(out, 0x1c, base); // the string base moves down with the longer offset table
    }
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

export const equalUnits = (a: Uint16Array, b: Uint16Array): boolean => a.length === b.length && a.every((c, i) => c === b[i]);

export interface MessageFile {
  name: string;
  entryIndex: number;
  gmsg: Gmsg;
  editable: boolean;
}

/**
 * The message files of an archive and the edited messages (id -> units). An edited message's reading in the *_IN
 * files is blanked (zero-filled, same length), so the voice does not read the old text.
 */
export class MessageStore {
  private readonly edits = new Map<number, Uint16Array>();
  /**
   * New messages (IDs addedBase ...), appended to the text file with the last IDs (and blank readings to its *_IN
   * file when that one ends at the same ID). The game looks an ID up in the ranges of the loaded files' headers
   * (FUN_00310438 → FUN_0043ccac), so new IDs past every file are found there.
   */
  private readonly added: Uint16Array[] = [];
  /** Text files, in archive order; the game uses the first file whose range holds an ID (FUN_00310438). */
  readonly files: MessageFile[];
  readonly readings: MessageFile[];

  constructor(files: MessageFile[]) {
    this.files = files.filter((f) => !f.gmsg.reading);
    this.readings = files.filter((f) => f.gmsg.reading);
  }

  file(id: number): MessageFile | undefined {
    return this.files.find((f) => f.gmsg.has(id)) ?? (this.isAdded(id) ? this.host : undefined);
  }

  /** The text file new messages go to: the one with the last IDs. */
  private get host(): MessageFile | undefined {
    return this.files.reduce<MessageFile | undefined>((a, f) => (!a || f.gmsg.last > a.gmsg.last ? f : a), undefined);
  }

  /** First ID of the new messages. */
  get addedBase(): number {
    return (this.host?.gmsg.last ?? -1) + 1;
  }

  isAdded(id: number): boolean {
    return id >= this.addedBase && id < this.addedBase + this.added.length;
  }

  /** Add a message; returns its ID. */
  add(units: Uint16Array): number {
    if (!this.host?.editable) throw new Error('メッセージを追加できるファイルがありません');
    this.added.push(units.slice());
    return this.addedBase + this.added.length - 1;
  }

  /** Remove the last added message (only that one: the IDs stay in a row). */
  removeAdded(id: number): void {
    if (id !== this.addedBase + this.added.length - 1) throw new Error(`メッセージ ${id} は最後に追加したものではありません`);
    this.added.pop();
  }

  /** Current units of a message (edited or original). */
  units(id: number): Uint16Array | undefined {
    if (this.isAdded(id)) return this.added[id - this.addedBase];
    return this.edits.get(id) ?? this.file(id)?.gmsg.units(id);
  }

  original(id: number): Uint16Array | undefined {
    return this.isAdded(id) ? undefined : this.file(id)?.gmsg.units(id);
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
    if (this.isAdded(id)) {
      this.added[id - this.addedBase] = units.slice();
      return;
    }
    const f = this.file(id);
    if (!f?.editable) throw new Error(`メッセージ ${id} は書き換えられません`);
    if (equalUnits(units, f.gmsg.units(id)!)) this.edits.delete(id);
    else this.edits.set(id, units.slice());
  }

  setText(id: number, text: string): void {
    const cur = this.text(id);
    if (!cur) throw new Error(`メッセージ ${id} がありません`);
    const o = this.original(id);
    const orig = o && unitsToText(o);
    if (orig && text.replace(/\r\n?/g, '\n') === orig.text && cur.kind === orig.kind) this.revert(id);
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
    return this.edits.size > 0 || this.added.length > 0;
  }

  /** IDs of the added messages. */
  addedIds(): number[] {
    return this.added.map((_, i) => this.addedBase + i);
  }

  /** Edited IDs, sorted. */
  editedIds(): number[] {
    return [...this.edits.keys()].sort((a, b) => a - b);
  }

  /** For saving: [id, units][]. */
  saved(): [number, Uint16Array][] {
    return [...this.edits, ...this.added.map((u, i): [number, Uint16Array] => [this.addedBase + i, u])];
  }

  /** Put saved edits back; `keepAdded` keeps the added messages as they are (the map editor's undo). */
  restore(saved: [number, Uint16Array][], keepAdded = false): void {
    this.edits.clear();
    if (!keepAdded) this.added.length = 0;
    const base = this.addedBase;
    for (const [id, u] of [...saved].sort((a, b) => a[0] - b[0])) {
      if (id >= base) {
        if (keepAdded) continue;
        if (id === base + this.added.length) this.add(Uint16Array.from(u));
      } else if (this.editable(id)) this.set(id, Uint16Array.from(u));
    }
  }

  /** Rebuilt files that hold an edit (and the readings blanked): archive entry index -> file bytes. */
  replacements(): Map<number, Uint8Array> {
    const out = new Map<number, Uint8Array>();
    const host = this.added.length ? this.host : undefined;
    for (const f of this.files) {
      const mine = new Map([...this.edits].filter(([id]) => this.file(id) === f).map(([id, u]) => [id, fromUnits(u)] as const));
      const extra = f === host ? this.added.map(fromUnits) : [];
      if (mine.size || extra.length) out.set(f.entryIndex, f.gmsg.build(mine, extra));
    }
    for (const f of this.readings) {
      const mine = new Map([...this.edits.keys()].filter((id) => f.gmsg.has(id)).map((id) => [id, new Uint8Array(f.gmsg.raw[id - f.gmsg.first]!.length)] as const));
      // blank readings of the new messages (a few zero bytes each)
      const extra = host && f.gmsg.last === this.addedBase - 1 ? this.added.map(() => new Uint8Array(4)) : [];
      if (mine.size || extra.length) out.set(f.entryIndex, f.gmsg.build(mine, extra));
    }
    return out;
  }
}
