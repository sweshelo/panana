// The talks of 電波人間のRPG FREE! (the contents' `*_msg` tables, MessageContents; naauao lanai/messages.md): rows of 12
// bytes, +0x00 message, +0x04 voice (a reading for speech synthesis that repeats the text), +0x08 the speaker kind
// (its low byte; the other bytes are the 0xD0 padding of the packed words).
// Eight rows in a row with kinds 1〜8 are the eight tones of one line (the lead 電波人間's line spoken in each
// personality). ScriptMenu.StartMessageAuto (given a row of kind 1) and StartMessageHero add the lead's personality
// 0〜6 + 1 to the given row's physical place (not to its ID): tone = personality + 2, and any other personality gets
// row 1. StartMessage shows the row it is given (ROM: Update code.bin 0x2DEB90).
// The voice is what the speech synthesis (Hitachi RubyTalk Ver2.01.00) reads: a byte string of ASCII and half-width
// katakana (Shift_JIS 0xA1〜0xDF). ' accent, / phrase break, | ; pause, . end, ? question, > voiceless; $page$ for each
// {page}, $message:表:十進 ID:voice$ for an {ins:…}, $hero$ for the hero's name. An empty voice is silent (the game
// never reads the text). Kinds 1〜0x0E pick a voice preset each; 0 and 0x0F〜 keep the one set before (the ROM's NPC
// kinds 0x10〜0x16 have no voice). Every call speaks the row's voice, StartMessage too (Update 0x1E6340, 0x456608).
import { lanaiMarks, parseLanaiMessage } from './message';
import type { LanaiSession, LanaiTableRef } from './session';

export const TALK_ROW = 0x0c;
export const TALK_SPEAKER = 0x08;
/** Tones of one line. */
export const TALK_TONES = 8;

export type TalkKind = 'set' | 'single' | 'npc' | 'none';

export const TALK_KIND_LABEL: Record<TalkKind, string> = {
  set: '性格違いの組',
  single: '性格つき 1 行',
  npc: 'NPC',
  none: '話者なし',
};

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
export function talkColumns(ref: Pick<LanaiTableRef, 'table'>): { message: number; voice: number } | null {
  const t = ref.table;
  if (t.rowSize !== TALK_ROW) return null;
  const message = t.fields.find((f) => f.name === 'message')?.offset;
  const voice = t.fields.find((f) => f.name === 'voice')?.offset ?? -1;
  if (message === undefined || message === TALK_SPEAKER || voice === TALK_SPEAKER) return null;
  return { message, voice };
}

export const isTalkTable = (ref: LanaiTableRef): boolean => !!talkColumns(ref);

/** The speaker kind of a row (+0x08, the low byte: the word is 0xD0D0D0xx). */
export const talkSpeaker = (ref: LanaiTableRef, row: number): number => ref.table.u8(row, TALK_SPEAKER);

const kindOf = (speaker: number): TalkKind => (speaker === 0 ? 'none' : speaker <= TALK_TONES ? 'single' : 'npc');

/** The lines of a talk table: the sets of 8 tones (kinds 1〜8 in a row), the other rows one by one. */
export function talkGroups(ref: LanaiTableRef): TalkGroup[] {
  const t = ref.table;
  const out: TalkGroup[] = [];
  const key = (row: number): string => `${ref.archive}:${ref.entry.toString(16).toUpperCase().padStart(8, '0')}:${row}`;
  for (let r = 0; r < t.rows;) {
    if (
      r + TALK_TONES <= t.rows &&
      Array.from({ length: TALK_TONES }, (_, k) => talkSpeaker(ref, r + k) === k + 1).every(Boolean)
    ) {
      out.push({ ref, rows: Array.from({ length: TALK_TONES }, (_, k) => r + k), kind: 'set', key: key(r) });
      r += TALK_TONES;
      continue;
    }
    out.push({ ref, rows: [r], kind: kindOf(talkSpeaker(ref, r)), key: key(r) });
    r++;
  }
  return out;
}

/** The personalities of the tones 2〜8 (the 電波人間's personality 0〜6, its +0x77). */
export const TONE_PERSONALITY = ['ノーマル', 'クール', 'あらくれ', 'こども', 'オネエ', 'いばり', 'やさぐれ'];

/** "口調 3 (クール)": the tone of a speaker kind 1〜8 (tone = personality + 2; 1 the hero's). */
export function toneLabel(speaker: number): string {
  if (speaker === 1) return '口調 1 (主人公専用)';
  if (speaker >= 2 && speaker <= TALK_TONES) return `口調 ${speaker} (${TONE_PERSONALITY[speaker - 2]})`;
  return speaker ? `話者 0x${speaker.toString(16).toUpperCase()}` : '話者なし';
}

/** The speaker kinds a single row can take, named by how the ROM uses them (talk.ts; 0x0A〜 are assumed). */
export const SPEAKERS: [number, string][] = [
  [0, '0 話者なし (地の文・看板・システム)'],
  ...Array.from({ length: TALK_TONES }, (_, k): [number, string] => [k + 1, `${k + 1} ${toneLabel(k + 1)} の声`]),
  [0x0a, '0x0A 固有キャラ (あかり) の声'],
  [0x0b, '0x0B 固有キャラ (子供 1) の声'],
  [0x0c, '0x0C 固有キャラ (子供 2) の声'],
  [0x0d, '0x0D 固有キャラの声 (ROM では未使用)'],
  [0x0e, '0x0E 固有キャラ (女性冒険者) の声'],
  [0x0f, '0x0F 店員・敬語 (声は直前の設定のまま)'],
  [0x10, '0x10 店員・窓口'],
  [0x11, '0x11 店員・窓口'],
  [0x12, '0x12 一般の NPC (ROM で最多)'],
  [0x13, '0x13 女性の NPC'],
  [0x14, '0x14 男性の NPC'],
  [0x15, '0x15 地底人'],
  [0x16, '0x16 敵・ボス'],
];

/** Whether the rows of a set put {ins:…} and {page} in different places (a tone that lost or moved one). */
export function marksDiffer(session: LanaiSession, g: TalkGroup): boolean {
  const cols = talkColumns(g.ref);
  if (!cols || g.rows.length < 2) return false;
  const t = g.ref.table;
  const marks = g.rows.map((r) =>
    t.isString(r, cols.message) ? lanaiMarks(parseLanaiMessage(t.data, t.u32(r, cols.message)).tokens).join('') : '',
  );
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
  return g.rows.map((r) =>
    g.ref.table.isString(r, cols.message) ? session.plainAt(g.ref.table, g.ref.table.u32(r, cols.message)) : '',
  );
}

/** A row's voice as text: half-width katakana and ASCII, any other byte as \xNN ('' when there is none). */
export function talkVoice(ref: Pick<LanaiTableRef, 'table'>, row: number): string {
  const cols = talkColumns(ref);
  const t = ref.table;
  if (!cols || cols.voice < 0 || !t.isString(row, cols.voice)) return '';
  let out = '';
  for (let p = t.u32(row, cols.voice); p < t.data.length && t.data[p] !== 0; p++) {
    const b = t.data[p]!;
    out +=
      b >= 0xa1 && b <= 0xdf
        ? String.fromCharCode(0xff61 + b - 0xa1)
        : b === 0x0a || (b >= 0x20 && b < 0x7f)
          ? String.fromCharCode(b)
          : `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

const FULL_KANA =
  'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲンヴ';
const HALF_KANA = 'ｧｱｨｲｩｳｪｴｫｵｶｶﾞｷｷﾞｸｸﾞｹｹﾞｺｺﾞｻｻﾞｼｼﾞｽｽﾞｾｾﾞｿｿﾞﾀﾀﾞﾁﾁﾞｯﾂﾂﾞﾃﾃﾞﾄﾄﾞﾅﾆﾇﾈﾉﾊﾊﾞﾊﾟﾋﾋﾞﾋﾟﾌﾌﾞﾌﾟﾍﾍﾞﾍﾟﾎﾎﾞﾎﾟﾏﾐﾑﾒﾓｬﾔｭﾕｮﾖﾗﾘﾙﾚﾛﾜｦﾝｳﾞ';
const KANA = new Map<string, string>([
  ...[...FULL_KANA].map((c, k): [string, string] => [c, HALF_KANA.match(/.[ﾞﾟ]?/gu)![k]!]),
  ['ー', 'ｰ'],
  ['〜', 'ｰ'],
  ['。', '.'],
  ['！', '.'],
  ['？', '?'],
  ['、', '/'],
  ['　', ' '],
]);

/**
 * Hiragana and full-width katakana (and 。、！？ー) as the half-width letters a voice is written in, a sound mark a
 * letter of its own. Kanji stay: their reading is the author's to write.
 */
export function toVoiceKana(text: string): string {
  return [...text]
    .map((c) => {
      const code = c.charCodeAt(0);
      const kata = code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : c;
      return KANA.get(kata) ?? kata;
    })
    .join('');
}

/**
 * A first draft of the voice of a text (the text form of message.ts): ruby as its reading, {page} as $page$, an
 * {ins:…} as the inserted row's voice, the hero's name tag as $hero$, kana as half-width. Kanji without ruby, accents and
 * pauses are the author's to write (the ROM's voices are written by hand: the game never makes one).
 */
export function voiceDraft(text: string): string {
  const said = text
    .replace(/\{ruby:[^|}]*\|([^}]*)\}/gu, '$1')
    .replace(/\{page\}/gu, '$$page$$')
    .replace(
      /\{ins:([^:}]+):(0x[0-9A-Fa-f]+|\d+):[^}]*\}/gu,
      (_, table: string, id: string) => `$message:${table}:${Number(id) >>> 0}:voice$`,
    )
    .replace(/\{tag:10C\}/giu, '$$hero$$')
    .replace(/\{[^}]*\}/gu, '')
    .replace(/\s+/gu, '');
  return toVoiceKana(said);
}

/** A voice's text as the bytes of its field (with the terminator); throws on a letter a voice cannot have. */
export function encodeTalkVoice(text: string): Uint8Array {
  const out: number[] = [];
  for (const c of text.replace(/\r\n?/gu, '\n')) {
    const code = c.charCodeAt(0);
    if (code >= 0xff61 && code <= 0xff9f) out.push(code - 0xff61 + 0xa1);
    else if (code === 0x0a || (code >= 0x20 && code < 0x7f)) out.push(code);
    else throw new Error(`「${c}」は読みに書けません (書けるのは半角カナと半角の英数字・記号)`);
  }
  out.push(0);
  // the strings of the pool start on an even byte
  if (out.length % 2) out.push(0);
  return new Uint8Array(out);
}

/** Writes a row's voice ('' makes it silent). */
export function setTalkVoice(ref: Pick<LanaiTableRef, 'table'>, row: number, text: string): void {
  const cols = talkColumns(ref);
  if (!cols || cols.voice < 0) throw new Error(`${ref.table.name} には読み (voice) の欄がありません`);
  ref.table.setString(row, cols.voice, encodeTalkVoice(text));
}

/** What a voice has wrong for its text (the text form of message.ts): '' when nothing. */
export function voiceProblem(message: string, voice: string): string {
  if (!voice) return '';
  const pages = (message.match(/\{page\}/gu) ?? []).length;
  const said = (voice.match(/\$page\$/gu) ?? []).length;
  if (pages !== said) return `本文の改ページ {page} が ${pages} 個、読みの $page$ が ${said} 個です (同じ数にします)`;
  if (/[^\x20-\x7e\n｡-ﾟ]/u.test(voice)) return '読みに書けない文字があります (半角カナに直してください)';
  return '';
}
