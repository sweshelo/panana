// The messages of 初代 (honolulu): its tag numbers (HONOLULU_SYNTAX, naauao honolulu/analysis.md §6), the store over
// every archive that holds GMSG (honolulu/messages.ts) and the message page. The tests with the ROM read
// roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';
import { Gmsg } from '../src/game/gmsg';
import { HONOLULU_SYNTAX, KAHARA_SYNTAX, parseBody, previewText, textToUnits, unitsToText } from '../src/game/msgtext';
import { HonoluluMessagePage } from '../src/honolulu/MessagePage';
import { HonoluluSession } from '../src/honolulu/session';
import { openImage } from '../src/rom/dump';
import { MessagePreview } from '../src/ui/message';
import { hasHonolulu, HONOLULU_BASE } from './env';

const units = (...parts: (string | number[])[]): Uint16Array =>
  Uint16Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('初代の tags (no ROM)', () => {
  // 「{10D}ここは{ref 90}、{良|よ}く{page}⏎…」: a voice, an inserted message, ruby and a page break
  const m = units([5, 1, 0x10d], 'ここは', [2, 0x24, 90, 0], '、', [1, 0x25], '良', [1, 0x26], 'よ', [1, 0x27], 'く', [1, 0x0e, 0x0a], 'まあ', [2, 0x28, 20, 0], [1, 0x104, 1, 0x105, 1, 0x10], [0]);

  test('ruby 0x25-0x27, the inserted message 0x0002 0x0024, page break 0x0E', () => {
    expect(parseBody(m, HONOLULU_SYNTAX).tokens.map((t) => t.t)).toEqual(['tag', 'text', 'ref', 'text', 'ruby', 'text', 'tag', 'br', 'text', 'call', 'tag', 'tag', 'tag']);
    const t = unitsToText(m, HONOLULU_SYNTAX);
    expect(t.kind).toBe(5);
    expect(t.text).toBe('{tag:010D}ここは{msg:005A}、{ruby:良|よ}く{page}\nまあ{call:0028,0014}{tag:0104}{tag:0105}{tag:0010}');
    expect([...textToUnits(t, HONOLULU_SYNTAX)]).toEqual([...m]);
  });

  test('the preview: the page break eats its line break, names and numbers as 〈…〉, the voice and the call are not drawn', () => {
    expect(previewText(m, (id) => (id === 90 ? 'デンパ島' : undefined), 0, HONOLULU_SYNTAX)).toBe('ここはデンパ島、良く\nまあ〈モンスター〉〈A〜Z〉〈数値〉');
    const html = renderToString(<MessagePreview texts={{ syntax: HONOLULU_SYNTAX, units: () => undefined } as never} units={m} />);
    expect(html).toContain('<ruby>良<rp>(</rp><rt>よ</rt>');
    expect(html).toContain('声: です調 (精霊など)');
    expect(html).toContain('制御 0028 (未解析)');
    expect(html).toContain('▼');
  });

  test('RPG2 reads the same units as before (0x0002 0x0028 is not a call there)', () => {
    expect(parseBody(m, KAHARA_SYNTAX).tokens.some((t) => t.t === 'call' || t.t === 'ruby' || t.t === 'ref')).toBe(false);
    expect([...textToUnits(unitsToText(m, KAHARA_SYNTAX), KAHARA_SYNTAX)]).toEqual([...m]);
    expect(() => textToUnits({ kind: 1, text: '{call:0028}', tail: new Uint16Array() }, HONOLULU_SYNTAX)).toThrow('2 つの値');
  });
});

describe.skipIf(!hasHonolulu)('初代の messages (ROM)', () => {
  let session: HonoluluSession;
  beforeAll(async () => {
    session = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
  });

  test('one store over the archives (analysis.md §6), the copy of MessageEventIntro2 left out of the list', () => {
    const { messages } = session;
    expect(messages.files.map((f) => [f.name, f.archive, f.gmsg.first, f.gmsg.last])).toEqual([
      ['MessageSystemCommon_JP.gsmb', '56562135', 0, 2468],
      ['MessageBattle_JP.gsmb', '56562135', 2471, 2896],
      ['MessageField_JP.gsmb', '56562135', 2897, 3299],
      ['MessageEventIntro2_JP.gsmb', '56562135', 3305, 3323],
      ['MessageIslandEvent_JP.gsmb', '56562135', 3324, 3338],
      ['エントリ 2', '0901BA07', 3300, 3304],
      ['MessageEvent_JP.gsmb', '1D37838B', 3339, 3347],
      ['MessageNagomi_JP.gsmb', '6F896E38', 3348, 4599],
      ['MessageAntenna_JP.gsmb', '90EACC05', 4600, 5087],
      ['MessageCommand_JP.gsmb', '91B0619D', 5088, 5268],
      ['MessageStaffroll_JP.gsmb', 'FBADD94C', 5269, 5360],
    ]);
    expect(messages.texts.files.every((f) => f.editable)).toBe(true);
    expect(messages.texts.readings.length).toBe(9);
  });

  test('every message: lossless text form, no unknown control, the whole body read', () => {
    const { texts } = session.messages;
    let n = 0;
    for (const f of session.messages.files)
      for (let id = f.gmsg.first; id <= f.gmsg.last; id++, n++) {
        const u = texts.units(id)!;
        expect([...textToUnits(texts.text(id)!, HONOLULU_SYNTAX)]).toEqual([...u]);
        const { tokens, end } = parseBody(u, HONOLULU_SYNTAX);
        expect(tokens.filter((t) => t.t === 'raw')).toEqual([]);
        // only the test message 2437 has tags not known; 2916 has a line break in a ruby's base (its tags stay tags)
        if (id !== 2437) expect(tokens.filter((t) => t.t === 'tag' && HONOLULU_SYNTAX.kind(t.x) === 'other' && !HONOLULU_SYNTAX.ruby.includes(t.x)).map((t) => [id, t])).toEqual([]);
        expect(u.subarray(end).every((c) => c === 0)).toBe(true);
      }
    expect(n).toBe(5359);
  });

  test('kind 0 bodies are not empty; ruby and names in the previews (the names of the master too)', () => {
    const { texts } = session.messages;
    expect([texts.text(551)!.kind, texts.preview(551)]).toEqual([0, 'きばコウモリ']);
    expect(texts.preview(2478)).toBe('〈モンスター〉〈A〜Z〉の攻撃！');
    expect(texts.preview(3295)).toContain('「ちかいのあかし」を得たのですね。');
    expect(texts.preview(3295)).toContain('良くがんばりました。');
    expect(texts.text(140)!.text).toBe('{tag:010C}{tag:0106}を{tag:0008}{ruby:個|こ}\nまいどあり。');
    expect(session.master.message(661)).toBe('キズぐすり');
    // a dungeon name with ruby: the base only (it was "%…&…'" with RPG2's numbers)
    expect(session.master.message(48)).not.toMatch(/[%&']/);
  });

  test('an edit of MessageEventIntro2 goes to both copies; the archives come back as they were otherwise', () => {
    const { messages } = session;
    const { texts } = messages;
    const before = texts.text(3305)!.text;
    texts.setText(3305, `${before}！`);
    try {
      const changed = messages.changedArchives();
      expect([...changed.keys()].sort()).toEqual(['56562135', '90EACC05']);
      for (const bytes of changed.values()) {
        const arc = parseArchive(bytes);
        const files = arc.entries.filter((e) => e.type === 6).map((e) => new Gmsg(unpackEntry(arc, e).body)).filter((g) => g.has(3305));
        expect(files.map((g) => g.reading || unitsToText(g.units(3305)!, HONOLULU_SYNTAX).text.endsWith('！'))).toEqual([true, true]);
      }
      expect(session.master.message(3305)).toEndWith('！');
    } finally {
      texts.revert(3305);
    }
    expect(messages.changedArchives().size).toBe(0);
  });

  test('the page: the list, the file filter and the selected message with ruby and its kind', () => {
    const html = renderToString(<HonoluluMessagePage session={session} arg="0x227" />);
    expect(html).toContain('メッセージ 551');
    expect(html).toContain('MessageSystemCommon_JP.gsmb (56562135)');
    expect(html).toContain('きばコウモリ');
    expect(html).toContain('5359 / 5359 件');
    expect(html).toContain('MessageNagomi (3348〜)');
    // the unnamed file of 0901BA07 is its own choice
    expect(html).toContain('エントリ 2 (3300〜)');
    const talk = renderToString(<HonoluluMessagePage session={session} arg="140" />);
    expect(talk).toContain('<ruby>個<rp>(</rp><rt>こ</rt>');
    expect(talk).toContain('声: 片言 (店員など)');
    expect(talk).toContain('〈アイテム〉');
  });
});
