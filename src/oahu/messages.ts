// The messages of 電波人間のRPG3 (oahu): every GMSG of the root archives that hold them, in one store
// (naauao oahu/analysis.md §5). IDs are one range over the files (10000 apart), so one store edits them all; the
// four copies of MessageCommand_JP get the same edits (MessageStore.rebuilt).
import { ArchiveMessages } from '../game/archivemessages';
import { OAHU_SYNTAX } from '../game/msgtext';
import type { Dump } from '../rom/dump';

/** Root archives with GMSG entries (the master first: the game registers it at boot). */
export const OAHU_MESSAGE_ARCHIVES = ['21350000', 'A9DF0000', '6E380000', '00910000', '3B630000', '58190000', '619D0000', '838B0000', 'D94C0000', '91470000'];

/**
 * New messages (copied items) go past the last ID of MessageSystemCommon_JP (0–8657; the next file starts at 30000).
 * The game looks an ID up by the ranges of the files' headers (RPG2's FUN_00310438; same engine, not checked in RPG3).
 */
export const OAHU_NEW_MESSAGE_FILE = 'MessageSystemCommon_JP.gsmb';

export class OahuMessages extends ArchiveMessages {
  static async load(dump: Dump): Promise<OahuMessages> {
    return new OahuMessages(...(await ArchiveMessages.read(dump, OAHU_MESSAGE_ARCHIVES, OAHU_SYNTAX, OAHU_NEW_MESSAGE_FILE)));
  }
}
