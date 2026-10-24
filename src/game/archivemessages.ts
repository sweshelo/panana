// The messages of a game whose GMSG files are spread over several root archives (RPG3, 初代): one MessageStore over
// every file, and the archives rebuilt with the edited files. Each game gives its archives, its syntax and where new
// messages go (oahu/messages.ts, honolulu/messages.ts).
import { parseArchive, rebuildArchive, unpackEntry, type Archive } from '../archive/gsarc';
import type { Dump } from '../rom/dump';
import { Gmsg, MessageStore, type MessageFile } from './gmsg';
import type { MessageSyntax } from './msgtext';

export class ArchiveMessages {
  protected constructor(
    readonly texts: MessageStore,
    /** The parsed archives the files come from (name -> archive). */
    readonly archives: Map<string, Archive>,
  ) {}

  /** The type 6 (GMSG) entries of the archives that are in the dump, in the order given. */
  protected static async read(dump: Dump, names: readonly string[], syntax: MessageSyntax, canAddMessages: boolean | string): Promise<[MessageStore, Map<string, Archive>]> {
    const archives = new Map<string, Archive>();
    const files: MessageFile[] = [];
    const have = new Set(dump.names());
    for (const name of names) {
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
    return [new MessageStore(files, syntax, canAddMessages), archives];
  }

  /** The text files, one per name and range (the copies of a file in other archives left out). */
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
