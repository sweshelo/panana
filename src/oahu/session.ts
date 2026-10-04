// One opened 電波人間のRPG3 dump: its messages, the master's tables, the items and the battle tables, their edits saved to IndexedDB and
// restored when the dump is opened again (with or without the Update), and the MOD export (LayeredFS zip; it needs
// the Update, #59). code.bin features (code.ips) use the Update's code.bin only (#65).
import { OahuPerformances } from './performance';
import { buildModZip } from '../export/pack';
import { buildPatches, patchRecords, type BuiltPatch, type CodePatch } from '../game/patch';
import { buildIps } from '../rom/ips';
import { withUpdate, type Dump, type UpdateImage } from '../rom/dump';
import { OAHU } from '../rom/titles';
import { idbGet, idbSet } from '../util/idb';
import { OahuBattle } from './battle';
import { OAHU_LAYOUT, OahuCode } from './code';
import { OahuItemModels } from './itemModels';
import { OahuItems } from './items';
import { OahuMaps, type OahuMapSaved } from './maps';
import { OahuMaster, OAHU_MASTER, type SavedRow } from './master';
import { OahuMessages } from './messages';
import { OahuMonsterModels } from './monsterModels';
import { OahuShops, type SavedShop } from './shops';
import { oahuEventEntries, type OahuEventEntry } from './events';
import { oahuReadSites, oahuSaveKeys, oahuValueRanges, oahuWriteSites, storyRecords, type OahuReadSite, type OahuSaveKey, type OahuValueRange, type OahuWriteSite, type StoryCodeEdit, type StoryState } from './story';
import { CodeIndex } from '../game/scripts';
import { OAHU_TEXT_END } from './scripts';
import { BCSAR_PATH, bcsarSoundNames, SoundNames } from '../game/sound';
import { SoundArchive } from '../sound/formats';
import { SoundRenderer } from '../sound/render';
import { u32 } from '../util/bytes';

const EDITS_KEY = 'oahu/edits/v1';

interface Saved {
  messages: [number, Uint16Array][];
  /** Changed rows of the master's tables. */
  rows?: SavedRow[];
  /** Code patches (kept without the Update too; they are only built and exported with it). */
  patches?: CodePatch[];
  /** Map sections and EventObject rows. */
  maps?: OahuMapSaved;
  /** Edited shop stocks. */
  shops?: SavedShop[];
  /** The story (#87): code edits (write immediates, script messages), names of the save values, the preview state. */
  storyEdits?: StoryCodeEdit[];
  storyNames?: Record<string, string>;
  storyState?: StoryState | null;
}

export class OahuSession {
  private saveTimer = 0;

  readonly items: OahuItems;
  readonly battle: OahuBattle;
  readonly itemModels: OahuItemModels;
  /** The performances of the actions (402F0000) and the names of the effects, read when first used. */
  readonly performances: OahuPerformances;
  /** The Update's code.bin; null without the Update (or when the Update is another version, see {@link codeError}). */
  readonly code: OahuCode | null = null;
  /** Why an Update's code.bin cannot be used. */
  readonly codeError: string = '';
  /** Code patches written to code.ips. */
  codePatches: CodePatch[] = [];
  /** Edits of the story's immediates and the scripts' message literals (code.ips; story.ts). */
  storyEdits: StoryCodeEdit[] = [];
  /** Names given to save values ("values.4" -> "ドローン撃破"; story.ts valueNameKey). */
  storyNames: Record<string, string> = {};
  /** The state the map page previews the events with (null = no preview). */
  storyState: StoryState | null = null;
  /** Bumped when the preview state changes (the map page follows it). */
  storyRevision = 0;
  private readonly storyListeners = new Set<() => void>();

  onStory(f: () => void): () => void {
    this.storyListeners.add(f);
    return () => this.storyListeners.delete(f);
  }

  /** The preview state was changed: save it and redraw the maps. */
  storyStateChanged(): void {
    this.storyRevision++;
    for (const f of this.storyListeners) f();
    this.scheduleSave();
  }

  private constructor(
    readonly dump: Dump,
    readonly messages: OahuMessages,
    readonly master: OahuMaster,
    readonly maps: OahuMaps,
    /** ShopItem / Shop (null when the dump has neither archive). */
    readonly shops: OahuShops | null,
  ) {
    this.items = new OahuItems(master, messages.texts);
    this.itemModels = new OahuItemModels(dump);
    this.performances = new OahuPerformances(dump);
    this.battle = new OahuBattle(master, this.items, new OahuMonsterModels(dump), this.itemModels);
    try {
      this.code = OahuCode.of(dump);
    } catch (e) {
      this.codeError = (e as Error).message;
    }
  }

  private static async load(dump: Dump): Promise<OahuSession> {
    const master = await OahuMaster.load(dump);
    return new OahuSession(dump, await OahuMessages.load(dump), master, await OahuMaps.load(dump, master), await OahuShops.load(dump));
  }

  static async open(dump: Dump): Promise<OahuSession> {
    const s = await OahuSession.load(dump);
    const saved = await idbGet<Saved>(EDITS_KEY).catch(() => undefined);
    if (saved) await s.restore(saved);
    return s;
  }

  /** The same edits on the dump with its Update applied. */
  async withUpdate(update: UpdateImage): Promise<OahuSession> {
    this.saveNow();
    const next = await OahuSession.load(withUpdate(this.dump, update));
    await next.restore(this.saved());
    return next;
  }

  private saved(): Saved {
    return {
      messages: this.messages.texts.saved(), rows: this.master.saved(), patches: this.codePatches, maps: this.maps.saved(), shops: this.shops?.saved() ?? [],
      storyEdits: this.storyEdits, storyNames: this.storyNames, storyState: this.storyState,
    };
  }

  /** Messages first: the rows of copied items name the messages added for them. */
  private async restore(saved: Saved): Promise<void> {
    if (saved.messages) this.messages.texts.restore(saved.messages);
    if (saved.rows) this.master.restore(saved.rows);
    if (saved.patches) this.codePatches = saved.patches.map((p) => ({ ...p }));
    if (saved.shops) this.shops?.restore(saved.shops);
    if (saved.storyEdits) this.storyEdits = saved.storyEdits.map((e) => ({ ...e }));
    if (saved.storyNames) this.storyNames = { ...saved.storyNames };
    if (saved.storyState) this.storyState = saved.storyState;
    this.items.reload();
    if (saved.maps) await this.maps.restore(saved.maps);
  }

  readonly scheduleSave = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  };

  saveNow(): void {
    clearTimeout(this.saveTimer);
    idbSet(EDITS_KEY, this.saved()).catch(() => {});
  }

  /** Whether a MOD can be exported: the edits must go on the Update's files (else its fixes would be lost). */
  get canExport(): boolean {
    return !!this.dump.update;
  }

  /** Assembles patches against the Update's code.bin (the enabled ones of the list unless given). */
  buildPatches(patches: CodePatch[] = this.enabledPatches()): Map<string, BuiltPatch> {
    if (!this.code) throw new Error(this.codeError || 'code.bin を使うには Update の CIA が要ります');
    return buildPatches(this.code.code, patches, OAHU_LAYOUT);
  }

  enabledPatches(): CodePatch[] {
    return this.codePatches.filter((p) => p.enabled);
  }

  /** code.ips of the enabled patches (those with errors left out) and the story's edits, or null when there is none. */
  codeIps(): Uint8Array | null {
    if (!this.code) return null;
    const records = [...(this.enabledPatches().length ? patchRecords(this.buildPatches().values()) : []), ...storyRecords(this.code.code, this.storyEdits).records];
    return records.length ? buildIps(records, this.code.code) : null;
  }

  // ---- the story (#87)

  /** MessageField_JP's ID range (the messages the scripts' code names). */
  fieldRange(): [number, number] {
    const f = this.messages.texts.files.find((x) => x.name === 'MessageField_JP.gsmb');
    return f ? [f.gmsg.first, f.gmsg.last] : [40000, 49999];
  }

  private entries: { revision: number; p: Promise<OahuEventEntry[]> } | null = null;

  /**
   * Every EventObject row with its places and classes (events.ts), rebuilt when the maps change. The tables it loads
   * bump the maps' revision too, so the list counts as current for the revision it ends at (-1 while it is built).
   */
  eventEntries(): Promise<OahuEventEntry[]> {
    const have = this.entries;
    if (have && (have.revision === this.maps.revision || have.revision < 0)) return have.p;
    const entry: { revision: number; p: Promise<OahuEventEntry[]> } = { revision: -1, p: Promise.resolve([]) };
    entry.p = oahuEventEntries(this.maps, this.code?.code ?? null, this.fieldRange()).then(
      (e) => {
        entry.revision = this.maps.revision;
        return e;
      },
      (err: unknown) => {
        if (this.entries === entry) this.entries = null;
        throw err;
      },
    );
    this.entries = entry;
    return entry.p;
  }

  private storyCache: { keys: OahuSaveKey[]; ranges: OahuValueRange[]; writes: OahuWriteSite[]; reads: OahuReadSite[] } | null = null;

  /** The save keys, the dungeons' ranges of 0xF9 / 0xFA, and (with the Update) where the code writes and reads them. */
  story(): { keys: OahuSaveKey[]; ranges: OahuValueRange[]; writes: OahuWriteSite[]; reads: OahuReadSite[] } {
    if (!this.storyCache) {
      const ranges = oahuValueRanges(this.master);
      const code = this.code?.code;
      const index = code ? new CodeIndex(code, [], { textEnd: OAHU_TEXT_END, msgFirst: 0, msgLast: -1, complete: 0 }) : undefined;
      this.storyCache = { keys: oahuSaveKeys(this.master), ranges, writes: code ? oahuWriteSites(code, index) : [], reads: code ? oahuReadSites(code, ranges, index) : [] };
    }
    return this.storyCache;
  }

  /** RomFS files of the MOD (root name -> bytes). */
  modFiles(): Map<string, Uint8Array> {
    if (!this.canExport) throw new Error('書き出しには Update の CIA が要ります');
    const more = new Map([[OAHU_MASTER, this.master.changedEntries()]]);
    for (const [name, repl] of this.shops?.changedEntries() ?? []) more.set(name, new Map([...(more.get(name) ?? []), ...repl]));
    const files = this.messages.changedArchives(more, this.shops?.archives());
    for (const [name, b] of this.maps.changedArchives()) files.set(name, b);
    return files;
  }

  /** The LayeredFS zip: 00040000000EF000/romfs/… and exefs/code.ips. */
  modZip(): Uint8Array {
    const pkg = new Map([...this.modFiles()].map(([name, b]) => [`romfs/${name}`, b]));
    const ips = this.codeIps();
    if (ips) pkg.set('exefs/code.ips', ips);
    return buildModZip(pkg, OAHU.titleId);
  }

  private soundNames: Promise<SoundNames> | null = null;

  /** Names of the soundData rows, from the Base's sound/sound.bcsar (cached by name, apart from RPG2's). */
  sounds(): Promise<SoundNames> {
    this.soundNames ??= (async () => {
      const t = this.master.table('soundData.bin');
      const items = Array.from({ length: t.rows }, (_, i) => u32(t.row(i), 0));
      // +8: the volume byte, then D0 padding
      const volumes = Array.from({ length: t.rows }, (_, i) => t.row(i)[8]!);
      const key = 'oahu/sound/names/v1';
      let names = (await idbGet<string[]>(key).catch(() => undefined)) ?? null;
      if (!names)
        try {
          names = bcsarSoundNames(await this.dump.readRomfs(BCSAR_PATH));
          await idbSet(key, names).catch(() => {});
        } catch {
          names = null;
        }
      return new SoundNames(items, names, volumes);
    })();
    return this.soundNames;
  }

  private renderer: Promise<SoundRenderer> | null = null;

  /** Plays the sounds of sound/sound.bcsar (its streams from sound/stream/). */
  soundRenderer(): Promise<SoundRenderer> {
    this.renderer ??= this.dump.readRomfs(BCSAR_PATH).then(
      (b) => new SoundRenderer(new SoundArchive(b), (path) => this.dump.readRomfs(`sound/${path}`)),
      (err: Error) => {
        this.renderer = null;
        throw new Error(`${BCSAR_PATH} を読めません (${err.message})`);
      },
    );
    return this.renderer;
  }
}
