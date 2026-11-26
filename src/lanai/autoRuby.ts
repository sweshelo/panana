// Ruby on every kanji of a Lanai string ({ruby:親字|よみ}), from the readings of a morphological analyser
// (rubyTokenizer.ts: lindera's IPADIC). Only the plain text is read; ruby, inserted strings, tags and line breaks stay.
import { lanaiText, parseLanaiText, type LanaiToken } from './message';

/** A word of the analyser: its surface and its reading in katakana (undefined or '*' when unknown). */
export interface Morpheme {
  surface: string;
  reading?: string;
}

export type RubyTokenizer = (text: string) => Morpheme[];

const KANJI = /[\p{Script=Han}々〆ヵヶ]/u;
const KANJI_RUN = /([\p{Script=Han}々〆ヵヶ]+)/u;
const KANA_READING = /^[\p{Script=Hiragana}ー]+$/u;

/** Katakana to hiragana (ァ..ヶ); other characters as they are. */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * One word as tokens: each run of kanji with its part of the reading, the kana around it as text (お話し → お
 * {ruby:話|はな} し). When the kana of the surface do not line up with the reading (今日, 一人), the whole word gets one
 * ruby. A word without kanji, or without a reading in kana, is left as text.
 */
export function rubyWord(surface: string, reading: string | undefined): LanaiToken[] {
  const yomi = reading && reading !== '*' ? toHiragana(reading) : '';
  if (!KANJI.test(surface) || !KANA_READING.test(yomi)) return [{ t: 'text', s: surface }];
  const parts = surface.split(KANJI_RUN).filter((p) => p !== '');
  const pattern = parts
    .map((p) => (KANJI.test(p) ? '(.+?)' : toHiragana(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const m = new RegExp(`^${pattern}$`, 'u').exec(yomi);
  if (!m) return [{ t: 'ruby', base: surface, reading: yomi }];
  let g = 1;
  return parts.map((p) => (KANJI.test(p) ? { t: 'ruby', base: p, reading: m[g++]! } : { t: 'text', s: p }));
}

/** `text` (lanaiText's form) with ruby on every kanji of its plain text. */
export function autoRuby(text: string, tokenize: RubyTokenizer): string {
  const out: LanaiToken[] = [];
  for (const t of parseLanaiText(text)) {
    if (t.t !== 'text' || !KANJI.test(t.s)) {
      out.push(t);
      continue;
    }
    const words = tokenize(t.s);
    // a word the analyser dropped (e.g. spaces) would be lost: leave such a run as it is
    if (words.map((w) => w.surface).join('') !== t.s) out.push(t);
    else for (const w of words) out.push(...rubyWord(w.surface, w.reading));
  }
  return lanaiText(out);
}
