// One opened 電波人間のRPG (honolulu, the first game) dump: its master read through the field definitions
// (master.ts, tables.ts) and the messages of every archive (messages.ts; the master's names come from them), their edits saved to IndexedDB and restored when the dump is
// opened again, and the MOD export (LayeredFS zip; the game has no Update, so the edits go on the Base's files).
import { buildModZip } from '../export/pack';
import type { Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';
import { idbGet, idbSet } from '../util/idb';
import type { SavedRow, SavedRowCount } from '../game/mastertables';
import { HonoluluMaster } from './master';
import { HonoluluMessages } from './messages';
import { HonoluluShop, type HonoluluSavedShop } from './shops';

const EDITS_KEY = 'honolulu/edits/v1';

interface Saved {
  messages: [number, Uint16Array][];
  /** Changed rows of the master's tables. */
  rows: SavedRow[];
  /** The tables whose number of rows an edit changed. */
  counts?: SavedRowCount[];
  /** The stocks of the shop's stages (shops.ts; laid out again after the rows). */
  shops?: HonoluluSavedShop;
}

export class HonoluluSession {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every edit (the pages recompute what it may have changed). */
  revision = 0;
  /** The shop's 12 stages (shopItemGroup / shopItemData). */
  readonly shop: HonoluluShop;

  private constructor(
    readonly dump: Dump,
    readonly master: HonoluluMaster,
    readonly messages: HonoluluMessages,
  ) {
    this.shop = new HonoluluShop(master);
  }

  /** Opens the dump; refuses one whose master is not the first game's (a version 5 GS archive). */
  static async open(dump: Dump): Promise<HonoluluSession> {
    if (dump.title !== HONOLULU) throw new Error(`『${dump.title.name}』のダンプです`);
    const messages = await HonoluluMessages.load(dump);
    const master = await HonoluluMaster.load(dump, messages.texts);
    const { version } = master.archive;
    if (version !== 5) throw new Error(`master (${HONOLULU.master}) のアーカイブが version ${version} です (初代は 5)`);
    const s = new HonoluluSession(dump, master, messages);
    const saved = await idbGet<Saved>(EDITS_KEY).catch(() => undefined);
    if (saved) s.restore(saved);
    return s;
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
    return { messages: this.messages.texts.saved(), rows: this.master.saved(), counts: this.master.savedRowCounts(), shops: this.shop.saved() };
  }

  private restore(saved: Saved): void {
    if (saved.messages) this.messages.texts.restore(saved.messages);
    if (saved.counts) this.master.restoreRowCounts(saved.counts);
    if (saved.rows) this.master.restore(saved.rows);
    if (saved.shops) this.shop.restore(saved.shops);
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
    return this.messages.texts.changed() || this.master.changedEntries().size > 0;
  }

  /** RomFS files of the MOD (root name -> bytes): the archives with edited tables or messages. */
  modFiles(): Map<string, Uint8Array> {
    return this.messages.changedArchives(new Map([[HONOLULU.master, this.master.changedEntries()]]), new Map([[HONOLULU.master, this.master.archive]]));
  }

  /** The LayeredFS zip: 0004000000077E00/romfs/…. */
  modZip(): Uint8Array {
    return buildModZip(new Map([...this.modFiles()].map(([name, b]) => [`romfs/${name}`, b])), HONOLULU.titleId);
  }
}
