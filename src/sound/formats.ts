// CTR sound files (NW4C): the sound archive sound.bcsar (CSAR) and what it holds — sequences (CSEQ), banks (CBNK),
// wave sound data (CWSD), wave archives (CWAR) and waves (CWAV) — and the streams sound/stream/*.bcstm (CSTM).
// Every file: a header with a block table, blocks of "references" {u16 type, u16 pad, s32 offset} whose offsets
// count from the start of the structure holding them. docs/encounters.md §4.
import { ascii, f32, s16, s32, u16, u32 } from '../util/bytes';

/** Blocks of a file: block type -> offset of the block (its body starts 8 bytes later). */
function blocks(d: Uint8Array, magic: string): Map<number, number> {
  if (ascii(d, 0, 4) !== magic) throw new Error(`${magic} ではありません`);
  const out = new Map<number, number>();
  for (let i = 0, n = u16(d, 0x10); i < n; i++) out.set(u16(d, 0x14 + i * 12), u32(d, 0x18 + i * 12));
  return out;
}

function body(d: Uint8Array, b: Map<number, number>, type: number): number {
  const o = b.get(type);
  if (o === undefined) throw new Error(`ブロック ${type.toString(16)} がありません`);
  return o + 8;
}

/** Target of the reference at `at` (relative to `base`), or -1 when it is null. */
function ref(d: Uint8Array, at: number, base: number): number {
  const o = s32(d, at + 4);
  return u16(d, at) === 0 && o === -1 ? -1 : base + o;
}

/** Targets of a reference table {u32 count, references} (relative to the table). */
function refTable(d: Uint8Array, t: number): number[] {
  return Array.from({ length: u32(d, t) }, (_, i) => (s32(d, t + 8 + i * 8) === -1 ? -1 : t + s32(d, t + 8 + i * 8)));
}

// ---- samples

export const enum Encoding {
  Pcm8 = 0,
  Pcm16 = 1,
  DspAdpcm = 2,
}

/** Decoded audio: one Float32Array per channel (-1..1). `loopStart` / `loopEnd` in samples when it loops. */
export interface Pcm {
  rate: number;
  channels: Float32Array[];
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}

/** DSP-ADPCM coefficients and the decoder history (kept between the blocks of a stream). */
interface Dsp {
  coefs: Int16Array;
  h1: number;
  h2: number;
}

function dspInfo(d: Uint8Array, o: number): Dsp {
  return { coefs: Int16Array.from({ length: 16 }, (_, i) => s16(d, o + i * 2)), h1: s16(d, o + 0x22), h2: s16(d, o + 0x24) };
}

/** `count` samples of DSP-ADPCM at `o` (8-byte frames of 14 samples) into `out` from `at`. */
export function decodeDsp(d: Uint8Array, o: number, count: number, dsp: Dsp, out: Float32Array, at: number): void {
  let { h1, h2 } = dsp;
  const c = dsp.coefs;
  for (let i = 0; i < count; i += 14) {
    const ps = d[o++] ?? 0;
    const scale = 1 << (ps & 0xf);
    const c1 = c[(ps >> 4) * 2]!;
    const c2 = c[(ps >> 4) * 2 + 1]!;
    for (let j = 0; j < 14 && i + j < count; j++) {
      const b = d[o + (j >> 1)] ?? 0;
      let n = j & 1 ? b & 0xf : b >> 4;
      if (n >= 8) n -= 16;
      let s = ((n * scale) << 11) + 1024 + c1 * h1 + c2 * h2;
      s >>= 11;
      if (s > 32767) s = 32767;
      else if (s < -32768) s = -32768;
      out[at + i + j] = s / 32768;
      h2 = h1;
      h1 = s;
    }
    o += 7;
  }
  dsp.h1 = h1;
  dsp.h2 = h2;
}

function decodeSamples(enc: number, d: Uint8Array, o: number, count: number, dsp: Dsp | null, out: Float32Array, at: number): void {
  if (enc === Encoding.DspAdpcm) {
    if (!dsp) throw new Error('DSP-ADPCM の係数がありません');
    decodeDsp(d, o, count, dsp, out, at);
  } else if (enc === Encoding.Pcm16) for (let i = 0; i < count; i++) out[at + i] = s16(d, o + i * 2) / 32768;
  else if (enc === Encoding.Pcm8) for (let i = 0; i < count; i++) out[at + i] = ((d[o + i]! << 24) >> 24) / 128;
  else throw new Error(`対応していない音の形式 (${enc}) です`);
}

// ---- CWAV / CWAR

/** A wave (CWAV). */
export function parseCwav(d: Uint8Array): Pcm {
  const b = blocks(d, 'CWAV');
  const info = body(d, b, 0x7000);
  const data = body(d, b, 0x7001);
  const enc = d[info]!;
  const loop = d[info + 1] === 1;
  const rate = u32(d, info + 4);
  const loopStart = u32(d, info + 8);
  const length = u32(d, info + 12);
  const channels = refTable(d, info + 0x14).map((ch) => {
    const out = new Float32Array(length);
    const adpcm = ref(d, ch + 8, ch);
    decodeSamples(enc, d, ref(d, ch, data), length, adpcm >= 0 && u16(d, ch + 8) === 0x0300 ? dspInfo(d, adpcm) : null, out, 0);
    return out;
  });
  return { rate, channels, loop, loopStart, loopEnd: length };
}

/** The waves of a wave archive (CWAR), decoded when first asked for. */
export class WaveArchive {
  private readonly info: number;
  private readonly data: number;
  private readonly cache = new Map<number, Pcm>();
  constructor(private readonly d: Uint8Array) {
    const b = blocks(d, 'CWAR');
    this.info = body(d, b, 0x6800);
    this.data = body(d, b, 0x6801);
  }
  get count(): number {
    return u32(this.d, this.info);
  }
  wave(i: number): Pcm | null {
    if (i < 0 || i >= this.count) return null;
    let w = this.cache.get(i);
    if (!w) {
      const e = this.info + 4 + i * 12;
      const o = this.data + s32(this.d, e + 4);
      w = parseCwav(this.d.subarray(o, o + u32(this.d, e + 8)));
      this.cache.set(i, w);
    }
    return w;
  }
}

// ---- CSTM

/** A stream (BGM / ME): interleaved blocks of every channel. */
export function parseCstm(d: Uint8Array): Pcm {
  const b = blocks(d, 'CSTM');
  const info = body(d, b, 0x4000);
  const data = body(d, b, 0x4002);
  const si = ref(d, info, info);
  const enc = d[si]!;
  const loop = d[si + 1] === 1;
  const nch = d[si + 2]!;
  const rate = u32(d, si + 4);
  const loopStart = u32(d, si + 8);
  const length = u32(d, si + 12);
  const blockCount = u32(d, si + 16);
  const blockSize = u32(d, si + 20);
  const blockSamples = u32(d, si + 24);
  const lastSamples = u32(d, si + 32);
  const lastPadded = u32(d, si + 36);
  const start = ref(d, si + 48, data);
  const chInfo = refTable(d, ref(d, info + 16, info));
  const channels: Float32Array[] = [];
  for (let c = 0; c < nch; c++) {
    const ci = chInfo[c]!;
    const adpcm = ci >= 0 ? ref(d, ci, ci) : -1;
    const dsp = enc === Encoding.DspAdpcm && adpcm >= 0 ? dspInfo(d, adpcm) : null;
    const out = new Float32Array(length);
    for (let k = 0; k < blockCount; k++) {
      const last = k === blockCount - 1;
      const o = start + k * blockSize * nch + c * (last ? lastPadded : blockSize);
      const n = Math.min(last ? lastSamples : blockSamples, length - k * blockSamples);
      if (n > 0) decodeSamples(enc, d, o, n, dsp, out, k * blockSamples);
    }
    channels.push(out);
  }
  return { rate, channels, loop, loopStart, loopEnd: length };
}

// ---- CBNK

/** Envelope of a region: attack, decay, sustain, hold, release (0-127; 127 = instant / full). */
export interface Adshr {
  a: number;
  d: number;
  s: number;
  h: number;
  r: number;
}

/** What a note of an instrument plays. */
export interface Region {
  /** Index in the bank's wave ID table. */
  wave: number;
  /** Key the wave plays at its own pitch. */
  root: number;
  volume: number;
  pan: number;
  pitch: number;
  env: Adshr;
}

/** Regions of the three kinds (0x6000 one for all, 0x6001 by upper bounds, 0x6002 by index): [lo, hi, target]. */
function regions(d: Uint8Array, at: number, base: number): [number, number, number][] {
  const t = u16(d, at);
  const p = ref(d, at, base);
  if (p < 0) return [];
  if (t === 0x6000) return [[0, 127, ref(d, p, p)]];
  if (t === 0x6001) {
    const n = u32(d, p);
    const refs = p + 4 + ((n + 3) & ~3);
    const out: [number, number, number][] = [];
    for (let i = 0, lo = 0; i < n; i++) {
      const hi = d[p + 4 + i]!;
      out.push([lo, hi, ref(d, refs + i * 8, p)]);
      lo = hi + 1;
    }
    return out;
  }
  if (t === 0x6002) {
    const min = d[p]!;
    const max = d[p + 1]!;
    return Array.from({ length: max - min + 1 }, (_, i) => [min + i, min + i, ref(d, p + 4 + i * 8, p)] as [number, number, number]);
  }
  return [];
}

export const DEFAULT_ENV: Adshr = { a: 127, d: 127, s: 127, h: 0, r: 127 };

function velocityRegion(d: Uint8Array, p: number): Region {
  const flags = u32(d, p + 4);
  const r: Region = { wave: u32(d, p), root: 60, volume: 127, pan: 64, pitch: 1, env: { ...DEFAULT_ENV } };
  let o = p + 8;
  for (let bit = 0; bit < 32; bit++) {
    if (!(flags & (1 << bit))) continue;
    if (bit === 0) r.root = u32(d, o);
    else if (bit === 1) r.volume = u32(d, o);
    else if (bit === 2) r.pan = d[o]!;
    else if (bit === 3) r.pitch = f32(d, o);
    else if (bit === 9) {
      const e = ref(d, p + u32(d, o), p + u32(d, o));
      if (e >= 0) r.env = { a: d[e]!, d: d[e + 1]!, s: d[e + 2]!, h: d[e + 3]!, r: d[e + 4]! };
    }
    o += 4;
  }
  return r;
}

/** A bank: instruments (programs) -> key -> velocity -> region; waves by the wave ID table. */
export class Bank {
  /** Wave ID table: [wave archive item ID, wave index]. */
  readonly waves: [number, number][];
  private readonly instruments: number[];
  constructor(private readonly d: Uint8Array) {
    const info = body(d, blocks(d, 'CBNK'), 0x5800);
    const wt = ref(d, info, info);
    this.waves = Array.from({ length: u32(d, wt) }, (_, i) => [u32(d, wt + 4 + i * 8), u32(d, wt + 8 + i * 8)]);
    this.instruments = refTable(d, ref(d, info + 8, info));
  }

  region(program: number, key: number, velocity: number): Region | null {
    const ins = this.instruments[program];
    if (ins === undefined || ins < 0) return null;
    const k = regions(this.d, ins, ins).find(([lo, hi]) => key >= lo && key <= hi);
    if (!k || k[2] < 0) return null;
    const v = regions(this.d, k[2], k[2]).find(([lo, hi]) => velocity >= lo && velocity <= hi);
    return v && v[2] >= 0 ? velocityRegion(this.d, v[2]) : null;
  }
}

// ---- CWSD

/** Wave sound data: each wave sound plays one wave (the first note of its only track, in this game). */
export class WaveSoundData {
  readonly waves: [number, number][];
  private readonly sounds: number[];
  constructor(private readonly d: Uint8Array) {
    const info = body(d, blocks(d, 'CWSD'), 0x6800);
    const wt = ref(d, info, info);
    this.waves = Array.from({ length: u32(d, wt) }, (_, i) => [u32(d, wt + 4 + i * 8), u32(d, wt + 8 + i * 8)]);
    this.sounds = refTable(d, ref(d, info + 8, info));
  }

  /** [wave archive item ID, wave index, pitch] of wave sound `i`. */
  wave(i: number): { wave: [number, number]; pitch: number } | null {
    const s = this.sounds[i];
    if (s === undefined || s < 0) return null;
    const d = this.d;
    const notes = refTable(d, ref(d, s + 0x10, s));
    const n = notes[0];
    if (n === undefined || n < 0) return null;
    const w = this.waves[u32(d, n)];
    if (!w) return null;
    let pitch = 1;
    const si = ref(d, s, s);
    if (si >= 0) {
      const flags = u32(d, si);
      if (flags & 2) pitch = f32(d, si + 4 + (flags & 1 ? 4 : 0));
    }
    return { wave: w, pitch };
  }
}

// ---- CSEQ

/** Sequence data (the commands; big-endian arguments). */
export function cseqData(d: Uint8Array): Uint8Array {
  const b = blocks(d, 'CSEQ');
  const o = body(d, b, 0x5000);
  return d.subarray(o, b.get(0x5000)! + u32(d, b.get(0x5000)! + 4));
}

// ---- CSAR

export type SoundType = 'stream' | 'wave' | 'sequence';

export interface SoundInfo {
  name: string;
  type: SoundType | null;
  fileId: number;
  /** 0-255 (127 = as recorded). */
  volume: number;
  /** Wave sound: index in its CWSD. */
  waveIndex: number;
  /** Sequence: start offset in the sequence data, and its banks (item IDs). */
  start: number;
  banks: number[];
}

const SOUND_TYPE: Record<number, SoundType> = { 0x2201: 'stream', 0x2202: 'wave', 0x2203: 'sequence' };

/** The sound archive: sounds, and the files they use (internal bytes, or the path of an external file). */
export class SoundArchive {
  readonly sounds: SoundInfo[];
  /** Bank item index -> file ID. */
  readonly banks: number[];
  /** Wave archive item index -> file ID. */
  readonly waveArchives: number[];
  private readonly files: number[];
  private readonly fileBody: number;

  constructor(private readonly d: Uint8Array) {
    const b = blocks(d, 'CSAR');
    const strg = body(d, b, 0x2000);
    const info = body(d, b, 0x2001);
    this.fileBody = body(d, b, 0x2002);
    const tab = strg + u32(d, strg + 4);
    const strings = Array.from({ length: u32(d, tab) }, (_, i) => {
      const o = tab + u32(d, tab + 4 + i * 12 + 4);
      return ascii(d, o, u32(d, tab + 4 + i * 12 + 8) - 1);
    });
    const tables = new Map<number, number>();
    for (let i = 0; i < 8; i++) tables.set(u16(d, info + i * 8), info + s32(d, info + i * 8 + 4));
    const table = (type: number): number[] => {
      const t = tables.get(type);
      return t === undefined ? [] : refTable(d, t);
    };
    this.sounds = table(0x2100).map((e) => {
      const flags = u32(d, e + 0x14);
      const detail = ref(d, e + 0x0c, e);
      const type = SOUND_TYPE[u16(d, e + 0x0c)] ?? null;
      const s: SoundInfo = { name: flags & 1 ? strings[u32(d, e + 0x18)] ?? '' : '', type, fileId: u32(d, e), volume: d[e + 8]!, waveIndex: 0, start: 0, banks: [] };
      if (type === 'wave' && detail >= 0) s.waveIndex = u32(d, detail);
      if (type === 'sequence' && detail >= 0) {
        const bt = ref(d, detail, detail);
        if (bt >= 0) s.banks = Array.from({ length: u32(d, bt) }, (_, i) => u32(d, bt + 4 + i * 4));
        if (u32(d, detail + 12) & 1) s.start = u32(d, detail + 16);
      }
      return s;
    });
    this.banks = table(0x2101).map((e) => u32(d, e));
    this.waveArchives = table(0x2103).map((e) => u32(d, e));
    this.files = table(0x2106);
  }

  /** Bytes of an internal file, the path of an external one ("stream/BGM_CAVE.bcstm"), or null. */
  file(id: number): Uint8Array | string | null {
    const fe = this.files[id];
    if (fe === undefined || fe < 0) return null;
    const d = this.d;
    const p = ref(d, fe, fe);
    if (p < 0) return null;
    if (u16(d, fe) === 0x220d) {
      let end = p;
      while (end < d.length && d[end]) end++;
      return ascii(d, p, end - p);
    }
    const o = s32(d, p + 4);
    if (o === -1) return null; // only in a group file
    const start = this.fileBody + o;
    return d.subarray(start, start + u32(d, p + 8));
  }

  internal(id: number): Uint8Array {
    const f = this.file(id);
    if (!(f instanceof Uint8Array)) throw new Error(`ファイル ${id} がサウンドアーカイブにありません`);
    return f;
  }
}
