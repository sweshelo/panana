// The base MOD of every game (rom/basemod.ts) and the model index RPG3 shares with FREE! (bch/models.ts). The parts
// with a dump skip when it is missing (test/env.ts).
import { describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { lz10Compress } from '../src/archive/lz10';
import { parseArchive } from '../src/archive/gsarc';
import { BchEntryIndex } from '../src/bch/models';
import { HonoluluSession } from '../src/honolulu/session';
import { OahuSession } from '../src/oahu/session';
import { baseModFor, packageOn } from '../src/rom/basemod';
import { openImage, openImages, type BaseMod } from '../src/rom/dump';
import { appendIps } from '../src/rom/ips';
import { HONOLULU, KAHARA, OAHU } from '../src/rom/titles';
import { equalBytes, w32 } from '../src/util/bytes';
import { hasHonolulu, hasOahuBase, hasOahuUpdate, HONOLULU_BASE, OAHU_BASE, OAHU_UPDATE } from './env';

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const IPS = (off: number, data: number[]): Uint8Array =>
  Uint8Array.from([...new TextEncoder().encode('PATCH'), (off >> 16) & 255, (off >> 8) & 255, off & 255, 0, data.length, ...data, ...new TextEncoder().encode('EOF')]);

describe('base MOD (no ROM)', () => {
  test("a folder of the game's MOD is read, another game's is refused by the title ID in its path", () => {
    const files = [
      { name: '56562135', path: 'mod/00040000000EF000/romfs/56562135', bytes: bytes(1) },
      { name: 'code.ips', path: 'mod/00040000000EF000/exefs/code.ips', bytes: IPS(0, [1]) },
    ];
    const mod = baseModFor(OAHU, 'mod', files);
    expect([...mod.romfs.keys()]).toEqual(['56562135']);
    expect(mod.ips).not.toBeNull();
    expect(() => baseModFor(KAHARA, 'mod', files)).toThrow(/電波人間のRPG3/);
    // a folder without a title ID (elpulse's mod/out) is taken as it is
    expect(baseModFor(HONOLULU, 'out', [{ name: 'A90C8038', path: 'out/A90C8038', bytes: bytes(2) }]).romfs.size).toBe(1);
  });

  test("the package has the base's files under the rebuilt ones", () => {
    const mod: BaseMod = { label: 'm', romfs: new Map([['11111111', bytes(1)], ['22222222', bytes(2)]]), ips: IPS(0, [1]) };
    const pkg = packageOn(mod, new Map([['22222222', bytes(9)]]), appendIps(mod.ips, [[4, bytes(5)]]));
    expect([...pkg.keys()]).toEqual(['romfs/11111111', 'romfs/22222222', 'exefs/code.ips']);
    expect([...pkg.get('romfs/22222222')!]).toEqual([9]);
    // the base's records come first, the game's after them
    expect([...pkg.get('exefs/code.ips')!]).toEqual([...IPS(0, [1]).subarray(0, -3), 0, 0, 4, 0, 1, 5, ...new TextEncoder().encode('EOF')]);
    expect([...packageOn(null, new Map([['33333333', bytes(3)]]), null).keys()]).toEqual(['romfs/33333333']);
  });

  test('the model index reads each archive once and finds entries by hash (the first archive wins)', async () => {
    const archive = (entries: [number, Uint8Array][]): Uint8Array => {
      const hdr = new Uint8Array(12 + 28 * entries.length);
      w32(hdr, 0, 5); w32(hdr, 4, 0x28480000); w32(hdr, 8, entries.length);
      const blobs = entries.map(([, b]) => lz10Compress(b));
      let at = hdr.length;
      entries.forEach(([hash, body], i) => {
        [hash, 0, blobs[i]!.length, at, 6, 0xffffffff, body.length].forEach((v, j) => w32(hdr, 12 + i * 28 + j * 4, v));
        at += blobs[i]!.length;
      });
      return Uint8Array.from([...hdr, ...blobs.flatMap((b) => [...b])]);
    };
    const files: Record<string, Uint8Array> = { A: archive([[0x100, bytes(1, 2)], [0x200, bytes(3)]]), B: archive([[0x200, bytes(9)], [0x300, bytes(4)]]) };
    const reads: string[] = [];
    const index = await BchEntryIndex.of(['A', 'B'], async (n) => (reads.push(n), parseArchive(files[n]!)));
    expect([...index.body(0x100)!]).toEqual([1, 2]);
    expect([...index.body(0x200)!]).toEqual([3]);
    expect([...index.body(0x300)!]).toEqual([4]);
    expect(index.body(0x400)).toBeNull();
    expect(index.get(0)).toBeUndefined();
    expect(reads).toEqual(['A', 'B']);
  });
});

describe.skipIf(!hasOahuBase)('RPG3 monster models', () => {
  test('the photos of many monsters read the model archive once', async () => {
    const dump = await openImage(Bun.file(OAHU_BASE), 'base');
    const s = await OahuSession.open(dump);
    let reads = 0;
    const own = s.dump.readRomfs;
    s.dump.readRomfs = (name) => {
      if (name === '28480000') reads++;
      return own(name);
    };
    s.monsterModels.forgetModels();
    let models = 0;
    for (let d = 0; d < 6; d++) {
      const r = await s.monsterModels.ref(d).load();
      if (r) models += r.set.models.size;
    }
    expect(models).toBeGreaterThan(0);
    expect(reads).toBe(1);
  }, 300_000);
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 on a base MOD', () => {
  test("the dump reads the MOD's files and code.ips, and the export writes them", async () => {
    const raw = await openImages([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], (f) => (f as { name?: string }).name ?? '');
    const at = raw.code.length - 4;
    const mod: BaseMod = { label: 'test', romfs: new Map([['DEADBEEF', bytes(1, 2, 3)]]), ips: IPS(at, [0xaa]) };
    const s = await OahuSession.open(raw, mod);
    expect(s.baseMod).toBe(mod);
    expect(s.raw).toBe(raw);
    expect([...(await s.dump.readRomfs('DEADBEEF'))]).toEqual([1, 2, 3]);
    expect(s.dump.code[at]).toBe(0xaa);
    const zip = unzipSync(await s.modZip());
    expect([...zip[`${OAHU.titleId}/romfs/DEADBEEF`]!]).toEqual([1, 2, 3]);
    expect(equalBytes(zip[`${OAHU.titleId}/exefs/code.ips`]!, mod.ips!)).toBe(true);
  }, 300_000);
});

describe.skipIf(!hasHonolulu)('the first game on a base MOD', () => {
  test("the MOD's files go into the package", async () => {
    const raw = await openImage(Bun.file(HONOLULU_BASE), 'base');
    const mod: BaseMod = { label: 'test', romfs: new Map([['DEADBEEF', bytes(7)]]), ips: null };
    const s = await HonoluluSession.open(raw, mod);
    expect([...(await s.dump.readRomfs('DEADBEEF'))]).toEqual([7]);
    expect([...s.modPackage().keys()]).toEqual(['romfs/DEADBEEF']);
  }, 300_000);
});
