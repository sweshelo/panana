// Telling file formats apart by their bytes (the RomFS viewer picks a view with these).
import { parseArchive, type Archive } from '../archive/gsarc';
import { ascii, hex8, u32 } from '../util/bytes';

/** Magic numbers at +0x00 -> format name. */
const MAGICS: [string, string][] = [
  ['GMSG', 'GMSG (メッセージ)'],
  ['CGFX', 'CGFX (モデル)'],
  ['BCH\0', 'BCH (H3D モデル)'],
  ['darc', 'darc (レイアウト)'],
  ['CTPK', 'CTPK (テクスチャ)'],
  ['CLIM', 'CLIM (画像)'],
  ['FLIM', 'FLIM (画像)'],
  ['RTFN', 'NFTR (フォント)'],
  ['CFNT', 'BCFNT (フォント)'],
  ['CSAR', 'BCSAR (サウンドアーカイブ)'],
  ['CSTM', 'BCSTM (ストリーム)'],
  ['CWAV', 'BCWAV (波形)'],
  ['SARC', 'SARC'],
  ['DVLB', 'SHBIN (シェーダー)'],
  ['PK\x03\x04', 'ZIP'],
];

/** Name of the format of `b` ("BCH (H3D モデル)" …), or null when it is not one we know. */
export function formatName(b: Uint8Array): string | null {
  const m = b.length >= 4 ? ascii(b, 0, 4) : '';
  for (const [magic, name] of MAGICS) if (m === magic) return name;
  if (b.length >= 0x184 && ascii(b, 0x180, 4) === 'BCH\0') return '0x180 バイトのヘッダー + BCH';
  if (b.length >= 0x184 && ascii(b, 0x180, 4) === 'CGFX') return '0x180 バイトのヘッダー + CGFX';
  if (isGsTable(b)) return 'GS テーブル';
  return null;
}

/** A GS data table: +0x00 rows, +0x04 row size, +0x10 data offset, +0x14 rows × row size, +0x18 file size. */
export function isGsTable(b: Uint8Array): boolean {
  if (b.length < 0x40) return false;
  const rows = u32(b, 0), size = u32(b, 4), off = u32(b, 0x10);
  return size > 0 && off >= 0x30 && off <= b.length && u32(b, 0x14) === rows * size && off + rows * size <= b.length && u32(b, 0x18) <= b.length;
}

/** A root archive of the GS engine (+0x04 = its own name) with any known version; null otherwise. */
export function asArchive(b: Uint8Array, path: string): Archive | null {
  if (b.length < 12 || !/^[0-9A-F]{8}$/i.test(path) || hex8(u32(b, 4)) !== path.toUpperCase()) return null;
  try {
    return parseArchive(b);
  } catch {
    return null;
  }
}
