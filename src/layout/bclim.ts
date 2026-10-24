// BCLIM (a layout's image): the PICA200 texture data, then the footer "CLIM" (0x14 bytes) and its "imag" block (u32
// size, u16 width, u16 height, u32 format). The data is tiled like a model's texture, with the size
// rounded up to a power of 2 (at least 8). The formats are numbered in another order than the PICA's.
import { decodeTexture } from '../cgfx/texture';
import { u16 } from '../util/bytes';

/** BCLIM format -> PICA200 format (cgfx/texture.ts TEX_FORMAT). */
const PICA = [7, 8, 9, 5, 6, 3, 1, 2, 4, 0, 12, 13, 10, 11];

export interface Bclim {
  width: number;
  height: number;
  /** RGBA8 of width × height, top row first. */
  rgba: Uint8Array;
}

const pow2 = (n: number): number => Math.max(8, 1 << Math.ceil(Math.log2(n)));

export function readBclim(b: Uint8Array): Bclim {
  const foot = b.length - 0x28;
  if (String.fromCharCode(...b.subarray(foot, foot + 4)) !== 'CLIM') throw new Error('BCLIM ではありません');
  const imag = foot + u16(b, foot + 6);
  if (String.fromCharCode(...b.subarray(imag, imag + 4)) !== 'imag') throw new Error('BCLIM の imag がありません');
  const width = u16(b, imag + 8);
  const height = u16(b, imag + 10);
  const format = PICA[b[imag + 0xc]!];
  if (format === undefined) throw new Error(`BCLIM の形式 ${b[imag + 0xc]} は読めません`);
  const tw = pow2(width);
  const th = pow2(height);
  const full = decodeTexture(b, tw, th, format);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(full.subarray(y * tw * 4, y * tw * 4 + width * 4), y * width * 4);
  return { width, height, rgba };
}
