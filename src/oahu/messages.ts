// The messages of 電波人間のRPG3 (oahu): every GMSG of the root archives that hold them, in one store
// (naauao oahu/analysis.md §5). IDs are one range over the files (10000 apart), so one store edits them all; the
// four copies of MessageCommand_JP get the same edits (MessageStore.rebuilt).
import { parseArchive, rebuildArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { Gmsg, MessageStore, type MessageFile } from '../game/gmsg';
import { OAHU_SYNTAX } from '../game/msgtext';
import type { Dump } from '../rom/dump';

/** Root archives with GMSG entries (the master first: the game registers it at boot). */
export const OAHU_MESSAGE_ARCHIVES = ['21350000', 'A9DF0000', '6E380000', '00910000', '3B630000', '58190000', '619D0000', '838B0000', 'D94C0000', '91470000'];

export class OahuMessages {
  private constructor(
    readonly texts: MessageStore,
    /** The parsed archives the files come from (name -> archive). */
    readonly archives: Map<string, Archive>,
  ) {}

  static async load(dump: Dump): Promise<OahuMessages> {
    const archives = new Map<string, Archive>();
    const files: MessageFile[] = [];
    const have = new Set(dump.names());
    for (const name of OAHU_MESSAGE_ARCHIVES) {
      if (!have.has(name)) continue;
      const arc = parseArchive(await dump.readRomfs(name));
      archives.set(name, arc);
      for (const e of arc.entries) {
        if (e.type !== 6) continue;
        const { name: file, body } = unpackEntry(arc, e);
        try {
          const gmsg = new Gmsg(body);
          files.push({ name: file ?? `エントリ ${e.index}`, archive: name, entryIndex: e.index, gmsg, editable: gmsg.roundTrips() });
        } catch {
          /* not a message file */
        }
      }
    }
    return new OahuMessages(new MessageStore(files, OAHU_SYNTAX, false), archives);
  }

  /** The text files, one per name and range (the copies of MessageCommand_JP left out). */
  get files(): MessageFile[] {
    const seen = new Set<string>();
    return this.texts.files.filter((f) => {
      const key = `${f.name}:${f.gmsg.first}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** The archives that hold an edited message, rebuilt (name -> bytes); every other entry is copied as it is. */
  changedArchives(): Map<string, Uint8Array> {
    const byArchive = new Map<string, Map<number, Uint8Array>>();
    for (const [f, bytes] of this.texts.rebuilt()) {
      const name = f.archive!;
      if (!byArchive.has(name)) byArchive.set(name, new Map());
      byArchive.get(name)!.set(f.entryIndex, bytes);
    }
    return new Map([...byArchive].map(([name, repl]) => [name, rebuildArchive(this.archives.get(name)!, repl)]));
  }
}
