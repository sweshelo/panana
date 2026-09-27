// Renders a sequence sound (CSEQ commands playing the instruments of a bank) to PCM, for previewing sound effects.
// An approximation of the console's sequencer: notes, programs, volume / pan / transpose / pitch bend (with the
// random, variable and time prefixes), envelopes, sweep and vibrato, tracks, calls, jumps and loops.
// Tempo in quarter notes per minute, 48 ticks a quarter note. Envelopes as the DS / 3DS sound libraries: a level in
// 1/128 dB updated every 3 ms, attack multiplying it, decay / release subtracting from it.
import { u16be } from '../util/bytes';
import type { Adshr, Bank, Pcm } from './formats';

export const SAMPLE_RATE = 32728;
const TIMEBASE = 48;
const ENV_STEP = 0.003;
const SILENT = -92544;
const ATTACK_TABLE = [0x00, 0x01, 0x05, 0x0e, 0x1a, 0x26, 0x33, 0x3f, 0x49, 0x54, 0x5c, 0x64, 0x6d, 0x74, 0x7b, 0x7f, 0x84, 0x89, 0x8f];

const attackRate = (a: number): number => (a >= 109 ? ATTACK_TABLE[127 - a]! : 255 - a);
const fallRate = (r: number): number => (r >= 127 ? 0xffff : r === 126 ? 0x3c00 : r >= 50 ? 0x1e00 / (126 - r) : r * 2 + 1);
const sustainLevel = (s: number): number => (s >= 127 ? 0 : s <= 0 ? SILENT : Math.max(SILENT, 128 * 40 * Math.log10(s / 127)));
/** 0-127 as the console's volume curve (squared). */
const vol = (v: number): number => (Math.max(0, Math.min(127, v)) / 127) ** 2;

/** A value set with the time prefix moves to its target over some ticks. */
class Ramp {
  from = 0;
  ticks = 0;
  left = 0;
  constructor(public to: number) {}
  set(v: number, ticks = 0): void {
    this.from = this.value;
    this.to = v;
    this.ticks = this.left = Math.max(0, ticks);
  }
  get value(): number {
    return this.ticks ? this.to + ((this.from - this.to) * this.left) / this.ticks : this.to;
  }
  tick(): void {
    if (this.left > 0) this.left--;
  }
}

interface Track {
  pc: number;
  alive: boolean;
  wait: number;
  program: number;
  volume: Ramp;
  volume2: Ramp;
  pan: Ramp;
  bend: Ramp;
  transpose: number;
  bendRange: number;
  noteWait: boolean;
  env: Partial<Adshr>;
  modDepth: number;
  modSpeed: number;
  modType: number;
  modRange: number;
  modDelay: number;
  sweep: number;
  calls: number[];
  loops: { pc: number; count: number }[];
  cond: boolean;
}

interface Voice {
  track: Track;
  wave: Pcm;
  pos: number;
  key: number;
  root: number;
  gain: number;
  pan: number;
  pitch: number;
  env: Adshr;
  level: number;
  phase: 'attack' | 'decay' | 'sustain' | 'release' | 'done';
  hold: number;
  /** Ticks until the note is released (-1: plays to the end of the wave). */
  left: number;
  age: number;
  sweep: number;
  sweepTicks: number;
}

export interface SequenceSource {
  data: Uint8Array;
  start: number;
  bank: Bank;
  /** Wave of the bank's wave ID table entry. */
  wave: (war: number, index: number) => Pcm | null;
}

function newTrack(pc: number): Track {
  return {
    pc, alive: true, wait: 0, program: 0, volume: new Ramp(127), volume2: new Ramp(127), pan: new Ramp(64), bend: new Ramp(0),
    transpose: 0, bendRange: 2, noteWait: true, env: {}, modDepth: 0, modSpeed: 16, modType: 0, modRange: 1, modDelay: 0,
    sweep: 0, calls: [], loops: [], cond: false,
  };
}

/** Render `src` for at most `maxSeconds` (then fade out); `volume` is the sound's (127 = as recorded). */
export function renderSequence(src: SequenceSource, volume = 127, maxSeconds = 8): Pcm {
  const d = src.data;
  const tracks: (Track | undefined)[] = [newTrack(src.start)];
  const voices: Voice[] = [];
  const vars = new Int16Array(48);
  let tempo = 120;
  let left: Float32Array = new Float32Array(SAMPLE_RATE * 2);
  let right: Float32Array = new Float32Array(SAMPLE_RATE * 2);
  let length = 0;
  let seconds = 0;
  let sampleCarry = 0;

  const varlen = (t: Track): number => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = d[t.pc++] ?? 0;
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };
  const s16be = (o: number): number => (u16be(d, o) << 16) >> 16;
  const u24 = (o: number): number => ((d[o] ?? 0) << 16) | ((d[o + 1] ?? 0) << 8) | (d[o + 2] ?? 0);

  function noteOn(t: Track, key: number, velocity: number, length: number): void {
    key = Math.max(0, Math.min(127, key + t.transpose));
    const r = src.bank.region(t.program, key, velocity);
    if (!r) return;
    const id = src.bank.waves[r.wave];
    const wave = id ? src.wave(id[0], id[1]) : null;
    if (!wave) return;
    const env = { ...r.env, ...t.env };
    voices.push({
      track: t, wave, pos: 0, key, root: r.root, gain: vol(velocity) * vol(r.volume), pan: r.pan - 64, pitch: r.pitch, env,
      level: env.a >= 127 ? 0 : SILENT, phase: 'attack', hold: 0, left: length > 0 ? length : -1, age: 0,
      sweep: t.sweep / 64, sweepTicks: length > 0 ? length : TIMEBASE,
    });
  }

  /** Run a track's commands until it waits or ends. */
  function step(t: Track, id: number): void {
    for (let guard = 0; t.alive && t.wait === 0 && guard < 10000; guard++) {
      let cmd = d[t.pc++];
      if (cmd === undefined) {
        t.alive = false;
        break;
      }
      let prefix = 0;
      let exec = true;
      while (cmd >= 0xa0 && cmd <= 0xa5) {
        if (cmd === 0xa2) exec = t.cond;
        else prefix = cmd;
        cmd = d[t.pc++] ?? 0xff;
      }
      /** The last argument, as the prefix says (random range / variable / plain), and the time of a time prefix. */
      const arg = (plain: () => number): [number, number] => {
        let v: number;
        if (prefix === 0xa0 || prefix === 0xa4) {
          const lo = s16be(t.pc);
          const hi = s16be(t.pc + 2);
          t.pc += 4;
          v = lo + Math.floor(Math.random() * (hi - lo + 1));
        } else if (prefix === 0xa1 || prefix === 0xa5) v = vars[d[t.pc++]! % vars.length]!;
        else v = plain();
        let time = 0;
        if (prefix >= 0xa3) {
          time = s16be(t.pc);
          t.pc += 2;
        }
        return [v, time];
      };
      if (cmd < 0x80) {
        const velocity = d[t.pc++]!;
        const [length] = arg(() => varlen(t));
        if (!exec) continue;
        noteOn(t, cmd, velocity, length);
        if (t.noteWait) t.wait = length;
        continue;
      }
      switch (cmd) {
        case 0x80: {
          const [v] = arg(() => varlen(t));
          if (exec) t.wait = v;
          break;
        }
        case 0x81: {
          const [v] = arg(() => varlen(t));
          if (exec) t.program = v;
          break;
        }
        case 0x88: {
          const n = d[t.pc]!;
          const o = u24(t.pc + 1);
          t.pc += 4;
          if (exec && n !== id && n < 16) tracks[n] = newTrack(o);
          break;
        }
        case 0x89: {
          const o = u24(t.pc);
          t.pc += 3;
          if (exec) t.pc = o;
          break;
        }
        case 0x8a: {
          const o = u24(t.pc);
          t.pc += 3;
          if (exec && t.calls.length < 8) {
            t.calls.push(t.pc);
            t.pc = o;
          }
          break;
        }
        case 0xfc: {
          const l = t.loops[t.loops.length - 1];
          if (!exec || !l) break;
          if (l.count === 0 || --l.count > 0) t.pc = l.pc;
          else t.loops.pop();
          break;
        }
        case 0xfd:
          if (exec) {
            const r = t.calls.pop();
            if (r === undefined) t.alive = false;
            else t.pc = r;
          }
          break;
        case 0xfe:
          t.pc += 2;
          break;
        case 0xff:
          if (exec) t.alive = false;
          break;
        case 0xf0: {
          const ext = d[t.pc++]!;
          const n = d[t.pc++]! % vars.length;
          const [v] = arg(() => {
            const x = s16be(t.pc);
            t.pc += 2;
            return x;
          });
          if (!exec) break;
          const x = vars[n]!;
          const ops: Record<number, () => void> = {
            0x80: () => (vars[n] = v), 0x81: () => (vars[n] = x + v), 0x82: () => (vars[n] = x - v), 0x83: () => (vars[n] = x * v),
            0x84: () => (vars[n] = v ? Math.trunc(x / v) : x), 0x85: () => (vars[n] = v >= 0 ? x << v : x >> -v),
            0x86: () => (vars[n] = Math.floor(Math.random() * (Math.abs(v) + 1)) * Math.sign(v || 1)),
            0x87: () => (vars[n] = x & v), 0x88: () => (vars[n] = x | v), 0x89: () => (vars[n] = x ^ v), 0x8a: () => (vars[n] = ~v), 0x8b: () => (vars[n] = v ? x % v : x),
            0x90: () => (t.cond = x === v), 0x91: () => (t.cond = x >= v), 0x92: () => (t.cond = x > v),
            0x93: () => (t.cond = x <= v), 0x94: () => (t.cond = x < v), 0x95: () => (t.cond = x !== v),
          };
          ops[ext]?.();
          break;
        }
        default: {
          if (cmd >= 0xb0 && cmd <= 0xdf) {
            const [raw, time] = arg(() => d[t.pc++]!);
            if (!exec) break;
            const v = raw & 0xff;
            const s8 = (v << 24) >> 24;
            switch (cmd) {
              case 0xc0: t.pan.set(v, time); break;
              case 0xc1: t.volume.set(v, time); break;
              case 0xc3: t.transpose = prefix === 0xa0 || prefix === 0xa1 ? raw : s8; break;
              case 0xc4: t.bend.set(prefix === 0xa0 || prefix === 0xa1 || prefix === 0xa4 || prefix === 0xa5 ? raw : s8, time); break;
              case 0xc5: t.bendRange = v; break;
              case 0xc7: t.noteWait = v !== 0; break;
              case 0xca: t.modDepth = v; break;
              case 0xcb: t.modSpeed = v; break;
              case 0xcc: t.modType = v; break;
              case 0xcd: t.modRange = v; break;
              case 0xd0: t.env.a = v; break;
              case 0xd1: t.env.d = v; break;
              case 0xd2: t.env.s = v; break;
              case 0xd3: t.env.r = v; break;
              case 0xb1: t.env.h = v; break;
              case 0xd4: t.loops.push({ pc: t.pc, count: v }); break;
              case 0xd5: t.volume2.set(v, time); break;
              default: break; // priority, sends, filters, ... (not heard in a preview)
            }
          } else if (cmd >= 0xe0 && cmd <= 0xe3) {
            const [v] = arg(() => {
              const x = s16be(t.pc);
              t.pc += 2;
              return x;
            });
            if (!exec) break;
            if (cmd === 0xe0) t.modDelay = v;
            else if (cmd === 0xe1) tempo = Math.max(1, v);
            else if (cmd === 0xe3) t.sweep = v;
          } else if (cmd === 0xfb) {
            t.env = {};
          } else t.alive = false; // unknown command: stop the track
        }
      }
    }
  }

  function envelope(v: Voice, steps: number): void {
    for (let i = 0; i < steps; i++) {
      switch (v.phase) {
        case 'attack':
          v.level = (v.level * attackRate(v.env.a)) / 256;
          if (v.level > -32) {
            v.level = 0;
            v.phase = 'decay';
            v.hold = v.env.h;
          }
          break;
        case 'decay':
          if (v.hold > 0) {
            v.hold--;
            break;
          }
          v.level -= fallRate(v.env.d);
          if (v.level <= sustainLevel(v.env.s)) {
            v.level = sustainLevel(v.env.s);
            v.phase = 'sustain';
          }
          break;
        case 'release':
          v.level -= fallRate(v.env.r);
          if (v.level <= -128 * 72) v.phase = 'done';
          break;
        default:
          break;
      }
    }
  }

  const master = volume / 127;
  let fading = 0;
  const maxTicks = 100000;
  for (let tick = 0; tick < maxTicks; tick++) {
    tracks.forEach((t, i) => {
      if (!t) return;
      if (t.wait > 0) t.wait--;
      if (t.wait === 0) step(t, i);
    });
    const tickSeconds = 60 / (tempo * TIMEBASE);
    sampleCarry += tickSeconds * SAMPLE_RATE;
    const n = Math.floor(sampleCarry);
    sampleCarry -= n;
    if (length + n > left.length) {
      const grow = (a: Float32Array): Float32Array => {
        const b = new Float32Array(Math.max(a.length * 2, length + n));
        b.set(a);
        return b;
      };
      left = grow(left);
      right = grow(right);
    }
    const envSteps = Math.max(1, Math.round(tickSeconds / ENV_STEP));
    if (seconds >= maxSeconds && !fading) fading = 1;
    for (const v of voices) {
      if (v.phase === 'done') continue;
      const t = v.track;
      if (v.left > 0 && --v.left === 0 && v.phase !== 'release') v.phase = 'release';
      if (fading && v.phase !== 'release') {
        v.phase = 'release';
        v.env = { ...v.env, r: Math.min(v.env.r, 110) };
      }
      const g0 = 10 ** (v.level / 128 / 20);
      envelope(v, envSteps);
      const g1 = (v.phase as Voice['phase']) === 'done' ? 0 : 10 ** (v.level / 128 / 20);
      // Pitch: key, bend, sweep (to 0 over the note) and vibrato.
      let semis = v.key - v.root + (t.bend.value / 128) * t.bendRange;
      if (v.sweep) semis += v.sweep * Math.max(0, 1 - v.age / v.sweepTicks);
      const lfoOn = t.modDepth > 0 && v.age * tickSeconds * 1000 >= t.modDelay * 5;
      const lfo = lfoOn ? Math.sin(2 * Math.PI * t.modSpeed * 0.39 * v.age * tickSeconds) * (t.modDepth / 128) : 0;
      if (t.modType === 0) semis += lfo * t.modRange;
      const ratio = ((v.wave.rate / SAMPLE_RATE) * v.pitch * 2 ** (semis / 12));
      let amp = master * v.gain * vol(t.volume.value) * vol(t.volume2.value);
      if (t.modType === 1) amp *= 1 + lfo * 0.5;
      const pan = Math.max(-64, Math.min(63, t.pan.value - 64 + v.pan + (t.modType === 2 ? lfo * 64 : 0)));
      const angle = ((pan + 64) / 128) * (Math.PI / 2);
      const [gl, gr] = [Math.cos(angle) * Math.SQRT2, Math.sin(angle) * Math.SQRT2];
      const w = v.wave;
      const len = w.loopEnd || w.channels[0]!.length;
      const c0 = w.channels[0]!;
      const c1 = w.channels[1] ?? c0;
      const base = length;
      for (let i = 0; i < n; i++) {
        if (v.pos >= len) {
          if (w.loop && len > w.loopStart) v.pos = w.loopStart + ((v.pos - w.loopStart) % (len - w.loopStart));
          else {
            v.phase = 'done';
            break;
          }
        }
        const p = Math.floor(v.pos);
        const f = v.pos - p;
        const next = p + 1 < len ? p + 1 : w.loop ? w.loopStart : p;
        const g = amp * (g0 + ((g1 - g0) * i) / n);
        const sl = (c0[p]! + (c0[next]! - c0[p]!) * f) * g;
        const sr = (c1[p]! + (c1[next]! - c1[p]!) * f) * g;
        left[base + i]! += sl * gl;
        right[base + i]! += sr * gr;
        v.pos += ratio;
      }
      v.age++;
    }
    length += n;
    seconds += tickSeconds;
    for (const t of tracks) {
      if (!t) continue;
      t.volume.tick();
      t.volume2.tick();
      t.pan.tick();
      t.bend.tick();
    }
    const playing = voices.some((v) => v.phase !== 'done');
    if (!tracks.some((t) => t?.alive) && !playing) break;
    if (fading && !playing) break;
    if (seconds > maxSeconds + 2) break;
  }
  const channels = [left.slice(0, length), right.slice(0, length)];
  // Keep it below clipping (the console's mixer limits; overlapping voices can exceed 1 here).
  let peak = 0;
  for (const c of channels) for (const x of c) peak = Math.max(peak, Math.abs(x));
  if (peak > 0.98) for (const c of channels) for (let i = 0; i < c.length; i++) c[i]! *= 0.98 / peak;
  return { rate: SAMPLE_RATE, channels, loop: false, loopStart: 0, loopEnd: length };
}
