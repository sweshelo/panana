// Previewing sounds in the browser (Web Audio): one sound at a time; streams loop like in the game.
import { useSyncExternalStore } from 'react';
import type { Pcm } from './formats';

export interface PlayerState {
  /** What is playing (or being prepared), e.g. "sound:18"; null when nothing is. */
  key: string | null;
  loading: boolean;
  /** Why the last sound could not be played (with its key). */
  error: { key: string; message: string } | null;
}

/** A sound ready to play: the buffer and its loop (seconds). */
interface Prepared {
  buffer: AudioBuffer;
  loop: [number, number] | null;
}

class SoundPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private readonly cache = new Map<string, Prepared>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  state: PlayerState = { key: null, loading: false, error: null };

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  private set(s: Partial<PlayerState>): void {
    this.state = { ...this.state, ...s };
    for (const f of this.listeners) f();
  }

  stop(): void {
    this.seq++;
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    if (this.state.key) this.set({ key: null, loading: false });
  }

  /** Play `key` (stop it if it is playing). `cacheable`: the rendering is the same every time (not a sequence). */
  async toggle(key: string, render: () => Promise<Pcm>, cacheable = true): Promise<void> {
    if (this.state.key === key) {
      this.stop();
      return;
    }
    this.stop();
    const my = ++this.seq;
    this.set({ key, loading: true, error: null });
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      let prepared = this.cache.get(key);
      if (!prepared) {
        const pcm = await render();
        if (my !== this.seq) return;
        const buffer = ctx.createBuffer(Math.max(1, pcm.channels.length), Math.max(1, pcm.channels[0]?.length ?? 0), pcm.rate);
        pcm.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        prepared = { buffer, loop: pcm.loop ? [pcm.loopStart / pcm.rate, pcm.loopEnd / pcm.rate] : null };
        if (cacheable) {
          this.cache.set(key, prepared);
          if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
        }
      }
      if (my !== this.seq) return;
      const src = ctx.createBufferSource();
      src.buffer = prepared.buffer;
      const loop = prepared.loop;
      if (loop) {
        src.loop = true;
        [src.loopStart, src.loopEnd] = loop;
      }
      src.connect(ctx.destination);
      src.onended = () => {
        if (this.source === src) {
          this.source = null;
          this.set({ key: null, loading: false });
        }
      };
      this.source = src;
      src.start();
      this.set({ loading: false });
    } catch (err) {
      if (my !== this.seq) return;
      this.set({ key: null, loading: false, error: { key, message: (err as Error).message } });
    }
  }
}

export const soundPlayer = new SoundPlayer();

export function usePlayer(): PlayerState {
  return useSyncExternalStore(soundPlayer.subscribe, () => soundPlayer.state, () => soundPlayer.state);
}
