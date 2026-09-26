// A game dump: code.bin (decompressed, base 0x100000) + the root files of the RomFS.
// Accepted inputs (docs/map-editor-design.md §2): decrypted CIA, decrypted NCCH (.cxi / .app),
// or an extracted RomFS folder together with code.bin.
import { ascii } from '../util/bytes';
import { applyIps } from './ips';
import { blzDecompress } from './blz';
import { parseCia } from './cia';
import { readExefsFile } from './exefs';
import { isCodeCompressed, parseNcch } from './ncch';
import { parseRomfs } from './romfs';
import { BlobSource, type ByteSource } from './source';

export const TITLE_ID = '00040000000A7900';

export interface Dump {
  /** Where the data came from (for the UI). */
  label: string;
  titleVersion?: number;
  code: Uint8Array;
  /** Root RomFS file names (e.g. "A90C8038"). */
  names(): string[];
  readRomfs(name: string): Promise<Uint8Array>;
}

export async function openImage(file: Blob, label: string): Promise<Dump> {
  const src = new BlobSource(file);
  const head = await src.read(0, Math.min(0x200, src.size));
  let ncchSrc: ByteSource = src;
  let titleVersion: number | undefined;
  if (ascii(head, 0x100, 4) !== 'NCCH') {
    const cia = await parseCia(src);
    if (cia.titleId !== TITLE_ID) throw new Error(`タイトル ID が違います (${cia.titleId})。電波人間のRPG2 (${TITLE_ID}) のダンプを使ってください。`);
    ncchSrc = cia.content0;
    titleVersion = cia.titleVersion;
  }
  const ncch = await parseNcch(ncchSrc);
  if (ncch.programId !== TITLE_ID) throw new Error(`プログラム ID が違います (${ncch.programId})`);
  let code = await readExefsFile(ncch.exefs, '.code');
  if (isCodeCompressed(ncch.exheader)) code = blzDecompress(code);
  const files = await parseRomfs(ncch.romfs);
  const romfs = ncch.romfs;
  return {
    label,
    titleVersion,
    code,
    names: () => [...files.keys()].filter((p) => p.lastIndexOf('/') === 0).map((p) => p.slice(1)),
    readRomfs: async (name) => {
      const f = files.get('/' + name);
      if (!f) throw new Error(`RomFS に ${name} がありません`);
      return romfs.read(f.offset, f.size);
    },
  };
}

/** Folder input: any file named code.bin (or .code) plus files whose name is an 8-digit hex hash. */
export async function openFolder(files: File[], label: string): Promise<Dump> {
  const code = files.find((f) => /^(code\.bin|\.code)$/i.test(f.name));
  if (!code) throw new Error('フォルダに code.bin がありません (ExeFS の .code を展開したもの)');
  let codeBytes: Uint8Array = new Uint8Array(await code.arrayBuffer());
  if (codeBytes.length < 0x400000) codeBytes = blzDecompress(codeBytes); // still compressed
  const map = new Map<string, File>();
  for (const f of files) if (/^[0-9A-Fa-f]{8}$/.test(f.name)) map.set(f.name.toUpperCase(), f);
  if (!map.size) throw new Error('フォルダに RomFS のファイル (A90C8038 など) がありません');
  return {
    label,
    code: codeBytes,
    names: () => [...map.keys()],
    readRomfs: async (name) => {
      const f = map.get(name.toUpperCase());
      if (!f) throw new Error(`RomFS に ${name} がありません`);
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}

/** A MOD to build on (e.g. elpulse mod/out): RomFS files that replace the dump's, and a code.ips. */
export interface BaseMod {
  label: string;
  romfs: Map<string, Uint8Array>;
  ips: Uint8Array | null;
}

/** Collect a base MOD from the files of a folder (hash-named RomFS files, code.ips). */
export function baseModFromFiles(label: string, files: { name: string; bytes: Uint8Array }[]): BaseMod {
  const romfs = new Map<string, Uint8Array>();
  let ips: Uint8Array | null = null;
  for (const f of files) {
    if (/^[0-9A-Fa-f]{8}$/.test(f.name)) romfs.set(f.name.toUpperCase(), f.bytes);
    else if (/^code\.ips$/i.test(f.name)) ips = f.bytes;
  }
  if (!romfs.size && !ips) throw new Error('RomFS のファイル (56562135 など) も code.ips も見つかりません');
  return { label, romfs, ips };
}

/** The dump with a base MOD on top: its RomFS files win, its code.ips is applied to code.bin. */
export function overlayDump(dump: Dump, mod: BaseMod): Dump {
  return {
    label: `${dump.label} + ${mod.label}`,
    titleVersion: dump.titleVersion,
    code: mod.ips ? applyIps(dump.code, mod.ips) : dump.code,
    names: () => [...new Set([...dump.names(), ...mod.romfs.keys()])],
    readRomfs: async (name) => mod.romfs.get(name.toUpperCase())?.slice() ?? dump.readRomfs(name),
  };
}
