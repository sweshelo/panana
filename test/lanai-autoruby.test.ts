import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { autoRuby, rubyWord, toHiragana, type Morpheme, type RubyTokenizer } from '../src/lanai/autoRuby';
import { encodeLanaiMessage, parseLanaiText } from '../src/lanai/message';
import { rubyTokenizerOf } from '../src/lanai/rubyTokenizer';

/** A tokenizer over a fixed word list (longest match; anything else one character without a reading). */
function fake(words: Record<string, string>): RubyTokenizer {
  const keys = Object.keys(words).sort((a, b) => b.length - a.length);
  return (s) => {
    const out: Morpheme[] = [];
    for (let i = 0; i < s.length;) {
      const k = keys.find((w) => s.startsWith(w, i));
      if (k) {
        out.push({ surface: k, reading: words[k] });
        i += k.length;
      } else {
        out.push({ surface: s[i]!, reading: '*' });
        i++;
      }
    }
    return out;
  };
}

describe('rubyWord', () => {
  test('okurigana are split off each run of kanji', () => {
    expect(rubyWord('お話し', 'オハナシ')).toEqual([
      { t: 'text', s: 'お' },
      { t: 'ruby', base: '話', reading: 'はな' },
      { t: 'text', s: 'し' },
    ]);
    expect(rubyWord('食べる', 'タベル')).toEqual([
      { t: 'ruby', base: '食', reading: 'た' },
      { t: 'text', s: 'べる' },
    ]);
  });
  test('a word whose kana do not line up gets one ruby', () => {
    expect(rubyWord('今日', 'キョウ')).toEqual([{ t: 'ruby', base: '今日', reading: 'きょう' }]);
  });
  test('words without kanji or a kana reading stay text', () => {
    expect(rubyWord('アンテナ', 'アンテナ')).toEqual([{ t: 'text', s: 'アンテナ' }]);
    expect(rubyWord('々', '々')).toEqual([{ t: 'text', s: '々' }]);
    expect(rubyWord('謎', '*')).toEqual([{ t: 'text', s: '謎' }]);
    expect(rubyWord('謎', undefined)).toEqual([{ t: 'text', s: '謎' }]);
  });
  test('toHiragana', () => expect(toHiragana('ヴァカヶ-ー')).toBe('ゔぁかゖ-ー'));
});

describe('autoRuby', () => {
  const tok = fake({ 今日: 'キョウ', は: 'ハ', 東京: 'トウキョウ', 行き: 'イキ', 電波: 'デンパ', 人間: 'ニンゲン' });
  test('ruby on the kanji of the plain text; ruby, tags, inserts and lines stay', () => {
    const src = '{ruby:今日|こんにち}は東京\n{page}{ins:ItemData:0x800000C7:name}電波人間{tag:100}';
    const out = autoRuby(src, tok);
    expect(out).toBe(
      '{ruby:今日|こんにち}は{ruby:東京|とうきょう}\n{page}{ins:ItemData:0x800000C7:name}{ruby:電波|でんぱ}{ruby:人間|にんげん}{tag:100}',
    );
    expect(() => encodeLanaiMessage(parseLanaiText(out))).not.toThrow();
  });
  test('kana only text is unchanged, and so is running it twice', () => {
    expect(autoRuby('こんにちは！', tok)).toBe('こんにちは！');
    const once = autoRuby('今日は東京', tok);
    expect(autoRuby(once, tok)).toBe(once);
  });
  test('a run the tokenizer does not give back whole is left alone', () => {
    expect(autoRuby('東京 行き', () => [{ surface: '東京', reading: 'トウキョウ' }])).toBe('東京 行き');
  });
});

const pkg = 'node_modules/lindera-wasm-web-ipadic/';
describe.skipIf(!existsSync(`${pkg}lindera_wasm_bg.wasm`))('autoRuby with IPADIC', () => {
  test('a line of dialogue', async () => {
    const m = await import(`../${pkg}lindera_wasm.js`);
    m.initSync({ module: readFileSync(`${pkg}lindera_wasm_bg.wasm`) });
    const tok = rubyTokenizerOf(m);
    expect(autoRuby('今日は東京へ行きます。お話しを聞かせて！\nアンテナ 電波人間', tok)).toBe(
      '{ruby:今日|きょう}は{ruby:東京|とうきょう}へ{ruby:行|い}きます。お{ruby:話|はな}しを{ruby:聞|き}かせて！\nアンテナ {ruby:電波|でんぱ}{ruby:人間|にんげん}',
    );
  });
});
