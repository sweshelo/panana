// One opened 電波人間のRPG3 dump: its messages, the master's tables, the items and the battle tables, their edits saved to IndexedDB and
// restored when the dump is opened again (with or without the Update), and the MOD export (LayeredFS zip; it needs
// the Update, #59).
import { buildModZip } from '../export/pack';
import { withUpdate, type Dump, type UpdateImage } from '../rom/dump';
import { OAHU } from '../rom/titles';
import { idbGet, idbSet } from '../util/idb';
import { OahuBattle } from './battle';
import { OahuItemModels } from './itemModels';
import { OahuItems } from './items';
import { OahuMaster, OAHU_MASTER, type SavedRow } from './master';
import { OahuMessages } from './messages';

const EDITS_KEY = 'oahu/edits/v1';

interface Saved {
  messages: [number, Uint16Array][];
  /** Changed rows of the master's tables. */
  rows?: SavedRow[];
}

export class OahuSession {
  private saveTimer = 0;

  readonly items: OahuItems;
  readonly battle: OahuBattle;
  readonly itemModels: OahuItemModels;

  private constructor(
    readonly dump: Dump,
    readonly messages: OahuMessages,
    readonly master: OahuMaster,
  ) {
    this.items = new OahuItems(master, messages.texts);
    this.battle = new OahuBattle(master, this.items);
    this.itemModels = new OahuItemModels(dump);
  }

  private static async load(dump: Dump): Promise<OahuSession> {
    return new OahuSession(dump, await OahuMessages.load(dump), await OahuMaster.load(dump));
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
    return { messages: this.messages.texts.saved(), rows: this.master.saved() };
  }

  /** Messages first: the rows of copied items name the messages added for them. */
  private restore(saved: Saved): void {
    if (saved.messages) this.messages.texts.restore(saved.messages);
    if (saved.rows) this.master.restore(saved.rows);
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

  /** RomFS files of the MOD (root name -> bytes). */
  modFiles(): Map<string, Uint8Array> {
    if (!this.canExport) throw new Error('書き出しには Update の CIA が要ります');
    return this.messages.changedArchives(new Map([[OAHU_MASTER, this.master.changedEntries()]]));
  }

  /** The LayeredFS zip: 00040000000EF000/romfs/…. */
  modZip(): Uint8Array {
    return buildModZip(new Map([...this.modFiles()].map(([name, b]) => [`romfs/${name}`, b])), OAHU.titleId);
  }
}
