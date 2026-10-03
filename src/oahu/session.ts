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
import { OahuMaster, OAHU_MASTER, type SavedRow } from './master';
import { OahuMessages } from './messages';
import { OahuMonsterModels } from './monsterModels';
import { OahuShops, type SavedShop } from './shops';
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
  /** Edited shop stocks. */
  shops?: SavedShop[];
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

  private constructor(
    readonly dump: Dump,
    readonly messages: OahuMessages,
    readonly master: OahuMaster,
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
    return new OahuSession(dump, await OahuMessages.load(dump), await OahuMaster.load(dump), await OahuShops.load(dump));
  }

  static async open(dump: Dump): Promise<OahuSession> {
    const s = await OahuSession.load(dump);
    const saved = await idbGet<Saved>(EDITS_KEY).catch(() => undefined);
    if (saved) s.restore(saved);
    return s;
  }

  /** The same edits on the dump with its Update applied. */
  async withUpdate(update: UpdateImage): Promise<OahuSession> {
    this.saveNow();
    const next = await OahuSession.load(withUpdate(this.dump, update));
    next.restore(this.saved());
    return next;
  }

  private saved(): Saved {
    return { messages: this.messages.texts.saved(), rows: this.master.saved(), patches: this.codePatches, shops: this.shops?.saved() ?? [] };
  }

  /** Messages first: the rows of copied items name the messages added for them. */
  private restore(saved: Saved): void {
    if (saved.messages) this.messages.texts.restore(saved.messages);
    if (saved.rows) this.master.restore(saved.rows);
    if (saved.patches) this.codePatches = saved.patches.map((p) => ({ ...p }));
    if (saved.shops) this.shops?.restore(saved.shops);
    this.items.reload();
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

  /** code.ips of the enabled patches (those with errors left out), or null when there is none. */
  codeIps(): Uint8Array | null {
    if (!this.code || !this.enabledPatches().length) return null;
    const records = patchRecords(this.buildPatches().values());
    return records.length ? buildIps(records, this.code.code) : null;
  }

  /** RomFS files of the MOD (root name -> bytes). */
  modFiles(): Map<string, Uint8Array> {
    if (!this.canExport) throw new Error('書き出しには Update の CIA が要ります');
    const more = new Map([[OAHU_MASTER, this.master.changedEntries()]]);
    for (const [name, repl] of this.shops?.changedEntries() ?? []) more.set(name, new Map([...(more.get(name) ?? []), ...repl]));
    return this.messages.changedArchives(more, this.shops?.archives());
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
