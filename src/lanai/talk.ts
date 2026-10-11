// The talks of 電波人間のRPG FREE! (the contents' `*_msg` tables, MessageContents; naauao lanai/messages.md): rows of 12
// bytes, +0x00 message, +0x04 voice (a reading for speech synthesis that repeats the text), +0x08 the speaker kind.
// Eight rows in a row with kinds 1〜8 are the eight tones of one line (the player's own line spoken in each
// personality); tone = personality + 2 is assumed (1 is the hero's only). How the game picks a row of the set, which
// personality value goes with which tone and what kinds 0x09〜0x16 mean are not known yet (assumed: other speakers, NPC).
import { lanaiMarks, parseLanaiMessage } from './message';
import type { LanaiSession, LanaiTableRef } from './session';

export const TALK_ROW = 0x0c;
export const TALK_SPEAKER = 0x08;
/** Tones of one line. */
export const TALK_TONES = 8;

export type TalkKind = 'set' | 'single' | 'npc' | 'none';

export const TALK_KIND_LABEL: Record<TalkKind, string> = { set: '性格違いの組', single: '性格つき 1 行', npc: 'NPC', none: '話者なし' };

/** One line: the 8 rows of a set of tones, or one row. */
export interface TalkGroup {
  ref: LanaiTableRef;
  /** The rows (8 for a set, else 1). */
  rows: number[];
  kind: TalkKind;
  /** "archive:entry:first row" (for the URL and the list). */
  key: string;
}

/** Offsets of the message and voice columns of a talk table, or null when the table is not one. */
export function talkColumns(ref: LanaiTableRef): { message: number; voice: number } | null {
  const t = ref.table;
  if (t.rowSize !== TALK_ROW) return null;
  const message = t.fields.find((f) => f.name === 'message')?.offset;
  const voice = t.fields.find((f) => f.name === 'voice')?.offset ?? -1;
  if (message === undefined || message === TALK_SPEAKER || voice === TALK_SPEAKER) return null;
  return { message, voice };
}

export const isTalkTable = (ref: LanaiTableRef): boolean => !!talkColumns(ref);

/** The speaker kind of a row (+0x08). */
export const talkSpeaker = (ref: LanaiTableRef, row: number): number => ref.table.u32(row, TALK_SPEAKER);

const kindOf = (speaker: number): TalkKind => (speaker === 0 ? 'none' : speaker <= TALK_TONES ? 'single' : 'npc');

/** The lines of a talk table: the sets of 8 tones (kinds 1〜8 in a row), the other rows one by one. */
export function talkGroups(ref: LanaiTableRef): TalkGroup[] {
  const t = ref.table;
  const out: TalkGroup[] = [];
  const key = (row: number): string => `${ref.archive}:${ref.entry.toString(16).toUpperCase().padStart(8, '0')}:${row}`;
  for (let r = 0; r < t.rows;) {
    if (r + TALK_TONES <= t.rows && Array.from({ length: TALK_TONES }, (_, k) => talkSpeaker(ref, r + k) === k + 1).every(Boolean)) {
      out.push({ ref, rows: Array.from({ length: TALK_TONES }, (_, k) => r + k), kind: 'set', key: key(r) });
      r += TALK_TONES;
      continue;
    }
    out.push({ ref, rows: [r], kind: kindOf(talkSpeaker(ref, r)), key: key(r) });
    r++;
  }
  return out;
}

/** "口調 3 (性格 1)": the tone of a speaker kind 1〜8 (assumed: tone = personality + 2, 1 the hero's). */
export function toneLabel(speaker: number): string {
  if (speaker === 1) return '口調 1 (主人公専用)';
  if (speaker >= 2 && speaker <= TALK_TONES) return `口調 ${speaker} (性格 ${speaker - 2})`;
  return speaker ? `話者 0x${speaker.toString(16).toUpperCase()}` : '話者なし';
}

/** Whether the rows of a set put {ins:…} and {page} in different places (a tone that lost or moved one). */
export function marksDiffer(session: LanaiSession, g: TalkGroup): boolean {
  const cols = talkColumns(g.ref);
  if (!cols || g.rows.length < 2) return false;
  const t = g.ref.table;
  const marks = g.rows.map((r) => (t.isString(r, cols.message) ? lanaiMarks(parseLanaiMessage(t.data, t.u32(r, cols.message)).tokens).join('') : ''));
  return marks.some((m) => m !== marks[0]);
}

/** Whether a row's message was written while it has a voice string (which still reads the text as it was). */
export function voiceStale(g: TalkGroup, row: number): boolean {
  const cols = talkColumns(g.ref);
  if (!cols || cols.voice < 0) return false;
  const t = g.ref.table;
  return t.stringChanged(row, cols.message) && t.isString(row, cols.voice) && t.data[t.u32(row, cols.voice)] !== 0;
}

/** The plain text of every row of a line (for the list and the search). */
export function talkPlain(session: LanaiSession, g: TalkGroup): string[] {
  const cols = talkColumns(g.ref)!;
  return g.rows.map((r) => (g.ref.table.isString(r, cols.message) ? session.plainAt(g.ref.table, g.ref.table.u32(r, cols.message)) : ''));
}
