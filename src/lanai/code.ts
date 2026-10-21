// The code.bin of 電波人間のRPG FREE!: the Update's (TitleVersion 17408), the code the game runs once the Update is
// installed (like RPG3's, oahu/code.ts). Panana writes only its own code MODs to it (game/dropcap.ts), as exefs/code.ips.
import type { CodeLayout } from '../game/patch';
import type { Dump } from '../rom/dump';

/** The TitleVersion of the Update whose addresses Panana knows. */
export const LANAI_CODE_VERSION = 17408;
/** Size of that code.bin (decompressed). */
export const LANAI_CODE_SIZE = 4182016;

/** Sections of the Update's code.bin (ExHeader). */
export const LANAI_SECTIONS = { text: [0x100000, 0x399900], ro: [0x49a000, 0x48848], data: [0x4e3000, 0x19a68] } as const;

/** Where patches go: the cave is the zero padding between the end of .text and .rodata (0x700 bytes). */
export const LANAI_LAYOUT: CodeLayout = {
  caveStart: LANAI_SECTIONS.text[0] + LANAI_SECTIONS.text[1],
  caveEnd: LANAI_SECTIONS.ro[0],
  reservedEnd: LANAI_SECTIONS.ro[0],
  writableEnd: LANAI_SECTIONS.data[0],
};

/** The Update's code.bin; throws a message for the user without the Update or with another version of it. */
export function lanaiCode(dump: Dump): Uint8Array {
  if (!dump.update) throw new Error('code.bin を書き換えるには Update の CIA が要ります');
  const v = dump.update.titleVersion;
  if (v !== undefined && v !== LANAI_CODE_VERSION) throw new Error(`Update のバージョンが v${v} です。Panana が調べた v${LANAI_CODE_VERSION} の Update を選んでください。`);
  if (dump.code.length !== LANAI_CODE_SIZE) throw new Error(`code.bin が Update v${LANAI_CODE_VERSION} のものと違います (大きさ ${dump.code.length} バイト)。`);
  return dump.code;
}
