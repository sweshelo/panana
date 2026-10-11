// GS table of 電波人間のRPG FREE! (lanai; naauao lanai/analysis.md §2). A 0x40-byte header, then the regions it points
// at: the string pool (+0x08, always 0x40), the rows (+0x10), the row IDs (+0x18), the names of the string fields
// (+0x20), the extra (hash, value) pairs (+0x30) and the relocations (+0x28, file offsets of the u32s the game turns
// into pointers: the string fields, and the names of the field-name table). A string field holds the file offset of
// its string in the pool.
//   0x00 rows, 0x04 row size, 0x08 pool offset, 0x0C pool size, 0x10 data offset, 0x14 data size (rows × row size),
//   0x18 / 0x1C row IDs (4 × rows), 0x20 / 0x24 field names (8 × fields: name offset, offset in the row),
//   0x28 relocations, 0x2C relocation count, 0x30 extra, 0x34 / 0x38 the table's name (in the pool),
//   0x3C reference count, 0x3E relocated (both 0 in the files).
// In every table of the dumps the rows come right after the pool and the other regions after the rows, each on 16
// bytes (data > [row IDs] > [field names | extra] > relocations). Editing keeps to that: the numbers of a row can be
// written (the bits of a packed word are written into the word, so the bits around them and the 0xD0 padding stay),
// rows can be added at the end (the regions after the rows move), and the string fields can be written. The pool is
// laid out again for that: the pool as read stays as it is (every field that was not written keeps its offset, so the
// rows that were not edited keep their bytes), and the written strings follow it, each on 4 bytes, in the order of
// their fields; the pool is padded to 16 bytes and everything after it moves. A field written back to the string it
// had points at the string as read again, so a table whose edits were all undone is the bytes it was read from.
import { align, cstr, equalBytes, u16, u32, w16, w32 } from '../util/bytes';

export interface LanaiField {
  name: string;
  /** Offset in the row. */
  offset: number;
}

const HEADER = 0x40;
/** Alignment of the regions after the rows (and of the end of a pool with written strings). */
const REGION_ALIGN = 0x10;
/** Alignment of a written string in the pool. */
const STRING_ALIGN = 4;

/** Row IDs at or above this are looked up in the row ID table; smaller ones are row numbers (FUN_0031C038). */
export const ROW_ID = 0x80000000;

export const isRowId = (v: number): boolean => v >= ROW_ID;

export class LanaiTable {
  /** The bytes of the table (a copy is made on the first edit: the bytes it was read from are not written). */
  data: Uint8Array;
  rows = 0;
  rowSize = 0;
  dataOffset = 0;
  name = '';
  /** The row IDs (0x80000000 | number in most tables), or an empty list when the table has none. */
  rowIds: number[] = [];
  fields: LanaiField[] = [];
  /** File offsets of the relocated u32s. */
  relocs = new Set<number>();
  /** The (hash, value) pairs of the extra region (meaning not known). */
  extra: [number, number][] = [];
  private byId?: Map<number, number>;
  /** The bytes as read, once the table was edited. */
  private orig: Uint8Array | null = null;
  private origRows = 0;
  /** Pool size and data offset as read (the pool as read is never moved or written). */
  private basePool = 0;
  private baseData = 0;
  /** Strings written by edits (bytes up to and with the terminator), by place: row × row size + offset in the row. */
  private written = new Map<number, Uint8Array>();
  /** Bumped by every edit (for views that cache what they read). */
  revision = 0;

  constructor(data: Uint8Array) {
    if (!LanaiTable.is(data)) throw new Error('RPG FREE! の GS テーブルではありません');
    this.data = data;
    this.parse();
    this.origRows = this.rows;
    this.basePool = u32(data, 0x0c);
    this.baseData = this.dataOffset;
  }

  private parse(): void {
    const d = this.data;
    this.rows = u32(d, 0);
    this.rowSize = u32(d, 4);
    this.dataOffset = u32(d, 0x10);
    this.name = cstr(d.subarray(0, u32(d, 8) + u32(d, 0x38)), u32(d, 8) + u32(d, 0x34));
    const ids = u32(d, 0x18);
    this.rowIds = ids ? Array.from({ length: u32(d, 0x1c) >>> 2 }, (_, i) => u32(d, ids + i * 4)) : [];
    const schema = u32(d, 0x20);
    this.fields = schema
      ? Array.from({ length: u32(d, 0x24) >>> 3 }, (_, i) => ({ name: cstr(d, u32(d, schema + i * 8)), offset: u32(d, schema + i * 8 + 4) }))
        .sort((a, b) => a.offset - b.offset)
      : [];
    const reloc = u32(d, 0x28);
    this.relocs = new Set(Array.from({ length: u32(d, 0x2c) }, (_, i) => u32(d, reloc + i * 4)));
    const extra = u32(d, 0x30);
    this.extra = [];
    if (extra) {
      // the region runs up to the next one after it (the relocations come last)
      const end = Math.min(...[reloc, schema, ids, d.length].filter((o) => o > extra));
      for (let o = extra; o + 8 <= end; o += 8) this.extra.push([u32(d, o), u32(d, o + 4)]);
    }
    this.byId = undefined;
  }

  /** Whether `b` has the header of a lanai table (the pool at 0x40, the regions inside the file, a name). */
  static is(b: Uint8Array): boolean {
    if (b.length < HEADER || u32(b, 8) !== HEADER) return false;
    const rows = u32(b, 0), size = u32(b, 4), data = u32(b, 0x10);
    if (rows * size !== u32(b, 0x14) || data < HEADER || data + rows * size > b.length) return false;
    const reloc = u32(b, 0x28);
    if (reloc > b.length || reloc + u32(b, 0x2c) * 4 > b.length) return false;
    for (const [at, len] of [[0x18, 0x1c], [0x20, 0x24]] as const) if (u32(b, at) && u32(b, at) + u32(b, len) > b.length) return false;
    const pool = HEADER + u32(b, 0x0c);
    const name = HEADER + u32(b, 0x34);
    return name < pool && HEADER + u32(b, 0x38) <= pool && b[name] !== 0;
  }

  /** The bytes of row `i`. */
  row(i: number): Uint8Array {
    if (i < 0 || i >= this.rows) throw new RangeError(`${this.name}: 行 ${i} は範囲外です (${this.rows} 行)`);
    const o = this.dataOffset + i * this.rowSize;
    return this.data.subarray(o, o + this.rowSize);
  }

  /** File offset of the field at `offset` of row `i`. */
  at(i: number, offset: number): number {
    return this.dataOffset + i * this.rowSize + offset;
  }

  u8(i: number, offset: number): number {
    return this.data[this.at(i, offset)]!;
  }

  u16(i: number, offset: number): number {
    return u16(this.data, this.at(i, offset));
  }

  u32(i: number, offset: number): number {
    return u32(this.data, this.at(i, offset));
  }

  /** `count` bits from bit `shift` of the u32 at `offset` (sign-extended when `signed`). */
  bits(i: number, offset: number, shift: number, count: number, signed = false): number {
    const v = count >= 32 ? this.u32(i, offset) : (this.u32(i, offset) >>> shift) & ((1 << count) - 1);
    return signed && count < 32 && v & (1 << (count - 1)) ? v - (1 << count) : v;
  }

  /** The row ID of row `i` (0x80000000 | i when the table has no IDs). */
  rowId(i: number): number {
    return this.rowIds[i] ?? (ROW_ID | i) >>> 0;
  }

  /** The row a reference names: a row ID (0x80000000 and above) from the ID table, else a row number; -1 when none. */
  find(ref: number): number {
    if (!isRowId(ref)) return ref < this.rows ? ref : -1;
    if (!this.rowIds.length) return -1;
    this.byId ??= new Map(this.rowIds.map((id, i) => [id, i]));
    return this.byId.get(ref) ?? -1;
  }

  /** Whether the u32 at `offset` of row `i` is relocated (a string field). */
  isString(i: number, offset: number): boolean {
    return this.relocs.has(this.at(i, offset));
  }

  /** Offsets in the row of the relocated fields of any row (the string columns). */
  stringOffsets(): number[] {
    const out = new Set<number>();
    const end = this.dataOffset + this.rows * this.rowSize;
    for (const r of this.relocs) if (r >= this.dataOffset && r < end) out.add((r - this.dataOffset) % this.rowSize);
    return [...out].sort((a, b) => a - b);
  }

  /** The field at `offset` by name (string fields only have names). */
  fieldName(offset: number): string | undefined {
    return this.fields.find((f) => f.offset === offset)?.name;
  }

  /** File offset of the string of a field (what it holds in the file: an offset into the pool), or -1 when the field is not a string. */
  stringOffset(i: number, offset: number): number {
    return this.isString(i, offset) ? this.u32(i, offset) : -1;
  }

  /** The string field named `name` of row `i` as a file offset, or -1. */
  named(i: number, name: string): number {
    const f = this.fields.find((x) => x.name === name);
    return f ? this.stringOffset(i, f.offset) : -1;
  }

  // ---- editing

  /** The bytes as they were read. */
  get original(): Uint8Array {
    return this.orig ?? this.data;
  }

  /** Rows the table had when it was read (rows from here on were added by edits). */
  get originalRows(): number {
    return this.origRows;
  }

  /** Whether the table differs from what was read. */
  get changed(): boolean {
    return !!this.orig && !equalBytes(this.orig, this.data);
  }

  /** Row `i` as it was read, or null for a row an edit added. */
  originalRow(i: number): Uint8Array | null {
    if (i < 0 || i >= this.origRows) return null;
    const o = this.baseData + i * this.rowSize;
    return this.original.subarray(o, o + this.rowSize);
  }

  /** Whether row `i` differs from what was read (an added row always does). */
  rowChanged(i: number): boolean {
    const o = this.originalRow(i);
    return !o || !equalBytes(o, this.row(i));
  }

  /** The rows that differ from what was read, added rows included. */
  changedRows(): number[] {
    if (!this.orig) return [];
    return Array.from({ length: this.rows }, (_, i) => i).filter((i) => this.rowChanged(i));
  }

  /** Before the first write: keep the bytes as read and write into a copy. */
  private writable(): void {
    if (!this.orig) {
      this.orig = this.data;
      this.data = this.data.slice();
    }
    this.revision++;
  }

  /** Checks that a write of `size` bytes at `offset` stays in a row and does not touch a string field. */
  private place(i: number, offset: number, size: number): number {
    if (i < 0 || i >= this.rows) throw new RangeError(`${this.name}: 行 ${i} は範囲外です (${this.rows} 行)`);
    if (offset < 0 || offset + size > this.rowSize) throw new RangeError(`${this.name}: +0x${offset.toString(16)} は行 (0x${this.rowSize.toString(16)} バイト) の外です`);
    const base = this.at(i, 0);
    for (const r of this.relocs) if (r + 4 > base + offset && r < base + offset + size) throw new Error(`${this.name}: 行 ${i} +0x${(r - base).toString(16)} は文字列の欄なので書き換えられません`);
    return this.at(i, offset);
  }

  private static check(v: number, min: number, max: number, what: string): void {
    if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${what}: ${v} は ${min}〜${max} の外です`);
  }

  setU8(i: number, offset: number, v: number): void {
    LanaiTable.check(v, 0, 0xff, `${this.name} +0x${offset.toString(16)}`);
    const at = this.place(i, offset, 1);
    this.writable();
    this.data[at] = v;
  }

  setU16(i: number, offset: number, v: number): void {
    LanaiTable.check(v, 0, 0xffff, `${this.name} +0x${offset.toString(16)}`);
    const at = this.place(i, offset, 2);
    this.writable();
    w16(this.data, at, v);
  }

  setU32(i: number, offset: number, v: number): void {
    LanaiTable.check(v, 0, 0xffffffff, `${this.name} +0x${offset.toString(16)}`);
    const at = this.place(i, offset, 4);
    this.writable();
    w32(this.data, at, v >>> 0);
  }

  /** Writes `count` bits from bit `shift` of the u32 at `offset`; the other bits (and the padding) stay. */
  setBits(i: number, offset: number, shift: number, count: number, v: number, signed = false): void {
    if (count >= 32) return this.setU32(i, offset, signed ? v >>> 0 : v);
    const [min, max] = signed ? [-(2 ** (count - 1)), 2 ** (count - 1) - 1] : [0, 2 ** count - 1];
    LanaiTable.check(v, min, max, `${this.name} +0x${offset.toString(16)} bit${shift}-${shift + count - 1}`);
    const at = this.place(i, offset, 4);
    this.writable();
    const mask = ((1 << count) - 1) << shift;
    w32(this.data, at, ((u32(this.data, at) & ~mask) | ((v << shift) & mask)) >>> 0);
  }

  /**
   * Writes a whole row (same size). Its string fields must keep their values, or (undoing a string edit) have the
   * values they had when read.
   */
  setRow(i: number, bytes: Uint8Array): void {
    if (bytes.length !== this.rowSize) throw new RangeError(`${this.name}: 行の大きさが違います`);
    this.row(i);
    const base = this.at(i, 0);
    const was = this.originalRow(i);
    const undone: number[] = [];
    for (const o of this.stringOffsetsOf(i)) {
      const v = u32(bytes, o);
      if (v === u32(this.data, base + o)) continue;
      if (!was || v !== u32(was, o)) throw new Error(`${this.name}: 行 ${i} の文字列の欄は setString で書き換えます`);
      undone.push(o);
    }
    this.writable();
    this.data.set(bytes, base);
    for (const o of undone) this.written.delete(i * this.rowSize + o);
    if (undone.length) this.relayout();
  }

  /** Puts row `i` back as it was read, strings included (an added row cannot be: remove it with removeLastRow). */
  revertRow(i: number): void {
    const o = this.originalRow(i);
    if (!o) throw new Error(`${this.name}: 行 ${i} は追加した行です`);
    const keys = this.writtenIn(i);
    if (!keys.length && equalBytes(o, this.row(i))) return;
    this.writable();
    for (const k of keys) this.written.delete(k);
    this.data.set(o, this.at(i, 0));
    if (keys.length) this.relayout();
  }

  // ---- strings

  /** Places (row × row size + offset) of the strings written in row `i`. */
  private writtenIn(i: number): number[] {
    const from = i * this.rowSize;
    return [...this.written.keys()].filter((k) => k >= from && k < from + this.rowSize);
  }

  /**
   * Writes the string of the field at `offset` of row `i`: `bytes` is the whole string with its terminator (as the
   * game reads it: UTF-16LE with tags for the messages, lanai/message.ts encodeLanaiMessage). The same bytes as the
   * string the field had when read (or points at now, in the pool as read) point the field back at that string.
   */
  setString(i: number, offset: number, bytes: Uint8Array): void {
    this.row(i);
    if (offset < 0 || offset + 4 > this.rowSize || !this.isString(i, offset)) throw new Error(`${this.name}: 行 ${i} +0x${offset.toString(16)} は文字列の欄ではありません`);
    if (!bytes.length) throw new Error(`${this.name}: 文字列が空です (終端も入れます)`);
    const key = i * this.rowSize + offset;
    const cur = this.u32(i, offset);
    const was = this.originalRow(i);
    // a string as read: its bytes at the field's offset in the bytes as read (a string read as UTF-16 may run past the
    // pool when it is not UTF-16; the bytes are still the ones the field pointed at)
    const poolEnd = HEADER + this.basePool;
    const same = [was ? u32(was, offset) : -1, this.written.has(key) ? -1 : cur]
      .find((p) => p >= HEADER && p < poolEnd && p + bytes.length <= this.original.length && equalBytes(this.original.subarray(p, p + bytes.length), bytes));
    if (same !== undefined) {
      if (same === cur && !this.written.has(key)) return;
      this.writable();
      this.written.delete(key);
      w32(this.data, this.at(i, offset), same);
    } else {
      const now = this.written.get(key);
      if (now && equalBytes(now, bytes)) return;
      this.writable();
      this.written.set(key, bytes.slice());
    }
    this.relayout();
  }

  /** The string written into the field at `offset` of row `i` (with its terminator), or null when it was not written. */
  writtenString(i: number, offset: number): Uint8Array | null {
    return this.written.get(i * this.rowSize + offset) ?? null;
  }

  /** Whether the string field at `offset` of row `i` was written (an added row's fields count when they were written). */
  stringChanged(i: number, offset: number): boolean {
    if (this.written.has(i * this.rowSize + offset)) return true;
    const was = this.originalRow(i);
    return !!was && this.isString(i, offset) && u32(was, offset) !== this.u32(i, offset);
  }

  /** The written strings: row, offset in the row, bytes (with the terminator), in the order of the rows. */
  changedStrings(): [row: number, offset: number, bytes: Uint8Array][] {
    return [...this.written].sort((a, b) => a[0] - b[0]).map(([k, b]) => [Math.floor(k / this.rowSize), k % this.rowSize, b]);
  }

  /** Puts the whole table back as it was read (added rows are dropped). */
  revert(): void {
    if (!this.orig) return;
    this.data = this.orig;
    this.orig = null;
    this.written.clear();
    this.revision++;
    this.parse();
  }

  /**
   * Appends a row: a copy of row `from`, or zeros. In a table with row IDs it gets the largest ID + 1 (the IDs stay in
   * order); the copy's string fields point at the same strings (or get a copy of the strings written there) and are
   * relocated like them. Returns the row's index.
   */
  addRow(from?: number): number {
    const src = from === undefined ? new Uint8Array(this.rowSize) : this.row(from).slice();
    const strings = from === undefined ? [] : this.stringOffsetsOf(from);
    const ids = this.rowIds.length ? [...this.rowIds, (Math.max(...this.rowIds.map((x) => x & 0x7fffffff)) + 1 | ROW_ID) >>> 0] : [];
    this.writable();
    if (from !== undefined) for (const k of this.writtenIn(from)) this.written.set(k - from * this.rowSize + this.rows * this.rowSize, this.written.get(k)!);
    this.rebuild([src], ids, strings);
    return this.rows - 1;
  }

  /** Drops the last row when an edit added it. */
  removeLastRow(): void {
    if (this.rows <= this.origRows) throw new Error(`${this.name}: 元の行は消せません`);
    this.writable();
    this.rebuild([], this.rowIds.slice(0, -1), [], 1);
  }

  /** Offsets in row `i` of its relocated fields. */
  private stringOffsetsOf(i: number): number[] {
    const base = this.at(i, 0);
    return [...this.relocs].filter((r) => r >= base && r < base + this.rowSize).map((r) => r - base);
  }

  /** Lays the table out again with the rows it has (after a string was written or put back). */
  private relayout(): void {
    this.rebuild([], this.rowIds.slice(), []);
  }

  /**
   * Lays the table out again with `add` rows appended (or `drop` rows removed from the end): the header and the pool as
   * read stay where they are, the written strings follow (each on 4 bytes, in the order of their fields; with none the
   * rows start where they did when read, else on 16 bytes after them), then the rows, then the row IDs, field names and
   * extra pairs on 16 bytes in the order they had, and the relocations last (those inside a moved region move with it;
   * those of the new rows' string fields are added). Relocated values that point past the pool move with what they
   * point at; the written strings' fields point at their new places.
   */
  private rebuild(add: Uint8Array[], ids: number[], strings: number[], drop = 0): void {
    const d = this.data;
    const rows = this.rows + add.length - drop;
    const keep = Math.min(this.rows, rows);
    const oldData = this.dataOffset;
    const oldEnd = oldData + this.rows * this.rowSize;
    const oldPoolEnd = HEADER + u32(d, 0x0c);
    const relocAt = u32(d, 0x28);
    // the pool: as read, then the written strings
    for (const k of [...this.written.keys()]) if (k >= rows * this.rowSize) this.written.delete(k);
    const placed = new Map<number, number>(); // place -> file offset of its string
    let poolEnd = HEADER + this.basePool;
    for (const k of [...this.written.keys()].sort((x, y) => x - y)) {
      poolEnd = align(poolEnd, STRING_ALIGN);
      placed.set(k, poolEnd);
      poolEnd += this.written.get(k)!.length;
    }
    const data = placed.size ? align(poolEnd, REGION_ALIGN) : this.baseData;
    // the files' pool sizes run up to the rows (padding included) when the rows follow the pool
    const poolSize = !placed.size ? this.basePool : this.baseData === HEADER + this.basePool ? data - HEADER : poolEnd - HEADER;
    const dataEnd = data + rows * this.rowSize;
    const regions = ([[0x18, 0x1c], [0x20, 0x24], [0x30, -1]] as const)
      .filter(([at]) => u32(d, at))
      .map(([at, len]) => {
        const start = u32(d, at);
        // the extra region has no size: it runs up to the next region
        const end = len >= 0 ? start + u32(d, len) : Math.min(...[relocAt, u32(d, 0x20), u32(d, 0x18), d.length].filter((o) => o > start));
        return { at, len, start, end };
      })
      .sort((a, b) => a.start - b.start);
    if (regions.some((r) => r.start < oldEnd) || relocAt < oldEnd) throw new Error(`${this.name}: 行の後ろにない領域があるので、組み直せません`);
    const parts: { at: number; bytes: Uint8Array }[] = [];
    let pos = dataEnd;
    const moved = new Map<number, number>(); // old start -> new start
    for (const r of regions) {
      pos = align(pos, REGION_ALIGN);
      const bytes = r.at === 0x18 ? new Uint8Array(ids.length * 4) : d.slice(r.start, r.end);
      if (r.at === 0x18) ids.forEach((id, i) => w32(bytes, i * 4, id));
      moved.set(r.start, pos);
      parts.push({ at: pos, bytes });
      pos += bytes.length;
    }
    // old file offset -> new (rows and regions move; the header and the pool as read stay)
    const shift = (p: number): number => {
      if (p >= oldData && p < oldEnd) return p - oldData + data;
      for (const r of regions) if (p >= r.start && p < r.end) return p - r.start + moved.get(r.start)!;
      return p;
    };
    // relocations: shift those inside a moved region, drop those of dropped rows, add those of the new rows
    const before = Array.from({ length: u32(d, 0x2c) }, (_, i) => u32(d, relocAt + i * 4));
    const sorted = before.every((p, i) => i === 0 || before[i - 1]! < p);
    const list = before.filter((p) => !(p >= oldData + keep * this.rowSize && p < oldEnd)).map(shift);
    for (let k = 0; k < add.length; k++) for (const s of strings) list.push(data + (this.rows + k) * this.rowSize + s);
    if (sorted) list.sort((a, b) => a - b);
    pos = align(pos, REGION_ALIGN);
    const reloc = pos;
    const out = new Uint8Array(reloc + list.length * 4);
    out.set(this.original.subarray(0, placed.size ? HEADER + this.basePool : this.baseData));
    for (const [k, at] of placed) out.set(this.written.get(k)!, at);
    out.set(d.subarray(oldData, oldData + keep * this.rowSize), data);
    add.forEach((row, k) => out.set(row, data + (this.rows + k) * this.rowSize));
    for (const p of parts) out.set(p.bytes, p.at);
    list.forEach((p, i) => w32(out, reloc + i * 4, p));
    // relocated values past the pool (none in the files) move with what they point at; written strings to their places
    for (const p of list) {
      const v = u32(out, p);
      if (v >= oldPoolEnd && v < d.length) w32(out, p, shift(v));
    }
    for (const [k, at] of placed) w32(out, data + k, at);
    w32(out, 0, rows);
    w32(out, 0x0c, poolSize);
    w32(out, 0x10, data);
    w32(out, 0x14, rows * this.rowSize);
    for (const r of regions) {
      w32(out, r.at, moved.get(r.start)!);
      if (r.at === 0x18) w32(out, 0x1c, ids.length * 4);
    }
    w32(out, 0x28, reloc);
    w32(out, 0x2c, list.length);
    this.data = out;
    this.parse();
  }

  /** The table laid out again with no change (for checking that the layout is the one the files have). */
  relaidOut(): Uint8Array {
    const copy = new LanaiTable(this.data.slice());
    copy.rebuild([], copy.rowIds.slice(), []);
    return copy.data;
  }
}
