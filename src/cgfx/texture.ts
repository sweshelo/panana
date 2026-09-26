// PICA200 texture decoding (formats and tile order as in Ohana3DS TextureCodec). Output: RGBA8, row 0 =
// first row of the data = top of the image (the models' UVs use v = 0 at the bottom; see cgfx/three.ts).

export const TEX_FORMAT = [
  'RGBA8', 'RGB8', 'RGBA5551', 'RGB565', 'RGBA4', 'LA8', 'HILO8', 'L8', 'A8', 'LA4', 'L4', 'A4', 'ETC1', 'ETC1A4',
] as const;

const BPP = [32, 24, 16, 16, 16, 16, 16, 8, 8, 8, 4, 4, 4, 8];

export function textureDataSize(format: number, w: number, h: number): number {
  return (w * h * (BPP[format] ?? 32)) / 8;
}

// Morton order of the 64 pixels in an 8x8 tile.
const TILE_ORDER = [
  0, 1, 8, 9, 2, 3, 10, 11, 16, 17, 24, 25, 18, 19, 26, 27, 4, 5, 12, 13, 6, 7, 14, 15, 20, 21, 28, 29, 22, 23, 30, 31,
  32, 33, 40, 41, 34, 35, 42, 43, 48, 49, 56, 57, 50, 51, 58, 59, 36, 37, 44, 45, 38, 39, 46, 47, 52, 53, 60, 61, 54,
  55, 62, 63,
];

const ETC1_LUT = [
  [2, 8, -2, -8], [5, 17, -5, -17], [9, 29, -9, -29], [13, 42, -13, -42],
  [18, 60, -18, -60], [24, 80, -24, -80], [33, 106, -33, -106], [47, 183, -47, -183],
];

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export function decodeTexture(data: Uint8Array, w: number, h: number, format: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  if (format === 12 || format === 13) {
    decodeEtc1(data, w, h, format === 13, out);
    return out;
  }
  let p = 0;
  let nibble = false;
  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let i = 0; i < 64; i++) {
        const x = TILE_ORDER[i]! & 7;
        const y = TILE_ORDER[i]! >> 3;
        const o = ((ty + y) * w + tx + x) * 4;
        let r = 0, g = 0, b = 0, a = 255;
        switch (format) {
          case 0: // RGBA8 stored as A B G R
            a = data[p]!; b = data[p + 1]!; g = data[p + 2]!; r = data[p + 3]!;
            p += 4;
            break;
          case 1: // RGB8 stored as B G R
            b = data[p]!; g = data[p + 1]!; r = data[p + 2]!;
            p += 3;
            break;
          case 2: {
            const v = data[p]! | (data[p + 1]! << 8);
            r = ((v >> 11) & 31) * 255 / 31; g = ((v >> 6) & 31) * 255 / 31; b = ((v >> 1) & 31) * 255 / 31;
            a = v & 1 ? 255 : 0;
            p += 2;
            break;
          }
          case 3: {
            const v = data[p]! | (data[p + 1]! << 8);
            r = ((v >> 11) & 31) * 255 / 31; g = ((v >> 5) & 63) * 255 / 63; b = (v & 31) * 255 / 31;
            p += 2;
            break;
          }
          case 4: {
            const v = data[p]! | (data[p + 1]! << 8);
            r = ((v >> 12) & 15) * 17; g = ((v >> 8) & 15) * 17; b = ((v >> 4) & 15) * 17; a = (v & 15) * 17;
            p += 2;
            break;
          }
          case 5: // LA8: A, L
            a = data[p]!; r = g = b = data[p + 1]!;
            p += 2;
            break;
          case 6: // HILO8
            g = data[p]!; r = data[p + 1]!; b = 0;
            p += 2;
            break;
          case 7:
            r = g = b = data[p++]!;
            break;
          case 8:
            r = g = b = 255; a = data[p++]!;
            break;
          case 9: {
            const v = data[p++]!;
            r = g = b = (v >> 4) * 17; a = (v & 15) * 17;
            break;
          }
          case 10: case 11: {
            const v = nibble ? data[p++]! >> 4 : data[p]! & 15;
            nibble = !nibble;
            if (format === 10) r = g = b = v * 17;
            else { r = g = b = 255; a = v * 17; }
            break;
          }
          default:
            throw new Error(`未対応のテクスチャ形式 ${format}`);
        }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      }
    }
  }
  return out;
}

// ETC1: 8x8 tiles made of four 4x4 blocks in Z order; each block is a little-endian u64
// (ETC1A4: preceded by a u64 of 4-bit alphas, column-major).
function decodeEtc1(data: Uint8Array, w: number, h: number, alpha: boolean, out: Uint8Array): void {
  let p = 0;
  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let bi = 0; bi < 4; bi++) {
        const bx = tx + (bi & 1) * 4;
        const by = ty + (bi >> 1) * 4;
        let alphaLo = 0xffffffff, alphaHi = 0xffffffff;
        if (alpha) {
          alphaLo = (data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16) | (data[p + 3]! << 24)) >>> 0;
          alphaHi = (data[p + 4]! | (data[p + 5]! << 8) | (data[p + 6]! << 16) | (data[p + 7]! << 24)) >>> 0;
          p += 8;
        }
        const lo = (data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16) | (data[p + 3]! << 24)) >>> 0;
        const hi = (data[p + 4]! | (data[p + 5]! << 8) | (data[p + 6]! << 16) | (data[p + 7]! << 24)) >>> 0;
        p += 8;
        etc1Block(hi, lo, (x, y, r, g, b) => {
          const X = bx + x;
          const Y = by + y;
          if (X >= w || Y >= h) return;
          const o = (Y * w + X) * 4;
          const i = x * 4 + y; // alpha nibbles are column-major
          const nib = i < 8 ? (alphaLo >>> (i * 4)) & 15 : (alphaHi >>> ((i - 8) * 4)) & 15;
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = alpha ? nib * 17 : 255;
        });
      }
    }
  }
}

/** Standard ETC1 block: hi = bits 63..32 (colours, tables, flags), lo = pixel index bits. */
function etc1Block(hi: number, lo: number, put: (x: number, y: number, r: number, g: number, b: number) => void): void {
  const diff = (hi >>> 1) & 1;
  const flip = hi & 1;
  const t1 = (hi >>> 5) & 7;
  const t2 = (hi >>> 2) & 7;
  let r1, g1, b1, r2, g2, b2;
  if (diff) {
    const R = (hi >>> 27) & 31, G = (hi >>> 19) & 31, B = (hi >>> 11) & 31;
    const dr = ((((hi >>> 24) & 7) << 29) >> 29), dg = ((((hi >>> 16) & 7) << 29) >> 29), db = ((((hi >>> 8) & 7) << 29) >> 29);
    const e5 = (v: number): number => (v << 3) | (v >> 2);
    r1 = e5(R); g1 = e5(G); b1 = e5(B);
    r2 = e5((R + dr) & 31); g2 = e5((G + dg) & 31); b2 = e5((B + db) & 31);
  } else {
    r1 = ((hi >>> 28) & 15) * 17; g1 = ((hi >>> 20) & 15) * 17; b1 = ((hi >>> 12) & 15) * 17;
    r2 = ((hi >>> 24) & 15) * 17; g2 = ((hi >>> 16) & 15) * 17; b2 = ((hi >>> 8) & 15) * 17;
  }
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const second = flip ? y >= 2 : x >= 2;
      const i = x * 4 + y;
      const idx = ((lo >>> i) & 1) | (((lo >>> (i + 16)) & 1) << 1);
      // idx: msb<<1 | lsb -> modifier table order {+a, +b, -a, -b} is (0:+small, 1:+large, 2:-small, 3:-large)
      const mod = ETC1_LUT[second ? t2 : t1]![idx]!;
      if (second) put(x, y, clamp8(r2 + mod), clamp8(g2 + mod), clamp8(b2 + mod));
      else put(x, y, clamp8(r1 + mod), clamp8(g1 + mod), clamp8(b1 + mod));
    }
  }
}
