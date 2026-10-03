// The messages of 電波人間のRPG3 (oahu): every GMSG of the root archives that hold them, in one store
// (naauao oahu/analysis.md §5). IDs are one range over the files (10000 apart), so one store edits them all; the
// four copies of MessageCommand_JP get the same edits (MessageStore.rebuilt).
import { parseArchive, rebuildArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { Gmsg, MessageStore, type MessageFile } from '../game/gmsg';
import { OAHU_SYNTAX } from '../game/msgtext';
import type { Dump } from '../rom/dump';

/** Root archives with GMSG entries (the master first: the game registers it at boot). */
export const OAHU_MESSAGE_ARCHIVES = ['21350000', 'A9DF0000', '6E380000', '00910000', '3B630000', '58190000', '619D0000', '838B0000', 'D94C0000', '91470000'];

/**
 * New messages (copied items) go past the last ID of MessageSystemCommon_JP (0–8657; the next file starts at 30000).
 * The game looks an ID up by the ranges of the files' headers (RPG2's FUN_00310438; same engine, not checked in RPG3).
 */
export const OAHU_NEW_MESSAGE_FILE = 'MessageSystemCommon_JP.gsmb';

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
    return new OahuMessages(new MessageStore(files, OAHU_SYNTAX, OAHU_NEW_MESSAGE_FILE), archives);
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

  /** The entries that hold an edited message, rebuilt: archive name -> entry index -> bytes. */
  changedEntries(): Map<string, Map<number, Uint8Array>> {
    const out = new Map<string, Map<number, Uint8Array>>();
    for (const [f, bytes] of this.texts.rebuilt()) {
      const name = f.archive!;
      if (!out.has(name)) out.set(name, new Map());
      out.get(name)!.set(f.entryIndex, bytes);
    }
    return out;
  }

  /**
   * The archives that hold an edited message, rebuilt (name -> bytes); every other entry is copied as it is. `more`
   * adds entries changed by others (the master's tables, the shops), by archive name; `sources` are the parsed
   * archives of those the messages do not hold.
   */
  changedArchives(more: Map<string, Map<number, Uint8Array>> = new Map(), sources: Map<string, Archive> = new Map()): Map<string, Uint8Array> {
    const all = this.changedEntries();
    for (const [name, repl] of more) if (repl.size) all.set(name, new Map([...(all.get(name) ?? []), ...repl]));
    return new Map([...all].map(([name, repl]) => [name, rebuildArchive((this.archives.get(name) ?? sources.get(name))!, repl)]));
  }
}
