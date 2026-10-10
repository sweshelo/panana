// GS table of 電波人間のRPG FREE! (lanai; naauao lanai/analysis.md §2). A 0x40-byte header, then the regions it points
// at: the string pool (+0x08, always 0x40), the rows (+0x10), the row IDs (+0x18), the names of the string fields
// (+0x20), the extra (hash, value) pairs (+0x30) and the relocations (+0x28, file offsets of the u32s the game turns
// into pointers: the string fields, and the names of the field-name table). A string field holds the file offset of
// its string in the pool.
//   0x00 rows, 0x04 row size, 0x08 pool offset, 0x0C pool size, 0x10 data offset, 0x14 data size (rows × row size),
//   0x18 / 0x1C row IDs (4 × rows), 0x20 / 0x24 field names (8 × fields: name offset, offset in the row),
//   0x28 relocations, 0x2C relocation count, 0x30 extra, 0x34 / 0x38 the table's name (in the pool),
//   0x3C reference count, 0x3E relocated (both 0 in the files).
import { cstr, u32 } from '../util/bytes';

export interface LanaiField {
  name: string;
  /** Offset in the row. */
  offset: number;
}

const HEADER = 0x40;

/** Row IDs at or above this are looked up in the row ID table; smaller ones are row numbers (FUN_0031C038). */
export const ROW_ID = 0x80000000;

export const isRowId = (v: number): boolean => v >= ROW_ID;

export class LanaiTable {
  readonly rows: number;
  readonly rowSize: number;
  readonly dataOffset: number;
  readonly name: string;
  /** The row IDs (0x80000000 | number in most tables), or an empty list when the table has none. */
  readonly rowIds: number[];
  readonly fields: LanaiField[];
  /** File offsets of the relocated u32s. */
  readonly relocs: Set<number>;
  /** The (hash, value) pairs of the extra region (meaning not known). */
  readonly extra: [number, number][];
  private byId?: Map<number, number>;

  constructor(readonly data: Uint8Array) {
    if (!LanaiTable.is(data)) throw new Error('RPG FREE! の GS テーブルではありません');
    const d = data;
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

  u32(i: number, offset: number): number {
    return u32(this.data, this.at(i, offset));
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
}
