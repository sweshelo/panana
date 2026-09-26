// CIA container (3dbrew "CIA"): header, cert chain, ticket, TMD, contents; each part is 64-byte aligned.
import { align, u16be, u32, u32be, u64, u64be } from '../util/bytes';
import { SubSource, type ByteSource } from './source';

export interface CiaInfo {
  titleId: string;
  titleVersion: number;
  /** Content 0 (the NCCH of the application). */
  content0: ByteSource;
}

function tmdHeaderOffset(sigType: number): number {
  // Signature type -> signature size + padding (header starts after it).
  switch (sigType) {
    case 0x10000: case 0x10003: return 4 + 0x200 + 0x3c;
    case 0x10001: case 0x10004: return 4 + 0x100 + 0x3c;
    case 0x10002: case 0x10005: return 4 + 0x3c + 0x40;
    default: throw new Error(`TMD: unknown signature type 0x${sigType.toString(16)}`);
  }
}

export async function parseCia(src: ByteSource): Promise<CiaInfo> {
  const h = await src.read(0, 0x20);
  const headerSize = u32(h, 0);
  const certSize = u32(h, 0x08);
  const ticketSize = u32(h, 0x0c);
  const tmdSize = u32(h, 0x10);
  const contentSize = u64(h, 0x18);
  if (headerSize !== 0x2020) throw new Error('CIA ではありません (ヘッダーサイズが 0x2020 でない)');
  const certOff = align(headerSize, 64);
  const ticketOff = align(certOff + certSize, 64);
  const tmdOff = align(ticketOff + ticketSize, 64);
  const contentOff = align(tmdOff + tmdSize, 64);

  const tmd = await src.read(tmdOff, tmdSize);
  const hdr = tmdHeaderOffset(u32be(tmd, 0));
  const titleId = u64be(tmd, hdr + 0x4c).toString(16).toUpperCase().padStart(16, '0');
  const titleVersion = u16be(tmd, hdr + 0x9c);
  const count = u16be(tmd, hdr + 0x9e);
  const chunks = hdr + 0xc4 + 64 * 0x24;
  if (count < 1) throw new Error('CIA: コンテンツがありません');
  // The first chunk record is content index 0 and comes first in the content area.
  const index = u16be(tmd, chunks + 4);
  const type = u16be(tmd, chunks + 6);
  const size = u64be(tmd, chunks + 8);
  if (index !== 0) throw new Error('CIA: 先頭のコンテンツが 0 番ではありません');
  if (type & 1) {
    throw new Error('CIA のコンテンツが暗号化されています。GodMode9 などで復号した (decrypted) ダンプを使ってください。');
  }
  if (contentOff + size > src.size || size > contentSize) throw new Error('CIA: コンテンツの範囲が不正です');
  return { titleId, titleVersion, content0: new SubSource(src, contentOff, size) };
}
