// RPG FREE!'s talks by line (lanai/talk.ts) and the string source of the shared message editor: a small talk table
// (12-byte rows: message, voice, speaker), the sets of 8 tones, the warnings, and writing a tone through the editor's
// source. The counts on the real tables need the decrypted CIAs (test/env.ts) and are skipped without them.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { encodeLanaiMessage, parseLanaiText } from '../src/lanai/message';
import { lanaiMessageSource } from '../src/lanai/MessageSource';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiSession, type LanaiTableRef } from '../src/lanai/session';
import { LanaiTable } from '../src/lanai/table';
import { lanaiAppendTalkRow, lanaiAppendTalkSet, type LanaiMaps } from '../src/lanai/maps';
import { addScriptLine, scriptLineCall } from '../src/lanai/ScriptLineDialog';
import {
  encodeTalkVoice,
  isTalkTable,
  marksDiffer,
  setTalkVoice,
  talkGroups,
  talkPlain,
  talkSpeaker,
  talkVoice,
  toneLabel,
  toVoiceKana,
  voiceDraft,
  voiceProblem,
  voiceStale,
} from '../src/lanai/talk';
import { MessageEditor } from '../src/ui/message';
import { openImages, type Dump } from '../src/rom/dump';
import { align, w32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

/** A talk table: rows of [text, speaker]; every row has a voice string ("\xC0\xDE" + the text in bytes). */
function talkTable(rows: [text: string, speaker: number][]): Uint8Array {
  const pool: number[] = [];
  const put = (bytes: Uint8Array | number[]): number => {
    while (pool.length % 4) pool.push(0);
    const at = 0x40 + pool.length;
    pool.push(...bytes);
    return at;
  };
  const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const name = put(ascii('d01_msg'));
  const fMessage = put(ascii('message'));
  const fVoice = put(ascii('voice'));
  const strings = rows.map(
    ([text]) => [put(encodeLanaiMessage(parseLanaiText(text))), put([0xc0, 0xde, ...ascii('yomi')])] as const,
  );
  while (pool.length % 16) pool.push(0);
  const data = 0x40 + pool.length;
  const ids = align(data + rows.length * 12, 16);
  const names = align(ids + rows.length * 4, 16);
  const reloc = align(names + 16, 16);
  const relocs = [...rows.flatMap((_, r) => [data + r * 12, data + r * 12 + 4]), names, names + 8].sort(
    (a, b) => a - b,
  );
  const b = new Uint8Array(reloc + relocs.length * 4);
  [
    rows.length,
    12,
    0x40,
    pool.length,
    data,
    rows.length * 12,
    ids,
    rows.length * 4,
    names,
    16,
    reloc,
    relocs.length,
    0,
    name - 0x40,
    7,
  ].forEach((v, i) => w32(b, i * 4, v));
  b.set(pool, 0x40);
  rows.forEach(([, speaker], r) => {
    w32(b, data + r * 12, strings[r]![0]);
    w32(b, data + r * 12 + 4, strings[r]![1]);
    w32(b, data + r * 12 + 8, (0xd0d0d000 | speaker) >>> 0); // the speaker in the low byte, the padding above
    w32(b, ids + r * 4, (0x80000000 | r) >>> 0);
  });
  w32(b, names, fMessage);
  w32(b, names + 4, 0);
  w32(b, names + 8, fVoice);
  w32(b, names + 12, 4);
  relocs.forEach((p, i) => w32(b, reloc + i * 4, p));
  return b;
}

const TONES: [string, number][] = Array.from({ length: 8 }, (_, k) => [`こんにちは${k + 1}{page}またね`, k + 1]);

function setup(rows: [string, number][]) {
  const table = new LanaiTable(talkTable(rows));
  const ref: LanaiTableRef = { archive: '1234000A', entry: 0xabcd, index: 0, file: null, table };
  // the parts of a session the talk code reads (strings of the table, edits)
  const session = Object.assign(Object.create(LanaiSession.prototype) as LanaiSession, {
    refOf: (t: LanaiTable) => (t === table ? ref : undefined),
    insert: () => undefined,
  });
  return { table, ref, session };
}

describe('talks by line', () => {
  test('8 rows with speakers 1〜8 are one set; the others are lines of their own', () => {
    const { ref, session } = setup([['ナレーション', 0], ...TONES, ['ひとり', 3], ['村人', 0x0a]]);
    expect(isTalkTable(ref)).toBe(true);
    const gs = talkGroups(ref);
    expect(gs.map((g) => [g.kind, g.rows.length])).toEqual([
      ['none', 1],
      ['set', 8],
      ['single', 1],
      ['npc', 1],
    ]);
    expect(talkPlain(session, gs[1]!)[7]).toBe('こんにちは8またね');
    expect(marksDiffer(session, gs[1]!)).toBe(false);
    expect(toneLabel(1)).toBe('口調 1 (主人公専用)');
    expect(toneLabel(4)).toBe('口調 4 (あらくれ)');
    expect(toneLabel(8)).toBe('口調 8 (やさぐれ)');
  });

  test('a tone that moves {page} is warned about; a written row warns that its voice reads the old text', () => {
    const { table, ref, session } = setup(TONES);
    const g = talkGroups(ref)[0]!;
    const src = lanaiMessageSource(session, table, 0);
    expect(src.text(2)).toBe('こんにちは3{page}またね');
    src.setText(2, 'こんにちは3またね{page}');
    expect(src.text(2)).toBe('こんにちは3またね{page}');
    expect(src.isEdited(2)).toBe(true);
    expect(marksDiffer(session, g)).toBe(true);
    expect(voiceStale(g, 2)).toBe(true);
    expect(voiceStale(g, 3)).toBe(false);
    // the voice string is kept as it was
    expect(table.data[table.u32(2, 4)]).toBe(0xc0);
    expect(() => src.preview(2, '{tag:02,?3}')).toThrow();
    src.revert(2);
    expect(table.changed).toBe(false);
    expect(marksDiffer(session, g)).toBe(false);
  });

  test('the shared editor draws a tone with its title and the edited mark', () => {
    const { table, session } = setup(TONES);
    const src = lanaiMessageSource(session, table, 0);
    src.setText(0, 'やあ');
    const html = renderToString(<MessageEditor texts={src} id={0} apply={(f) => f()} title={<b>{toneLabel(1)}</b>} />);
    expect(html).toContain('口調 1 (主人公専用)');
    expect(html).toContain('やあ');
    expect(html).toContain('変更あり');
    expect(html).toContain('元の文に戻す');
  });
});

describe('voices and new lines', () => {
  test('a voice is written as half-width katakana bytes and read back', () => {
    expect([...encodeTalkVoice("ﾏ'ｯﾃ.")]).toEqual([0xcf, 0x27, 0xaf, 0xc3, 0x2e, 0]);
    // an odd length gets one more 0 (the strings of the pool start on an even byte)
    expect([...encodeTalkVoice('ﾏ')]).toEqual([0xcf, 0]);
    expect(() => encodeTalkVoice('漢字')).toThrow('「漢」');
    const { ref } = setup(TONES);
    expect(talkVoice(ref, 0)).toBe('ﾀﾞyomi');
    setTalkVoice(ref, 0, "ﾖﾛｼ>ｸ/ｵﾈｶﾞｲｼﾏ'ｽ>.$page$");
    expect(talkVoice(ref, 0)).toBe("ﾖﾛｼ>ｸ/ｵﾈｶﾞｲｼﾏ'ｽ>.$page$");
    setTalkVoice(ref, 0, '');
    expect(talkVoice(ref, 0)).toBe('');
  });

  test('kana and a text become a draft of the voice', () => {
    expect(toVoiceKana('がっこう、パーティー！')).toBe('ｶﾞｯｺｳ/ﾊﾟｰﾃｨｰ.');
    expect(toVoiceKana('ヴァ漢')).toBe('ｳﾞｧ漢');
    expect(
      voiceDraft('よろしくお{ruby:願|ねが}いします。{page}{ins:MonsterParameter:0x80000093:name}？{tag:10C}'),
    ).toBe('ﾖﾛｼｸｵﾈｶﾞｲｼﾏｽ.$page$$message:MonsterParameter:2147483795:voice$?$hero$');
    expect(voiceProblem('あ{page}い', 'ｱ$page$ｲ')).toBe('');
    expect(voiceProblem('あ{page}い', 'ｱｲ')).toContain('$page$');
    expect(voiceProblem('あ', '')).toBe('');
  });

  test('a set of 8 tones is appended in a row: the first row is the line, StartMessageAuto picks from it', () => {
    const { table, ref } = setup([['ナレーション', 0]]);
    const hero = lanaiAppendTalkRow(table, encodeLanaiMessage(parseLanaiText('ボクだけ')), 1);
    const first = lanaiAppendTalkSet(
      table,
      Array.from({ length: 8 }, (_, k) => `口調${k + 1}`),
    );
    expect(first).toBe(hero + 1);
    expect(Array.from({ length: 8 }, (_, k) => talkSpeaker(ref, first + k))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(talkGroups(ref).map((g) => [g.kind, g.rows[0]])).toEqual([
      ['none', 0],
      ['single', hero],
      ['set', first],
    ]);
    // the new rows are silent until a voice is written
    expect(talkVoice(ref, first)).toBe('');
    expect(() => lanaiAppendTalkSet(table, ['1つだけ'])).toThrow();
  });
});

describe('a line added from the script editor', () => {
  const stub = () => {
    const { table, ref } = setup([['ナレーション', 0]]);
    const maps = {
      talkTable: () => table,
      addTalkRow: (_: number, text: string, speaker: number) =>
        lanaiAppendTalkRow(table, encodeLanaiMessage(parseLanaiText(text)), speaker),
      addTalkSet: (_: number, texts: string[]) => lanaiAppendTalkSet(table, texts),
    } as unknown as LanaiMaps;
    return { table, ref, maps };
  };
  test('each kind is shown by its call', () => {
    expect(scriptLineCall('talk', 0x80000012)).toBe('talk(0x80000012)');
    expect(scriptLineCall('tones', 0x80000013)).toBe('ScriptMenu.StartMessageAuto(0x80000013, 0, 0, 0.2)');
    expect(scriptLineCall('hero', 0x80000014)).toBe('ScriptMenu.StartMessage(0x80000014, 0, 0, 0.2)');
    expect(scriptLineCall('system', 0x80000015)).toBe('ScriptMenu.StartMessage(0x80000015, 2, 0, 0.2)');
  });
  test('the row is added with its speaker and voice, and the call names its ID', () => {
    const { ref, maps } = stub();
    expect(addScriptLine(maps, 0, 'talk', ['やあ'], 0x0a, "ﾔ'ｱ.")).toBe('talk(0x80000001)');
    expect(talkSpeaker(ref, 1)).toBe(0x0a);
    expect(talkVoice(ref, 1)).toBe("ﾔ'ｱ.");
    expect(addScriptLine(maps, 0, 'hero', ['ボク'], 0x12, '')).toBe('ScriptMenu.StartMessage(0x80000002, 0, 0, 0.2)');
    expect(talkSpeaker(ref, 2)).toBe(1);
    const tones = Array.from({ length: 8 }, (_, k) => `口調${k + 1}`);
    expect(addScriptLine(maps, 0, 'tones', tones, 0, '')).toBe('ScriptMenu.StartMessageAuto(0x80000003, 0, 0, 0.2)');
    expect(talkGroups(ref).at(-1)).toMatchObject({ kind: 'set', rows: [3, 4, 5, 6, 7, 8, 9, 10] });
  });
  test('a text or voice that cannot be written adds no row', () => {
    const { table, maps } = stub();
    expect(() => addScriptLine(maps, 0, 'talk', ['{tag:02,?3}'], 0x12, '')).toThrow();
    expect(() => addScriptLine(maps, 0, 'talk', ['やあ'], 0x12, 'やあ')).toThrow('「や」');
    expect(table.rows).toBe(1);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! talks', () => {
  let session: LanaiSession;
  beforeAll(async () => {
    const dump: Dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    session = await LanaiSession.open(dump, { fresh: true });
  });

  test("the sets of 8 tones: 727 in the contents' talk tables (naauao lanai/messages.md), 73 in MessageNagomiFriend", async () => {
    const sets = (ts: LanaiTableRef[]): number =>
      ts.reduce((n, t) => n + talkGroups(t).filter((g) => g.kind === 'set').length, 0);
    const contents: LanaiTableRef[] = [];
    for (const a of new Set(lanaiContents(session).map((c) => c.archive)))
      contents.push(...(await session.tablesIn(a)).filter(isTalkTable));
    const others = session.tables.filter(isTalkTable);
    expect(contents.length).toBeGreaterThan(100);
    expect(sets(contents)).toBe(727);
    // the master's and the language archives' talk tables: only the two MessageNagomiFriend of FE74000A have sets
    expect(others.filter((t) => sets([t])).map((t) => `${t.archive}/${t.table.name}: ${sets([t])}`)).toEqual([
      'FE74000A/MessageNagomiFriend: 50',
      'FE74000A/MessageNagomiFriend: 23',
    ]);
  });

  test('a talk of a content is written, exported and put back', async () => {
    const c = lanaiContents(session).find((x) => x.stages.length)!;
    const t = (await session.tablesIn(c.archive)).find(isTalkTable)!;
    const g = talkGroups(t)[0]!;
    session.setText(t.table, g.rows[0]!, 0, 'テスト');
    session.edited();
    expect([...session.modFiles().keys()]).toContain(c.archive);
    const other = await LanaiSession.open(session.dump, { fresh: true });
    await other.restore(session.saved());
    const back = (await other.tablesIn(c.archive)).find((x) => x.entry === t.entry)!;
    expect(other.field(back.table, g.rows[0]!, 0)!.text).toBe('テスト');
    t.table.revert();
  });
});
