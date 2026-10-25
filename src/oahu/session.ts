// One opened 電波人間のRPG3 dump: its messages, the master's tables, the items and the battle tables, their edits saved to IndexedDB and
// restored when the dump is opened again (with or without the Update), and the MOD export (LayeredFS zip; it needs
// the Update, #59). code.bin features (code.ips) use the Update's code.bin only (#65).
import { OahuPerformances } from './performance';
import { buildModZip } from '../export/pack';
import { dropCapPatch, dropCapProblem } from '../game/dropcap';
import { buildPatches, patchRecords, type BuiltPatch, type CodePatch } from '../game/patch';
import { packageOn } from '../rom/basemod';
import { appendIps } from '../rom/ips';
import { overlayDump, withUpdate, type BaseMod, type Dump, type UpdateImage } from '../rom/dump';
import { OAHU } from '../rom/titles';
import { idbGet, idbSet } from '../util/idb';
import { OahuBattle } from './battle';
import { OAHU_LAYOUT, OahuCode } from './code';
import { OahuItemModels } from './itemModels';
import { OahuItems } from './items';
import { OahuMaps, type OahuMapSaved } from './maps';
import { OahuMaster, OAHU_MASTER, type SavedRow } from './master';
import { OahuMessages } from './messages';
import { OAHU_DESIGN_ARCHIVE, OahuMonsterModels } from './monsterModels';
import { PortStore } from '../port/store';
import { OahuShops, type SavedShop } from './shops';
import { oahuEventEntries, type OahuEventEntry } from './events';
import { oahuReadSites, oahuSaveKeys, oahuValueRanges, oahuWriteSites, storyRecords, type OahuReadSite, type OahuSaveKey, type OahuValueRange, type OahuWriteSite, type StoryCodeEdit, type StoryState } from './story';
import { CodeIndex } from '../game/scripts';
import { OAHU_TEXT_END } from './scripts';
import type { SoundNames } from '../game/sound';
import type { SoundRenderer } from '../sound/render';
import { loadSoundNames, openSoundRenderer } from '../sound/source';
import { u32 } from '../util/bytes';

const EDITS_KEY = 'oahu/edits/v1';

interface Saved {
  messages: [number, Uint16Array][];
  /** Changed rows of the master's tables. */
  rows?: SavedRow[];
  /** Code patches (kept without the Update too; they are only built and exported with it). */
  patches?: CodePatch[];
  /** Panana's code MOD "ドロップ率の天井を撤廃" is on (game/dropcap.ts). */
  dropCap?: boolean;
  /** Map sections and EventObject rows. */
  maps?: OahuMapSaved;
  /** Edited shop stocks. */
  shops?: SavedShop[];
  /** The story (#87): code edits (write immediates, script messages), names of the save values, the preview state. */
  storyEdits?: StoryCodeEdit[];
  storyNames?: Record<string, string>;
  storyState?: StoryState | null;
  /** monsterDesign.bin (402F0000) with the rows ports added (#100). */
  designs?: Uint8Array | null;
  /** directData.bin (402F0000) with the performances' edits (#93). */
  direct?: Uint8Array | null;
}

export class OahuSession {
  private saveTimer = 0;

  readonly items: OahuItems;
  readonly battle: OahuBattle;
  readonly itemModels: OahuItemModels;
  /** The monsters' designs (402F0000): their models, and the rows ports add. */
  readonly monsterModels: OahuMonsterModels;
  /** The performances of the actions (402F0000) and the names of the effects, read when first used. */
  readonly performances: OahuPerformances;
  /** The Update's code.bin; null without the Update (or when the Update is another version, see {@link codeError}). */
  readonly code: OahuCode | null = null;
  /** Why an Update's code.bin cannot be used. */
  readonly codeError: string = '';
  /** The dump as opened, without the base MOD ({@link dump} reads through it). */
  raw!: Dump;
  /** The existing MOD the dump is read with (its files and code.ips also go into the export), or null. */
  baseMod: BaseMod | null = null;
  /** Code patches written to code.ips. */
  codePatches: CodePatch[] = [];
  /** Whether the export writes Panana's code MOD "ドロップ率の天井を撤廃" (game/dropcap.ts) to exefs/code.ips. */
  dropCap = false;
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
    this.monsterModels = new OahuMonsterModels(dump);
    this.battle = new OahuBattle(master, this.items, this.monsterModels, this.itemModels);
    try {
      this.code = OahuCode.of(dump);
    } catch (e) {
      this.codeError = (e as Error).message;
    }
  }

  private static async load(raw: Dump, baseMod: BaseMod | null): Promise<OahuSession> {
    const dump = baseMod ? overlayDump(raw, baseMod) : raw;
    await PortStore.install(dump);
    const master = await OahuMaster.load(dump);
    const s = new OahuSession(dump, await OahuMessages.load(dump), master, await OahuMaps.load(dump, master), await OahuShops.load(dump));
    s.raw = raw;
    s.baseMod = baseMod;
    await s.monsterModels.rows(); // the design rows are read before the pages ask for the monsters' models
    return s;
  }

  /** Opens a dump (on a base MOD when one is given) and puts back the edits saved in IndexedDB. */
  static async open(dump: Dump, baseMod: BaseMod | null = null): Promise<OahuSession> {
    const s = await OahuSession.load(dump, baseMod);
    const saved = await idbGet<Saved>(EDITS_KEY).catch(() => undefined);
    if (saved) await s.restore(saved);
    return s;
  }

  /** The same edits on the dump with its Update applied. */
  async withUpdate(update: UpdateImage): Promise<OahuSession> {
    this.saveNow();
    const next = await OahuSession.load(withUpdate(this.raw, update), this.baseMod);
    await next.restore(this.saved());
    return next;
  }

  private saved(): Saved {
    return {
      messages: this.messages.texts.saved(), rows: this.master.saved(), patches: this.codePatches, maps: this.maps.saved(), shops: this.shops?.saved() ?? [],
      storyEdits: this.storyEdits, storyNames: this.storyNames, storyState: this.storyState, designs: this.monsterModels.saved(), direct: this.performances.saved(),
      ...(this.dropCap ? { dropCap: true } : {}),
    };
  }

  /** Messages first: the rows of copied items name the messages added for them. */
  private async restore(saved: Saved): Promise<void> {
    if (saved.messages) this.messages.texts.restore(saved.messages);
    if (saved.rows) this.master.restore(saved.rows);
    if (saved.patches) this.codePatches = saved.patches.map((p) => ({ ...p }));
    this.dropCap = !!saved.dropCap;
    if (saved.shops) this.shops?.restore(saved.shops);
    if (saved.storyEdits) this.storyEdits = saved.storyEdits.map((e) => ({ ...e }));
    if (saved.storyNames) this.storyNames = { ...saved.storyNames };
    if (saved.storyState) this.storyState = saved.storyState;
    if (saved.designs) await this.monsterModels.restore(saved.designs);
    if (saved.direct) await this.performances.restore(saved.direct);
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

  /** Why the code MOD "ドロップ率の天井を撤廃" cannot be written (no Update, another version), or null. */
  dropCapProblem(): string | null {
    if (!this.code) return this.codeError || 'code.bin を書き換えるには Update の CIA が要ります';
    return dropCapProblem(this.code.code, 'oahu');
  }

  /** The enabled patches and Panana's code MODs that are on, as they are exported (one build, so their caves do not overlap). */
  exportedPatches(): CodePatch[] {
    return [...this.enabledPatches(), ...(this.dropCap && !this.dropCapProblem() ? [dropCapPatch('oahu')] : [])];
  }

  /**
   * code.ips: the base MOD's, then the enabled patches and code MODs (those with errors left out) and the story's edits;
   * null when there is none.
   */
  codeIps(): Uint8Array | null {
    const base = this.baseMod?.ips ?? null;
    if (!this.code) return base;
    const patches = this.exportedPatches();
    const records = [...(patches.length ? patchRecords(this.buildPatches(patches).values()) : []), ...storyRecords(this.code.code, this.storyEdits).records];
    return records.length ? appendIps(base, records, this.code.code) : base;
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

  /** The RomFS files of the MOD with the archives of ported models and their design rows (#100), and 402F0000 with the performances (#93). */
  async allModFiles(): Promise<Map<string, Uint8Array>> {
    const files = this.modFiles();
    const direct = await this.performances.replacement();
    const designs = await this.monsterModels.archive(new Map(direct ? [direct] : []));
    if (designs) files.set(OAHU_DESIGN_ARCHIVE, designs);
    for (const [name, b] of await (await PortStore.of('oahu')).archives()) if (!files.has(name)) files.set(name, b);
    return files;
  }

  /** The LayeredFS zip: 00040000000EF000/romfs/… (with the base MOD's files) and exefs/code.ips. */
  async modZip(): Promise<Uint8Array> {
    return buildModZip(packageOn(this.baseMod, await this.allModFiles(), this.codeIps()), OAHU.titleId);
  }

  private soundNames: Promise<SoundNames> | null = null;

  /** Names of the soundData rows, from the Base's sound/sound.bcsar (cached by name, apart from RPG2's). */
  sounds(): Promise<SoundNames> {
    const t = this.master.table('soundData.bin');
    // +8: the volume byte, then D0 padding
    return (this.soundNames ??= loadSoundNames(this.dump, 'oahu/sound/names/v1', Array.from({ length: t.rows }, (_, i) => u32(t.row(i), 0)), Array.from({ length: t.rows }, (_, i) => t.row(i)[8]!)));
  }

  private renderer: Promise<SoundRenderer> | null = null;

  /** Plays the sounds of sound/sound.bcsar (its streams from sound/stream/). */
  soundRenderer(): Promise<SoundRenderer> {
    this.renderer ??= openSoundRenderer(this.dump).catch((err: Error) => {
      this.renderer = null;
      throw err;
    });
    return this.renderer;
  }
}
