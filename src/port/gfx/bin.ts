// Binary helpers of the CGFX port: a little-endian reader with self-relative pointers, and a block writer that
// places structures in an explicit order and resolves pointers, strings and image data at the end.

export class GfxReader {
  readonly dv: DataView;
  constructor(readonly b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8 = (o: number): number => this.b[o]!;
  s8 = (o: number): number => (this.b[o]! << 24) >> 24;
  u16 = (o: number): number => this.dv.getUint16(o, true);
  s16 = (o: number): number => this.dv.getInt16(o, true);
  u32 = (o: number): number => this.dv.getUint32(o, true);
  s32 = (o: number): number => this.dv.getInt32(o, true);
  f32 = (o: number): number => this.dv.getFloat32(o, true);
  bool = (o: number): boolean => this.u32(o) !== 0;
  /** Self-relative pointer at o (0 = null). */
  ptr = (o: number): number => {
    const v = this.u32(o);
    return v === 0 ? 0 : (o + v) >>> 0;
  };
  vec2 = (o: number): [number, number] => [this.f32(o), this.f32(o + 4)];
  vec3 = (o: number): [number, number, number] => [this.f32(o), this.f32(o + 4), this.f32(o + 8)];
  vec4 = (o: number): [number, number, number, number] => [this.f32(o), this.f32(o + 4), this.f32(o + 8), this.f32(o + 12)];
  floats = (o: number, n: number): number[] => Array.from({ length: n }, (_, i) => this.f32(o + i * 4));
  words = (o: number, n: number): number[] => Array.from({ length: n }, (_, i) => this.u32(o + i * 4));
  magic = (o: number): string => String.fromCharCode(this.b[o]!, this.b[o + 1]!, this.b[o + 2]!, this.b[o + 3]!);
  /** NUL-terminated string at an absolute offset (bytes kept as Latin-1 characters). */
  cstr = (o: number): string => {
    let e = o;
    while (e < this.b.length && this.b[e] !== 0) e++;
    return latin1(this.b.subarray(o, e));
  };
  /** String through a pointer at o (null pointer = null). */
  str = (o: number): string | null => {
    const p = this.ptr(o);
    return p ? this.cstr(p) : null;
  };
  /** Count + pointer to a table of pointers -> absolute addresses (0 = null entry). */
  ptrList = (o: number): number[] => {
    const n = this.u32(o);
    const t = this.ptr(o + 4);
    if (!n) return [];
    if (!t) throw new Error(`CGFX: list at ${hex(o)} has ${n} entries and no table`);
    return Array.from({ length: n }, (_, i) => this.ptr(t + i * 4));
  };
  bytes = (o: number, n: number): Uint8Array => this.b.slice(o, o + n);
}

export function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) throw new Error(`CGFX: string ${JSON.stringify(s)} has a character outside Latin-1`);
    out[i] = c;
  }
  return out;
}

export const hex = (v: number): string => '0x' + (v >>> 0).toString(16);

/** A pointer slot of a block: a self-relative pointer to another block (+ add), filled in at layout. */
interface Fix {
  at: number;
  target: Block;
  add: number;
}

/** A structure (or table, or raw data) of the content section. */
export class Block {
  readonly bytes: Uint8Array;
  readonly dv: DataView;
  pos = -1;
  readonly fixes: Fix[] = [];
  readonly strings: { at: number; s: string }[] = [];
  readonly images: { at: number; data: Uint8Array; align: number }[] = [];
  constructor(size: number, readonly label = '', readonly alignment = 4) {
    this.bytes = new Uint8Array(size);
    this.dv = new DataView(this.bytes.buffer);
  }
  get size(): number {
    return this.bytes.length;
  }
  u8(o: number, v: number): this {
    this.bytes[o] = v & 0xff;
    return this;
  }
  u16(o: number, v: number): this {
    this.dv.setUint16(o, v & 0xffff, true);
    return this;
  }
  u32(o: number, v: number): this {
    this.dv.setUint32(o, v >>> 0, true);
    return this;
  }
  s32(o: number, v: number): this {
    this.dv.setInt32(o, v | 0, true);
    return this;
  }
  f32(o: number, v: number): this {
    this.dv.setFloat32(o, v, true);
    return this;
  }
  bool(o: number, v: boolean): this {
    return this.u32(o, v ? 1 : 0);
  }
  floats(o: number, v: readonly number[]): this {
    v.forEach((x, i) => this.f32(o + i * 4, x));
    return this;
  }
  words(o: number, v: readonly number[]): this {
    v.forEach((x, i) => this.u32(o + i * 4, x));
    return this;
  }
  set(o: number, data: Uint8Array): this {
    this.bytes.set(data, o);
    return this;
  }
  /** Pointer to a block (null leaves 0). */
  ptr(o: number, target: Block | null | undefined, add = 0): this {
    if (target) this.fixes.push({ at: o, target, add });
    return this;
  }
  /** Pointer to a string of the string section (null leaves 0). */
  str(o: number, s: string | null | undefined): this {
    if (s !== null && s !== undefined) this.strings.push({ at: o, s });
    return this;
  }
  /** Count + pointer to image section data. */
  image(o: number, data: Uint8Array | null, align = 4): this {
    if (!data) return this;
    this.u32(o, data.length);
    this.images.push({ at: o + 4, data, align });
    return this;
  }
}

/**
 * Layout of a CGFX file: content blocks in the order they are placed, then the strings (in order of their first
 * reference), then the IMAG section (image data in order of reference).
 */
export class GfxLayout {
  readonly blocks: Block[] = [];
  /** Places a block after the previous one. */
  place(b: Block): Block {
    if (b.pos !== -1 || this.blocks.includes(b)) throw new Error(`CGFX writer: block ${b.label} placed twice`);
    this.blocks.push(b);
    return b;
  }
  /** Places a new block of `size` bytes. */
  add(size: number, label = '', alignment = 4): Block {
    return this.place(new Block(size, label, alignment));

  }

  /** Builds the file. `start` = offset of the first block, `header(total, dataEnd, imageStart)` writes the header. */
  build(start: number, finish: (out: Uint8Array, contentEnd: number, imageStart: number, imageEnd: number) => void): Uint8Array {
    let pos = start;
    for (const b of this.blocks) {
      pos = align(pos, b.alignment);
      b.pos = pos;
      pos += b.size;
    }
    const contentEnd = pos;
    // Strings: first reference (by position) decides the order; equal strings share one copy.
    const refs: { at: number; s: string }[] = [];
    for (const b of this.blocks) for (const r of b.strings) refs.push({ at: b.pos + r.at, s: r.s });
    refs.sort((a, b) => a.at - b.at);
    const strPos = new Map<string, number>();
    const strParts: Uint8Array[] = [];
    for (const r of refs) {
      if (strPos.has(r.s)) continue;
      strPos.set(r.s, pos);
      const bytes = latin1Bytes(r.s);
      strParts.push(bytes);
      pos += bytes.length + 1;
    }
    const strEnd = pos;
    // Image data in order of reference.
    const imgs: { at: number; data: Uint8Array; align: number }[] = [];
    for (const b of this.blocks) for (const r of b.images) imgs.push({ at: b.pos + r.at, data: r.data, align: r.align });
    imgs.sort((a, b) => a.at - b.at);
    // The IMAG header follows the strings, placed so that its data starts at the largest alignment of the chunks.
    pos = align(pos, 4);
    if (imgs.length) pos = align(pos + 8, Math.max(...imgs.map((i) => i.align))) - 8;
    const imageStart = pos;
    pos += 8;
    const imgPos: number[] = [];
    for (const r of imgs) {
      pos = align(pos, r.align);
      imgPos.push(pos);
      pos += r.data.length;
    }
    const imageEnd = imgs.length ? pos : imageStart;
    const out = new Uint8Array(imageEnd);
    const dv = new DataView(out.buffer);
    for (const b of this.blocks) {
      out.set(b.bytes, b.pos);
      for (const f of b.fixes) {
        if (f.target.pos < 0) throw new Error(`CGFX writer: block ${f.target.label} (pointed from ${b.label}) was never placed`);
        dv.setUint32(b.pos + f.at, (f.target.pos + f.add - (b.pos + f.at)) >>> 0, true);
      }
      for (const r of b.strings) dv.setUint32(b.pos + r.at, (strPos.get(r.s)! - (b.pos + r.at)) >>> 0, true);
    }
    let sp = contentEnd;
    for (const p of strParts) {
      out.set(p, sp);
      sp += p.length + 1;
    }
    if (sp !== strEnd) throw new Error('CGFX writer: string section size');
    imgs.forEach((r, i) => {
      out.set(r.data, imgPos[i]!);
      dv.setUint32(r.at, (imgPos[i]! - r.at) >>> 0, true);
    });
    finish(out, contentEnd, imageStart, imageEnd);
    return out;
  }
}

export const align = (v: number, a: number): number => (a <= 1 ? v : Math.ceil(v / a) * a);
