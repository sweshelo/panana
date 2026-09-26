// Little-endian byte helpers shared by every parser.

export function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

export const u8 = (b: Uint8Array, o: number): number => b[o]!;
export const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
export const s16 = (b: Uint8Array, o: number): number => (u16(b, o) << 16) >> 16;
export const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
export const s32 = (b: Uint8Array, o: number): number => u32(b, o) | 0;
export const u64 = (b: Uint8Array, o: number): number => u32(b, o) + u32(b, o + 4) * 0x100000000;
export const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
export const u32be = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
export const u64be = (b: Uint8Array, o: number): number => u32be(b, o) * 0x100000000 + u32be(b, o + 4);
export const f32 = (b: Uint8Array, o: number): number => view(b).getFloat32(o, true);

export function w16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}
export function w32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

export function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]!);
  return s;
}

/** NUL-terminated ASCII string. */
export function cstr(b: Uint8Array, o: number): string {
  let s = '';
  while (o < b.length && b[o] !== 0) s += String.fromCharCode(b[o++]!);
  return s;
}

/** NUL-terminated UTF-16LE string. */
export function wstr(b: Uint8Array, o: number, maxBytes = Infinity): string {
  let s = '';
  for (let i = 0; i + 1 < maxBytes && o + 1 < b.length; i += 2, o += 2) {
    const c = u16(b, o);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function hex8(v: number): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const align = (v: number, a: number): number => Math.ceil(v / a) * a;
