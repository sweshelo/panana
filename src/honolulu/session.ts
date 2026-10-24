// One opened 電波人間のRPG (honolulu, the first game) dump: its master read through the field definitions
// (master.ts, tables.ts) and the messages of every archive (messages.ts; the master's names come from them).
// The pages come one by one (#153-#157, naauao honolulu/). The edits are not saved yet.
import type { Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';
import { HonoluluMaster } from './master';
import { HonoluluMessages } from './messages';

export class HonoluluSession {
  private constructor(
    readonly dump: Dump,
    readonly master: HonoluluMaster,
    readonly messages: HonoluluMessages,
  ) {}

  /** Opens the dump; refuses one whose master is not the first game's (a version 5 GS archive). */
  static async open(dump: Dump): Promise<HonoluluSession> {
    if (dump.title !== HONOLULU) throw new Error(`『${dump.title.name}』のダンプです`);
    const messages = await HonoluluMessages.load(dump);
    const master = await HonoluluMaster.load(dump, messages.texts);
    const { version } = master.archive;
    if (version !== 5) throw new Error(`master (${HONOLULU.master}) のアーカイブが version ${version} です (初代は 5)`);
    return new HonoluluSession(dump, master, messages);
  }

  /** The other sessions keep their edits here; this one has none yet. */
  saveNow(): void {}
}
