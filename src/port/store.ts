// Archive entries a port added to a game (#100): the converted model, texture and motion files of a monster or an
// item from another game. They are kept per game (saved in IndexedDB), and the dump of that game reads its archives
// with them added, so every page shows the ported models and the export writes the archives that hold them.
import { findEntry, parseArchive, rebuildArchive, type ArcEntry } from '../archive/gsarc';
import type { Dump } from '../rom/dump';
import type { TitleKey } from '../rom/titles';
import { hex8 } from '../util/bytes';
import { idbGet, idbSet } from '../util/idb';

export interface PortedEntry {
  /** Root archive ("470D2848", "28480000", …). */
  archive: string;
  hash: number;
  /** File name kept in the entry (the games' ZIP entries carry one). */
  name: string;
  body: Uint8Array;
  /** An entry of the archive whose type and packing the new one copies. */
  like: number;
}

const KEY = (title: TitleKey): string => `port/${title}/v1`;

/**
 * A free entry hash for `body` in `taken`: from its contents (so the same file gets the same hash, and a photo cached
 * under a hash never belongs to another file), low byte 0 like every hash of the games.
 */
export function entryHash(body: Uint8Array, taken: (h: number) => boolean): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) h = Math.imul(h ^ body[i]!, 0x01000193) >>> 0;
  let v = (h & 0xffffff00) >>> 0;
  while (!v || taken(v)) v = (v + 0x100) >>> 0;
  return v;
}

export class PortStore {
  private entries: PortedEntry[] = [];
  /** Rebuilt archives by name (dropped when their entries change). */
  private built = new Map<string, Promise<Uint8Array>>();
  private readonly listeners = new Set<(archive: string) => void>();
  /** The dump's own reading (without the ported entries). */
  private read: ((name: string) => Promise<Uint8Array>) | null = null;

  private constructor(readonly title: TitleKey) {}

  private static stores = new Map<TitleKey, Promise<PortStore>>();

  /** The store of a game (restored from IndexedDB on first use). */
  static of(title: TitleKey): Promise<PortStore> {
    let p = PortStore.stores.get(title);
    if (!p) {
      p = (async () => {
        const s = new PortStore(title);
        const saved = await idbGet<PortedEntry[]>(KEY(title)).catch(() => undefined);
        if (saved) s.entries = saved;
        return s;
      })();
      PortStore.stores.set(title, p);
    }
    return p;
  }

  /** Makes `dump` read its archives with the ported entries (call before anything reads them). */
  static async install(dump: Dump): Promise<PortStore> {
    const s = await PortStore.of(dump.title.key);
    const own = dump.readRomfs;
    s.read = own;
    s.built.clear();
    dump.readRomfs = async (name) => {
      const key = name.toUpperCase();
      if (!s.entries.some((e) => e.archive === key)) return own(name);
      let p = s.built.get(key);
      if (!p) {
        p = own(name).then((b) => s.rebuild(key, b));
        p.catch(() => s.built.delete(key));
        s.built.set(key, p);
      }
      return (await p).slice();
    };
    return s;
  }

  private rebuild(archive: string, bytes: Uint8Array): Uint8Array {
    const arc = parseArchive(bytes);
    const add = this.entries.filter((e) => e.archive === archive && !findEntry(arc, e.hash));
    if (!add.length) return bytes;
    const like = (h: number): ArcEntry => findEntry(arc, h) ?? arc.entries[0]!;
    return rebuildArchive(arc, new Map(), add.map((e) => ({ hash: e.hash, name: e.name, body: e.body, like: like(e.like) })));
  }

  /** The archive as the game has it (without the ported entries). */
  async original(archive: string): Promise<Uint8Array> {
    if (!this.read) throw new Error('ダンプがありません');
    return this.read(archive);
  }

  list(): readonly PortedEntry[] {
    return this.entries;
  }

  has(archive: string, hash: number): boolean {
    return this.entries.some((e) => e.archive === archive && e.hash === hash);
  }

  /** Adds entries (an entry with the same archive and hash replaces the old one) and saves. */
  add(list: PortedEntry[]): void {
    for (const e of list) {
      this.entries = this.entries.filter((x) => !(x.archive === e.archive && x.hash === e.hash));
      this.entries.push(e);
    }
    this.changed(new Set(list.map((e) => e.archive)));
  }

  /** Drops entries nothing uses any more. */
  remove(archive: string, hashes: number[]): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => !(e.archive === archive && hashes.includes(e.hash)));
    if (this.entries.length !== before) this.changed(new Set([archive]));
  }

  private changed(archives: Set<string>): void {
    for (const a of archives) this.built.delete(a);
    idbSet(KEY(this.title), this.entries).catch(() => {});
    for (const a of archives) for (const f of this.listeners) f(a);
  }

  /** Called with an archive's name when its entries change (e.g. to drop a cached copy). */
  onChange(f: (archive: string) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** The archives holding ported entries, as the MOD writes them: [root file name, bytes]. */
  async archives(): Promise<[string, Uint8Array][]> {
    if (!this.read) return [];
    const out: [string, Uint8Array][] = [];
    for (const a of new Set(this.entries.map((e) => e.archive))) out.push([a, this.rebuild(a, await this.read(a))]);
    return out;
  }

  /** A short description for the export's list of changes. */
  summary(): string[] {
    const by = new Map<string, number>();
    for (const e of this.entries) by.set(e.archive, (by.get(e.archive) ?? 0) + 1);
    return [...by].map(([a, n]) => `${a}: 移植したファイル ${n} 個`);
  }
}

export const portedName = (e: PortedEntry): string => `${e.archive}/${hex8(e.hash)} ${e.name}`;
