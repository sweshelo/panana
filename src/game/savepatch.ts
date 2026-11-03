// #201: a native-offset RAM stream, committed as checked PNSV generations in real ExtData archive 6.
import type { CodePatch } from './patch';
import { buildPatches } from './patch';
import { BASE } from './codeconst';
import { u32 } from '../util/bytes';
import { SAVE201_RELOCATIONS, SAVE201_SYMBOLS, SAVE201_WORDS } from './savepatchdata';

export const SAVE_PATCH_ID = 'panana:ext-save';
export const SAVE_PATCH_TITLE = 'セーブをExtDataに移行';
export const SAVE_DISK_BYTES = 0x40080;
export const SAVE_NATIVE_CAPACITY = 0x40000;

/** Validate every overwritten instruction, including SDK stream entry points shared by other files. */
export const SAVE_PATCH_SITES: readonly [number, number, string, string?][] = [
  // Reach the existence adapter even if data: cannot mount; never auto-format the import source.
  [0x3fd700, 0x1a000013, '0x3fd754'],
  [0x3fd800, 0xebfbbd68, 'save201_start', 'bl'],
  [0x33789c, 0xe92d4070, 'save201_open'],
  [0x2ecda8, 0xe92d4070, 'save201_exists'],
  [0x33791c, 0xe1a0c002, 'save201_seek'],
  [0x33794c, 0xe92d4008, 'save201_read'],
  [0x2cef50, 0xe52de004, 'save201_write'],
  [0x3378e0, 0xe92d4070, 'save201_close'],
  [0x33b880, 0xe92d4070, 'save201_destroy'],
  [0x31ae64, 0xe2800010, 'save201_flush'],
  [0x3fdd68, 0xe92d4038, 'save201_format'],
  [0x3fdffc, 0xe92d4ff8, 'save201_save'],
  [0x3fe4cc, 0xe92d4070, 'save201_dispose'],
  [0x3fdd48, 0xebfc7438, 'save201_archive_commit', 'bl'],
  [0x3fdeec, 0xebfc73cf, 'save201_archive_commit', 'bl'],
  [0x3fe414, 0xebfc7285, 'save201_archive_commit', 'bl'],
];

/** Rebase ELF R_ARM_ABS32 literals through assembler labels; all internal PC-relative code stays unchanged. */
function runtimeSource(): string {
  const names = new Map<number, string[]>();
  const add = (offset: number, label: string): void => {
    if (offset % 4 || offset < 0 || offset >= SAVE201_WORDS.length * 4) throw new Error('Invalid save runtime symbol');
    names.set(offset, [...(names.get(offset) ?? []), label]);
  };
  for (const [name, offset] of Object.entries(SAVE201_SYMBOLS)) add(offset, `pns201_${name}`);
  const relocated = new Map<number, string>();
  for (const offset of SAVE201_RELOCATIONS) {
    const target = SAVE201_WORDS[offset / 4]!;
    const label = `pns201_offset_${target.toString(16)}`;
    if (!names.get(target)?.includes(label)) add(target, label);
    relocated.set(offset, label);
  }
  const source = SAVE_PATCH_SITES.map(([address, , fn, branch = 'b']) => `@0x${address.toString(16)}\n  ${branch} ${fn.startsWith('0x') ? fn : `pns201_${fn}`}`);
  source.push('@cave pns201_runtime');
  SAVE201_WORDS.forEach((word, i) => {
    for (const name of names.get(i * 4) ?? []) source.push(`${name}:`);
    source.push(`  .word ${relocated.get(i * 4) ?? `0x${word.toString(16)}`}`);
  });
  return source.join('\n');
}

export const SAVE_PATCH: CodePatch = {
  id: SAVE_PATCH_ID, title: SAVE_PATCH_TITLE, source: runtimeSource(), enabled: true,
};

export function savePatchProblem(code: Uint8Array, other: CodePatch[] = []): string | null {
  const bad = SAVE_PATCH_SITES.filter(([a, w]) => a - BASE + 4 > code.length || u32(code, a - BASE) !== w);
  if (bad.length) return `RPG2日本版v1.1.0と命令が異なります: ${bad.map(([a]) => `0x${a.toString(16).toUpperCase()}`).join('・')} (別の版または競合するMOD)`;
  const built = buildPatches(code, [...other.filter(p => p.id !== SAVE_PATCH_ID), SAVE_PATCH]);
  for (const result of built.values()) if (result.errors.length) return result.errors[0]!.message;
  return null;
}
