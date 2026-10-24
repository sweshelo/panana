// One opened 電波人間のRPG (honolulu, the first game) dump. For now only the RomFS viewer reads it (#150): the tables,
// their fields and the pages come later (#152-#157, naauao honolulu/). Nothing is edited yet, so nothing is saved.
import { parseArchive } from '../archive/gsarc';
import type { Dump } from '../rom/dump';
import { HONOLULU } from '../rom/titles';

export class HonoluluSession {
  private constructor(readonly dump: Dump) {}

  /** Opens the dump; refuses one whose master is not the first game's (a version 5 GS archive). */
  static async open(dump: Dump): Promise<HonoluluSession> {
    if (dump.title !== HONOLULU) throw new Error(`『${dump.title.name}』のダンプです`);
    const master = parseArchive(await dump.readRomfs(HONOLULU.master));
    if (master.version !== 5) throw new Error(`master (${HONOLULU.master}) のアーカイブが version ${master.version} です (初代は 5)`);
    return new HonoluluSession(dump);
  }

  /** The other sessions keep their edits here; this one has none yet. */
  saveNow(): void {}
}
