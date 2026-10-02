// What the RomFS viewer knows about one game: names of root files and the meaning of the entry types. Each game has
// its own profile (kahara.ts, oahu.ts); the viewer itself is shared.
import type { TableDef } from '../game/tabledef';
import type { TitleDef } from '../rom/titles';

export interface RomfsProfile {
  title: TitleDef;
  /** Version at +0x00 of the game's root archives (5 = RPG2, 7 = RPG3). */
  archiveVersion: number;
  /** Root files the game is known to use for something (upper-case name -> what it holds). */
  files: Record<string, string>;
  /** Entry types of the root archives (type -> what entries of that type hold). */
  entryTypes: Record<number, string>;
  /** Field definitions of the GS tables (file name -> fields): the viewer names the columns with them. */
  tables?: Record<string, TableDef>;
}

export const fileNote = (p: RomfsProfile, path: string): string | undefined => p.files[path.toUpperCase()];

export const entryTypeLabel = (p: RomfsProfile, type: number): string => p.entryTypes[type] ?? `種類 ${type}`;
