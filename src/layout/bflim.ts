// 3DS BFLIM: the CLIM pixel formats, but format/swizzle follow a u16 alignment in imag.
// Swizzle 8 transposes, 4 rotates 90° (ObsidianX/3dstools bflim.py).
import { decodeTexture, textureDataSize } from '../cgfx/texture';
import { ascii, u16, u32 } from '../util/bytes';
import type { Bclim } from './bclim';

const PICA = [7, 8, 9, 5, 6, 3, 1, 2, 4, 0, 12, 13, 10, 11];
const pow2 = (n: number): number => Math.max(8, 2 ** Math.ceil(Math.log2(n)));

export function readBflim(b: Uint8Array): Bclim {
  const foot = b.length - 0x28,
    imag = foot + 0x14;
  if (foot < 0 || ascii(b, foot, 4) !== 'FLIM' || u16(b, foot + 4) !== 0xfeff || ascii(b, imag, 4) !== 'imag')
    throw new Error('対応する BFLIM ではありません');
  const height = u16(b, imag + 8),
    width = u16(b, imag + 10),
    swizzle = b[imag + 15]!;
  const format = PICA[b[imag + 14]!],
    tw = pow2(width),
    th = pow2(height);
  if (
    !width ||
    !height ||
    format === undefined ||
    ![0, 4, 8].includes(swizzle) ||
    textureDataSize(format, tw, th) > foot ||
    u32(b, imag + 16) > foot
  )
    throw new Error('BFLIM の画像形式・大きさが不正です');
  const full = decodeTexture(b, tw, th, format),
    transposed = swizzle !== 0;
  const outWidth = transposed ? height : width,
    outHeight = transposed ? width : height;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < outHeight; y++)
    for (let x = 0; x < outWidth; x++) {
      const sx = swizzle === 8 ? y : swizzle === 4 ? width - 1 - y : x;
      const sy = transposed ? x : y,
        at = (sy * tw + sx) * 4;
      rgba.set(full.subarray(at, at + 4), (y * outWidth + x) * 4);
    }
  return { width: outWidth, height: outHeight, rgba };
}
