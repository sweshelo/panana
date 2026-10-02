// One opened 電波人間のRPG3 dump: its messages and their edits, saved to IndexedDB and restored when the dump is
// opened again (with or without the Update), and the MOD export (LayeredFS zip; it needs the Update, #59).
import { buildModZip } from '../export/pack';
import { withUpdate, type Dump, type UpdateImage } from '../rom/dump';
import { OAHU } from '../rom/titles';
import { idbGet, idbSet } from '../util/idb';
import { OahuMessages } from './messages';

const EDITS_KEY = 'oahu/edits/v1';

interface Saved {
  messages: [number, Uint16Array][];
}

export class OahuSession {
  private saveTimer = 0;

  private constructor(
    readonly dump: Dump,
    readonly messages: OahuMessages,
  ) {}

  static async open(dump: Dump): Promise<OahuSession> {
    const s = new OahuSession(dump, await OahuMessages.load(dump));
    const saved = await idbGet<Saved>(EDITS_KEY).catch(() => undefined);
    if (saved?.messages) s.messages.texts.restore(saved.messages);
    return s;
  }

  /** The same edits on the dump with its Update applied. */
  async withUpdate(update: UpdateImage): Promise<OahuSession> {
    this.saveNow();
    const dump = withUpdate(this.dump, update);
    const next = new OahuSession(dump, await OahuMessages.load(dump));
    next.messages.texts.restore(this.messages.texts.saved());
    return next;
  }

  readonly scheduleSave = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  };

  saveNow(): void {
    clearTimeout(this.saveTimer);
    idbSet(EDITS_KEY, { messages: this.messages.texts.saved() } satisfies Saved).catch(() => {});
  }

  /** Whether a MOD can be exported: the edits must go on the Update's files (else its fixes would be lost). */
  get canExport(): boolean {
    return !!this.dump.update;
  }

  /** RomFS files of the MOD (root name -> bytes). */
  modFiles(): Map<string, Uint8Array> {
    if (!this.canExport) throw new Error('書き出しには Update の CIA が要ります');
    return this.messages.changedArchives();
  }

  /** The LayeredFS zip: 00040000000EF000/romfs/…. */
  modZip(): Uint8Array {
    return buildModZip(new Map([...this.modFiles()].map(([name, b]) => [`romfs/${name}`, b])), OAHU.titleId);
  }
}
