import { describe, expect, test } from 'bun:test';
import {
  assertSupportedSaveChunks, KAHARA_TITLE_ID, readExtendedSave, SAVE_HEADER_BYTES,
  SAVE_MAX_CHUNKS, SAVE_REQUIRED, saveCrc32, writeExtendedSave, type ExtendedSave,
} from '../src/game/saveformat';
import { w16, w32 } from '../src/util/bytes';

function example(): ExtendedSave {
  return {
    minor: 0, generation: 17, titleId: KAHARA_TITLE_ID,
    profileId: new Uint8Array(16).fill(0x12), sourceDigest: new Uint8Array(32).fill(0x34),
    chunks: [
      { tag: 'LEGC', id: 0, version: 1, count: 1, flags: SAVE_REQUIRED, data: new Uint8Array([1, 2, 3]) },
      { tag: 'FUTR', id: 77, version: 42, count: 2, flags: 0, data: new Uint8Array([4, 5]) },
    ],
  };
}

function edited(edit: (bytes: Uint8Array) => void): Uint8Array {
  const bytes = writeExtendedSave(example());
  edit(bytes);
  w32(bytes, 28, saveCrc32(bytes, true));
  return bytes;
}

describe('proposed PNSV v1 container (#201 preparation)', () => {
  test('CRC matches the standard check vector', () => {
    expect(saveCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  test('round trip preserves unknown chunks and does not alias the input', () => {
    const save = example(), bytes = writeExtendedSave(save);
    const before = bytes.slice(), read = readExtendedSave(bytes);
    expect(read).toEqual(save);
    expect(writeExtendedSave(read)).toEqual(bytes);
    read.chunks[0]!.data[0] = 99;
    expect(bytes).toEqual(before);
    expect(save.chunks[0]!.data[0]).toBe(1);
  });

  test('empty chunks and nonzero byteOffset views work', () => {
    const save = example();
    save.chunks.unshift({ tag: 'ZERO', id: 0, version: 1, count: 0, flags: 0, data: new Uint8Array() });
    const bytes = writeExtendedSave(save), padded = new Uint8Array(bytes.length + 13);
    padded.set(bytes, 9);
    expect(readExtendedSave(padded.subarray(9, 9 + bytes.length))).toEqual(save);
    save.chunks = [];
    expect(readExtendedSave(writeExtendedSave(save))).toEqual(save);
  });

  test('required versions need explicit support, optional unknown data survives', () => {
    const save = readExtendedSave(writeExtendedSave(example()));
    expect(() => assertSupportedSaveChunks(save, new Map())).toThrow('unsupported required');
    expect(() => assertSupportedSaveChunks(save, new Map([['LEGC', new Set([1])]]))).not.toThrow();
    expect(() => assertSupportedSaveChunks(save, new Map([['LEGC', new Set([2])]]))).toThrow();
  });

  test('detects truncation and corruption including the directory', () => {
    const bytes = writeExtendedSave(example());
    expect(() => readExtendedSave(bytes.subarray(0, 80))).toThrow('length');
    expect(() => readExtendedSave(bytes.subarray(0, bytes.length - 1))).toThrow('length');
    bytes[bytes.length - 1]! ^= 1;
    expect(() => readExtendedSave(bytes)).toThrow('checksum');
    expect(() => readExtendedSave(edited(b => { b[b.length - 1]! ^= 1; }))).toThrow('chunk checksum');
  });

  test('rejects incompatible header versions, sizes and flags', () => {
    expect(() => readExtendedSave(edited(b => w16(b, 4, 2)))).toThrow('major');
    expect(() => readExtendedSave(edited(b => w32(b, 8, 100)))).toThrow('header size');
    expect(() => readExtendedSave(edited(b => w32(b, 16, 100)))).toThrow('directory offset');
    expect(() => readExtendedSave(edited(b => w32(b, 88, 1)))).toThrow('header flags');
    expect(() => readExtendedSave(edited(b => w32(b, 20, SAVE_MAX_CHUNKS + 1)))).toThrow('directory');
  });

  test('rejects invalid and overlapping ranges even with valid file CRC', () => {
    const d = SAVE_HEADER_BYTES;
    for (const offset of [0, 97, 0xfffffffc]) {
      expect(() => readExtendedSave(edited(b => w32(b, d + 16, offset)))).toThrow('range');
    }
    const same = example(); same.chunks[1]!.data = same.chunks[0]!.data.slice();
    const bytes = writeExtendedSave(same);
    // Both payload checksums remain valid, so overlap must be checked independently.
    w32(bytes, d + 32 + 16, d + 64);
    w32(bytes, 28, saveCrc32(bytes, true));
    expect(() => readExtendedSave(bytes)).toThrow('overlapping');
  });

  test('rejects duplicate identities, invalid metadata and unknown flag bits', () => {
    const save = example(); save.chunks.push({ ...save.chunks[0]! });
    expect(() => writeExtendedSave(save)).toThrow('duplicate');
    expect(() => readExtendedSave(edited(b => w32(b, SAVE_HEADER_BYTES + 28, 2)))).toThrow('flags');
    for (const mutate of [
      (s: ExtendedSave) => { s.generation = -1; },
      (s: ExtendedSave) => { s.generation = 0x100000000; },
      (s: ExtendedSave) => { s.profileId = new Uint8Array(15); },
      (s: ExtendedSave) => { s.sourceDigest = new Uint8Array(31); },
      (s: ExtendedSave) => { s.chunks[0]!.tag = '日本AB'; },
      (s: ExtendedSave) => { s.chunks[0]!.count = 0.5; },
    ]) {
      const s = example(); mutate(s);
      expect(() => writeExtendedSave(s)).toThrow('PNSV');
    }
  });
});
