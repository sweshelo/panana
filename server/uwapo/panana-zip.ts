// Ported from lanai-custom-stages web/panana-zip.ts (99304a5); the uwapo there is kept in parallel.
// Reads a Panana MOD ZIP of 電波人間のRPG FREE! (LayeredFS layout 0004000000125D00/romfs/…, exefs/code.ips) without
// the ROM and finds the stages (contents) in it. Formats follow Panana (src/archive/gsarc.ts, src/lanai/table.ts,
// src/lanai/message.ts) and naauao lanai/analysis.md, lanai/contents.md; see ../docs/stage-distribution.md.
import { unzipSync } from 'fflate';

export const TITLE_ID = '0004000000125D00';
export const MASTER_ARCHIVE = '2135000A';
/** Rows of the master's Contents in Update v17408: content numbers at or above this were added by an edit. */
export const BASE_CONTENT_COUNT = 127;
/** Total size of the files the ZIP may expand to. */
export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

export type FileRole = 'archive' | 'crr' | 'patchList' | 'codeIps' | 'other';

export interface ZipFileInfo {
  /** Path inside the title folder ("romfs/F0000000", "exefs/code.ips"). */
  path: string;
  size: number;
  sha256: string;
  role: FileRole;
}

export interface StageRow {
  /** Row ID of MessageMapStage (MapStage +0x0C). */
  messageId: string;
  /** Stage slot (MapStage +0x34, Integration +0x40). */
  slot: number;
  /** Content number (MapStage +0x38, Integration +0x44). */
  content: number;
  /** Stamina to enter (MapStage +0x3D, Integration +0x49). */
  stamina: number;
  /** Display condition kind (+0x24 low byte; 0x72 = Panana condition script). */
  visibleKind: number;
  visibleArg: number;
  hiddenKind: number;
  hiddenArg: number;
  name: string;
  mission: string;
  /** MapStageIntegration row number in the ZIP's master, or null when the master is not in the ZIP. */
  integrationRow: number | null;
  /** MapStageIntegration row ID. */
  integrationId: string | null;
}

export interface StageSummary {
  /** Content number (ContentsDef row 0). */
  content: number;
  /** Root archive of the content ("F0000000"). */
  archive: string;
  /** "added" when the content number is beyond the ROM's Contents, else "modified" (an existing content replaced). */
  kind: 'added' | 'modified';
  /** Display name (MessageMapStage stage_name of its first stage), or "". */
  name: string;
  /** The CRO ContentsDef names: entry file name, hash, size and the module name in its header. */
  cro: { name: string; hash: string; size: number; module: string } | null;
  /** romfs/.crr/contentsNNNN.crr when it is in the ZIP. */
  crr: string | null;
  /** Whether the master's Contents row of this content points at this archive (null without the master). */
  contentsRow: boolean | null;
  /** Whether patchList.bin lists the archive (null without patchList.bin). */
  inPatchList: boolean | null;
  stages: StageRow[];
  /** Files of this stage's package (paths in the title folder). */
  files: string[];
  warnings: string[];
}

export interface PackageSummary {
  titleId: string;
  files: ZipFileInfo[];
  stages: StageSummary[];
  /** Archives that are not contents (the master, language archives …): shared by every stage of the ZIP. */
  sharedArchives: string[];
  patchList: { count: number; hashes: string[] } | null;
  codeIps: { size: number; records: { offset: string; size: number }[] } | null;
  /** Condition script numbers (kind 0x72) the stages use: their code is in code.ips, not per stage. */
  conditionScripts: number[];
  /** Rows of the ZIP's master that differ from the ROM's (null without a baseline or without the master). */
  masterDiff: MasterTableDiff[] | null;
  warnings: string[];
}

/**
 * Hashes of the rows of the ROM's master (Update v17408), made from the local ROM by tools/master-baseline.ts. It has
 * no ROM data itself, only row counts and truncated SHA-1 hashes, and lets the server find edited rows without the ROM.
 */
export interface MasterBaseline {
  titleVersion: number;
  tables: { entry: string; name: string; rows: number; rowHashes: string[] }[];
}

export interface MasterRowDiff {
  row: number;
  /** Row ID, or null for a table without IDs (Contents, ItemDataCore …). */
  id: string | null;
  /** The stage the row belongs to: its own rows, rows named by its messages' insertion tags, a u32 of its tables (推定) or ItemData +0x0C (推定). */
  owner?: { content: number; by: 'own' | 'insert' | 'value' | 'link' };
}

export interface MasterTableDiff {
  entry: string;
  name: string;
  baseRows: number;
  rows: number;
  added: MasterRowDiff[];
  changed: MasterRowDiff[];
}

export const rowHash = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha1').update(bytes).digest('hex').slice(0, 12);

const rowBytes = (t: Table, r: number): Uint8Array => t.data.subarray(cell(t, r, 0), cell(t, r, 0) + t.rowSize);

/** Every GS table of an archive with its entry hash. */
export function allTables(arc: Archive): { entry: number; table: Table }[] {
  const out: { entry: number; table: Table }[] = [];
  for (const e of arc.entries) {
    if (![1, 3, 11, 12].includes(e.type)) continue;
    if (e.comp === 1) {
      const name = zipEntryName(arc.data.subarray(e.offset, e.offset + e.size));
      if (name && !name.endsWith('.bin')) continue;
    }
    try {
      const t = parseTable(unpackEntry(arc, e).body);
      if (t) out.push({ entry: e.hash, table: t });
    } catch {}
  }
  return out;
}

/** The baseline of a master archive (tools/master-baseline.ts). */
export function masterBaseline(master: Uint8Array, titleVersion: number): MasterBaseline {
  return {
    titleVersion,
    tables: allTables(parseArchive(master)).map(({ entry, table }) => ({
      entry: hex8(entry),
      name: table.name,
      rows: table.rows,
      rowHashes: Array.from({ length: table.rows }, (_, r) => rowHash(rowBytes(table, r))),
    })),
  };
}

function diffMaster(tables: { entry: number; table: Table }[], baseline: MasterBaseline): MasterTableDiff[] {
  const out: MasterTableDiff[] = [];
  for (const { entry, table } of tables) {
    const base = baseline.tables.find((b) => b.entry === hex8(entry));
    const id = (r: number) => (table.rowIds[r] === undefined ? null : hex8(table.rowIds[r]!));
    const added: MasterRowDiff[] = [];
    const changed: MasterRowDiff[] = [];
    for (let r = 0; r < table.rows; r++) {
      if (!base || r >= base.rows) added.push({ row: r, id: id(r) });
      else if (rowHash(rowBytes(table, r)) !== base.rowHashes[r]) changed.push({ row: r, id: id(r) });
    }
    if (added.length || changed.length || (base && base.rows !== table.rows))
      out.push({ entry: hex8(entry), name: table.name, baseRows: base?.rows ?? 0, rows: table.rows, added, changed });
  }
  return out;
}

/** The insertion tags (0x37: table, row ID, field) of a message. */
function insertTags(b: Uint8Array, o: number): { table: string; id: number }[] {
  const out: { table: string; id: number }[] = [];
  if (o <= 0 || o >= b.length) return out;
  while (o + 1 < b.length) {
    const c = u16(b, o);
    if (c === 0) break;
    if (c !== 1 || o + 6 > b.length) {
      o += 2;
      continue;
    }
    const code = u16(b, o + 2),
      n = u16(b, o + 4);
    o += 6;
    const args: (string | number)[] = [];
    for (let k = 0; k < n && o + 2 <= b.length; k++) {
      const type = u16(b, o);
      o += 2;
      if (type === 2) {
        args.push(u32(b, o));
        o += 4;
      } else if (type === 3) {
        const len = u16(b, o);
        args.push(cstr(b.subarray(0, o + 2 + len * 2), o + 2));
        o += 2 + len * 2;
      } else break;
    }
    if (code === 0x37 && typeof args[0] === 'string' && typeof args[1] === 'number')
      out.push({ table: args[0], id: args[1] });
  }
  return out;
}

// ---- little-endian helpers

const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
/** One romfs file of a Panana MOD ZIP (case-insensitive), or undefined. */
export function romfsFile(zip: Uint8Array, name: string): Uint8Array | undefined {
  const want = `${TITLE_ID}/romfs/${name}`.toUpperCase();
  return Object.entries(unzipSync(zip, { filter: (f) => f.name.toUpperCase() === want }))[0]?.[1];
}

export const hex8 = (n: number): string => n.toString(16).toUpperCase().padStart(8, '0');

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- GS archive (version 10: 0x18-byte header; else 0x0C)

export interface ArcEntry {
  hash: number;
  type: number;
  size: number;
  offset: number;
  comp: number;
}

export interface Archive {
  version: number;
  hash: number;
  entries: ArcEntry[];
  data: Uint8Array;
}

export function parseArchive(data: Uint8Array): Archive {
  if (data.length < 12) throw new Error('アーカイブが短すぎます');
  const version = u32(data, 0);
  const head = version === 10 ? 0x18 : 0x0c;
  const count = u32(data, version === 10 ? 0x10 : 8);
  if (head + count * 28 > data.length) throw new Error('アーカイブのヘッダーが不正です');
  const entries: ArcEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = head + i * 28;
    const e = {
      hash: u32(data, o),
      type: u32(data, o + 4),
      size: u32(data, o + 8),
      offset: u32(data, o + 12),
      comp: u32(data, o + 16),
    };
    if (e.offset + e.size > data.length) throw new Error(`エントリ ${hex8(e.hash)} がアーカイブの外を指しています`);
    entries.push(e);
  }
  return { version, hash: u32(data, 4), entries, data };
}

export function lz10Decompress(src: Uint8Array): Uint8Array {
  if (src[0] !== 0x10) throw new Error('LZ10 ではありません');
  let size = src[1]! | (src[2]! << 8) | (src[3]! << 16);
  let pos = 4;
  if (size === 0) {
    size = u32(src, 4);
    pos = 8;
  }
  if (size > MAX_EXPANDED_BYTES) throw new Error('LZ10 の展開サイズが大きすぎます');
  const out = new Uint8Array(size);
  let o = 0;
  while (o < size) {
    if (pos >= src.length) throw new Error('LZ10 のデータが途中で終わっています');
    const flags = src[pos++]!;
    for (let bit = 0; bit < 8 && o < size; bit++) {
      if (flags & (0x80 >> bit)) {
        if (pos + 1 >= src.length) throw new Error('LZ10 のデータが途中で終わっています');
        const b1 = src[pos]!,
          b2 = src[pos + 1]!;
        pos += 2;
        const n = (b1 >> 4) + 3;
        const disp = (((b1 & 0xf) << 8) | b2) + 1;
        if (disp > o) throw new Error('LZ10 の参照が不正です');
        for (let i = 0; i < n && o < size; i++, o++) out[o] = out[o - disp]!;
      } else {
        if (pos >= src.length) throw new Error('LZ10 のデータが途中で終わっています');
        out[o++] = src[pos++]!;
      }
    }
  }
  return out;
}

/** Name of the single file of an entry ZIP (compression 1), from its local header. */
export function zipEntryName(blob: Uint8Array): string | null {
  if (blob.length < 30 || u32(blob, 0) !== 0x04034b50) return null;
  const n = u16(blob, 26);
  return 30 + n <= blob.length ? new TextDecoder().decode(blob.subarray(30, 30 + n)) : null;
}

/** Body of an entry: comp 1 = single-file ZIP, 6 = LZ10 (size 0 = empty), else stored. */
export function unpackEntry(arc: Archive, e: ArcEntry): { name: string | null; body: Uint8Array } {
  const blob = arc.data.subarray(e.offset, e.offset + e.size);
  if (e.comp === 1) {
    const files = unzipSync(blob);
    const name = Object.keys(files)[0];
    return name ? { name, body: files[name]! } : { name: null, body: new Uint8Array(0) };
  }
  if (e.comp === 6) return { name: null, body: e.size ? lz10Decompress(blob) : new Uint8Array(0) };
  return { name: null, body: blob };
}

// ---- GS table (lanai form: 0x40-byte header, string pool at 0x40)

export interface Table {
  name: string;
  rows: number;
  rowSize: number;
  rowIds: number[];
  fields: { name: string; offset: number }[];
  data: Uint8Array;
  dataOffset: number;
  /** End of the string pool (file offset): 0x40 + pool size. */
  poolEnd: number;
  /** File offsets of the u32s the game relocates (+0x28 / +0x2C): string fields and field names. */
  relocs: number[];
}

function cstr(b: Uint8Array, o: number): string {
  let s = '';
  for (let i = o; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]!);
  return s;
}

export function parseTable(b: Uint8Array): Table | null {
  if (b.length < 0x40 || u32(b, 8) !== 0x40) return null;
  const rows = u32(b, 0),
    rowSize = u32(b, 4),
    dataOffset = u32(b, 0x10);
  if (rows * rowSize !== u32(b, 0x14) || dataOffset < 0x40 || dataOffset + rows * rowSize > b.length) return null;
  const pool = 0x40 + u32(b, 0x0c);
  const nameAt = 0x40 + u32(b, 0x34);
  if (nameAt >= pool || pool > b.length || !b[nameAt]) return null;
  for (const [at, len] of [
    [0x18, 0x1c],
    [0x20, 0x24],
  ] as const)
    if (u32(b, at) && u32(b, at) + u32(b, len) > b.length) return null;
  const ids = u32(b, 0x18);
  const schema = u32(b, 0x20);
  const reloc = u32(b, 0x28),
    relocCount = u32(b, 0x2c);
  if (reloc + relocCount * 4 > b.length) return null;
  return {
    name: cstr(b, nameAt),
    rows,
    rowSize,
    rowIds: ids ? Array.from({ length: u32(b, 0x1c) >>> 2 }, (_, i) => u32(b, ids + i * 4)) : [],
    fields: schema
      ? Array.from({ length: u32(b, 0x24) >>> 3 }, (_, i) => ({
          name: cstr(b, u32(b, schema + i * 8)),
          offset: u32(b, schema + i * 8 + 4),
        }))
      : [],
    data: b,
    dataOffset,
    poolEnd: pool,
    relocs: Array.from({ length: relocCount }, (_, i) => u32(b, reloc + i * 4)),
  };
}

const cell = (t: Table, row: number, offset: number): number => t.dataOffset + row * t.rowSize + offset;
const tu32 = (t: Table, row: number, offset: number): number => u32(t.data, cell(t, row, offset));
const tu16 = (t: Table, row: number, offset: number): number => u16(t.data, cell(t, row, offset));
const tu8 = (t: Table, row: number, offset: number): number => t.data[cell(t, row, offset)]!;

/** A message string (UTF-16LE with 0x0001 tags) as plain text: tags and ruby readings (0x39..0x3A) are left out. */
export function plainMessage(b: Uint8Array, o: number): string {
  let s = '';
  let ruby = false;
  while (o + 1 < b.length) {
    const c = u16(b, o);
    if (c === 0) break;
    if (c === 1 && o + 6 <= b.length) {
      const code = u16(b, o + 2),
        n = u16(b, o + 4);
      if (code === 0x39) ruby = true;
      else if (code === 0x3a) ruby = false;
      o += 6;
      for (let k = 0; k < n && o + 2 <= b.length; k++) {
        const type = u16(b, o);
        o += 2;
        if (type === 2) o += 4;
        else if (type === 3) o += 2 + u16(b, o) * 2;
        else break;
      }
      continue;
    }
    if (!ruby) s += String.fromCharCode(c);
    o += 2;
  }
  return s;
}

function namedString(t: Table, row: number, name: string): string {
  const f = t.fields.find((x) => x.name === name);
  if (!f) return '';
  const at = tu32(t, row, f.offset);
  return at > 0 && at < t.data.length ? plainMessage(t.data, at).trim() : '';
}

function tablesOf(arc: Archive, names: string[]): Map<string, Table> {
  const out = new Map<string, Table>();
  for (const e of arc.entries) {
    // tables are types 1, 3, 11 and 12; models and layouts are skipped without inflating them
    if (![1, 3, 11, 12].includes(e.type)) continue;
    if (e.comp === 1) {
      const name = zipEntryName(arc.data.subarray(e.offset, e.offset + e.size));
      if (name && !name.endsWith('.bin')) continue;
    }
    let body: Uint8Array;
    try {
      body = unpackEntry(arc, e).body;
    } catch {
      continue;
    }
    const t = parseTable(body);
    if (t && names.includes(t.name) && !out.has(t.name)) out.set(t.name, t);
  }
  return out;
}

function croOf(arc: Archive, hash: number): StageSummary['cro'] {
  const e = arc.entries.find((x) => x.hash === hash);
  if (!e) return null;
  const name = e.comp === 1 ? zipEntryName(arc.data.subarray(e.offset, e.offset + e.size)) : null;
  let size = e.size;
  let module = '';
  try {
    const body = unpackEntry(arc, e).body;
    size = body.length;
    // +0x84: offset of the module name (CRO header)
    if (body.length > 0x88 && u32(body, 0x80) === 0x304f5243) module = cstr(body, u32(body, 0x84)).trim();
  } catch {}
  return { name: name ?? '', hash: hex8(hash), size, module };
}

/** IPS records (offset in code.bin, size); RLE records count their run length. */
export function ipsRecords(b: Uint8Array): { offset: string; size: number }[] {
  if (new TextDecoder().decode(b.subarray(0, 5)) !== 'PATCH') throw new Error('code.ips が IPS ではありません');
  const out: { offset: string; size: number }[] = [];
  let o = 5;
  while (o + 3 <= b.length) {
    const offset = (b[o]! << 16) | (b[o + 1]! << 8) | b[o + 2]!;
    if (offset === 0x454f46 && o + 3 === b.length) return out;
    if (o + 5 > b.length) break;
    const n = (b[o + 3]! << 8) | b[o + 4]!;
    o += 5;
    if (n === 0) {
      if (o + 3 > b.length) break;
      out.push({ offset: hex8(offset), size: (b[o]! << 8) | b[o + 1]! });
      o += 3;
    } else {
      out.push({ offset: hex8(offset), size: n });
      o += n;
    }
  }
  throw new Error('code.ips の終わり (EOF) がありません');
}

/** Reads a Panana MOD ZIP and summarizes the stages in it. Throws on a file that is not such a ZIP. */
export async function parsePananaZip(zip: Uint8Array, baseline?: MasterBaseline | null): Promise<PackageSummary> {
  let expanded = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        expanded += f.originalSize;
        if (expanded > MAX_EXPANDED_BYTES) throw new Error('too large');
        return !f.name.endsWith('/');
      },
    });
  } catch (error) {
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('ZIP の展開後のサイズが大きすぎます');
    throw new Error(`ZIP を読めません: ${(error as Error).message}`);
  }
  const warnings: string[] = [];
  const files: ZipFileInfo[] = [];
  const romfs = new Map<string, Uint8Array>();
  let titleId = '';
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.split('/');
    const head = parts[0]!.toUpperCase();
    if (parts.length < 2 || !/^[0-9A-F]{16}$/.test(head)) {
      warnings.push(`タイトルのフォルダーの外のファイル: ${path}`);
      continue;
    }
    if (titleId && head !== titleId) warnings.push(`複数のタイトル ID があります: ${head}`);
    titleId ||= head;
    const rel = parts.slice(1).join('/');
    const name = rel.startsWith('romfs/') ? rel.slice(6) : null;
    const role: FileRole =
      rel === 'exefs/code.ips'
        ? 'codeIps'
        : name === 'patchList.bin'
          ? 'patchList'
          : name && /^\.crr\/.+\.crr$/i.test(name)
            ? 'crr'
            : name && /^[0-9A-F]{8}$/i.test(name)
              ? 'archive'
              : 'other';
    files.push({ path: rel, size: data.length, sha256: await sha256(data), role });
    if (name !== null) romfs.set(role === 'archive' ? name.toUpperCase() : name, data);
    else if (role === 'codeIps') romfs.set('\0code.ips', data);
  }
  if (!files.length) throw new Error(`ZIP に ${TITLE_ID}/ のファイルがありません`);
  if (titleId !== TITLE_ID) warnings.push(`電波人間のRPG FREE! (${TITLE_ID}) の MOD ではありません: ${titleId}`);
  files.sort((a, b) => a.path.localeCompare(b.path));

  let patchList: PackageSummary['patchList'] = null;
  const pl = romfs.get('patchList.bin');
  if (pl) {
    const n = pl.length >= 4 ? u32(pl, 0) : -1;
    if (n < 0 || 4 + n * 4 > pl.length) warnings.push('patchList.bin を読めません');
    else patchList = { count: n, hashes: Array.from({ length: n }, (_, i) => hex8(u32(pl, 4 + i * 4))) };
  }

  let codeIps: PackageSummary['codeIps'] = null;
  const ips = romfs.get('\0code.ips');
  if (ips) {
    try {
      codeIps = { size: ips.length, records: ipsRecords(ips) };
    } catch (error) {
      warnings.push((error as Error).message);
    }
  }

  // master tables that hold the stage rows
  let master: Map<string, Table> | null = null;
  let masterAll: { entry: number; table: Table }[] = [];
  const masterBytes = romfs.get(MASTER_ARCHIVE);
  if (masterBytes) {
    try {
      const arc = parseArchive(masterBytes);
      master = tablesOf(arc, ['Contents', 'MapStageIntegration', 'MessageMapStage']);
      if (baseline) masterAll = allTables(arc);
    } catch (error) {
      warnings.push(`master (${MASTER_ARCHIVE}) を読めません: ${(error as Error).message}`);
    }
  }
  const contents = master?.get('Contents');
  const integration = master?.get('MapStageIntegration');
  const messages = master?.get('MessageMapStage');
  const messageRow = (id: number): number => (messages ? messages.rowIds.indexOf(id) : -1);

  const stages: StageSummary[] = [];
  const sharedArchives: string[] = [];
  const refs = new Map<
    number,
    { values: Set<number>; inserts: { table: string; id: number }[]; archive: string; messageIds: string[] }
  >();
  for (const [name, data] of romfs) {
    if (!/^[0-9A-F]{8}$/.test(name)) continue;
    let arc: Archive;
    try {
      arc = parseArchive(data);
    } catch (error) {
      warnings.push(`${name}: ${(error as Error).message}`);
      continue;
    }
    const ts = tablesOf(arc, ['ContentsDef', 'MapStage']);
    const def = ts.get('ContentsDef');
    if (!def || def.rows < 3 || def.rowSize < 4) {
      sharedArchives.push(name);
      continue;
    }
    const content = tu32(def, 0, 0);
    const stageWarnings: string[] = [];
    if (hex8(arc.hash) !== name) stageWarnings.push(`ヘッダーのハッシュ ${hex8(arc.hash)} がファイル名と違います`);
    const crrPath = `.crr/contents${String(content).padStart(4, '0')}.crr`;
    const crr = romfs.has(crrPath) ? `romfs/${crrPath}` : null;
    const kind = content >= BASE_CONTENT_COUNT ? 'added' : 'modified';
    if (kind === 'added' && !crr) stageWarnings.push(`追加コンテンツの CRR (${crrPath}) がありません`);
    let contentsRow: boolean | null = null;
    if (contents) {
      contentsRow = content < contents.rows && tu32(contents, content, 0) === parseInt(name, 16);
      if (!contentsRow) stageWarnings.push(`master の Contents 行 ${content} がこのアーカイブを指していません`);
    } else if (kind === 'added') stageWarnings.push('master がないので Contents の行を確認できません');
    const inPatchList = patchList ? patchList.hashes.includes(name) : null;
    if (kind === 'added' && inPatchList === false) stageWarnings.push('patchList.bin にこのアーカイブがありません');

    const rows: StageRow[] = [];
    const local = ts.get('MapStage');
    for (let r = 0; local && r < local.rows; r++) {
      const messageId = tu32(local, r, 0x0c);
      let integrationRow: number | null = null;
      if (integration)
        for (let i = 0; i < integration.rows; i++)
          if (tu32(integration, i, 0x34) === content && tu32(integration, i, 0x0c) === messageId) integrationRow = i;
      const m = messageRow(messageId);
      rows.push({
        messageId: hex8(messageId),
        slot: tu16(local, r, 0x34),
        content: tu16(local, r, 0x38),
        stamina: tu8(local, r, 0x3d),
        visibleKind: tu8(local, r, 0x24),
        visibleArg: tu32(local, r, 0x1c),
        hiddenKind: tu8(local, r, 0x30),
        hiddenArg: tu32(local, r, 0x28),
        name: messages && m >= 0 ? namedString(messages, m, 'stage_name') : '',
        mission: messages && m >= 0 ? namedString(messages, m, 'stage_mission') : '',
        integrationRow,
        integrationId:
          integration && integrationRow !== null && integration.rowIds[integrationRow] !== undefined
            ? hex8(integration.rowIds[integrationRow]!)
            : null,
      });
      if (integration && integrationRow === null)
        stageWarnings.push(`MapStage ${r} に対応する MapStageIntegration の行がありません`);
    }
    if (!local) stageWarnings.push('MapStage がありません');
    const cro = croOf(arc, tu32(def, 2, 0));
    if (!cro) stageWarnings.push('ContentsDef の CRO がアーカイブにありません');
    else if (cro.module && `${cro.module}.cro` !== cro.name)
      stageWarnings.push(
        `CRO のモジュール名 ${cro.module} がエントリ名 ${cro.name} と違います (ゲームが受け付けるか未確認)`,
      );
    // references of this content to master rows: u32 values of its tables (推定) and insertion tags of its messages
    const values = new Set<number>();
    for (const t of allTables(arc).map((x) => x.table))
      for (let r = 0; r < t.rows; r++)
        for (let o = 0; o + 4 <= t.rowSize; o += 4) {
          const v = tu32(t, r, o);
          if (v >= 0x80000000) values.add(v);
        }
    const inserts: { table: string; id: number }[] = [];
    for (const r of rows) {
      const m = messageRow(parseInt(r.messageId, 16));
      if (messages && m >= 0)
        for (const f of messages.fields)
          if (f.name !== 'voice') inserts.push(...insertTags(messages.data, tu32(messages, m, f.offset)));
    }
    refs.set(content, { values, inserts, archive: name, messageIds: rows.map((r) => r.messageId) });
    stages.push({
      content,
      archive: name,
      kind,
      name: rows.find((x) => x.name)?.name ?? '',
      cro,
      crr,
      contentsRow,
      inPatchList,
      stages: rows,
      files: [`romfs/${name}`, ...(crr ? [crr] : [])],
      warnings: stageWarnings,
    });
  }
  stages.sort((a, b) => a.content - b.content);
  sharedArchives.sort();
  const conditionScripts = [
    ...new Set(
      stages.flatMap((s) =>
        s.stages.flatMap((r) => [
          ...(r.visibleKind === 0x72 ? [r.visibleArg] : []),
          ...(r.hiddenKind === 0x72 ? [r.hiddenArg] : []),
        ]),
      ),
    ),
  ].sort((a, b) => a - b);
  if (conditionScripts.length && !codeIps)
    warnings.push('条件スクリプト (種類 0x72) を使うステージがありますが code.ips がありません');
  if (!stages.length) warnings.push('コンテンツ (ContentsDef を持つアーカイブ) が見つかりません');

  let masterDiff: MasterTableDiff[] | null = null;
  if (baseline && masterBytes) {
    masterDiff = diffMaster(masterAll, baseline);
    for (const d of masterDiff)
      for (const row of [...d.added, ...d.changed]) {
        const id = row.id === null ? null : parseInt(row.id, 16);
        for (const [content, r] of refs) {
          if (
            (d.name === 'Contents' && row.row === content) ||
            (d.name === 'MapStageIntegration' &&
              row.id &&
              stages.some((s) => s.content === content && s.stages.some((x) => x.integrationId === row.id))) ||
            (d.name === 'MessageMapStage' && row.id && r.messageIds.includes(row.id))
          )
            row.owner = { content, by: 'own' };
          else if (id !== null && r.inserts.some((x) => x.table === d.name && x.id === id))
            row.owner ??= { content, by: 'insert' };
          else if (id !== null && r.values.has(id)) row.owner ??= { content, by: 'value' };
        }
      }
    // ItemData +0x0C (u16) is the row of ItemDataCore (推定: the sample's new item set it to the added row)
    const itemRows = masterDiff.find((d) => d.name === 'ItemData');
    const items = masterAll.find((t) => itemRows && hex8(t.entry) === itemRows.entry)?.table;
    for (const core of masterDiff.find((d) => d.name === 'ItemDataCore')?.added ?? [])
      for (const item of [...(itemRows?.added ?? []), ...(itemRows?.changed ?? [])])
        if (!core.owner && item.owner && items && items.rowSize >= 0x10 && tu16(items, item.row, 0x0c) === core.row)
          core.owner = { content: item.owner.content, by: 'link' };
    const loose = masterDiff.flatMap((d) =>
      [...d.added, ...d.changed].filter((r) => !r.owner).map((r) => `${d.name} ${r.row}`),
    );
    if (loose.length)
      warnings.push(
        `どのステージの変更か判定できない master の行があります: ${loose.slice(0, 8).join('、')}${loose.length > 8 ? ' …' : ''}`,
      );
  }
  return { titleId, files, stages, sharedArchives, patchList, codeIps, conditionScripts, masterDiff, warnings };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: bun panana-zip.ts <mod.zip> [master-baseline.json]');
  const baseline = process.argv[3] ? ((await Bun.file(process.argv[3]).json()) as MasterBaseline) : null;
  console.log(
    JSON.stringify(await parsePananaZip(new Uint8Array(await Bun.file(path).arrayBuffer()), baseline), null, 2),
  );
}
