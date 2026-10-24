// Backward LZ77 ("BLZ") used for ExeFS .code: decompressed from the end towards the start.
// Footer: u32 bufferTopAndBottom (top = low 24 bits, bottom = high 8 bits), u32 extra size.
import { u32 } from '../util/bytes';

/** Whether `src` ends with a BLZ footer (a decompressed code.bin does not). */
export function isBlz(src: Uint8Array): boolean {
  const size = src.length;
  if (size < 8) return false;
  const topBottom = u32(src, size - 8);
  const top = topBottom & 0xffffff;
  const bottom = topBottom >>> 24;
  return bottom >= 8 && bottom <= 12 && top >= bottom && top <= size;
}

export function blzDecompress(src: Uint8Array): Uint8Array {
  const size = src.length;
  const topBottom = u32(src, size - 8);
  const extra = u32(src, size - 4);
  const top = topBottom & 0xffffff;
  const bottom = topBottom >>> 24;
  if (!isBlz(src)) throw new Error('BLZ: フッターが不正です');
  const out = new Uint8Array(size + extra);
  out.set(src);
  let dst = out.length;
  let s = size - bottom;
  const end = size - top;
  while (s > end) {
    const flag = out[--s]!;
    for (let i = 0; i < 8 && s > end; i++) {
      if ((flag << i) & 0x80) {
        if (s - end < 2) throw new Error('BLZ: 入力が足りません');
        let v = out[--s]! << 8;
        v |= out[--s]!;
        const disp = (v & 0x0fff) + 3;
        const n = ((v >> 12) & 0x0f) + 3;
        if (dst - end < n) throw new Error('BLZ: 出力があふれます');
        for (let j = 0; j < n; j++) {
          dst--;
          out[dst] = out[dst + disp]!;
        }
      } else {
        out[--dst] = out[--s]!;
      }
    }
  }
  return out;
}
