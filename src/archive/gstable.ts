// GS data table (*.bin): header u32 rows, row size, ..., +0x10 data offset, +0x14 data size, +0x18 file
// size, +0x20 offset of an optional hash index ({u32 hash, u32 row} sorted by hash, then {0, 0}), name
// at +0x30 (tools/gstable.py).
import { align, cstr, u32, w32 } from '../util/bytes';

export class GsTable {
  constructor(public data: Uint8Array) {}

  get rows(): number {
    return u32(this.data, 0);
  }
  get rowSize(): number {
    return u32(this.data, 4);
  }
  get offset(): number {
    return u32(this.data, 0x10);
  }
  get name(): string {
    return cstr(this.data.subarray(0, this.offset), 0x30);
  }
  /** Offset of the hash index (0 = none). */
  get indexOffset(): number {
    return u32(this.data, 0x20);
  }

  row(i: number): Uint8Array {
    if (i < 0 || i >= this.rows) throw new RangeError(`${this.name}: 行 ${i} は範囲外です (${this.rows} 行)`);
    const o = this.offset + i * this.rowSize;
    return this.data.subarray(o, o + this.rowSize);
  }

  hashes(): Set<number> {
    const out = new Set<number>();
    const idx = this.indexOffset;
    if (idx) for (let o = idx; o + 8 <= this.data.length; o += 8) out.add(u32(this.data, o));
    return out;
  }

  /** Hash index: hash -> row. */
  hashIndex(): Map<number, number> {
    const out = new Map<number, number>();
    const idx = this.indexOffset;
    if (idx)
      for (let o = idx; o + 8 <= this.data.length; o += 8) {
        const h = u32(this.data, o);
        if (h) out.set(h, u32(this.data, o + 4));
      }
    return out;
  }

  /**
   * The table with its rows replaced (the header before the rows is kept). A hash index keeps the entries of the
   * rows that remain and gets a new hash for each added row.
   */
  withRows(rows: Uint8Array[]): Uint8Array {
    const size = this.rowSize;
    for (const r of rows) if (r.length !== size) throw new Error(`${this.name}: 行の大きさが違います`);
    const n = rows.length;
    const idx = this.indexOffset;
    const entries: [number, number][] = [];
    if (idx) {
      const used = new Set<number>();
      for (let o = idx; o + 8 <= this.data.length; o += 8) {
        const h = u32(this.data, o), r = u32(this.data, o + 4);
        if (h === 0 && r === 0) continue; // terminator
        used.add(h);
        if (r < n) entries.push([h, r]);
      }
      const have = new Set(entries.map((e) => e[1]));
      let hash = (0x7e600000 + n) >>> 0;
      for (let r = 0; r < n; r++) {
        if (have.has(r)) continue;
        while (used.has(hash)) hash = (hash + 0x10001) >>> 0;
        used.add(hash);
        entries.push([hash, r]);
      }
      entries.sort((a, b) => a[0] - b[0]);
    }
    const dataEnd = this.offset + n * size;
    const newIdx = idx ? align(dataEnd, 8) : 0;
    const total = idx ? newIdx + (entries.length + 1) * 8 : dataEnd;
    const out = new Uint8Array(total);
    out.set(this.data.subarray(0, this.offset));
    rows.forEach((r, i) => out.set(r, this.offset + i * size));
    entries.forEach(([h, r], i) => {
      w32(out, newIdx + i * 8, h);
      w32(out, newIdx + i * 8 + 4, r);
    });
    w32(out, 0, n);
    w32(out, 0x14, n * size);
    w32(out, 0x18, total);
    if (idx) w32(out, 0x20, newIdx);
    return out;
  }

  /** Append a row (and its hash to the index when the table has one). Returns the new row number. */
  append(row: Uint8Array, hash = 0): number {
    const size = this.rowSize;
    if (row.length !== size) throw new Error(`${this.name}: 行の大きさが違います`);
    const n = this.rows;
    const dataEnd = this.offset + n * size;
    const idx = this.indexOffset;
    const entries: [number, number][] = [];
    if (idx) {
      for (let o = idx; o + 8 <= this.data.length; o += 8) {
        const h = u32(this.data, o), r = u32(this.data, o + 4);
        if (h === 0 && r === 0) continue; // terminator
        entries.push([h, r]);
      }
      if (!hash || entries.some((e) => e[0] === hash)) throw new Error(`${this.name}: 索引のハッシュが不正です`);
      entries.push([hash, n]);
      entries.sort((a, b) => a[0] - b[0]);
    }
    const newEnd = dataEnd + size;
    const newIdx = idx ? align(newEnd, 8) : 0;
    const total = idx ? newIdx + (entries.length + 1) * 8 : newEnd;
    const out = new Uint8Array(total);
    out.set(this.data.subarray(0, dataEnd));
    out.set(row, dataEnd);
    if (idx) entries.forEach(([h, r], i) => {
      w32(out, newIdx + i * 8, h);
      w32(out, newIdx + i * 8 + 4, r);
    });
    w32(out, 0, n + 1);
    w32(out, 0x14, (n + 1) * size);
    w32(out, 0x18, total);
    if (idx) w32(out, 0x20, newIdx);
    this.data = out;
    return n;
  }
}
