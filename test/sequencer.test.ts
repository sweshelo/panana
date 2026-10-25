// The sequence renderer (src/sound/sequencer.ts) on a made-up sequence: the timebase command (0xB0) and the loop of a
// BGM (the first track jumping back), without a ROM.
import { describe, expect, test } from 'bun:test';
import type { Bank, Pcm } from '../src/sound/formats';
import { renderSequence, SAMPLE_RATE } from '../src/sound/sequencer';

const wave: Pcm = { rate: SAMPLE_RATE, channels: [new Float32Array(1000).fill(0.5)], loop: true, loopStart: 0, loopEnd: 1000 };
const bank = {
  waves: [[0, 0]],
  region: () => ({ wave: 0, root: 60, volume: 127, pan: 64, pitch: 1, env: { a: 127, d: 127, s: 127, h: 0, r: 127 } }),
} as unknown as Bank;

/** tempo 120, note wait on, then at 8: a quarter-note-long note (96 ticks at timebase 96, 48 at 48) and a jump back to it. */
const song = (timebase: number[]): Uint8Array => {
  const head = [...timebase, 0xe1, 0x00, 0x78, 0xc7, 0x01];
  const start = head.length;
  return new Uint8Array([...head, 0x3c, 0x7f, 0x60, 0x89, 0x00, 0x00, start]);
};

describe('renderSequence', () => {
  test('a timebase of 96 makes the ticks half as long (96 ticks = 0.5 s at tempo 120)', () => {
    const p = renderSequence({ data: song([0xb0, 0x60]), start: 0, bank, wave: () => wave }, 127, 8, true);
    expect(p.loop).toBe(true);
    expect(Math.abs(p.loopEnd - p.loopStart - SAMPLE_RATE / 2)).toBeLessThan(64);
  });

  test('without it, 48 ticks a quarter note (96 ticks = 1 s)', () => {
    const p = renderSequence({ data: song([0xc7, 0x01]), start: 0, bank, wave: () => wave }, 127, 8, true);
    expect(Math.abs(p.loopEnd - p.loopStart - SAMPLE_RATE)).toBeLessThan(64);
  });

  test('without `loop`, the jump keeps playing until maxSeconds and fades out', () => {
    const p = renderSequence({ data: song([0xb0, 0x60]), start: 0, bank, wave: () => wave }, 127, 2);
    expect(p.loop).toBe(false);
    expect(p.channels[0]!.length / SAMPLE_RATE).toBeGreaterThan(2);
  });
});
