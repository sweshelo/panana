// CRO0 (nn::ro relocatable module) parse / build, checked against the 127 content CROs of RPG FREE! (Update v17408):
// parseCro → buildCro gives the same bytes for all of them (lanai-custom-stages 3ds/research/cro-format.md, where the
// layout facts buildCro uses are written). Pure: Uint8Array in, Uint8Array out. eventScript.ts lays an author's events
// into a parsed CRO with it.
import { sha256 } from './codes';

// ------------------------------------------------------------------------------------------------ bytes
const rd = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const rd16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const wr = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
};
const wr16 = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
};
const cstrAt = (b: Uint8Array, o: number): string => {
  let e = o;
  while (e < b.length && b[e]) e++;
  return String.fromCharCode(...b.subarray(o, e));
};
const align = (v: number, a: number): number => Math.ceil(v / a) * a;

// ------------------------------------------------------------------------------------------------ model
/** A position inside the module: segment index (low 4 bits) and offset in that segment (<< 4). */
export interface SegTag {
  seg: number;
  off: number;
}
export const tagDecode = (v: number): SegTag | null => (v === 0xffffffff ? null : { seg: v & 15, off: v >>> 4 });
export const tagEncode = (t: SegTag | null): number => (t ? ((t.off << 4) | t.seg) >>> 0 : 0xffffffff);

/** ARM relocation types seen in CRO patch lists (ELF numbering). */
export const RELOC = { NONE: 0, ABS32: 2, REL32: 3, CALL: 0x1c, JUMP24: 0x1d, TARGET1: 0x26, PREL31: 0x2a } as const;

export interface CroSegment {
  /** 0 text, 1 rodata, 2 data, 3 bss. Unused slots are {type 0, size 0}. */
  type: number;
  size: number;
  /** Raw bytes for text/rodata/data (null for an empty slot or bss). Offsets in the file are derived by buildCro. */
  bytes: Uint8Array | null;
}

/** One patch of an import batch (external relocation): where to write and how. */
export interface CroPatch {
  target: SegTag;
  type: number;
  addend: number;
  /** Byte +6 ("already resolved"); 0 in every file. */
  resolved: number;
}

/** One internal relocation: write (address of segment `symbolSeg` + addend) at target. */
export interface CroReloc {
  target: SegTag;
  type: number;
  symbolSeg: number;
  addend: number;
}

export interface CroImportModule {
  name: string;
  indexed: { index: number; patches: CroPatch[] }[];
  anonymous: { symbol: SegTag; patches: CroPatch[] }[];
}

export interface Cro {
  /** Module name ("contents0038"). */
  name: string;
  /** Header words kept as they are (0 / -1 in a file; nn::ro fills some at load). */
  next: number;
  prev: number;
  bssSize: number;
  fixedSize: number;
  unk9C: number;
  /** +0xA0: tag of nnroControlObject_ (same value as its named export). */
  controlObject: SegTag | null;
  onLoad: SegTag | null;
  onExit: SegTag | null;
  onUnresolved: SegTag | null;
  segments: CroSegment[];
  namedExports: { name: string; symbol: SegTag }[];
  indexedExports: SegTag[];
  importModules: CroImportModule[];
  namedImports: { name: string; patches: CroPatch[] }[];
  indexedImports: { index: number; patches: CroPatch[] }[];
  anonymousImports: { symbol: SegTag; patches: CroPatch[] }[];
  staticAnonymous: { symbol: SegTag; patches: CroPatch[] }[];
  internalRelocs: CroReloc[];
  staticRelocs: CroReloc[];
}

// ------------------------------------------------------------------------------------------------ header offsets
export const H = {
  magic: 0x80,
  nameOff: 0x84,
  next: 0x88,
  prev: 0x8c,
  fileSize: 0x90,
  bssSize: 0x94,
  fixedSize: 0x98,
  unk9C: 0x9c,
  controlObject: 0xa0,
  onLoad: 0xa4,
  onExit: 0xa8,
  onUnresolved: 0xac,
  codeOff: 0xb0,
  codeSize: 0xb4,
  dataOff: 0xb8,
  dataSize: 0xbc,
  modName: 0xc0,
  modNameSize: 0xc4,
  segTable: 0xc8,
  segNum: 0xcc,
  namedExp: 0xd0,
  namedExpNum: 0xd4,
  indexedExp: 0xd8,
  indexedExpNum: 0xdc,
  expStr: 0xe0,
  expStrSize: 0xe4,
  expTree: 0xe8,
  expTreeNum: 0xec,
  impModule: 0xf0,
  impModuleNum: 0xf4,
  extReloc: 0xf8,
  extRelocNum: 0xfc,
  namedImp: 0x100,
  namedImpNum: 0x104,
  indexedImp: 0x108,
  indexedImpNum: 0x10c,
  anonImp: 0x110,
  anonImpNum: 0x114,
  impStr: 0x118,
  impStrSize: 0x11c,
  staticAnon: 0x120,
  staticAnonNum: 0x124,
  intReloc: 0x128,
  intRelocNum: 0x12c,
  staticReloc: 0x130,
  staticRelocNum: 0x134,
} as const;
export const HEADER_END = 0x138;
/** Where the first code segment starts (0x138 rounded up to 0x80; every file). */
export const CODE_START = 0x180;
export const PAGE = 0x1000;
/** Fill byte from the end of the data segment to the end of the file. */
export const TAIL_FILL = 0xcc;

// ------------------------------------------------------------------------------------------------ parse
function readPatches(b: Uint8Array, at: number, tableEnd: number): CroPatch[] {
  const out: CroPatch[] = [];
  for (let p = at; p + 12 <= tableEnd; p += 12) {
    out.push({ target: tagDecode(rd(b, p))!, type: b[p + 4]!, addend: rd(b, p + 8), resolved: b[p + 6]! });
    if (b[p + 5]) break; // is_batch_end
  }
  return out;
}

export function parseCro(b: Uint8Array): Cro {
  if (b.length < HEADER_END || cstrAt(b, 0x80).slice(0, 4) !== 'CRO0') throw new Error('not a CRO0');
  const r = (o: number) => rd(b, o);
  const extEnd = r(H.extReloc) + r(H.extRelocNum) * 12;
  const batch = (at: number) => readPatches(b, at, extEnd);
  const segments: CroSegment[] = [];
  for (let k = 0; k < r(H.segNum); k++) {
    const e = r(H.segTable) + k * 12;
    const off = rd(b, e),
      size = rd(b, e + 4),
      type = rd(b, e + 8);
    segments.push({ type, size, bytes: size && type !== 3 ? b.slice(off, off + size) : null });
  }
  const pairs = <T>(tab: number, n: number, f: (e: number) => T): T[] =>
    Array.from({ length: n }, (_, k) => f(tab + k * 8));
  const modules: CroImportModule[] = [];
  for (let k = 0; k < r(H.impModuleNum); k++) {
    const e = r(H.impModule) + k * 20;
    modules.push({
      name: cstrAt(b, rd(b, e)),
      indexed: pairs(rd(b, e + 4), rd(b, e + 8), (x) => ({ index: rd(b, x), patches: batch(rd(b, x + 4)) })),
      anonymous: pairs(rd(b, e + 12), rd(b, e + 16), (x) => ({
        symbol: tagDecode(rd(b, x))!,
        patches: batch(rd(b, x + 4)),
      })),
    });
  }
  const relocs = (tab: number, n: number): CroReloc[] =>
    Array.from({ length: n }, (_, k) => {
      const e = tab + k * 12;
      return { target: tagDecode(rd(b, e))!, type: b[e + 4]!, symbolSeg: b[e + 5]!, addend: rd(b, e + 8) };
    });
  return {
    name: cstrAt(b, r(H.modName)),
    next: r(H.next),
    prev: r(H.prev),
    bssSize: r(H.bssSize),
    fixedSize: r(H.fixedSize),
    unk9C: r(H.unk9C),
    controlObject: tagDecode(r(H.controlObject)),
    onLoad: tagDecode(r(H.onLoad)),
    onExit: tagDecode(r(H.onExit)),
    onUnresolved: tagDecode(r(H.onUnresolved)),
    segments,
    namedExports: pairs(r(H.namedExp), r(H.namedExpNum), (e) => ({
      name: cstrAt(b, rd(b, e)),
      symbol: tagDecode(rd(b, e + 4))!,
    })),
    indexedExports: Array.from({ length: r(H.indexedExpNum) }, (_, k) => tagDecode(rd(b, r(H.indexedExp) + k * 4))!),
    importModules: modules,
    namedImports: pairs(r(H.namedImp), r(H.namedImpNum), (e) => ({
      name: cstrAt(b, rd(b, e)),
      patches: batch(rd(b, e + 4)),
    })),
    indexedImports: pairs(r(H.indexedImp), r(H.indexedImpNum), (e) => ({
      index: rd(b, e),
      patches: batch(rd(b, e + 4)),
    })),
    anonymousImports: pairs(r(H.anonImp), r(H.anonImpNum), (e) => ({
      symbol: tagDecode(rd(b, e))!,
      patches: batch(rd(b, e + 4)),
    })),
    staticAnonymous: pairs(r(H.staticAnon), r(H.staticAnonNum), (e) => ({
      symbol: tagDecode(rd(b, e))!,
      patches: batch(rd(b, e + 4)),
    })),
    internalRelocs: relocs(r(H.intReloc), r(H.intRelocNum)),
    staticRelocs: relocs(r(H.staticReloc), r(H.staticRelocNum)),
  };
}

// ------------------------------------------------------------------------------------------------ export tree
/**
 * The named-export lookup tree (Patricia trie over the bits of the names, nn::ro / Citra `ExportTreeEntry`):
 * 8 B per node = test_bit u16 (byte index << 3 | bit, LSB first), left u16, right u16 (bit 15 = leaf, low 15 bits =
 * node index), export_table_index u16. Lookup starts at node 0's left. A leaf link to node k means export
 * `node[k].export_table_index`. Node 0 is the header (test_bit 0xFFFF).
 */
export interface TreeNode {
  testBit: number;
  left: number;
  right: number;
  exportIndex: number;
}
export function parseExportTree(b: Uint8Array): TreeNode[] {
  return Array.from({ length: rd(b, H.expTreeNum) }, (_, k) => {
    const e = rd(b, H.expTree) + k * 8;
    return { testBit: rd16(b, e), left: rd16(b, e + 2), right: rd16(b, e + 4), exportIndex: rd16(b, e + 6) };
  });
}
const bitOf = (name: string, bit: number): number => {
  const byte = bit >> 3;
  return byte >= name.length ? 0 : (name.charCodeAt(byte) >> (bit & 7)) & 1;
};
/** Look a name up the way nn::ro does; returns the export index or -1. */
export function treeLookup(nodes: TreeNode[], names: string[], name: string): number {
  if (nodes.length === 0) return -1;
  let next = nodes[0]!.left;
  for (let guard = 0; guard < 0x10000; guard++) {
    const n = nodes[next & 0x7fff]!;
    if (next & 0x8000) {
      const i = n.exportIndex;
      return names[i] === name ? i : -1;
    }
    next = bitOf(name, n.testBit) ? n.right : n.left;
  }
  return -1;
}
/**
 * Builds the tree the way the files have it (checked: lanai.crs 1101 exports node-for-node, and the 1-export trees of
 * all 127 CROs): a balanced bit-decision tree. For a set of names, the tested bit is the one that splits the set most
 * evenly (max of min(#0, #1); tie -> lowest bit; bits past the end of a name read 0); bit 0 goes left. Internal nodes
 * are numbered 1.. in pre-order; leaves are numbered 0.. left to right and leaf k is stored as node[k].exportIndex.
 * Node 0 is the header (test 0xFFFF, left = 1, right = 0). One export: one node testing bit 0, links leaf 0 / leaf 1,
 * both meaning export 0.
 */
export function buildExportTree(names: string[]): TreeNode[] {
  if (names.length === 0) return [];
  if (names.length === 1)
    return [
      { testBit: 0xffff, left: 1, right: 0, exportIndex: 0 },
      { testBit: 0, left: 0x8000, right: 0x8001, exportIndex: 0 },
    ];
  const maxBits = Math.max(...names.map((n) => n.length)) * 8;
  const nodes: TreeNode[] = [{ testBit: 0xffff, left: 1, right: 0, exportIndex: 0 }];
  const leaves: number[] = [];
  const rec = (set: number[]): number => {
    if (set.length === 1) {
      leaves.push(set[0]!);
      return 0x8000 | (leaves.length - 1);
    }
    let best = -1,
      bestScore = -1;
    for (let bit = 0; bit < maxBits; bit++) {
      let ones = 0;
      for (const i of set) ones += bitOf(names[i]!, bit);
      const score = Math.min(ones, set.length - ones);
      if (score > bestScore) {
        bestScore = score;
        best = bit;
      }
    }
    if (bestScore <= 0) throw new Error(`export names not distinct: ${set.map((i) => names[i]).join(', ')}`);
    const me = nodes.length;
    nodes.push({ testBit: best, left: 0, right: 0, exportIndex: 0 });
    const zero = set.filter((i) => !bitOf(names[i]!, best)),
      one = set.filter((i) => bitOf(names[i]!, best));
    // pre-order numbering: reserve `me`, then fill the children
    const l = rec(zero),
      r = rec(one);
    nodes[me]!.left = l;
    nodes[me]!.right = r;
    return me;
  };
  rec(names.map((_, i) => i));
  leaves.forEach((e, k) => (nodes[k]!.exportIndex = e)); // N leaves, N nodes (header + N-1 internal)
  return nodes;
}

// ------------------------------------------------------------------------------------------------ build
export interface BuildOptions {
  /** Export tree nodes to write instead of buildExportTree(names) (for byte-exact round trips of odd trees). */
  exportTree?: TreeNode[];
}

/** The four SHA-256 at 0x00: header 0x80..code, code, tables (code end..data), data. */
export function croHashes(b: Uint8Array): Uint8Array[] {
  const codeOff = rd(b, H.codeOff),
    codeEnd = codeOff + rd(b, H.codeSize),
    dataOff = rd(b, H.dataOff),
    dataEnd = dataOff + rd(b, H.dataSize);
  return [
    sha256(b.subarray(0x80, codeOff)),
    sha256(b.subarray(codeOff, codeEnd)),
    sha256(b.subarray(codeEnd, dataOff)),
    sha256(b.subarray(dataOff, dataEnd)),
  ];
}

export function buildCro(m: Cro, opt: BuildOptions = {}): Uint8Array {
  // -------- layout of the code area: code segments (text/rodata with bytes) in slot order, first at 0x180, the
  // following ones page-aligned; the code area ends page-aligned.
  const segOff = new Array<number>(m.segments.length).fill(0);
  let at = CODE_START;
  let firstCode = true;
  for (let k = 0; k < m.segments.length; k++) {
    const s = m.segments[k]!;
    if (!s.size || (s.type !== 0 && s.type !== 1)) continue;
    if (!firstCode) at = align(at, PAGE);
    segOff[k] = at;
    at += s.size;
    firstCode = false;
  }
  const codeEnd = align(at, PAGE);

  // -------- strings
  const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(0));
  const expStrs: Uint8Array[] = [];
  const expStrOff: number[] = [];
  let expStrSize = 0;
  for (const e of m.namedExports) {
    expStrOff.push(expStrSize);
    const s = enc(e.name);
    expStrs.push(s);
    expStrSize += s.length;
  }
  const impStrs: Uint8Array[] = [];
  const impStrIndex = new Map<string, number>();
  let impStrSize = 0;
  const impString = (name: string): number => {
    const known = impStrIndex.get(name);
    if (known !== undefined) return known;
    const s = enc(name);
    impStrIndex.set(name, impStrSize);
    impStrs.push(s);
    impStrSize += s.length;
    return impStrSize - s.length;
  };
  for (const im of m.namedImports) impString(im.name);
  for (const mod of m.importModules) impString(mod.name);

  // -------- tables (order seen in every file)
  const nameBytes = enc(m.name);
  let t = codeEnd;
  const place = (size: number, a = 4): number => {
    t = align(t, a);
    const o = t;
    t += size;
    return o;
  };
  const tree = opt.exportTree ?? buildExportTree(m.namedExports.map((e) => e.name));
  const batches: CroPatch[][] = [
    ...m.namedImports.map((x) => x.patches),
    ...m.indexedImports.map((x) => x.patches),
    ...m.anonymousImports.map((x) => x.patches),
    ...m.importModules.flatMap((mod) => [...mod.indexed.map((x) => x.patches), ...mod.anonymous.map((x) => x.patches)]),
    ...m.staticAnonymous.map((x) => x.patches),
  ];
  const patchCount = batches.reduce((n, p) => n + p.length, 0);
  const moduleIdx = m.importModules.reduce((n, mod) => n + mod.indexed.length, 0);
  const moduleAnon = m.importModules.reduce((n, mod) => n + mod.anonymous.length, 0);
  const o = {
    name: place(nameBytes.length),
    segT: place(m.segments.length * 12),
    namedExp: place(m.namedExports.length * 8),
    tree: place(tree.length * 8),
    indexedExp: place(m.indexedExports.length * 4),
    expStr: place(expStrSize),
    impModule: place(m.importModules.length * 20),
    extReloc: place(patchCount * 12),
    namedImp: place(m.namedImports.length * 8),
    indexedImp: place(m.indexedImports.length * 8),
    anonImp: place(m.anonymousImports.length * 8),
    moduleIdx: place(moduleIdx * 8), // 推定: where module-local indexed/anon import tables go (no file has them)
    moduleAnon: place(moduleAnon * 8),
    impStr: place(impStrSize),
    staticAnon: place(m.staticAnonymous.length * 8),
    intReloc: place(m.internalRelocs.length * 12),
    staticReloc: 0,
  };
  // Every file has no static relocations and points the empty table at the START of the internal ones. nn::ro (and
  // Citra's RebaseHeader) wants intReloc <= staticReloc <= dataOff, so a non-empty table goes after them (推定).
  o.staticReloc = m.staticRelocs.length ? place(m.staticRelocs.length * 12) : o.intReloc;
  // data segment(s) after the tables
  for (let k = 0; k < m.segments.length; k++) {
    const s = m.segments[k]!;
    if (s.type === 2 && s.size) segOff[k] = place(s.size);
  }
  const dataSeg = m.segments.findIndex((s) => s.type === 2 && s.size);
  const dataOff = dataSeg >= 0 ? segOff[dataSeg]! : align(t, 4);
  const dataSize = dataSeg >= 0 ? m.segments[dataSeg]!.size : 0;
  const fileSize = align(t, PAGE);

  // -------- write
  const b = new Uint8Array(fileSize);
  b.fill(TAIL_FILL, dataOff + dataSize);
  b.set([0x43, 0x52, 0x4f, 0x30], H.magic);
  const hw = (k: number, v: number) => wr(b, k, v);
  hw(H.nameOff, o.name);
  hw(H.next, m.next);
  hw(H.prev, m.prev);
  hw(H.fileSize, fileSize);
  hw(H.bssSize, m.bssSize);
  hw(H.fixedSize, m.fixedSize);
  hw(H.unk9C, m.unk9C);
  hw(H.controlObject, tagEncode(m.controlObject));
  hw(H.onLoad, tagEncode(m.onLoad));
  hw(H.onExit, tagEncode(m.onExit));
  hw(H.onUnresolved, tagEncode(m.onUnresolved));
  hw(H.codeOff, CODE_START);
  hw(H.codeSize, codeEnd - CODE_START);
  hw(H.dataOff, dataOff);
  hw(H.dataSize, dataSize);
  hw(H.modName, o.name);
  hw(H.modNameSize, nameBytes.length);
  hw(H.segTable, o.segT);
  hw(H.segNum, m.segments.length);
  hw(H.namedExp, o.namedExp);
  hw(H.namedExpNum, m.namedExports.length);
  hw(H.indexedExp, o.indexedExp);
  hw(H.indexedExpNum, m.indexedExports.length);
  hw(H.expStr, o.expStr);
  hw(H.expStrSize, expStrSize);
  hw(H.expTree, o.tree);
  hw(H.expTreeNum, tree.length);
  hw(H.impModule, o.impModule);
  hw(H.impModuleNum, m.importModules.length);
  hw(H.extReloc, o.extReloc);
  hw(H.extRelocNum, patchCount);
  hw(H.namedImp, o.namedImp);
  hw(H.namedImpNum, m.namedImports.length);
  hw(H.indexedImp, o.indexedImp);
  hw(H.indexedImpNum, m.indexedImports.length);
  hw(H.anonImp, o.anonImp);
  hw(H.anonImpNum, m.anonymousImports.length);
  hw(H.impStr, o.impStr);
  hw(H.impStrSize, impStrSize);
  hw(H.staticAnon, o.staticAnon);
  hw(H.staticAnonNum, m.staticAnonymous.length);
  hw(H.intReloc, o.intReloc);
  hw(H.intRelocNum, m.internalRelocs.length);
  hw(H.staticReloc, o.staticReloc);
  hw(H.staticRelocNum, m.staticRelocs.length);

  for (let k = 0; k < m.segments.length; k++) {
    const s = m.segments[k]!;
    if (s.bytes) b.set(s.bytes.subarray(0, s.size), segOff[k]!);
    wr(b, o.segT + k * 12, s.type === 3 ? 0 : segOff[k]!);
    wr(b, o.segT + k * 12 + 4, s.size);
    wr(b, o.segT + k * 12 + 8, s.type);
  }
  b.set(nameBytes, o.name);
  m.namedExports.forEach((e, k) => {
    wr(b, o.namedExp + k * 8, o.expStr + expStrOff[k]!);
    wr(b, o.namedExp + k * 8 + 4, tagEncode(e.symbol));
  });
  tree.forEach((n, k) => {
    const e = o.tree + k * 8;
    wr16(b, e, n.testBit);
    wr16(b, e + 2, n.left);
    wr16(b, e + 4, n.right);
    wr16(b, e + 6, n.exportIndex);
  });
  m.indexedExports.forEach((x, k) => wr(b, o.indexedExp + k * 4, tagEncode(x)));
  let sp = o.expStr;
  for (const s of expStrs) {
    b.set(s, sp);
    sp += s.length;
  }
  sp = o.impStr;
  for (const s of impStrs) {
    b.set(s, sp);
    sp += s.length;
  }

  // external relocation batches, in the order of `batches`
  let pp = o.extReloc;
  const batchAt: number[] = [];
  for (const p of batches) {
    batchAt.push(pp);
    p.forEach((x, k) => {
      wr(b, pp, tagEncode(x.target));
      b[pp + 4] = x.type;
      b[pp + 5] = k === p.length - 1 ? 1 : 0;
      b[pp + 6] = x.resolved;
      wr(b, pp + 8, x.addend);
      pp += 12;
    });
  }
  let bi = 0;
  m.namedImports.forEach((x, k) => {
    wr(b, o.namedImp + k * 8, o.impStr + impStrIndex.get(x.name)!);
    wr(b, o.namedImp + k * 8 + 4, batchAt[bi++]!);
  });
  m.indexedImports.forEach((x, k) => {
    wr(b, o.indexedImp + k * 8, x.index);
    wr(b, o.indexedImp + k * 8 + 4, batchAt[bi++]!);
  });
  m.anonymousImports.forEach((x, k) => {
    wr(b, o.anonImp + k * 8, tagEncode(x.symbol));
    wr(b, o.anonImp + k * 8 + 4, batchAt[bi++]!);
  });
  let mi = 0,
    ma = 0;
  m.importModules.forEach((mod, k) => {
    const e = o.impModule + k * 20;
    wr(b, e, o.impStr + impStrIndex.get(mod.name)!);
    wr(b, e + 4, o.moduleIdx + mi * 8);
    wr(b, e + 8, mod.indexed.length);
    wr(b, e + 12, o.moduleAnon + ma * 8);
    wr(b, e + 16, mod.anonymous.length);
    for (const x of mod.indexed) {
      wr(b, o.moduleIdx + mi * 8, x.index);
      wr(b, o.moduleIdx + mi++ * 8 + 4, batchAt[bi++]!);
    }
    for (const x of mod.anonymous) {
      wr(b, o.moduleAnon + ma * 8, tagEncode(x.symbol));
      wr(b, o.moduleAnon + ma++ * 8 + 4, batchAt[bi++]!);
    }
  });
  m.staticAnonymous.forEach((x, k) => {
    wr(b, o.staticAnon + k * 8, tagEncode(x.symbol));
    wr(b, o.staticAnon + k * 8 + 4, batchAt[bi++]!);
  });
  const writeRelocs = (tab: number, list: CroReloc[]) =>
    list.forEach((x, k) => {
      const e = tab + k * 12;
      wr(b, e, tagEncode(x.target));
      b[e + 4] = x.type;
      b[e + 5] = x.symbolSeg;
      wr(b, e + 8, x.addend);
    });
  writeRelocs(o.intReloc, m.internalRelocs);
  writeRelocs(o.staticReloc, m.staticRelocs);

  croHashes(b).forEach((h, k) => b.set(h, k * 32));
  return b;
}

/** First differing offset, or -1. */
export function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// ------------------------------------------------------------------------------------------------ CRR
/**
 * CRR0 (nn::ro registration list). Layout from 3dbrew "CRR" (checked against the 127 files by `crr`):
 * 0x00 "CRR0", 0x04 reserved, 0x08 next/prev (0), 0x10 debug info offset?, 0x14..0x20 reserved,
 * 0x20 unique id mask / id, 0x40 0x100 B signature (certificate: 0x100 B public key modulus + 0x100 B its signature by
 * Nintendo, then the body signature), 0x340 unique id, 0x344 size, 0x350 hash list offset, 0x354 hash count,
 * 0x358 plain region offset, 0x35C plain region size. The hashes are SHA-256 of each CRO's first 0x80 bytes (the
 * hash table), sorted ascending.
 */
export interface CrrInfo {
  uniqueId: number;
  size: number;
  hashOff: number;
  hashes: Uint8Array[];
  plainOff: number;
  plainSize: number;
}
export function parseCrr(b: Uint8Array): CrrInfo {
  if (cstrAt(b, 0).slice(0, 4) !== 'CRR0') throw new Error('not a CRR0');
  const hashOff = rd(b, 0x350),
    n = rd(b, 0x354);
  return {
    uniqueId: rd(b, 0x340),
    size: rd(b, 0x344),
    hashOff,
    hashes: Array.from({ length: n }, (_, k) => b.slice(hashOff + k * 32, hashOff + k * 32 + 32)),
    plainOff: rd(b, 0x358),
    plainSize: rd(b, 0x35c),
  };
}
/** The CRR hash that registers a CRO. */
export const croRegistrationHash = (cro: Uint8Array): Uint8Array => sha256(cro.subarray(0, 0x80));
