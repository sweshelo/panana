// GS data table (*.bin): u32 rows, u32 row size, ..., 0x10 u32 data offset, name at 0x30 (tools/gstable.py).
import { cstr, u32 } from '../util/bytes';

export class GsTable {
  readonly rows: number;
  readonly rowSize: number;
  readonly offset: number;
  readonly name: string;
  constructor(readonly data: Uint8Array) {
    this.rows = u32(data, 0);
    this.rowSize = u32(data, 4);
    this.offset = u32(data, 0x10);
    this.name = cstr(data.subarray(0, this.offset), 0x30);
  }
  row(i: number): Uint8Array {
    if (i < 0 || i >= this.rows) throw new RangeError(`${this.name}: 行 ${i} は範囲外です (${this.rows} 行)`);
    const o = this.offset + i * this.rowSize;
    return this.data.subarray(o, o + this.rowSize);
  }
}
