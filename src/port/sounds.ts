// BGMs ported from another game into RPG2 (the streams of sound/stream/): each is a new stream sound of RPG2's
// sound.bcsar (after its own 430, a copy of one of its BGMs) playing a new file sound/stream/<name>.bcstm (the stream
// in RPG2's CSTM version, sound/write.ts). They are kept in IndexedDB like the ported models (store.ts), and the dump
// reads sound.bcsar and the new streams with them, so the pages play them and the export writes them.
// Which soundData row plays one is an ordinary edit of soundData (+0x00 = 0x01000000 | its sound).
import type { SoundPorts } from '../game/game';
import { BCSAR_PATH } from '../game/sound';
import type { Dump } from '../rom/dump';
import type { TitleKey } from '../rom/titles';
import { SoundArchive } from '../sound/formats';
import { addStreamSounds, cstmChannels, cstmForKahara } from '../sound/write';
import { idbGet, idbSet } from '../util/idb';

export interface PortedSound {
  /** Name in RPG2's sound.bcsar ("BGM_OAHU_BATTLE_1"). */
  name: string;
  /** Game and sound name it was taken from. */
  from: { title: TitleKey; name: string };
  /** The stream in RPG2's version. */
  stream: Uint8Array;
  /** The sound's volume in its game (0-255). */
  volume: number;
}

const KEY = 'port/kahara/sound/v1';

/** Short names of the games for the new sound names (the games' own names, as the code calls them). */
export const SOUND_PREFIX: Record<TitleKey, string> = { kahara: 'KAHARA', oahu: 'OAHU', lanai: 'LANAI', honolulu: 'HONOLULU' };

/** File of a ported sound, from sound/. */
export const portedPath = (name: string): string => `stream/${name}.bcstm`;

export class SoundPortStore implements SoundPorts {
  private entries: PortedSound[] = [];
  private read: ((name: string) => Promise<Uint8Array>) | null = null;
  private built: Promise<Uint8Array> | null = null;
  private original: Promise<SoundArchive> | null = null;
  private readonly listeners = new Set<() => void>();

  private static store: Promise<SoundPortStore> | null = null;

  static of(): Promise<SoundPortStore> {
    SoundPortStore.store ??= (async () => {
      const s = new SoundPortStore();
      s.entries = (await idbGet<PortedSound[]>(KEY).catch(() => undefined)) ?? [];
      return s;
    })();
    return SoundPortStore.store;
  }

  /** Makes RPG2's `dump` read sound.bcsar and the streams with the ported sounds. */
  static async install(dump: Dump): Promise<SoundPortStore> {
    const s = await SoundPortStore.of();
    s.attach(dump);
    return s;
  }

  /** (For the tests: a store that is not saved.) */
  static fresh(entries: PortedSound[] = []): SoundPortStore {
    const s = new SoundPortStore();
    s.entries = entries;
    s.save = () => {};
    return s;
  }

  attach(dump: Dump): void {
    const own = dump.readRomfs;
    this.read = own;
    this.built = null;
    this.original = null;
    dump.readRomfs = async (name) => {
      if (!this.entries.length) return own(name);
      if (name.toLowerCase() === BCSAR_PATH) return (await this.bcsar()).slice();
      const e = this.entries.find((x) => `sound/${portedPath(x.name)}`.toLowerCase() === name.toLowerCase());
      return e ? e.stream.slice() : own(name);
    };
  }

  originalBcsar(): Promise<Uint8Array> {
    if (!this.read) return Promise.reject(new Error('ダンプがありません'));
    return this.read(BCSAR_PATH);
  }

  names(): string[] {
    return this.entries.map((e) => e.name);
  }

  /** RPG2's sound archive as in the game. */
  archive(): Promise<SoundArchive> {
    if (!this.read) return Promise.reject(new Error('ダンプがありません'));
    this.original ??= this.read(BCSAR_PATH).then((b) => new SoundArchive(b));
    return this.original;
  }

  /** sound.bcsar with the ported sounds. */
  private bcsar(): Promise<Uint8Array> {
    if (!this.read) return Promise.reject(new Error('ダンプがありません'));
    const read = this.read;
    this.built ??= read(BCSAR_PATH).then((b) => {
      const a = new SoundArchive(b);
      return addStreamSounds(b, templateSound(a), this.entries.map((e) => ({ name: e.name, path: portedPath(e.name), volume: e.volume, channels: cstmChannels(e.stream) })));
    });
    this.built.catch(() => (this.built = null));
    return this.built;
  }

  list(): readonly PortedSound[] {
    return this.entries;
  }

  /** Sound index (in the archive with the ported ones) of a ported sound. */
  async index(name: string): Promise<number | null> {
    const i = this.entries.findIndex((e) => e.name === name);
    return i < 0 ? null : (await this.archive()).sounds.length + i;
  }

  /** The ported sound taken from `title`'s `name`, if it was ported already. */
  find(title: TitleKey, name: string): PortedSound | undefined {
    return this.entries.find((e) => e.from.title === title && e.from.name === name);
  }

  /**
   * Adds the stream `stream` of `title`'s sound `name` (or finds it, when ported already); returns its sound index in
   * RPG2's archive.
   */
  async add(title: TitleKey, name: string, stream: Uint8Array, volume: number): Promise<number> {
    const had = this.find(title, name);
    if (had) return (await this.index(had.name))!;
    const own = new Set((await this.archive()).sounds.map((s) => s.name));
    const base = `BGM_${SOUND_PREFIX[title]}_${name.replace(/^BGM_/, '')}`;
    let n = base;
    for (let k = 2; own.has(n) || this.entries.some((e) => e.name === n); k++) n = `${base}_${k}`;
    this.entries = [...this.entries, { name: n, from: { title, name }, stream: cstmForKahara(stream), volume }];
    this.changed();
    return (await this.index(n))!;
  }

  /** Drops every ported sound (the soundData rows that play one have to be put back first). */
  clear(): void {
    this.entries = [];
    this.changed();
  }

  private save = (): void => {
    idbSet(KEY, this.entries).catch(() => {});
  };

  private changed(): void {
    this.built = null;
    this.save();
    for (const f of this.listeners) f();
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** RomFS files for the MOD: sound/sound.bcsar and the streams (none without ported sounds). */
  async files(): Promise<[string, Uint8Array][]> {
    if (!this.entries.length || !this.read) return [];
    return [[BCSAR_PATH, await this.bcsar()], ...this.entries.map((e): [string, Uint8Array] => [`sound/${portedPath(e.name)}`, e.stream])];
  }

  summary(): string[] {
    return this.entries.length ? [`移植した BGM ${this.entries.length} 曲 (sound/sound.bcsar と sound/stream/)`] : [];
  }
}

/** The stream sound new ones copy: the first BGM stream (RPG2's BGM_TITLE). */
export function templateSound(a: SoundArchive): number {
  const i = a.sounds.findIndex((s) => s.type === 'stream' && s.name.startsWith('BGM_'));
  if (i < 0) throw new Error('sound.bcsar に BGM のストリームがありません');
  return i;
}
