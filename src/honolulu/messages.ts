// The messages of 電波人間のRPG (初代, honolulu): every GMSG of the root archives that hold them, in one store (naauao
// honolulu/analysis.md §6). The IDs are one range over the files (0〜5360), with RPG2's form of the text and the tags
// 2 lower (HONOLULU_SYNTAX). MessageEventIntro2_JP is in the master and in 90EACC05: both copies get the same edits
// (MessageStore.rebuilt). No messages are added: the ranges of the files leave no room between them.
import { ArchiveMessages } from '../game/archivemessages';
import { HONOLULU_SYNTAX } from '../game/msgtext';
import type { Dump } from '../rom/dump';

/**
 * Root archives with GMSG entries, the master first: 56562135 (MessageSystemCommon 0〜, Battle, Field, EventIntro2,
 * IslandEvent), 0901BA07 (the opening's talk, 3300〜3304, no file name), 1D37838B (MessageEvent), 6F896E38 (MessageNagomi),
 * 90EACC05 (MessageAntenna and a copy of EventIntro2), 91B0619D (MessageCommand), FBADD94C (MessageStaffroll).
 */
export const HONOLULU_MESSAGE_ARCHIVES = ['56562135', '0901BA07', '1D37838B', '6F896E38', '90EACC05', '91B0619D', 'FBADD94C'];

export class HonoluluMessages extends ArchiveMessages {
  static async load(dump: Dump): Promise<HonoluluMessages> {
    return new HonoluluMessages(...(await ArchiveMessages.read(dump, HONOLULU_MESSAGE_ARCHIVES, HONOLULU_SYNTAX, false)));
  }
}
