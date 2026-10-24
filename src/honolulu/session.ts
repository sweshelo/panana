// One opened 電波人間のRPG (honolulu, the first game) dump: its master read through the field definitions
// (master.ts, tables.ts). For now only the RomFS viewer reads it; the pages come later (#153-#157, naauao honolulu/).
// Nothing is edited yet, so nothing is saved.
import type { Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';
import { HonoluluMaster } from './master';

export class HonoluluSession {
  private constructor(
    readonly dump: Dump,
    readonly master: HonoluluMaster,
  ) {}

  /** Opens the dump; refuses one whose master is not the first game's (a version 5 GS archive). */
  static async open(dump: Dump): Promise<HonoluluSession> {
    if (dump.title !== HONOLULU) throw new Error(`『${dump.title.name}』のダンプです`);
    const master = await HonoluluMaster.load(dump);
    const { version } = master.archive;
    if (version !== 5) throw new Error(`master (${HONOLULU.master}) のアーカイブが version ${version} です (初代は 5)`);
    return new HonoluluSession(dump, master);
  }

  /** The other sessions keep their edits here; this one has none yet. */
  saveNow(): void {}
}
