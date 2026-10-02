// Field definitions of the GS tables: where a value is in a row, its type, what it means and how it is edited. Each
// game has its own (src/oahu/tables.ts, kaharatables.ts); the RomFS viewer names the columns of a table with them, and
// the books read and write rows through them.
import { u16, u32, w16, w32 } from '../util/bytes';

export type FieldType = 'u8' | 's8' | 'u16' | 's16' | 'u32' | 's32';

/** What a value names besides a number. */
export type FieldRef =
  | { kind: 'message' }
  /** A resource hash (a model entry). */
  | { kind: 'hash' }
  /** A row of another table of the master. */
  | { kind: 'row'; table: string }
  /** One of a few values. */
  | { kind: 'enum'; values: Record<number, string> };

export interface FieldDef {
  /** Name used by the code ('price'). */
  key: string;
  offset: number;
  type: FieldType;
  /** Only these bits of the value: [first bit, count]; signed when the type is. */
  bits?: [number, number];
  label: string;
  ref?: FieldRef;
  /** How the value was found, or what is not known about it. */
  note?: string;
  /** The meaning is a guess or unknown: shown as it is, not offered as an edit. */
  unsure?: boolean;
  /** Another view of bytes a field before already covers (left out of the viewer's columns). */
  alias?: boolean;
  /** Shown in hex (flags). */
  hex?: boolean;
}

export interface TableDef {
  /** File name in the archive ("itemData.bin"). */
  file: string;
  rowSize: number;
  fields: FieldDef[];
}

const SIZE: Record<FieldType, number> = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4 };
const SIGNED: Record<FieldType, boolean> = { u8: false, s8: true, u16: false, s16: true, u32: false, s32: true };

export const fieldSize = (f: FieldDef): number => SIZE[f.type];

function readRaw(row: Uint8Array, f: FieldDef): number {
  switch (SIZE[f.type]) {
    case 1: return row[f.offset]!;
    case 2: return u16(row, f.offset);
    default: return u32(row, f.offset);
  }
}

export function readField(row: Uint8Array, f: FieldDef): number {
  const raw = readRaw(row, f);
  const width = SIZE[f.type] * 8;
  const [shift, count] = f.bits ?? [0, width];
  let v = count >= 32 ? raw >>> 0 : (raw >>> shift) & ((1 << count) - 1);
  if (SIGNED[f.type] && count < 32 && v & (1 << (count - 1))) v -= 1 << count;
  if (SIGNED[f.type] && count >= 32) v |= 0;
  return v;
}

export function fieldRange(f: FieldDef): [number, number] {
  const count = f.bits?.[1] ?? SIZE[f.type] * 8;
  return SIGNED[f.type] ? [-(2 ** (count - 1)), 2 ** (count - 1) - 1] : [0, 2 ** count - 1];
}

export function writeField(row: Uint8Array, f: FieldDef, v: number): void {
  const [min, max] = fieldRange(f);
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${f.label}: ${v} は ${min}〜${max} の外です`);
  const width = SIZE[f.type] * 8;
  const [shift, count] = f.bits ?? [0, width];
  let raw = v;
  if (count < 32) {
    const mask = ((1 << count) - 1) << shift;
    raw = ((readRaw(row, f) & ~mask) | ((v << shift) & mask)) >>> 0;
  }
  switch (SIZE[f.type]) {
    case 1: row[f.offset] = raw & 0xff; break;
    case 2: w16(row, f.offset, raw & 0xffff); break;
    default: w32(row, f.offset, raw >>> 0);
  }
}

export function field(def: TableDef, key: string): FieldDef {
  const f = def.fields.find((x) => x.key === key);
  if (!f) throw new Error(`${def.file} に欄 ${key} がありません`);
  return f;
}

/** "+0x34 u32", "+0x10 bit15-17". */
export function fieldPlace(f: FieldDef): string {
  const o = `+0x${f.offset.toString(16).toUpperCase().padStart(2, '0')}`;
  if (!f.bits) return `${o} ${f.type}`;
  const [s, n] = f.bits;
  return `${o} ${f.type} bit${s}${n > 1 ? `-${s + n - 1}` : ''}`;
}

/** What the viewer needs to show a value as text. */
export interface FieldContext {
  message?(id: number): string | undefined;
  rowName?(table: string, row: number): string | undefined;
}

export function fieldText(f: FieldDef, v: number, ctx: FieldContext = {}): string {
  const r = f.ref;
  if (!r) return f.hex ? `0x${(v >>> 0).toString(16).toUpperCase()}` : String(v);
  switch (r.kind) {
    case 'message': {
      if (!v) return '';
      const t = ctx.message?.(v);
      return t === undefined ? `#${v}` : t;
    }
    case 'hash': return v ? (v >>> 0).toString(16).toUpperCase().padStart(8, '0') : '';
    case 'row': {
      if (!v) return '0';
      const n = ctx.rowName?.(r.table, v);
      return n ? `#${v} ${n}` : `#${v}`;
    }
    case 'enum': return r.values[v] ?? String(v);
  }
}

/** The fields of a definition that cover a row of `rowSize` bytes (a table whose rows are another size is not it). */
export const defFor = (defs: Record<string, TableDef> | undefined, file: string | null, rowSize: number): TableDef | undefined => {
  const d = file ? defs?.[file] : undefined;
  return d && d.rowSize === rowSize ? d : undefined;
};
