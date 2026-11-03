import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ArmMachine, type Stub } from '../src/game/arm';
import { applyRecords, buildPatches, patchRecords } from '../src/game/patch';
import { BASE } from '../src/game/codeconst';
import { SAVE_PATCH, SAVE_PATCH_ID, SAVE_PATCH_SITES, savePatchProblem, SAVE_DISK_BYTES } from '../src/game/savepatch';
import { SAVE201_SOURCE_HASH } from '../src/game/savepatchdata';
import { readExtendedSave, saveCrc32 } from '../src/game/saveformat';
import { u32, w32 } from '../src/util/bytes';
import { assembleLine } from '../src/game/asm';

function legacy(): Uint8Array {
  const b = new Uint8Array(0x3b668);
  w32(b, 0, 10); w32(b, 4, 12);
  for (const [p, a, n] of [[8, 0x178, 0x9ec8], [16, 0x1dbf0, 0x9ec8], [0x158, 0xa040, 0x8a80], [0x160, 0x27ab8, 0x8a80], [0x168, 0x12ac0, 0x27b0], [0x170, 0x30538, 0x27b0]]) {
    w32(b, p!, a!); w32(b, p! + 4, n!);
  }
  for (let i = 0; i < 16; i++) {
    w32(b, 0x18 + i * 4, 0x15270 + i * 0x898); w32(b, 0x58 + i * 4, 0x898);
    w32(b, 0x98 + i * 4, 0x32ce8 + i * 0x898);
  }
  // Both native schema IDs (bit 1) and a unit byte distinguish the copies.
  w32(b, 0x178, 0x17847d0c << 1); w32(b, 0x1dbf0, 0x17847d0c << 1);
  b[0xa040] = 7; b[0x27ab8] = 3;
  return b;
}

const code = new Uint8Array(0x500000);
for (const [a, word] of SAVE_PATCH_SITES) w32(code, a - BASE, word);
const built = buildPatches(code, [SAVE_PATCH]).get(SAVE_PATCH_ID)!;
const patched = applyRecords(code, patchRecords([built]));
const label = (name: string): number => built.labels.get(`pns201_${name}`)!;
const A = 'pns:/panana-a.bin', B = 'pns:/panana-b.bin', SOURCE = 'data:/savedata.bin';

class FS {
  files = new Map<string, Uint8Array>();
  opens: [string, number][] = [];
  extExists = false;
  createCalls = 0;
  fault: 'short-write' | 'flush' | 'permission' | null = null;
  handles = new Map<number, { name: string; pos: number }>();
  m: ArmMachine;
  controller: number;
  stubs = new Map<number, Stub>();
  constructor(files = new Map([[SOURCE, legacy()]]), machineCode = patched) {
    this.files = files;
    const stubs = this.stubs;
    this.m = new ArmMachine(machineCode, { stubs, maxDepth: 40, maxSteps: 9000000 });
    const m = this.m;
    stubs.set(label('fail'), () => { throw new Error('save failure'); });
    // Run CRC code separately below; accelerating it here keeps FS fault tests bounded.
    stubs.set(label('crc'), () => saveCrc32(this.bytes(m.r[0]!, m.r[1]!), !!m.r[2]));
    stubs.set(0x33d690, () => m.alloc(m.r[0]!));
    stubs.set(0x33e51c, () => 0);
    stubs.set(0x33ba30, () => { for (let i = 0; i < 36; i++) m.wb(m.r[0]! + i, 0); return m.r[0]!; });
    stubs.set(label('mount_ext'), () => this.extExists ? 0 : 0xc8804478);
    stubs.set(label('create_ext'), () => { this.extExists = true; this.createCalls++; return 0; });
    stubs.set(0x33ca7c, () => {
      const name = this.string(m.r[1]!), mode = m.r[2]!;
      this.opens.push([name, mode]);
      if (this.fault === 'permission') return 0xc8a04576;
      if (!this.files.has(name)) return 0xc8804470;
      if (mode & 4) throw new Error('ExtData forbids CREATE-open');
      const h = m.alloc(4); this.handles.set(h, { name, pos: 0 }); m.write(m.r[0]!, h, 4); return 0;
    });
    stubs.set(0x335460, () => {
      const h = this.handles.get(m.r[1]!)!;
      m.write(m.r[0]!, this.files.get(h.name)!.length, 4); m.write(m.r[0]! + 4, 0, 4); return 0;
    });
    stubs.set(0x333ad8, () => 0x1234);
    stubs.set(0x3607c8, () => {
      const p = m.r[1]!;
      expect(m.read(p, 4)).toBe(4); expect(m.read(p + 8, 4)).toBe(28);
      const name = 'pns:' + this.string(m.read(p + 4, 4));
      this.files.set(name, new Uint8Array(m.r[2]!)); return 0;
    });
    const transfer = (write: boolean): Stub => () => {
      const h = this.handles.get(m.read(m.r[0]!, 4))!, b = this.files.get(h.name)!;
      const n = Math.min(m.r[3]!, b.length - h.pos);
      const count = write && this.fault === 'short-write' ? Math.floor(n / 2) : n;
      if (write) {
        if (h.name === SOURCE) throw new Error('source save must be read only');
        b.set(this.bytes(m.r[2]!, count), h.pos);
      } else this.put(m.r[2]!, b.subarray(h.pos, h.pos + count));
      h.pos += count; m.write(m.r[1]!, count, 4); return 0;
    };
    stubs.set(0x33c908, transfer(false)); stubs.set(0x361674, transfer(true));
    stubs.set(0x3605c0, () => this.fault === 'flush' ? 0xc8a04576 : 0);
    stubs.set(label('original_close'), () => {
      const f = m.r[0]!; this.handles.delete(m.read(f + 16, 4));m.write(f + 16, 0, 4);return 1;
    });
    stubs.set(label('original_destroy'), () => 0);
    this.controller = m.alloc(0x298);
    this.put(this.controller + 0x210, new Uint8Array(Buffer.from(SOURCE + '\0', 'utf16le')));
  }
  bytes(p: number, n: number): Uint8Array { return Uint8Array.from({ length: n }, (_, i) => this.m.rb(p + i)); }
  put(p: number, b: Uint8Array): void { for (let i = 0; i < b.length; i++) this.m.wb(p + i, b[i]!); }
  string(p: number): string { let s = ''; for (let n = 0; n < 100; n++) { const c = this.m.read(p + n * 2, 2); if (!c) return s; s += String.fromCharCode(c); } throw new Error('unterminated path'); }
  run(name: string, args: number[] = []): number { return this.m.run(label(name), args); }
  start(): number { return this.run('save201_start', [this.m.alloc(36), this.controller + 0x210]); }
  open(mode = 3): number { const f = this.m.alloc(36); expect(this.run('save201_open', [f, this.controller + 0x210, mode])).toBe(1); return f; }
  write(f: number, offset: number, bytes: Uint8Array): void {
    this.run('save201_seek', [f, offset, 0]); const p = this.m.alloc(bytes.length); this.put(p, bytes);
    expect(this.run('save201_write', [f, p, bytes.length, 1])).toBe(bytes.length);
  }
}

describe('ExtData ARM save patch', () => {
  test('generated payload matches source and fits; incompatible ROMs fail closed', () => {
    const hash = createHash('sha256').update(['runtime.c', 'bridges.S', 'runtime.ld'].map(n => readFileSync(new URL(`../scripts/save201/${n}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')).join('\n')).digest('hex');
    expect(hash).toBe(SAVE201_SOURCE_HASH); expect(built.errors).toEqual([]); expect(savePatchProblem(code)).toBeNull();
    const bad = code.slice(); bad[0x33789c - BASE]! ^= 1;
    expect(savePatchProblem(bad)).toContain('33789C');
    expect(built.cave![1] - built.cave![0]).toBeLessThan(0xf60);
  });

  test('compiled ARM CRC agrees with the PC codec', () => {
    const m = new ArmMachine(patched, { maxDepth: 10 });
    const p = m.alloc(256), data = Uint8Array.from({ length: 256 }, (_, i) => i);
    data.forEach((b, i) => m.wb(p + i, b));
    for (const file of [0, 1]) expect(m.run(label('crc'), [p, data.length, file])).toBe(saveCrc32(data, !!file));
  });

  test('archive adapter requests real ExtData, with the SD/id binary path', () => {
    const stubs = new Map<number, Stub>();
    const m = new ArmMachine(patched, { stubs, maxDepth: 10 });
    stubs.set(0x2bbef4, () => {
      expect(m.r[2]).toBe(6); expect(m.r[3]).toBe(2);
      const path = m.read(m.r[13]!, 4);
      expect(m.read(m.r[13]! + 4, 4)).toBe(12);
      expect([0, 4, 8].map(o => m.read(path + o, 4))).toEqual([1, 0xa79, 0]);
      return 0xc8804478;
    });
    stubs.set(0x2bbf9c, () => {
      // Model the native registration-tail epilogue, whose stack contract the bridge uses.
      m.r[14] = m.read(m.r[13]! + 52, 4); m.r[13] = m.r[13]! + 56; return m.r[0]!;
    });
    expect(m.run(label('mount_ext'))).toBe(0xc8804478);
  });

  test('CreateExtSaveData builds the packed IPC command, distinct from trial archive opening', () => {
    const c = patched.slice(), entry = label('create_ext'), tls = 0x10000000;
    expect(u32(c, entry + 4 - BASE)).toBe(0xee1d4f70);
    // Model the TLS system register and svc boundary; execute every command-buffer store in ARM.
    w32(c, entry + 4 - BASE, assembleLine(`mov r4, #0x${tls.toString(16)}`, entry + 4).words[0]!);
    let svc = entry;
    while (u32(c, svc - BASE) !== 0xef000032) svc += 4;
    w32(c, svc - BASE, assembleLine('bl 0x100100', svc).words[0]!);
    const stubs = new Map<number, Stub>(), m = new ArmMachine(c, { stubs });
    m.write(0x574a30, 55, 4);
    stubs.set(0x100100, () => {
      expect(m.r[0]).toBe(55);
      const cmd = Array.from({ length: 12 }, (_, i) => m.read(tls + 128 + i * 4, 4));
      expect(cmd).toEqual([0x8510242, 1, 0xa79, 0, 0, 0, 2, 0x100000, 0, 0, 10, 0]);
      m.write(tls + 132, 0, 4); return 0;
    });
    expect(m.run(entry)).toBe(0);
  });

  test('existence check creates ExtData, migrates every native byte and leaves source unchanged', () => {
    const fs = new FS(), before = fs.files.get(SOURCE)!.slice();
    expect(fs.start()).toBe(1); expect(fs.createCalls).toBe(1);
    const save = readExtendedSave(fs.files.get(A)!);
    expect(save.generation).toBe(1); expect(save.chunks[0]!.data).toEqual(before);
    expect(fs.files.get(SOURCE)).toEqual(before);
    expect(fs.opens.filter(([n]) => n === SOURCE)).toEqual([[SOURCE, 1]]);
    expect(fs.m.rb(fs.controller + 0x292)).toBe(0);
  }, 30000);

  test('normal and snapshot byte ranges persist across reopen and startup', () => {
    const fs = new FS(); fs.start(); const f = fs.open();
    fs.write(f, 0xa040, new Uint8Array([21])); fs.write(f, 0x27ab8, new Uint8Array([34]));
    fs.run('save201_flush', [f]); fs.run('save201_close', [f]);
    const newer = readExtendedSave(fs.files.get(B)!);
    expect(newer.generation).toBe(2); expect(newer.chunks[0]!.data[0xa040]).toBe(21); expect(newer.chunks[0]!.data[0x27ab8]).toBe(34);
    const reopened = new FS(fs.files); reopened.extExists = true; expect(reopened.start()).toBe(1);
    const r = reopened.open(1), out = reopened.m.alloc(1);
    reopened.run('save201_seek', [r, 0x27ab8, 0]); reopened.run('save201_read', [r, out, 1]);
    expect(reopened.m.rb(out)).toBe(34); expect(reopened.files.get(SOURCE)![0xa040]).toBe(7);
  }, 30000);

  test('new game persists empty state and creates its native stream in RAM', () => {
    const fs = new FS(new Map()); expect(fs.start()).toBe(0);
    expect(readExtendedSave(fs.files.get(A)!).chunks[0]!.data.length).toBe(0);
    const f = fs.open(6); const native = legacy(); fs.write(f, 0, native); fs.run('save201_close', [f]);
    expect(readExtendedSave(fs.files.get(B)!).chunks[0]!.data).toEqual(native);
  }, 30000);

  test('partial write keeps the last complete generation recoverable', () => {
    const fs = new FS(); fs.start(); const good = fs.files.get(A)!.slice(), f = fs.open();
    fs.write(f, 0xa040, new Uint8Array([55])); fs.fault = 'short-write';
    expect(() => fs.run('save201_flush', [f])).toThrow('save failure');
    expect(fs.files.get(A)).toEqual(good);
    const recovery = new FS(fs.files); recovery.extExists = true; expect(recovery.start()).toBe(1);
    expect(readExtendedSave(recovery.files.get(A)!).chunks[0]!.data[0xa040]).toBe(7);
  }, 30000);

  test('corrupt existing containers and permission errors never re-import the source', () => {
    const files = new Map([[SOURCE, legacy()], [A, new Uint8Array(SAVE_DISK_BYTES)]]);
    const fs = new FS(files); expect(() => fs.start()).toThrow('save failure');
    expect(fs.opens.filter(([n]) => n === SOURCE)).toEqual([]);
    const denied = new FS(); denied.fault = 'permission'; expect(() => denied.start()).toThrow('save failure');
    expect(denied.opens.filter(([n]) => n === SOURCE)).toEqual([]);
  }, 30000);

  test('flush failure stops saving and bounds/modes prevent invalid stream accesses', () => {
    const fs = new FS(); fs.start(); const f = fs.open(), old = fs.files.get(A)!.slice();
    expect(() => fs.run('save201_seek', [f, 0x40001, 0])).toThrow('save failure');
    fs.write(f, 0xa040, new Uint8Array([66])); fs.fault = 'flush';
    expect(() => fs.run('save201_flush', [f])).toThrow('save failure'); expect(fs.files.get(A)).toEqual(old);
    const another = new FS(); another.start(); const ro = another.open(1);
    expect(() => another.write(ro, 0, new Uint8Array([1]))).toThrow('save failure');
    another.run('save201_seek', [ro, 0x3b668, 0]);
    expect(() => another.run('save201_read', [ro, another.m.alloc(1), 1])).toThrow('save failure');
  }, 30000);

  test('native format clears only the migrated profile; unrelated streams use their original routines', () => {
    const fs = new FS(); fs.start(); const original = fs.files.get(SOURCE)!.slice();
    fs.run('save201_format', [fs.controller]);
    expect(readExtendedSave(fs.files.get(B)!).chunks[0]!.data.length).toBe(0);
    expect(fs.files.get(SOURCE)).toEqual(original);
    const path = fs.m.alloc(40), f = fs.m.alloc(36);
    fs.put(path, new Uint8Array(Buffer.from('trial:/savedata.bin\0', 'utf16le')));
    fs.stubs.set(label('original_open'), m => { expect(m.r[1]).toBe(path); expect(m.r[2]).toBe(1); return 77; });
    expect(fs.run('save201_open', [f, path, 1])).toBe(77);
  }, 30000);
});

const romPath = new URL('../roms/kahara-code.bin', import.meta.url);
describe.skipIf(!existsSync(romPath))('save adapter with original v1.1.0 load/save code', () => {
  const rom = existsSync(romPath) ? new Uint8Array(readFileSync(romPath)) : code;
  const realBuilt = buildPatches(rom, [SAVE_PATCH]).get(SAVE_PATCH_ID)!;
  const realPatched = applyRecords(rom, patchRecords([realBuilt]));
  function engine(fs: FS): { flags: number; units: number } {
    const m = fs.m, c = fs.controller, globals = m.alloc(0x1400);
    m.write(0x564638, globals, 4);
    m.write(0x5674b4, c, 4); // controller (57457c is the archive-manager singleton)
    m.write(0x57457c, m.alloc(16), 4);
    m.wb(c + 0x290, 3);
    const flags = m.alloc(0x9ec8), units = m.alloc(0x8a80), third = m.alloc(0x27b0);
    m.write(c + 0x178, flags, 4); m.write(c + 0x17c, 0x9ec8, 4);
    m.write(c + 0x200, units, 4); m.write(c + 0x204, 0x8a80, 4);
    m.write(c + 0x208, third, 4); m.write(c + 0x20c, 0x27b0, 4);
    for (let i = 0; i < 16; i++) { m.write(c + 0x180 + i * 4, m.alloc(0x898), 4); m.write(c + 0x1c0 + i * 4, 0x898, 4); }
    for (const a of [0x317e30, 0x434ff8, 0x427bd0, 0x3fb440, 0x2349f0, 0x29052c, 0x3fc75c, 0x1a6114, 0x31d744, 0x3073ac, 0x3fcfb0, 0x1a4460, 0x290540, 0x3fcb0c]) fs.stubs.set(a, () => 0);
    fs.stubs.set(0x281e30, () => 0x17847d0c);
    fs.stubs.set(0x281c1c, () => 0);
    // The source loader compares flag key 1 with this ROM constant.
    return { flags, units };
  }
  test('actual native loader and both native save branches use the virtual stream', () => {
    expect(realBuilt.errors).toEqual([]); expect(savePatchProblem(rom)).toBeNull();
    const fs = new FS(undefined, realPatched); fs.start(); const { units } = engine(fs);
    expect(fs.m.run(0x2e28e0, [fs.controller])).toBe(0);
    expect(fs.m.rb(units)).toBe(7);
    fs.m.wb(units, 42); fs.m.wb(fs.controller + 0x292, 1);
    expect(fs.m.run(0x3fdffc, [fs.controller, 0])).toBe(1);
    expect(fs.m.rb(fs.controller + 0x292)).toBe(0);
    expect(readExtendedSave(fs.files.get(B)!).chunks[0]!.data[0xa040]).toBe(42);
    fs.m.wb(units, 59);
    expect(fs.m.run(0x3fdffc, [fs.controller, 1])).toBe(1);
    expect(readExtendedSave(fs.files.get(A)!).chunks[0]!.data[0x27ab8]).toBe(59);
    // Explicit native snapshot restore must retrieve 59, including its header write/flush/close.
    fs.m.wb(units, 99);
    expect(fs.m.run(0x3fe44c, [fs.controller])).toBe(1);
    expect(fs.m.rb(units)).toBe(59);
    expect(fs.m.calls.some(call => call.target === 0x2358cc)).toBe(false);
    expect(fs.files.get(SOURCE)![0xa040]).toBe(7);
  }, 30000);
  test('actual native create builds both copies without CREATE-open on ExtData', () => {
    const fs = new FS(new Map(), realPatched); fs.start(); const { units } = engine(fs);
    fs.m.wb(units, 73);
    expect(fs.m.run(0x3fdb2c, [fs.controller])).toBe(1);
    const native = readExtendedSave(fs.files.get(B)!).chunks[0]!.data;
    expect(native.length).toBe(0x3b668); expect(u32(native, 8)).toBe(0x178);
    expect(native[0xa040]).toBe(73); expect(native[0x27ab8]).toBe(73);
  }, 30000);
});
