// The talks of 電波人間のRPG FREE! (#/talks/<archive>[:<entry>:<row>]), edited by line (talk.ts): a set of the eight
// tones of one line is one entry of the list and is edited side by side, each tone in the shared message editor
// (ui/message.tsx MessageEditor through lanai/MessageSource.tsx); the other rows are entries of their own. The list
// is a content's talk tables (or the master's and the language archives'), narrowed by speaker and searched in every
// row of a line. A set whose tones put {ins:…} / {page} in different places, and a written row whose voice still reads
// the old text, are warned about.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { romfsHref } from '../romfs/RomfsPage';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { MessageEditor } from '../ui/message';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { contentTitle, lanaiContents } from './contents';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiMessageSource } from './MessageSource';
import type { LanaiSession, LanaiTableRef } from './session';
import { isTalkTable, marksDiffer, TALK_KIND_LABEL, talkColumns, talkGroups, talkPlain, talkSpeaker, toneLabel, voiceStale, type TalkGroup } from './talk';

/** The scope of the master and the language archives. */
const MASTER = 'master';

type Filter = 'all' | 'persona' | 'set' | 'npc' | 'none';

const FILTERS: [Filter, string][] = [['all', 'すべての話者'], ['persona', '性格つきのみ'], ['set', '性格違いの組のみ'], ['npc', 'NPC のみ'], ['none', '話者なし']];

const matches = (g: TalkGroup, f: Filter): boolean =>
  f === 'all' || (f === 'persona' ? g.kind === 'set' || g.kind === 'single' : f === 'set' ? g.kind === 'set' : g.kind === f);

/** #/talks/<content archive>[:<entry>:<row>], or #/talks/master[:<archive>:<entry>:<row>]. */
export const talksHref = (scope: string, g?: TalkGroup): string => `#/talks/${!g ? scope : scope === MASTER ? `${MASTER}:${g.key}` : g.key}`;

const PAGE = 300;

export function LanaiTalkPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const scopes = useMemo((): [string, string][] => [
    [MASTER, 'master・言語版の表'],
    ...contents.map((c): [string, string] => [c.archive, `${c.index}. ${contentTitle(c)}`]),
  ], [contents]);
  const m = /^(master:)?([0-9A-F]+)(:[0-9A-F]{8}:\d+)?$/i.exec(arg ?? '') ?? /^(master)()()$/i.exec(arg ?? '');
  const scope = useSticky<string>(m ? (m[1] ? MASTER : m[2]!.toUpperCase()) : undefined, (s) => scopes.some(([v]) => v === s), () => scopes[1]?.[0] ?? MASTER);
  const wanted = m?.[3] ? `${m[2]!.toUpperCase()}${m[3].toUpperCase()}` : undefined;
  const tables = useAsync(async () => (scope === MASTER ? session.tables : await session.tablesIn(scope)).filter(isTalkTable), [session, scope]);
  return (
    <div className="book">
      {!tables || tables instanceof Error
        ? (
          <div className="book-side">
            <ScopeSelect scopes={scopes} scope={scope} />
            <p className={tables ? 'error' : 'muted'}>{tables ? tables.message : 'アーカイブを読み込み中…'}</p>
          </div>
        )
        : <TalkList key={scope} session={session} scope={scope} scopes={scopes} tables={tables} wanted={wanted} />}
    </div>
  );
}

function ScopeSelect({ scopes, scope }: { scopes: [string, string][]; scope: string }): ReactNode {
  return (
    <div className="row">
      <select value={scope} title="会話の表を読むコンテンツ" onChange={(e) => (location.hash = talksHref(e.target.value))}>
        {scopes.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </div>
  );
}

function TalkList({ session, scope, scopes, tables, wanted }: { session: LanaiSession; scope: string; scopes: [string, string][]; tables: LanaiTableRef[]; wanted: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const all = useMemo(() => tables.flatMap(talkGroups), [tables]);
  const byKey = useMemo(() => new Map(all.map((g) => [g.key, g])), [all]);
  const selected = useSticky<string>(wanted, (k) => byKey.has(k), () => [...byKey.keys()].find((k) => byKey.get(k)!.kind === 'set') ?? [...byKey.keys()][0] ?? '');
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
  const shown = all.filter((g) => matches(g, filter) && (!q || g.rows.some((r) => g.ref.table.rowId(r) === qid) || plain.get(g)!.some((s) => s.includes(q))));
  const sel = byKey.get(selected);
  const counts = { set: all.filter((g) => g.kind === 'set').length };
  return (
    <>
      <div className="book-side">
        <ScopeSelect scopes={scopes} scope={scope} />
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="本文 (8 口調すべて) か行 ID で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }} options={FILTERS} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={all.length} />
          {!all.length && <p className="muted">このコンテンツには会話の表 (message / voice / 話者の 12 バイトの行) がありません。</p>}
          {!!all.length && <div className="muted small">{`性格違いの組 ${counts.set}`}</div>}
          <table className="book-table">
            <thead><tr><th>ID</th><th>話者</th><th>本文</th></tr></thead>
            <tbody>
              {shown.slice(0, limit).map((g) => {
                const k = g.key;
                const texts = plain.get(g)!;
                const edited = g.rows.some((r) => g.ref.table.rowChanged(r));
                return (
                  <tr key={k} className={k === selected ? 'active' : ''} onClick={() => (location.hash = talksHref(scope, g))}>
                    <td className="num muted mono">{hex8(g.ref.table.rowId(g.rows[0]!))}</td>
                    <td className="muted nowrap small">{g.kind === 'set' ? '8 口調' : toneLabel(talkSpeaker(g.ref, g.rows[0]!))}</td>
                    <td className="msg-cell">{edited && <b className="edited">● </b>}{texts.find((s) => s) || <span className="muted">(空)</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${shown.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {sel ? <TalkDetail key={selected} session={session} g={sel} /> : <p className="muted">会話がありません。</p>}
      </div>
    </>
  );
}

const HELP = 'ルビは {ruby:親字|よみ}、改ページは {page}、ほかの表の文字列の差し込みは {ins:表:行 ID:欄}、ほかのタグは {tag:XX,引数…} で表しています。'
  + '話者の値 (+0x08) が 1〜8 と続く 8 行を、同じセリフの 8 つの口調として組にしています (口調 = 性格 + 2 と推定、1 は主人公専用)。'
  + 'ゲームが組のどの行を選ぶか、口調と性格の値の対応、話者 0x09〜0x16 の意味は未確認です。';

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
        <a className="muted mono" href={romfsHref(g.ref.archive, g.ref.entry)} title="RomFS ビューで表のすべての欄を見る">{`${g.ref.archive} / ${hex8(g.ref.entry)}`}</a>
      </div>
      {marksDiffer(session, g) && <div className="error small">差し込み ({'{ins:…}'}) か改ページ ({'{page}'}) の位置が口調によって違います。</div>}
      {stale.length > 0 && (
        <div className="error small">{`本文を変えた行 (${stale.map((r) => toneLabel(talkSpeaker(g.ref, r))).join('、')}) の voice の欄は元の本文の読みのままです (音声合成用と推定。書き換えには対応していません)。`}</div>
      )}
      <div className={g.rows.length > 1 ? 'talk-tones' : undefined}>
        {g.rows.map((r) => (
          <MessageEditor key={r} texts={src} id={r} apply={apply} title={<div className="msg-slot-head">{toneLabel(talkSpeaker(g.ref, r))}</div>} />
        ))}
      </div>
      <p className="muted small">{HELP}</p>
    </>
  );
}
