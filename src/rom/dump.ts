// A game dump: code.bin (decompressed, base 0x100000) + the root files of the RomFS.
// Accepted inputs (docs/map-editor-design.md §2): decrypted CIA, decrypted NCCH (.cxi / .app),
// or an extracted RomFS folder together with code.bin.
import { ascii } from '../util/bytes';
import { applyIps } from './ips';
import { blzDecompress } from './blz';
import { parseCia } from './cia';
import { readExefsFile } from './exefs';
import { isCodeCompressed, parseNcch } from './ncch';
import { parseRomfs, type RomfsFile } from './romfs';
import { BlobSource, type ByteSource } from './source';
import { identifyTitle, KAHARA, titleById, titleByRootFiles, titleByUpdateId, type TitleDef } from './titles';
import { hex8, u32 } from '../util/bytes';

/** RPG2's title ID (the editor and the export are RPG2's for now). */
export const TITLE_ID = KAHARA.titleId;

/** A file of the RomFS: path without the leading slash ("A90C8038", "sound/sound.bcsar"). */
export interface RomfsListing {
  path: string;
  size: number;
}

export interface Dump {
  /** Where the data came from (for the UI). */
  label: string;
  /** The game of the dump. */
  title: TitleDef;
  titleVersion?: number;
  /** The Update applied on top of the Base (withUpdate), when there is one. */
  update?: UpdateInfo;
  code: Uint8Array;
  /** Root RomFS file names (e.g. "A90C8038"). */
  names(): string[];
  /** Every file of the RomFS, folders included (when the source knows them; the RomFS viewer). */
  files?(): RomfsListing[];
  readRomfs(name: string): Promise<Uint8Array>;
}

/** A decrypted CIA or NCCH: its title ID, version, code.bin (decompressed) and RomFS. */
interface Image {
  titleId: string;
  titleVersion?: number;
  code: Uint8Array;
  files: Map<string, RomfsFile>;
  romfs: ByteSource;
}

async function readImage(file: Blob): Promise<Image> {
  const src = new BlobSource(file);
  const head = await src.read(0, Math.min(0x200, src.size));
  let ncchSrc: ByteSource = src;
  let titleVersion: number | undefined;
  let titleId: string | undefined;
  if (ascii(head, 0x100, 4) !== 'NCCH') {
    const cia = await parseCia(src);
    titleId = cia.titleId;
    ncchSrc = cia.content0;
    titleVersion = cia.titleVersion;
  }
  const ncch = await parseNcch(ncchSrc);
  if (titleId && ncch.programId !== titleId) throw new Error(`プログラム ID が違います (${ncch.programId})`);
  let code = await readExefsFile(ncch.exefs, '.code');
  if (isCodeCompressed(ncch.exheader)) code = blzDecompress(code);
  return { titleId: titleId ?? ncch.programId, titleVersion, code, files: await parseRomfs(ncch.romfs), romfs: ncch.romfs };
}

const readFile = (img: Image, path: string): Promise<Uint8Array> => {
  const f = img.files.get('/' + path);
  if (!f) throw new Error(`RomFS に ${path} がありません`);
  return img.romfs.read(f.offset, f.size);
};

export async function openImage(file: Blob, label: string): Promise<Dump> {
  const img = await readImage(file);
  const title = identifyTitle(img.titleId);
  const { files } = img;
  return {
    label,
    title,
    titleVersion: img.titleVersion,
    code: img.code,
    names: () => [...files.keys()].filter((p) => p.lastIndexOf('/') === 0).map((p) => p.slice(1)),
    files: () => [...files.values()].map((f) => ({ path: f.path.slice(1), size: f.size })),
    readRomfs: (name) => readFile(img, name),
  };
}

/** What the Update of a dump brings (naauao oahu/analysis.md §3). */
export interface UpdateInfo {
  label: string;
  titleVersion?: number;
  /** Root files the game reads from the Update (patch:/patchList.bin), e.g. "21350000". */
  patched: string[];
}

/** An opened Update: its code.bin and the RomFS files it replaces. */
export interface UpdateImage extends UpdateInfo {
  title: TitleDef;
  code: Uint8Array;
  readRomfs(name: string): Promise<Uint8Array>;
}

/**
 * patch:/patchList.bin: u32 count, then the hashes of the root files to read from the Update instead of the Base
 * (FUN_002cb430 / FUN_0011ad1c of RPG3's Update).
 */
export function parsePatchList(b: Uint8Array): string[] {
  const n = u32(b, 0);
  if (4 + n * 4 > b.length) throw new Error('patchList.bin が読めません');
  return Array.from({ length: n }, (_, i) => hex8(u32(b, 4 + i * 4)));
}

/** A decrypted Update CIA (0004000E…) of a game Panana reads. */
export async function openUpdate(file: Blob, label: string): Promise<UpdateImage> {
  const img = await readImage(file);
  const title = titleByUpdateId(img.titleId);
  if (!title) {
    const base = titleById(img.titleId);
    throw new Error(base ? `これは『${base.name}』の Base です。Update (${base.updateTitleId ?? 'なし'}) の CIA を選んでください。` : `タイトル ID が ${img.titleId} です。Update の CIA ではありません。`);
  }
  const patched = img.files.has('/patchList.bin') ? parsePatchList(await readFile(img, 'patchList.bin')) : [];
  for (const n of patched) if (!img.files.has('/' + n)) throw new Error(`Update の RomFS に patchList.bin の ${n} がありません`);
  return { label, title, titleVersion: img.titleVersion, patched, code: img.code, readRomfs: (name) => readFile(img, name) };
}

/** The dump as the game sees it with its Update installed: the Update's code.bin, and the patched files from it. */
export function withUpdate(base: Dump, update: UpdateImage): Dump {
  if (update.title !== base.title) throw new Error(`Update は『${update.title.name}』のものです (ダンプは『${base.title.name}』)`);
  const patched = new Set(update.patched);
  const files = base.files?.bind(base);
  return {
    label: `${base.label} + ${update.label}`,
    title: base.title,
    titleVersion: base.titleVersion,
    update: { label: update.label, titleVersion: update.titleVersion, patched: update.patched },
    code: update.code,
    names: () => [...new Set([...base.names(), ...patched])],
    files: files && (() => files()),
    readRomfs: (name) => (patched.has(name.toUpperCase()) ? update.readRomfs(name.toUpperCase()) : base.readRomfs(name)),
  };
}

/** Opens the dump among `files`: a Base, or a Base and its Update (in any order). */
export async function openImages(files: Blob[], label: (f: Blob) => string): Promise<Dump> {
  if (files.length === 1) return openImage(files[0]!, label(files[0]!));
  if (files.length !== 2) throw new Error('CIA は 1 つ (Base)、または 2 つ (Base と Update) 選んでください');
  const ids = await Promise.all(files.map(async (f) => (await readImage(f)).titleId));
  const u = ids.findIndex((id) => titleByUpdateId(id));
  if (u < 0) throw new Error('2 つ選ぶときは、Base と Update の CIA にしてください');
  const b = 1 - u;
  return withUpdate(await openImage(files[b]!, label(files[b]!)), await openUpdate(files[u]!, label(files[u]!)));
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
    title: titleByRootFiles(map.keys()) ?? KAHARA,
    code: codeBytes,
    names: () => [...map.keys()],
    files: () => [...map].map(([path, f]) => ({ path, size: f.size })),
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
  const files = dump.files?.bind(dump);
  return {
    label: `${dump.label} + ${mod.label}`,
    title: dump.title,
    titleVersion: dump.titleVersion,
    update: dump.update,
    code: mod.ips ? applyIps(dump.code, mod.ips) : dump.code,
    names: () => [...new Set([...dump.names(), ...mod.romfs.keys()])],
    files: files && (() => {
      const out = new Map(files().map((f) => [f.path, f]));
      for (const [path, b] of mod.romfs) out.set(path, { path, size: b.length });
      return [...out.values()];
    }),
    readRomfs: async (name) => mod.romfs.get(name.toUpperCase())?.slice() ?? dump.readRomfs(name),
  };
}
