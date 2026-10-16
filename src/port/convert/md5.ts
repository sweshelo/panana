// MD5 (RFC 1321) and the 32-bit fold SPICA uses for the CGFX material hashes (GfxMaterial.HashBuffer).

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input: Uint8Array): Uint8Array {
  const len = input.length;
  const n = (((len + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(n);
  buf.set(input);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n - 8, (len * 8) >>> 0, true);
  dv.setUint32(n - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(o + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i]! + m[g]!) >>> 0;
      b = (b + ((x << S[i]!) | (x >>> (32 - S[i]!)))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}

/** SPICA's hash of a byte buffer: the MD5 bytes xor-folded into 32 bits (never 0). */
export function foldHash(input: Uint8Array): number {
  const b = md5(input);
  let h = 0;
  for (let i = 0; i < 16; i++) h = (h ^ (b[i]! << ((i & 3) * 8))) >>> 0;
  return h || 1;
}

/** foldHash of a string's UTF-8 bytes. */
export const hashText = (s: string): number => foldHash(new TextEncoder().encode(s));
