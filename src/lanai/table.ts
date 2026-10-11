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
// and rows can be added at the end (the regions after the rows move; the pool, which the string fields point into,
// does not). Strings are not edited: the pool would have to be rebuilt.
import { align, cstr, equalBytes, u16, u32, w16, w32 } from '../util/bytes';

export interface LanaiField {
  name: string;
  /** Offset in the row. */
  offset: number;
}

const HEADER = 0x40;
/** Alignment of the regions after the rows. */
const REGION_ALIGN = 0x10;

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
  /** Bumped by every edit (for views that cache what they read). */
  revision = 0;

  constructor(data: Uint8Array) {
    if (!LanaiTable.is(data)) throw new Error('RPG FREE! の GS テーブルではありません');
    this.data = data;
    this.parse();
    this.origRows = this.rows;
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
    const o = this.dataOffset + i * this.rowSize;
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

  /** Writes a whole row (same size; its string fields must keep their values). */
  setRow(i: number, bytes: Uint8Array): void {
    if (bytes.length !== this.rowSize) throw new RangeError(`${this.name}: 行の大きさが違います`);
    const base = this.at(i, 0);
    for (const r of this.relocs) if (r >= base && r < base + this.rowSize && u32(bytes, r - base) !== u32(this.data, r)) throw new Error(`${this.name}: 行 ${i} の文字列の欄は書き換えられません`);
    this.row(i);
    this.writable();
    this.data.set(bytes, base);
  }

  /** Puts row `i` back as it was read (an added row cannot be: remove it with removeLastRow). */
  revertRow(i: number): void {
    const o = this.originalRow(i);
    if (!o) throw new Error(`${this.name}: 行 ${i} は追加した行です`);
    if (equalBytes(o, this.row(i))) return;
    this.writable();
    this.data.set(o, this.at(i, 0));
  }

  /** Puts the whole table back as it was read (added rows are dropped). */
  revert(): void {
    if (!this.orig) return;
    this.data = this.orig;
    this.orig = null;
    this.revision++;
    this.parse();
  }

  /**
   * Appends a row: a copy of row `from`, or zeros. In a table with row IDs it gets the largest ID + 1 (the IDs stay in
   * order); the copy's string fields point at the same strings and are relocated like them. Returns the row's index.
   */
  addRow(from?: number): number {
    const src = from === undefined ? new Uint8Array(this.rowSize) : this.row(from).slice();
    const strings = from === undefined ? [] : this.stringOffsetsOf(from);
    const ids = this.rowIds.length ? [...this.rowIds, (Math.max(...this.rowIds.map((x) => x & 0x7fffffff)) + 1 | ROW_ID) >>> 0] : [];
    this.writable();
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

  /**
   * Lays the table out again with `add` rows appended (or `drop` rows removed from the end): the header, the pool and
   * the rows stay where they are, the row IDs, field names and extra pairs follow on 16 bytes in the order they had, and
   * the relocations come last (those inside a moved region move with it; those of the new rows' string fields are added).
   */
  private rebuild(add: Uint8Array[], ids: number[], strings: number[], drop = 0): void {
    const d = this.data;
    const rows = this.rows + add.length - drop;
    const dataEnd = this.dataOffset + rows * this.rowSize;
    const oldEnd = this.dataOffset + this.rows * this.rowSize;
    const relocAt = u32(d, 0x28);
    const regions = ([[0x18, 0x1c], [0x20, 0x24], [0x30, -1]] as const)
      .filter(([at]) => u32(d, at))
      .map(([at, len]) => {
        const start = u32(d, at);
        // the extra region has no size: it runs up to the next region
        const end = len >= 0 ? start + u32(d, len) : Math.min(...[relocAt, u32(d, 0x20), u32(d, 0x18), d.length].filter((o) => o > start));
        return { at, len, start, end };
      })
      .sort((a, b) => a.start - b.start);
    if (regions.some((r) => r.start < oldEnd) || relocAt < oldEnd) throw new Error(`${this.name}: 行の後ろにない領域があるので、行を足せません`);
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
    // relocations: shift those inside a moved region, drop those of dropped rows, add those of the new rows
    const shift = (p: number): number => {
      for (const r of regions) if (p >= r.start && p < r.end) return p - r.start + moved.get(r.start)!;
      return p;
    };
    const before = Array.from({ length: u32(d, 0x2c) }, (_, i) => u32(d, relocAt + i * 4));
    const sorted = before.every((p, i) => i === 0 || before[i - 1]! < p);
    const list = before.filter((p) => !(p >= dataEnd && p < oldEnd)).map(shift);
    for (let k = 0; k < add.length; k++) for (const s of strings) list.push(this.dataOffset + (this.rows + k) * this.rowSize + s);
    if (sorted) list.sort((a, b) => a - b);
    pos = align(pos, REGION_ALIGN);
    const reloc = pos;
    const out = new Uint8Array(reloc + list.length * 4);
    out.set(d.subarray(0, Math.min(oldEnd, dataEnd)));
    add.forEach((row, k) => out.set(row, oldEnd + k * this.rowSize));
    for (const p of parts) out.set(p.bytes, p.at);
    list.forEach((p, i) => w32(out, reloc + i * 4, p));
    w32(out, 0, rows);
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
