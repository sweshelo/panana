// PICA200 texture encoding: the inverse of texture.ts (same formats, tile order and channel layout). Input: RGBA8,
// row 0 = top of the image = first row of the data. ETC1 / ETC1A4 are encoded block by block, trying both sub-block
// splits, the individual and the differential modes and the 8 modifier tables (no search around the average colour).

import { textureDataSize } from './texture';

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
/** 0..255 -> 0..max, rounded. */
const q = (v: number, max: number): number => Math.round((v * max) / 255);
const luma = (r: number, g: number, b: number): number => Math.round(r * 0.299 + g * 0.587 + b * 0.114);

/** Encodes one level (w × h, multiples of 8 except the smallest mipmaps) in the PICA layout of `format`. */
export function encodeTexture(rgba: Uint8Array, w: number, h: number, format: number): Uint8Array {
  const out = new Uint8Array(textureDataSize(format, Math.max(w, 8), Math.max(h, 8)));
  const px = (x: number, y: number): number => (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * 4;
  if (format === 12 || format === 13) {
    encodeEtc1(rgba, w, h, format === 13, px, out);
    return out.subarray(0, textureDataSize(format, w, h));
  }
  let p = 0;
  let nibble = false;
  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let i = 0; i < 64; i++) {
        const o = px(tx + (TILE_ORDER[i]! & 7), ty + (TILE_ORDER[i]! >> 3));
        const r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!, a = rgba[o + 3]!;
        switch (format) {
          case 0: out[p++] = a; out[p++] = b; out[p++] = g; out[p++] = r; break;
          case 1: out[p++] = b; out[p++] = g; out[p++] = r; break;
          case 2: {
            const v = (q(r, 31) << 11) | (q(g, 31) << 6) | (q(b, 31) << 1) | (a >= 128 ? 1 : 0);
            out[p++] = v & 0xff; out[p++] = v >> 8;
            break;
          }
          case 3: {
            const v = (q(r, 31) << 11) | (q(g, 63) << 5) | q(b, 31);
            out[p++] = v & 0xff; out[p++] = v >> 8;
            break;
          }
          case 4: {
            const v = (q(r, 15) << 12) | (q(g, 15) << 8) | (q(b, 15) << 4) | q(a, 15);
            out[p++] = v & 0xff; out[p++] = v >> 8;
            break;
          }
          case 5: out[p++] = a; out[p++] = luma(r, g, b); break;
          case 6: out[p++] = g; out[p++] = r; break;
          case 7: out[p++] = luma(r, g, b); break;
          case 8: out[p++] = a; break;
          case 9: out[p++] = (q(luma(r, g, b), 15) << 4) | q(a, 15); break;
          case 10: case 11: {
            const v = q(format === 10 ? luma(r, g, b) : a, 15);
            if (nibble) out[p] = out[p]! | (v << 4), p++;
            else out[p] = v;
            nibble = !nibble;
            break;
          }
          default:
            throw new Error(`未対応のテクスチャ形式 ${format}`);
        }
      }
    }
  }
  return out.subarray(0, textureDataSize(format, w, h));
}

/** Half size by 2×2 averages (the next mipmap level). */
export function halve(rgba: Uint8Array, w: number, h: number): { rgba: Uint8Array; w: number; h: number } {
  const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) s += rgba[(Math.min(y * 2 + dy, h - 1) * w + Math.min(x * 2 + dx, w - 1)) * 4 + c]!;
        out[(y * W + x) * 4 + c] = (s + 2) >> 2;
      }
    }
  }
  return { rgba: out, w: W, h: H };
}

/**
 * The image data of a texture with `levels` mipmap levels (level 0 = `rgba`, each next one half the size), as many
 * bytes as `length` (the texture's buffer): the levels that do not fit are left out.
 */
export function encodeTextureLevels(rgba: Uint8Array, w: number, h: number, format: number, levels: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  let img = { rgba, w, h };
  for (let i = 0; i < Math.max(1, levels); i++) {
    const n = textureDataSize(format, img.w, img.h);
    if (o + n > length) break;
    out.set(encodeTexture(img.rgba, img.w, img.h, format), o);
    o += n;
    img = halve(img.rgba, img.w, img.h);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// ETC1

function encodeEtc1(rgba: Uint8Array, w: number, h: number, alpha: boolean, px: (x: number, y: number) => number, out: Uint8Array): void {
  let p = 0;
  const block = new Uint8Array(16 * 4);
  const put32 = (v: number): void => {
    out[p++] = v & 0xff; out[p++] = (v >>> 8) & 0xff; out[p++] = (v >>> 16) & 0xff; out[p++] = v >>> 24;
  };
  for (let ty = 0; ty < h; ty += 8) {
    for (let tx = 0; tx < w; tx += 8) {
      for (let bi = 0; bi < 4; bi++) {
        const bx = tx + (bi & 1) * 4;
        const by = ty + (bi >> 1) * 4;
        // pixel i = x * 4 + y (column-major, as the index bits and the alpha nibbles)
        for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) block.set(rgba.subarray(px(bx + x, by + y), px(bx + x, by + y) + 4), (x * 4 + y) * 4);
        if (alpha) {
          let lo = 0, hi = 0;
          for (let i = 0; i < 16; i++) {
            const a = q(block[i * 4 + 3]!, 15);
            if (i < 8) lo |= a << (i * 4);
            else hi |= a << ((i - 8) * 4);
          }
          put32(lo >>> 0); put32(hi >>> 0);
        }
        const [hi, lo] = etc1Block(block);
        put32(lo); put32(hi);
      }
    }
  }
}

/** Best table and indices for a sub-block of pixels `ids` around base colour (r, g, b): [error, table, indices]. */
function fitSub(block: Uint8Array, ids: number[], r: number, g: number, b: number): [number, number, number[]] {
  let best: [number, number, number[]] = [Infinity, 0, []];
  for (let t = 0; t < 8; t++) {
    const lut = ETC1_LUT[t]!;
    let err = 0;
    const idx: number[] = [];
    for (const i of ids) {
      const pr = block[i * 4]!, pg = block[i * 4 + 1]!, pb = block[i * 4 + 2]!;
      let e = Infinity, k = 0;
      for (let m = 0; m < 4; m++) {
        const d = lut[m]!;
        const dr = clamp8(r + d) - pr, dg = clamp8(g + d) - pg, db = clamp8(b + d) - pb;
        const v = dr * dr + dg * dg + db * db;
        if (v < e) { e = v; k = m; }
      }
      err += e;
      idx.push(k);
      if (err >= best[0]) break;
    }
    if (err < best[0]) best = [err, t, idx];
  }
  return best;
}

const SUBS: [number[], number[]][] = (() => {
  const split = (flip: boolean): [number[], number[]] => {
    const a: number[] = [], b: number[] = [];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) ((flip ? y >= 2 : x >= 2) ? b : a).push(x * 4 + y);
    return [a, b];
  };
  return [split(false), split(true)];
})();

/** One ETC1 block of 16 pixels (column-major RGBA): [bits 63..32, bits 31..0] as texture.ts reads them. */
function etc1Block(block: Uint8Array): [number, number] {
  let best = { err: Infinity, hi: 0, lo: 0 };
  for (let flip = 0; flip < 2; flip++) {
    const subs = SUBS[flip]!;
    const avg = subs.map((ids) => [0, 1, 2].map((c) => ids.reduce((s, i) => s + block[i * 4 + c]!, 0) / ids.length));
    const modes: { diff: number; colours: number[][]; bits: number }[] = [];
    // individual: 4 bits each
    const c4 = avg.map((a) => a.map((v) => q(v, 15)));
    modes.push({ diff: 0, colours: c4.map((c) => c.map((v) => v * 17)), bits: ((c4[0]![0]! << 28) | (c4[1]![0]! << 24) | (c4[0]![1]! << 20) | (c4[1]![1]! << 16) | (c4[0]![2]! << 12) | (c4[1]![2]! << 8)) >>> 0 });
    // differential: 5 bits and a 3-bit signed difference
    const c5 = avg.map((a) => a.map((v) => q(v, 31)));
    const d = [0, 1, 2].map((c) => c5[1]![c]! - c5[0]![c]!);
    if (d.every((v) => v >= -4 && v <= 3)) {
      const e5 = (v: number): number => (v << 3) | (v >> 2);
      modes.push({ diff: 1, colours: c5.map((c) => c.map(e5)), bits: ((c5[0]![0]! << 27) | ((d[0]! & 7) << 24) | (c5[0]![1]! << 19) | ((d[1]! & 7) << 16) | (c5[0]![2]! << 11) | ((d[2]! & 7) << 8)) >>> 0 });
    }
    for (const m of modes) {
      const fits = subs.map((ids, s) => fitSub(block, ids, m.colours[s]![0]!, m.colours[s]![1]!, m.colours[s]![2]!));
      const err = fits[0]![0] + fits[1]![0];
      if (err >= best.err) continue;
      let lo = 0;
      fits.forEach(([, , idx], s) => subs[s]!.forEach((i, j) => {
        const k = idx[j]!;
        lo |= ((k & 1) << i) | ((k >> 1) << (i + 16));
      }));
      const hi = (m.bits | (fits[0]![1] << 5) | (fits[1]![1] << 2) | (m.diff << 1) | flip) >>> 0;
      best = { err, hi, lo: lo >>> 0 };
    }
  }
  return [best.hi, best.lo];
}
