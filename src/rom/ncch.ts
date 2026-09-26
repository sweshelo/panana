// NCCH (3dbrew "NCCH"): signature 0x100, header 0x100; offsets in media units (0x200).
import { ascii, u32, u64 } from '../util/bytes';
import { SubSource, type ByteSource } from './source';

const MEDIA = 0x200;

export interface NcchInfo {
  programId: string;
  exheader: Uint8Array;
  exefs: ByteSource;
  romfs: ByteSource;
}

export async function parseNcch(src: ByteSource): Promise<NcchInfo> {
  const h = await src.read(0, 0x200);
  if (ascii(h, 0x100, 4) !== 'NCCH') {
    if (ascii(h, 0x100, 4) === 'NCSD') throw new Error('.3ds (NCSD) は、パーティション 0 を取り出すか CIA を使ってください');
    throw new Error('NCCH ではありません');
  }
  const flags7 = h[0x18f]!;
  const noCrypto = (flags7 & 0x04) !== 0;
  if (!noCrypto) {
    throw new Error('NCCH が暗号化されています。GodMode9 などで復号した (decrypted) ダンプを使ってください。');
  }
  const programId = u64(h, 0x118).toString(16).toUpperCase().padStart(16, '0');
  const exhSize = u32(h, 0x180);
  const exefsOff = u32(h, 0x1a0) * MEDIA;
  const exefsSize = u32(h, 0x1a4) * MEDIA;
  const romfsOff = u32(h, 0x1b0) * MEDIA;
  const romfsSize = u32(h, 0x1b4) * MEDIA;
  if (!exefsSize || !romfsSize) throw new Error('NCCH に ExeFS / RomFS がありません');
  const exheader = await src.read(0x200, exhSize);
  return {
    programId,
    exheader,
    exefs: new SubSource(src, exefsOff, exefsSize),
    romfs: new SubSource(src, romfsOff, romfsSize),
  };
}

/** ExHeader SCI flags bit0: .code is compressed. */
export const isCodeCompressed = (exheader: Uint8Array): boolean => (exheader[0x0d]! & 1) !== 0;
