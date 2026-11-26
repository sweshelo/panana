// The talks of 電波人間のRPG FREE! (#/talks/<archive>[:<entry>:<row>]), edited by line (talk.ts): a set of the eight
// tones of one line is one entry of the list and is edited side by side, each tone in the shared message editor
// (ui/message.tsx MessageEditor through lanai/MessageSource.tsx); the other rows are entries of their own. The list
// is a content's talk tables (or the master's and the language archives'), narrowed by speaker and searched in every
// row of a line. A set whose tones put {ins:…} / {page} in different places, and a written row whose voice still reads
// the old text, are warned about. Each row's voice (the reading the speech synthesis speaks, talk.ts) is written below
// its text; a new line is a row of one speaker, a set of the eight tones, or the hero's own row.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { romfsHref } from '../romfs/RomfsPage';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { MessageEditor } from '../ui/message';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { contentTitle } from './contents';
import { useLanaiContents } from './useContents';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiMessageSource } from './MessageSource';
import { lanaiAppendTalkRow, lanaiAppendTalkSet } from './maps';
import { encodeLanaiMessage, parseLanaiText } from './message';
import type { LanaiSession, LanaiTableRef } from './session';
import {
  isTalkTable,
  marksDiffer,
  setTalkVoice,
  SPEAKERS,
  TALK_KIND_LABEL,
  TALK_SPEAKER,
  TALK_TONES,
  talkColumns,
  talkGroups,
  talkPlain,
  talkSpeaker,
  talkVoice,
  toneLabel,
  voiceDraft,
  voiceProblem,
  voiceStale,
  type TalkGroup,
} from './talk';

/** The scope of the master and the language archives. */
const MASTER = 'master';

type Filter = 'all' | 'persona' | 'set' | 'npc' | 'none';

const FILTERS: [Filter, string][] = [
  ['all', 'すべての話者'],
  ['persona', '性格つきのみ'],
  ['set', '性格違いの組のみ'],
  ['npc', 'NPC のみ'],
  ['none', '話者なし'],
];

const matches = (g: TalkGroup, f: Filter): boolean =>
  f === 'all' ||
  (f === 'persona' ? g.kind === 'set' || g.kind === 'single' : f === 'set' ? g.kind === 'set' : g.kind === f);

/** #/talks/<content archive>[:<entry>:<row>], or #/talks/master[:<archive>:<entry>:<row>]. */
export const talksHref = (scope: string, g?: TalkGroup): string =>
  `#/talks/${!g ? scope : scope === MASTER ? `${MASTER}:${g.key}` : g.key}`;

const PAGE = 300;

export function LanaiTalkPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useLanaiContents(session);
  const scopes = useMemo(
    (): [string, string][] => [
      [MASTER, 'master・言語版の表'],
      ...contents.map((c): [string, string] => [c.archive, `${c.index}. ${contentTitle(c)}`]),
    ],
    [contents],
  );
  const m = /^(master:)?([0-9A-F]+)(:[0-9A-F]{8}:\d+)?$/i.exec(arg ?? '') ?? /^(master)()()$/i.exec(arg ?? '');
  const scope = useSticky<string>(
    m ? (m[1] ? MASTER : m[2]!.toUpperCase()) : undefined,
    (s) => scopes.some(([v]) => v === s),
    () => scopes[1]?.[0] ?? MASTER,
  );
  const wanted = m?.[3] ? `${m[2]!.toUpperCase()}${m[3].toUpperCase()}` : undefined;
  const tables = useAsync(
    async () => (scope === MASTER ? session.tables : await session.tablesIn(scope)).filter(isTalkTable),
    [session, scope],
  );
  return (
    <div className="book">
      {!tables || tables instanceof Error ? (
        <div className="book-side">
          <ScopeSelect scopes={scopes} scope={scope} />
          <p className={tables ? 'error' : 'muted'}>{tables ? tables.message : 'アーカイブを読み込み中…'}</p>
        </div>
      ) : (
        <TalkList key={scope} session={session} scope={scope} scopes={scopes} tables={tables} wanted={wanted} />
      )}
    </div>
  );
}

function ScopeSelect({ scopes, scope }: { scopes: [string, string][]; scope: string }): ReactNode {
  return (
    <div className="row">
      <select
        value={scope}
        title="会話の表を読むコンテンツ"
        onChange={(e) => (location.hash = talksHref(e.target.value))}
      >
        {scopes.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TalkList({
  session,
  scope,
  scopes,
  tables,
  wanted,
}: {
  session: LanaiSession;
  scope: string;
  scopes: [string, string][];
  tables: LanaiTableRef[];
  wanted: string | undefined;
}): ReactNode {
  const revision = useLanaiRevision(session);
  // again when a row was added (here, or by a new sign or NPC of the map page)
  const rowCount = tables.reduce((n, t) => n + t.table.rows, 0);
  const all = useMemo(() => tables.flatMap(talkGroups), [tables, rowCount]);
  const byKey = useMemo(() => new Map(all.map((g) => [g.key, g])), [all]);
  const selected = useSticky<string>(
    wanted,
    (k) => byKey.has(k),
    () => [...byKey.keys()].find((k) => byKey.get(k)!.kind === 'set') ?? [...byKey.keys()][0] ?? '',
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const plain = useMemo(() => new Map(all.map((g) => [g, talkPlain(session, g)])), [all, session, revision]);
  const q = query.trim();
  const qid = /^(0x)?[0-9a-f]{1,8}$/i.test(q) ? parseInt(q.replace(/^0x/i, ''), 16) : NaN;
  const shown = all.filter(
    (g) =>
      matches(g, filter) &&
      (!q || g.rows.some((r) => g.ref.table.rowId(r) === qid) || plain.get(g)!.some((s) => s.includes(q))),
  );
  const sel = byKey.get(selected);
  const counts = { set: all.filter((g) => g.kind === 'set').length };
  /** The table a new line goes to: the selected line's, else the first. */
  const target = sel?.ref ?? tables[0];
  const addLine = (what: 'row' | 'set' | 'hero'): void => {
    if (!target) return;
    try {
      const text = '新しいメッセージ';
      // the speaker kind of the selected line when it is a single row (an NPC's), else the ROM's usual NPC kind 18
      const speaker = sel && sel.kind !== 'set' ? talkSpeaker(sel.ref, sel.rows[0]!) : 18;
      const row =
        what === 'set'
          ? lanaiAppendTalkSet(target.table, Array<string>(TALK_TONES).fill(text))
          : lanaiAppendTalkRow(target.table, encodeLanaiMessage(parseLanaiText(text)), what === 'hero' ? 1 : speaker);
      session.edited();
      const g = talkGroups(target).find((x) => x.rows.includes(row));
      if (g) location.hash = talksHref(scope, g);
    } catch (e) {
      alert((e as Error).message);
    }
  };
  return (
    <>
      <div className="book-side">
        <ScopeSelect scopes={scopes} scope={scope} />
        <ListFilter
          query={query}
          setQuery={(v) => {
            setQuery(v);
            setLimit(PAGE);
          }}
          placeholder="本文 (8 口調すべて) か行 ID で検索"
          filter={filter}
          setFilter={(v) => {
            setFilter(v);
            setLimit(PAGE);
          }}
          options={FILTERS}
        />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={all.length} />
          {!all.length && (
            <p className="muted">このコンテンツには会話の表 (message / voice / 話者の 12 バイトの行) がありません。</p>
          )}
          {!!all.length && <div className="muted small">{`性格違いの組 ${counts.set}`}</div>}
          {target && scope !== MASTER && (
            <div className="row">
              <button
                title={`${target.table.name} の末尾に新しい行を足します。マップの NPC や看板の「台詞」欄から選べます`}
                onClick={() => addLine('row')}
              >
                ＋ 新しいメッセージ
              </button>
              <button
                title="先頭の電波人間の台詞: 性格ごとの 8 口調 (1 主人公、2〜8 性格 0〜6) の 8 行を足します。スクリプトでは 1 行目の ID を ScriptMenu.StartMessageAuto に渡します"
                onClick={() => addLine('set')}
              >
                ＋ 性格違いの組
              </button>
              <button
                title="主人公 (口調 1) だけの 1 行を足します。スクリプトでは ScriptMenu.StartMessage で出します (StartMessageAuto は性格で後ろの行を選んでしまいます)"
                onClick={() => addLine('hero')}
              >
                ＋ 主人公専用
              </button>
            </div>
          )}
          <table className="book-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>話者</th>
                <th>本文</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((g) => {
                const k = g.key;
                const texts = plain.get(g)!;
                const edited = g.rows.some((r) => g.ref.table.rowChanged(r));
                return (
                  <tr
                    key={k}
                    className={k === selected ? 'active' : ''}
                    onClick={() => (location.hash = talksHref(scope, g))}
                  >
                    <td className="num muted mono">{hex8(g.ref.table.rowId(g.rows[0]!))}</td>
                    <td className="muted nowrap small">
                      {g.kind === 'set' ? '8 口調' : toneLabel(talkSpeaker(g.ref, g.rows[0]!))}
                    </td>
                    <td className="msg-cell">
                      {edited && <b className="edited">● </b>}
                      {texts.find((s) => s) || <span className="muted">(空)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length > limit && (
            <div className="row">
              <button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${shown.length - limit} 件)`}</button>
            </div>
          )}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {sel ? <TalkDetail key={selected} session={session} g={sel} /> : <p className="muted">会話がありません。</p>}
      </div>
    </>
  );
}

const HELP =
  'ルビは {ruby:親字|よみ}、改ページは {page}、ほかの表の文字列の差し込みは {ins:表:行 ID:欄}、ほかのタグは {tag:XX,引数…} で表しています。' +
  '話者の値 (+0x08) が 1〜8 と続く 8 行が、同じセリフの 8 つの口調の組です。ScriptMenu.StartMessageAuto に 1 行目の ID を渡すと、先頭の電波人間の性格 0〜6 で口調 2〜8 の行が選ばれます (ほかの性格は口調 1)。' +
  "読み (voice) は音声合成 (RubyTalk) が読む半角カナで、空なら喋りません。' はアクセント、/ は句の切れ目、| は間、. は文の終わり、? は疑問、> は無声化、$page$ は改ページ (本文の {page} と同じ数)、$message:表:十進 ID:voice$ は差し込みの読み、$hero$ は主人公の名前です。" +
  '話者 1〜0x0E は種類ごとの声で喋ります。話者 0x0A〜0x16 の名前は ROM の使われ方からの推定です。';

function TalkDetail({ session, g }: { session: LanaiSession; g: TalkGroup }): ReactNode {
  useLanaiRevision(session);
  const t = g.ref.table;
  const cols = talkColumns(g.ref)!;
  const src = lanaiMessageSource(session, t, cols.message);
  const apply = (f: () => void): void => {
    f();
    session.edited();
  };
  const stale = g.rows.filter((r) => voiceStale(g, r));
  return (
    <>
      <div className="book-head">
        <h2>{`セリフ ${hex8(t.rowId(g.rows[0]!))}`}</h2>
        <span className="muted">{`${TALK_KIND_LABEL[g.kind]} · ${t.name} の行 ${g.rows[0]}${g.rows.length > 1 ? `〜${g.rows[g.rows.length - 1]}` : ''} · `}</span>
        <a
          className="muted mono"
          href={romfsHref(g.ref.archive, g.ref.entry)}
          title="RomFS ビューで表のすべての欄を見る"
        >{`${g.ref.archive} / ${hex8(g.ref.entry)}`}</a>
      </div>
      {marksDiffer(session, g) && (
        <div className="error small">
          差し込み ({'{ins:…}'}) か改ページ ({'{page}'}) の位置が口調によって違います。
        </div>
      )}
      {stale.length > 0 && (
        <div className="error small">{`本文を変えた行 (${stale.map((r) => toneLabel(talkSpeaker(g.ref, r))).join('、')}) の読み (voice) は元の本文の読みのままです。下の「読み」を直してください。`}</div>
      )}
      <div className={g.rows.length > 1 ? 'talk-tones' : undefined}>
        {g.rows.map((r) => (
          <div key={r}>
            <MessageEditor
              texts={src}
              id={r}
              apply={apply}
              title={
                <div className="msg-slot-head row">
                  {g.kind === 'set' ? (
                    <span>{toneLabel(talkSpeaker(g.ref, r))}</span>
                  ) : (
                    <select
                      aria-label="話者"
                      value={talkSpeaker(g.ref, r)}
                      onChange={(e) => apply(() => t.setU8(r, TALK_SPEAKER, Number(e.target.value)))}
                    >
                      {!SPEAKERS.some(([v]) => v === talkSpeaker(g.ref, r)) && (
                        <option value={talkSpeaker(g.ref, r)}>{toneLabel(talkSpeaker(g.ref, r))}</option>
                      )}
                      {SPEAKERS.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                  {g.kind === 'set' && (
                    <button
                      className="small"
                      title="この口調の本文を、組のほかの 7 口調にも写します"
                      onClick={() => {
                        const text = src.text(r);
                        if (text !== undefined) apply(() => g.rows.forEach((x) => x !== r && src.setText(x, text)));
                      }}
                    >
                      全口調へ写す
                    </button>
                  )}
                </div>
              }
            />
            {cols.voice >= 0 && <VoiceField session={session} g={g} row={r} text={src.text(r) ?? ''} />}
          </div>
        ))}
      </div>
      <p className="muted small">{HELP}</p>
    </>
  );
}

/** The voice of a row: what the speech synthesis reads (talk.ts), written as half-width katakana. */
export function VoiceField({
  session,
  g,
  row,
  text,
}: {
  session: LanaiSession;
  g: Pick<TalkGroup, 'ref'>;
  row: number;
  /** The row's text (the text form of message.ts): the draft is made from it and its pages checked against it. */
  text: string;
}): ReactNode {
  const stored = talkVoice(g.ref, row);
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setDraft(stored);
  }
  const [error, setError] = useState('');
  const write = (value: string): void => {
    try {
      setTalkVoice(g.ref, row, value);
      session.edited();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const problem = voiceProblem(text, draft);
  return (
    <div className="talk-voice">
      <label className="small">
        {'読み (voice) '}
        <input
          className="mono"
          style={{ width: '100%' }}
          placeholder="(空: 喋らない)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== stored && write(draft)}
        />
      </label>
      <div className="row">
        <button
          className="small"
          title="本文のルビとかなを半角カナにした下書きを入れます (欄から離れると書き込みます)。ルビのない漢字の読み、アクセント (') と区切り (/ |) は手で直します"
          onClick={() => setDraft(voiceDraft(text))}
        >
          本文から下書き
        </button>
        <button className="small" disabled={!stored} onClick={() => write('')}>
          読みを空にする
        </button>
      </div>
      {(error || problem) && <div className="error small">{error || problem}</div>}
    </div>
  );
}
