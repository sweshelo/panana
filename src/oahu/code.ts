// The code.bin of 電波人間のRPG3 (#65): only the Update's (TitleVersion 4096) is used, since that is the code the game
// runs once the Update is installed (naauao oahu/analysis.md §1, §7). Base addresses are not kept: without the
// Update, the features that read or patch code.bin are not offered.
import { BASE } from '../game/codeconst';
import type { CodeLayout } from '../game/patch';
import { u32 } from '../util/bytes';
import type { Dump } from '../rom/dump';

/** The TitleVersion of the Update whose addresses Panana knows (v4.7.0 of the CIA file name). */
export const OAHU_CODE_VERSION = 4096;
/** Size of that code.bin (decompressed). */
export const OAHU_CODE_SIZE = 5029888;

/** Addresses in the Update's code.bin (analysis.md §7). */
export const OAHU_CODE = {
  /** Resource manager (+0x80 / +0x84 = the patchList). */
  resources: 0x5a59dc,
  /** Builds the path of a root file, `rom:/` or `patch:/` (§3.1). */
  rootPath: 0x11ad1c,
  /** Reads patch:/patchList.bin. */
  readPatchList: 0x2cb430,
  /** Opens an archive by its hash (the master 0x21350000 at startup). */
  openArchive: 0x2cb4d0,
  /** Startup (patchList, then the master). */
  startup: 0x495fd0,
  /** `L"rom:/XXXXXXXX"` / `L"patch:/XXXXXXXX"`. */
  romPath: 0x5a5a00,
  patchPath: 0x5a5a1e,
  /** Effect kind -> conditionData row: `cmp r1, #0x36; ldrlo pc, [pc, r1, lsl #2]` and a case `mov r0, #row; bx lr` per kind. */
  effectCondition: 0x1a6348,
  effectConditionTable: 0x1a635c,
  effectKinds: 0x36,
} as const;

/** Sections of the Update's code.bin (ExHeader). */
export const OAHU_SECTIONS = { text: [0x100000, 0x4558c0], ro: [0x556000, 0x4023c], data: [0x597000, 0x34568] } as const;

/** Where patches go: the cave is the zero padding between the end of .text and .rodata (0x740 bytes). */
export const OAHU_LAYOUT: CodeLayout = {
  caveStart: OAHU_SECTIONS.text[0] + OAHU_SECTIONS.text[1],
  caveEnd: OAHU_SECTIONS.ro[0],
  reservedEnd: OAHU_SECTIONS.ro[0],
  writableEnd: OAHU_SECTIONS.data[0],
};

/** Words at known addresses, to check the code.bin is the one the addresses were taken from. */
const PROBES: [number, number][] = [
  [OAHU_CODE.effectCondition, 0xe1a01000], // mov r1, r0
  [OAHU_CODE.effectCondition + 4, 0xe3510036], // cmp r1, #0x36
  [OAHU_CODE.readPatchList, 0xe92d4030], // push {r4, r5, lr}
  [OAHU_CODE.openArchive, 0xe92d4010], // push {r4, lr}
];

const wide = (code: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...Array.from({ length: n }, (_, i) => code[at + i * 2]! | (code[at + i * 2 + 1]! << 8)));

/** The Update's code.bin with the addresses Panana knows. */
export class OahuCode {
  private constructor(readonly code: Uint8Array) {}

  /**
   * The code of a dump, or null when it has no Update (the Base's code.bin is never used). Throws a message for the
   * user when the Update is another version than the one the addresses are for.
   */
  static of(dump: Dump): OahuCode | null {
    if (!dump.update) return null;
    const v = dump.update.titleVersion;
    if (v !== undefined && v !== OAHU_CODE_VERSION) throw new Error(`Update のバージョンが v${v} です。Panana が調べた v${OAHU_CODE_VERSION} の Update を選んでください。`);
    return OahuCode.check(dump.code);
  }

  /** Checks the code.bin is the Update's v4096. */
  static check(code: Uint8Array): OahuCode {
    const bad = (): never => {
      throw new Error(`code.bin が Update v${OAHU_CODE_VERSION} のものと違います (大きさ ${code.length} バイト)。`);
    };
    if (code.length !== OAHU_CODE_SIZE) bad();
    for (const [a, w] of PROBES) if (u32(code, a - BASE) !== w) bad();
    if (wide(code, OAHU_CODE.patchPath - BASE, 7) !== 'patch:/') bad();
    return new OahuCode(code);
  }

  word(addr: number): number {
    return u32(this.code, addr - BASE);
  }

  /** Free bytes of the code cave (the cave is all zero in the game). */
  get caveSize(): number {
    return OAHU_LAYOUT.caveEnd - OAHU_LAYOUT.caveStart;
  }

  /**
   * The conditionData row of each effect kind, read from the cases of FUN_001A6348 (0 = none). A case that is not
   * `mov r0, #imm; bx lr` throws.
   */
  effectConditions(): number[] {
    const out: number[] = [];
    for (let k = 0; k < OAHU_CODE.effectKinds; k++) {
      const at = this.word(OAHU_CODE.effectConditionTable + k * 4);
      const op = this.word(at);
      if (op === 0xe12fff1e) out.push(0); // bx lr: r0 is still 0
      else if (((op & 0xfffff000) >>> 0) === 0xe3a00000 && this.word(at + 4) === 0xe12fff1e) out.push(ror(op & 0xff, ((op >> 8) & 0xf) * 2));
      else throw new Error(`FUN_001A6348 の種類 0x${k.toString(16)} が読めません (0x${at.toString(16)})`);
    }
    return out;
  }
}

const ror = (v: number, r: number): number => (r ? ((v >>> r) | (v << (32 - r))) >>> 0 : v);
