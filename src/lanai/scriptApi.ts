import { ascii, cstr, u32 } from '../util/bytes';
import { demangleName } from './contents';
export interface ScriptApiSymbol { symbol: string; name: string; address: number }
/** CRO/CRS named exports are absolute file offsets; the address uses a segment tag in its low nibble. */
export function crsExports(b: Uint8Array): ScriptApiSymbol[] {
  if (b.length < 0x138 || ascii(b, 0x80, 4) !== 'CRO0') throw new Error('CRO/CRS のヘッダーがありません');
  const table = u32(b, 0xd0), count = u32(b, 0xd4), segments = u32(b, 0xc8), segmentCount = u32(b, 0xcc);
  if (table + count * 8 > b.length || segments + segmentCount * 12 > b.length) throw new Error('シンボル表がファイルの外にあります');
  const result: ScriptApiSymbol[] = [];
  for (let i = 0; i < count; i++) {
    const nameOffset = u32(b, table + i * 8), encoded = u32(b, table + i * 8 + 4);
    if (nameOffset >= b.length || (encoded & 15) >= segmentCount) throw new Error('不正なシンボル参照です');
    const symbol = cstr(b, nameOffset);
    result.push({ symbol, name: demangleName(symbol), address: u32(b, segments + (encoded & 15) * 12) + (encoded >>> 4) });
  }
  return result;
}
