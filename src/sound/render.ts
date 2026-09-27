// A sound of the archive as PCM: streams (BGM / ME) from sound/stream/*.bcstm, wave sounds and sequences
// (sound effects) from the waves, banks and sequence data inside sound.bcsar.
import { Bank, cseqData, parseCstm, SoundArchive, WaveArchive, WaveSoundData, type Pcm } from './formats';
import { renderSequence } from './sequencer';

/** Item IDs: 0x03nnnnnn = bank nnnnnn, 0x05nnnnnn = wave archive nnnnnn. */
const itemIndex = (id: number): number => id & 0xffffff;

export class SoundRenderer {
  private readonly waveArchives = new Map<number, WaveArchive>();
  private readonly banks = new Map<number, Bank>();
  private readonly waveSounds = new Map<number, WaveSoundData>();
  private seqData: Map<number, Uint8Array> = new Map();

  constructor(
    readonly archive: SoundArchive,
    /** Reads a RomFS file under sound/ ("stream/BGM_CAVE.bcstm"). */
    private readonly readFile: (path: string) => Promise<Uint8Array>,
  ) {}

  private waveArchive(item: number): WaveArchive | null {
    const i = itemIndex(item);
    let w = this.waveArchives.get(i);
    if (!w) {
      const file = this.archive.waveArchives[i];
      if (file === undefined) return null;
      w = new WaveArchive(this.archive.internal(file));
      this.waveArchives.set(i, w);
    }
    return w;
  }

  private wave = (war: number, index: number): Pcm | null => this.waveArchive(war)?.wave(index) ?? null;

  private bank(item: number): Bank {
    const i = itemIndex(item);
    let b = this.banks.get(i);
    if (!b) {
      const file = this.archive.banks[i];
      if (file === undefined) throw new Error(`バンク ${i} がありません`);
      b = new Bank(this.archive.internal(file));
      this.banks.set(i, b);
    }
    return b;
  }

  /** Sound `index` of the archive; sequences are cut after `maxSeconds`. */
  async render(index: number, maxSeconds = 8): Promise<Pcm> {
    const s = this.archive.sounds[index];
    if (!s) throw new Error(`音 ${index} がありません`);
    const gain = s.volume / 127;
    if (s.type === 'stream') {
      const f = this.archive.file(s.fileId);
      const bytes = typeof f === 'string' ? await this.readFile(f) : f;
      if (!bytes) throw new Error(`${s.name} のストリームがありません`);
      return scale(parseCstm(bytes), gain);
    }
    if (s.type === 'wave') {
      let w = this.waveSounds.get(s.fileId);
      if (!w) {
        w = new WaveSoundData(this.archive.internal(s.fileId));
        this.waveSounds.set(s.fileId, w);
      }
      const ws = w.wave(s.waveIndex);
      const pcm = ws && this.wave(ws.wave[0], ws.wave[1]);
      if (!ws || !pcm) throw new Error(`${s.name} の波形がありません`);
      return scale({ ...pcm, rate: pcm.rate * ws.pitch }, gain);
    }
    if (s.type === 'sequence') {
      let data = this.seqData.get(s.fileId);
      if (!data) {
        data = cseqData(this.archive.internal(s.fileId));
        this.seqData.set(s.fileId, data);
      }
      const bank = this.bank(s.banks[0] ?? 0x03000000);
      return renderSequence({ data, start: s.start, bank, wave: this.wave }, s.volume, maxSeconds);
    }
    throw new Error(`${s.name || `音 ${index}`} は再生できない種類です`);
  }
}

/** A copy scaled by `gain` (the sound's volume). */
function scale(p: Pcm, gain: number): Pcm {
  if (gain === 1) return p;
  return { ...p, channels: p.channels.map((c) => c.map((x) => x * gain)) };
}
