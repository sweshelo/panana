// Proposed #201 disk container. This does not install a game patch or modify savedata.bin.
import { ascii, u16, u32, w16, w32 } from '../util/bytes';

export const SAVE_HEADER_BYTES = 96;
export const SAVE_ENTRY_BYTES = 32;
export const SAVE_MAX_BYTES = 16 * 1024 * 1024;
export const SAVE_MAX_CHUNKS = 4096;
export const SAVE_REQUIRED = 1;
export const KAHARA_TITLE_ID = 0x00040000000a7900n;

export interface SaveChunk {
  /** Four printable ASCII characters; e.g. LEGC, VARS, MODS, AMAP. */
  tag: string;
  /** Stable key within the tag, never the current position in an editor table. */
  id: number;
  version: number;
  count: number;
  flags: number;
  data: Uint8Array;
}

export interface ExtendedSave {
  minor: number;
  generation: number;
  titleId: bigint;
  /** Stable 128-bit MOD profile identifier. */
  profileId: Uint8Array;
  /** SHA-256 of the original migration input; provenance, not a two-file transaction. */
  sourceDigest: Uint8Array;
  chunks: SaveChunk[];
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  return c >>> 0;
});

/** CRC-32/ISO-HDLC. For the file checksum its own word (+28) is treated as zero. */
export function saveCrc32(bytes: Uint8Array, file = false): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const b = file && i >= 28 && i < 32 ? 0 : bytes[i]!;
    c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`PNSV: ${message}`);
}

function uint(n: number, name: string, max = 0xffffffff): void {
  check(Number.isInteger(n) && n >= 0 && n <= max, `invalid ${name}`);
}

function checkChunk(chunk: SaveChunk): void {
  check(/^[\x20-\x7e]{4}$/.test(chunk.tag), 'invalid chunk tag');
  uint(chunk.id, 'chunk ID');
  uint(chunk.version, 'chunk version');
  uint(chunk.count, 'chunk count');
  uint(chunk.flags, 'chunk flags', SAVE_REQUIRED);
}

function identity(chunk: SaveChunk): string { return `${chunk.tag}:${chunk.id}`; }
const align4 = (n: number): number => Math.ceil(n / 4) * 4;

/** Deterministic encoding, retaining unknown chunks, their versions and their order. */
export function writeExtendedSave(save: ExtendedSave): Uint8Array {
  uint(save.minor, 'minor version', 0xffff);
  uint(save.generation, 'generation');
  check(save.titleId >= 0n && save.titleId <= 0xffffffffffffffffn, 'invalid title ID');
  check(save.profileId.length === 16, 'profile ID must be 16 bytes');
  check(save.sourceDigest.length === 32, 'source digest must be 32 bytes');
  check(save.chunks.length <= SAVE_MAX_CHUNKS, 'too many chunks');
  const keys = new Set<string>();
  let total = SAVE_HEADER_BYTES + save.chunks.length * SAVE_ENTRY_BYTES;
  for (const chunk of save.chunks) {
    checkChunk(chunk);
    check(!keys.has(identity(chunk)), 'duplicate chunk ID');
    keys.add(identity(chunk));
    total = align4(total) + chunk.data.length;
    check(total <= SAVE_MAX_BYTES, 'file exceeds size limit');
  }
  const out = new Uint8Array(total);
  out.set([0x50, 0x4e, 0x53, 0x56]); // PNSV
  w16(out, 4, 1); w16(out, 6, save.minor);
  w32(out, 8, SAVE_HEADER_BYTES); w32(out, 12, total);
  w32(out, 16, SAVE_HEADER_BYTES); w32(out, 20, save.chunks.length);
  w32(out, 24, save.generation);
  w32(out, 32, Number(save.titleId & 0xffffffffn));
  w32(out, 36, Number(save.titleId >> 32n));
  out.set(save.profileId, 40); out.set(save.sourceDigest, 56);
  let offset = SAVE_HEADER_BYTES + save.chunks.length * SAVE_ENTRY_BYTES;
  save.chunks.forEach((chunk, i) => {
    offset = align4(offset);
    const d = SAVE_HEADER_BYTES + i * SAVE_ENTRY_BYTES;
    for (let k = 0; k < 4; k++) out[d + k] = chunk.tag.charCodeAt(k);
    w32(out, d + 4, chunk.id); w32(out, d + 8, chunk.version);
    w32(out, d + 12, chunk.count); w32(out, d + 16, offset);
    w32(out, d + 20, chunk.data.length); w32(out, d + 24, saveCrc32(chunk.data));
    w32(out, d + 28, chunk.flags);
    out.set(chunk.data, offset); offset += chunk.data.length;
  });
  w32(out, 28, saveCrc32(out, true));
  return out;
}

/** Container validation only. Call assertSupportedSaveChunks before interpreting game state. */
export function readExtendedSave(bytes: Uint8Array): ExtendedSave {
  check(bytes.length >= SAVE_HEADER_BYTES && bytes.length <= SAVE_MAX_BYTES, 'invalid file length');
  check(ascii(bytes, 0, 4) === 'PNSV', 'wrong magic');
  check(u16(bytes, 4) === 1, 'unsupported major version');
  check(u32(bytes, 8) === SAVE_HEADER_BYTES, 'unsupported header size');
  check(u32(bytes, 12) === bytes.length, 'file length mismatch');
  check(u32(bytes, 16) === SAVE_HEADER_BYTES, 'unsupported directory offset');
  check(u32(bytes, 88) === 0 && u32(bytes, 92) === 0, 'unsupported header flags');
  const count = u32(bytes, 20);
  const end = SAVE_HEADER_BYTES + count * SAVE_ENTRY_BYTES;
  check(count <= SAVE_MAX_CHUNKS && end <= bytes.length, 'invalid directory');
  check(u32(bytes, 28) === saveCrc32(bytes, true), 'file checksum mismatch');
  const chunks: SaveChunk[] = [];
  const keys = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    const d = SAVE_HEADER_BYTES + i * SAVE_ENTRY_BYTES;
    const offset = u32(bytes, d + 16), length = u32(bytes, d + 20);
    check(offset >= end && offset % 4 === 0 && offset + length <= bytes.length, 'invalid chunk range');
    const chunk: SaveChunk = {
      tag: ascii(bytes, d, 4), id: u32(bytes, d + 4), version: u32(bytes, d + 8),
      count: u32(bytes, d + 12), flags: u32(bytes, d + 28), data: bytes.slice(offset, offset + length),
    };
    checkChunk(chunk);
    check(!keys.has(identity(chunk)), 'duplicate chunk ID');
    keys.add(identity(chunk));
    check(saveCrc32(chunk.data) === u32(bytes, d + 24), 'chunk checksum mismatch');
    if (length) ranges.push({ start: offset, end: offset + length });
    chunks.push(chunk);
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) check(ranges[i]!.start >= ranges[i - 1]!.end, 'overlapping chunks');
  return {
    minor: u16(bytes, 6), generation: u32(bytes, 24),
    titleId: BigInt(u32(bytes, 32)) | (BigInt(u32(bytes, 36)) << 32n),
    profileId: bytes.slice(40, 56), sourceDigest: bytes.slice(56, 88), chunks,
  };
}

/** Unknown optional chunks survive PC editing; unknown required versions must block gameplay. */
export function assertSupportedSaveChunks(save: ExtendedSave, supported: ReadonlyMap<string, ReadonlySet<number>>): void {
  for (const chunk of save.chunks) {
    if (chunk.flags & SAVE_REQUIRED) {
      check(supported.get(chunk.tag)?.has(chunk.version) === true, `unsupported required chunk ${chunk.tag} v${chunk.version}`);
    }
  }
}
