// Map database: RomFS archive A90C8038, entry A2C14C00 (LZ10). docs/map.md §1.
//   u32 count, count x {u32 hash, u32 offset, u32 size} (hash ascending), then data (offsets from data start)
import { u32, w32 } from '../util/bytes';

export const MAPDB_ARCHIVE = 'A90C8038';
export const MAPDB_ENTRY = 0xa2c14c00;

interface DbEntry {
  hash: number;
  offset: number;
  size: number;
}

export class MapDb {
  private readonly index: DbEntry[];
  private readonly data: Uint8Array;
  /** Replaced entries (hash -> bytes). */
  private readonly changes = new Map<number, Uint8Array>();

  constructor(bytes: Uint8Array) {
    const n = u32(bytes, 0);
    const base = 4 + n * 12;
    this.index = [];
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 12;
      this.index.push({ hash: u32(bytes, o), offset: u32(bytes, o + 4), size: u32(bytes, o + 8) });
    }
    this.data = bytes.subarray(base);
  }

  get count(): number {
    return this.index.length;
  }

  has(hash: number): boolean {
    return this.index.some((e) => e.hash === hash);
  }

  /** Entry bytes, or an empty array when the hash is not in the index. */
  get(hash: number): Uint8Array {
    const c = this.changes.get(hash);
    if (c) return c;
    const e = this.index.find((x) => x.hash === hash);
    return e ? this.data.subarray(e.offset, e.offset + e.size) : new Uint8Array(0);
  }

  original(hash: number): Uint8Array {
    const e = this.index.find((x) => x.hash === hash);
    return e ? this.data.subarray(e.offset, e.offset + e.size) : new Uint8Array(0);
  }

  set(hash: number, bytes: Uint8Array): void {
    if (!this.has(hash)) throw new Error(`マップ DB に ${hash.toString(16)} がありません`);
    this.changes.set(hash, bytes);
  }

  /** Add an entry (a section of a new map). The game finds it once the index is sorted again by {@link build}. */
  add(hash: number, bytes: Uint8Array): void {
    if (this.has(hash)) throw new Error(`マップ DB に ${hash.toString(16)} はもうあります`);
    // After every original block, so the original data keeps its order.
    this.index.push({ hash, offset: this.data.length, size: 0 });
    this.changes.set(hash, bytes);
  }

  /**
   * Rebuild: data blocks keep their original order (so an unedited DB is byte-identical), replaced blocks
   * take their new size, offsets are recomputed with no gaps, the index is sorted by hash. Section hashes
   * never change.
   */
  build(): Uint8Array {
    // Empty entries share the offset of the next block; sorting by (offset, size) keeps them in front of it.
    const byOffset = [...this.index].sort((a, b) => a.offset - b.offset || a.size - b.size || a.hash - b.hash);
    const newOffset = new Map<number, number>();
    const blocks: Uint8Array[] = [];
    let pos = 0;
    // Entries that share the same bytes (same offset and size) stay shared unless one of them changed.
    const shared = new Map<string, number>();
    for (const e of byOffset) {
      const changed = this.changes.get(e.hash);
      if (!changed && e.size > 0) {
        const key = `${e.offset}:${e.size}`;
        const prev = shared.get(key);
        if (prev !== undefined) {
          newOffset.set(e.hash, prev);
          continue;
        }
        shared.set(key, pos);
      }
      const body = changed ?? this.data.subarray(e.offset, e.offset + e.size);
      newOffset.set(e.hash, pos);
      blocks.push(body);
      pos += body.length;
    }
    const sorted = [...this.index].sort((a, b) => a.hash - b.hash);
    const base = 4 + sorted.length * 12;
    const out = new Uint8Array(base + pos);
    w32(out, 0, sorted.length);
    sorted.forEach((e, i) => {
      w32(out, 4 + i * 12, e.hash);
      w32(out, 8 + i * 12, newOffset.get(e.hash)!);
      w32(out, 12 + i * 12, this.get(e.hash).length);
    });
    let p = base;
    for (const b of blocks) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }
}
