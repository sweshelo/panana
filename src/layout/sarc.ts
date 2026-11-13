// Little-endian SARC layouts (RPG FREE!'s Stage_symbol*.arc): SFAT nodes and SFNT names.
import { ascii, cstr, u16, u32 } from '../util/bytes';

export function readSarc(b: Uint8Array): Map<string, Uint8Array> {
  if (b.length < 0x20 || ascii(b, 0, 4) !== 'SARC' || u16(b, 6) !== 0xfeff)
    throw new Error('対応する SARC ではありません');
  const fat = u16(b, 4),
    data = u32(b, 0xc);
  if (ascii(b, fat, 4) !== 'SFAT') throw new Error('SARC の SFAT がありません');
  const count = u16(b, fat + 6),
    nodes = fat + u16(b, fat + 4),
    fnt = nodes + count * 16;
  if (fnt + 8 > b.length || ascii(b, fnt, 4) !== 'SFNT') throw new Error('SARC の SFNT がありません');
  const names = fnt + u16(b, fnt + 4),
    out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const at = nodes + i * 16,
      attr = u32(b, at + 4);
    const name = names + (attr & 0xffffff) * 4,
      start = data + u32(b, at + 8),
      end = data + u32(b, at + 12);
    if (name >= data || start < data || end < start || end > b.length) throw new Error('SARC の範囲が不正です');
    if (attr >>> 24) out.set(cstr(b, name), b.subarray(start, end));
  }
  return out;
}
