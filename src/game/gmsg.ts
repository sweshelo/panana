// Message files (GMSG, *.gsmb; elpulse docs/analysis.md "GMSG"): lossless parsing, rebuilding with edited
// messages, and the text form used by the editors.
//
// File: +0x04 file size, +0x08 / +0x0C first / last message ID (IDs are global), +0x10 0 = text / 1 = reading for
// the voice (*_IN), +0x14 ID step (1), +0x18 offset table (u32 per message, relative to +0x1C), +0x1C string base.
// A message runs to the next offset (the last one to the end of the file). Text messages are UTF-16LE (msgtext.ts);
// readings are 1-byte strings. The game checks neither the size nor the end (FUN_001e78f0).
import { equalBytes, u16, u32, w16, w32 } from '../util/bytes';
import { KAHARA_SYNTAX, plainText, previewText, textToUnits, unitsToText, type MessageSyntax, type MessageText } from './msgtext';

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
    // RPG3's empty MessageEvent_JP has 0xFFFFFFFF here (naauao oahu/analysis.md §5): no messages
    const last = u32(data, 12);
    this.last = last === 0xffffffff ? this.first - 1 : last;
    this.reading = u32(data, 0x10) === 1;
    const n = this.last - this.first + 1; // 0 only for a file made by Gmsg.empty
    const tbl = u32(data, 0x18);
    const base = u32(data, 0x1c);
    if (n < 0 || tbl < 0x20 || tbl + n * 4 > base || base > data.length) throw new Error('GMSG のヘッダーが読めません');
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

  /**
   * A text file with no messages yet (IDs from `first`; build() appends them), with the header of `template` (a text
   * file of the same archive: ID step and the other fields kept).
   */
  static empty(template: Gmsg, first: number): Gmsg {
    const out = template.head.slice();
    w32(out, 4, out.length);
    w32(out, 8, first);
    w32(out, 12, first - 1);
    w32(out, 0x10, 0);
    w32(out, 0x1c, out.length);
    return new Gmsg(out);
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
  /** Root archive of the file, when the store holds files of several archives (RPG3). */
  archive?: string;
  entryIndex: number;
  gmsg: Gmsg;
  editable: boolean;
}

/**
 * Last message ID of the game's files. The IDs are one range over every archive, and the ones after the master's
 * MessageField (0x21AF) are those of other archives (docs/analysis.md "GMSG": Nagomi 6F896E38, Antenna 56860091,
 * Command, Staffroll FBADD94C, CodeFilter 108B9147 up to 0x2B92), so new messages go past this.
 */
export const LAST_GAME_MESSAGE = 0x2b92;
/**
 * The file made for new messages: a type 6 entry added to the master, as elpulse's MOD adds MessageMod_JP.gsmb
 * (IDs 0x2C00〜, docs/analysis.md "メッセージ ID の追加"). The game registers every GMSG entry of an archive and
 * looks an ID up in the ranges of the registered files (FUN_00310438), so it finds them from any scene.
 */
export const NEW_MESSAGE_FILE = 'MessageMod_JP.gsmb';
export const NEW_MESSAGE_HASH = 0x4d4f4400;
export const NEW_MESSAGE_FIRST = 0x2c00;

/**
 * The message files of an archive and the edited messages (id -> units). An edited message's reading in the *_IN
 * files is blanked (zero-filled, same length), so the voice does not read the old text.
 */
export class MessageStore {
  private readonly edits = new Map<number, Uint16Array>();
  /**
   * New messages (IDs addedBase ...), appended to the file past the game's IDs: the one already in the archive (a
   * base MOD's MessageMod_JP.gsmb), else a file of our own ({@link newFile}). They have no readings (like the
   * MOD's): the voice reads nothing for them.
   */
  private readonly added: Uint16Array[] = [];
  /** Text files, in archive order; the game uses the first file whose range holds an ID (FUN_00310438). */
  readonly files: MessageFile[];
  readonly readings: MessageFile[];
  /** The text file new messages go to (entryIndex -1 when it is not in the archive yet). */
  private readonly host: MessageFile | undefined;

  /**
   * `syntax`: the game's tag numbers. `canAddMessages`: whether new messages may be added (RPG2's
   * MessageMod_JP.gsmb; not for RPG3 yet).
   */
  constructor(files: MessageFile[], readonly syntax: MessageSyntax = KAHARA_SYNTAX, canAddMessages = true) {
    this.files = files.filter((f) => !f.gmsg.reading);
    this.readings = files.filter((f) => f.gmsg.reading);
    const last = files.reduce((a, f) => (f.gmsg.raw.length ? Math.max(a, f.gmsg.last) : a), LAST_GAME_MESSAGE);
    const own = this.files.find((f) => f.gmsg.first > LAST_GAME_MESSAGE && f.gmsg.last === last);
    const template = this.files.find((f) => f.editable);
    this.host = !canAddMessages ? undefined : own?.editable
      ? own
      : template && { name: NEW_MESSAGE_FILE, entryIndex: -1, gmsg: Gmsg.empty(template.gmsg, Math.max(NEW_MESSAGE_FIRST, last + 1)), editable: true };
  }

  file(id: number): MessageFile | undefined {
    return this.files.find((f) => f.gmsg.has(id)) ?? (this.isAdded(id) ? this.host : undefined);
  }

  /** First ID of the new messages. */
  get addedBase(): number {
    return this.host ? this.host.gmsg.last + 1 : NEW_MESSAGE_FIRST;
  }

  /** Whether messages can be added. */
  canAdd(): boolean {
    return !!this.host;
  }

  isAdded(id: number): boolean {
    return id >= this.addedBase && id < this.addedBase + this.added.length;
  }

  /** Add a message; returns its ID. */
  add(units: Uint16Array): number {
    if (!this.host) throw new Error('メッセージを追加できるファイルがありません');
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
    return u && plainText(u, this.syntax);
  }

  /** What the reader sees (see previewText); `oneLine` turns line breaks into spaces. */
  preview(id: number, oneLine = false, depth = 0): string | undefined {
    const u = this.units(id);
    if (!u) return undefined;
    const s = previewText(u, (ref) => this.preview(ref, true, depth + 1), depth, this.syntax);
    return oneLine ? s.replace(/\n/g, ' ') : s;
  }

  text(id: number): MessageText | undefined {
    const u = this.units(id);
    return u && unitsToText(u, this.syntax);
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
    const orig = o && unitsToText(o, this.syntax);
    if (orig && text.replace(/\r\n?/g, '\n') === orig.text && cur.kind === orig.kind) this.revert(id);
    else this.set(id, textToUnits({ ...cur, text }, this.syntax));
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
      if (this.host && id >= base) {
        if (keepAdded) continue;
        if (id === base + this.added.length) this.add(Uint16Array.from(u));
      } else if (this.editable(id)) this.set(id, Uint16Array.from(u));
    }
  }

  /** Rebuilt files that hold an edit (and the readings blanked): archive entry index -> file bytes. */
  replacements(): Map<number, Uint8Array> {
    return new Map(this.rebuilt().map(([f, b]) => [f.entryIndex, b]));
  }

  /**
   * The files that hold an edit, rebuilt, and the readings blanked. A copy of the file that holds an ID (same name and
   * range, e.g. RPG3's MessageCommand_JP in 4 archives) gets the edit too, so every copy says the same.
   */
  rebuilt(): [MessageFile, Uint8Array][] {
    const out: [MessageFile, Uint8Array][] = [];
    const host = this.added.length ? this.host : undefined;
    const holds = (f: MessageFile, id: number): boolean => {
      const o = this.file(id);
      return o === f || (!!o && f.editable && o.name === f.name && o.gmsg.first === f.gmsg.first && o.gmsg.last === f.gmsg.last);
    };
    for (const f of this.files) {
      const mine = new Map([...this.edits].filter(([id]) => holds(f, id)).map(([id, u]) => [id, fromUnits(u)] as const));
      const extra = f === host ? this.added.map(fromUnits) : [];
      if (mine.size || extra.length) out.push([f, f.gmsg.build(mine, extra)]);
    }
    for (const f of this.readings) {
      const mine = new Map([...this.edits.keys()].filter((id) => f.gmsg.has(id)).map((id) => [id, new Uint8Array(f.gmsg.raw[id - f.gmsg.first]!.length)] as const));
      if (mine.size) out.push([f, f.gmsg.build(mine)]);
    }
    return out;
  }

  /** The file of the new messages to add to the archive (null when there are none, or they go to a file in it). */
  newFile(): { name: string; hash: number; bytes: Uint8Array } | null {
    const h = this.host;
    if (!h || h.entryIndex >= 0 || !this.added.length) return null;
    return { name: h.name, hash: NEW_MESSAGE_HASH, bytes: h.gmsg.build(new Map(), this.added.map(fromUnits)) };
  }
}
