// One opened 電波人間のRPG (honolulu, the first game) dump: its master, 2713402F (the monsters' looks) and 49C917B7 (the
// pier's world map) read through the field definitions (master.ts, tables.ts) and the messages of every archive (messages.ts; the master's names come from them), their edits saved to IndexedDB and restored when the dump is
// opened again, and the MOD export (LayeredFS zip; the game has no Update, so the edits go on the Base's files).
import { buildModZip } from '../export/pack';
import type { SoundNames } from '../game/sound';
import { packageOn } from '../rom/basemod';
import { overlayDump, type BaseMod, type Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';
import type { SoundRenderer } from '../sound/render';
import { loadSoundNames, openSoundRenderer } from '../sound/source';
import { idbGet, idbSet } from '../util/idb';
import type { SavedRow, SavedRowCount } from '../game/mastertables';
import { HonoluluMaps } from './maps';
import { HonoluluMaster } from './master';
import { HonoluluMessages } from './messages';
import { HONOLULU_MONSTER_ARCHIVE, monsterRowName } from './monsters';
import { HonoluluShop, type HonoluluSavedShop } from './shops';
import { HonoluluWorldmap } from './worldmap';

const EDITS_KEY = 'honolulu/edits/v1';

interface Saved {
  messages: [number, Uint16Array][];
  /** Changed rows of the master's tables. */
  rows: SavedRow[];
  /** The tables whose number of rows an edit changed. */
  counts?: SavedRowCount[];
  /** Changed rows of 2713402F's tables (monsterData). */
  design?: SavedRow[];
  /** The stocks of the shop's stages (shops.ts; laid out again after the rows). */
  shops?: HonoluluSavedShop;
  /** Changed rows of 49C917B7's PierData (the world map). */
  pier?: SavedRow[];
}

export class HonoluluSession {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every edit (the pages recompute what it may have changed). */
  revision = 0;
  /** The shop's 12 stages (shopItemGroup / shopItemData). */
  readonly shop: HonoluluShop;
  private mapsLoad: Promise<HonoluluMaps> | undefined;
  /** The dump as opened, without the base MOD ({@link dump} reads through it). */
  raw!: Dump;
  /** The existing MOD the dump is read with (its files also go into the export), or null. */
  baseMod: BaseMod | null = null;

  private constructor(
    readonly dump: Dump,
    readonly master: HonoluluMaster,
    readonly messages: HonoluluMessages,
    /** 2713402F: monsterData (the monsters' names and models), directData and effectData. */
    readonly design: HonoluluMaster,
    /** 49C917B7: PierData, the islands of the pier's world map. */
    readonly worldmap: HonoluluWorldmap,
  ) {
    this.shop = new HonoluluShop(master);
    const names = (table: string, row: number): string | undefined => monsterRowName(this, table, row);
    master.names = names;
    design.names = names;
  }

  /** Opens the dump (on a base MOD when one is given); refuses one whose master is not the first game's (a version 5 GS archive). */
  static async open(raw: Dump, baseMod: BaseMod | null = null): Promise<HonoluluSession> {
    if (raw.title !== HONOLULU) throw new Error(`『${raw.title.name}』のダンプです`);
    const dump = baseMod ? overlayDump(raw, baseMod) : raw;
    const messages = await HonoluluMessages.load(dump);
    const [master, design, worldmap] = await Promise.all([
      HonoluluMaster.load(dump, messages.texts),
      HonoluluMaster.load(dump, messages.texts, HONOLULU_MONSTER_ARCHIVE),
      HonoluluWorldmap.load(dump, messages.texts),
    ]);
    const { version } = master.archive;
    if (version !== 5) throw new Error(`master (${HONOLULU.master}) のアーカイブが version ${version} です (初代は 5)`);
    const s = new HonoluluSession(dump, master, messages, design, worldmap);
    s.raw = raw;
    s.baseMod = baseMod;
    const saved = await idbGet<Saved>(EDITS_KEY).catch(() => undefined);
    if (saved) s.restore(saved);
    return s;
  }

  /** The maps (A90C8038 and the floor definitions), read when the map page is first shown. */
  maps(): Promise<HonoluluMaps> {
    return (this.mapsLoad ??= HonoluluMaps.load(this.dump, this.master));
  }

  private soundNames: Promise<SoundNames> | undefined;

  /** The soundData rows with the names of sound/sound.bcsar (the BGM page). */
  sounds(): Promise<SoundNames> {
    const t = this.master.rows('soundData.bin');
    return (this.soundNames ??= loadSoundNames(this.dump, 'honolulu/sound/names/v1', Array.from({ length: t.rows }, (_, r) => t.get(r, 'item')), Array.from({ length: t.rows }, (_, r) => t.get(r, 'volume'))));
  }

  private renderer: Promise<SoundRenderer> | undefined;

  /** Plays the sounds of sound/sound.bcsar (its streams from sound/stream/). */
  soundRenderer(): Promise<SoundRenderer> {
    this.renderer ??= openSoundRenderer(this.dump).catch((err: Error) => {
      this.renderer = undefined;
      throw err;
    });
    return this.renderer;
  }

  /** A page changed the data: redraw the pages that show it and save. */
  edited(): void {
    this.revision++;
    for (const f of this.listeners) f();
    this.scheduleSave();
  }

  onEdit(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private saved(): Saved {
    return { messages: this.messages.texts.saved(), rows: this.master.saved(), counts: this.master.savedRowCounts(), shops: this.shop.saved(), design: this.design.saved(), pier: this.worldmap.pier.saved() };
  }

  private restore(saved: Saved): void {
    if (saved.messages) this.messages.texts.restore(saved.messages);
    if (saved.counts) this.master.restoreRowCounts(saved.counts);
    if (saved.rows) this.master.restore(saved.rows);
    if (saved.design) this.design.restore(saved.design);
    if (saved.shops) this.shop.restore(saved.shops);
    if (saved.pier) this.worldmap.pier.restore(saved.pier);
  }

  readonly scheduleSave = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 500);
  };

  saveNow(): void {
    clearTimeout(this.saveTimer);
    idbSet(EDITS_KEY, this.saved()).catch(() => {});
  }

  /** Whether anything was edited (the export has something to write). */
  changed(): boolean {
    return this.messages.texts.changed() || this.tables().some((t) => t.changedEntries().size > 0);
  }

  /** The archives of GS tables the pages edit: the master, 2713402F and 49C917B7. */
  tables(): HonoluluMaster[] {
    return [this.master, this.design, this.worldmap.pier];
  }

  /** RomFS files of the MOD (root name -> bytes): the archives with edited tables or messages. */
  modFiles(): Map<string, Uint8Array> {
    const tables = this.tables();
    return this.messages.changedArchives(new Map(tables.map((t) => [t.name, t.changedEntries()])), new Map(tables.map((t) => [t.name, t.archive])));
  }

  /** The files of the MOD below the title folder: romfs/… (with the base MOD's files) and the base MOD's exefs/code.ips. */
  modPackage(): Map<string, Uint8Array> {
    return packageOn(this.baseMod, this.modFiles(), this.baseMod?.ips ?? null);
  }

  /** The LayeredFS zip: 0004000000077E00/romfs/…. */
  modZip(): Uint8Array {
    return buildModZip(this.modPackage(), HONOLULU.titleId);
  }
}
