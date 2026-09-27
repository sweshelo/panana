// Event list: every EventObject row of every dungeon, with where it is placed, when it appears, the messages it
// shows and, for scripts, what the game's code does for it (game/eventlist.ts). docs/event-list.md.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import { completedBy, eventEntries, type EventEntry } from '../game/eventlist';
import { EVENT_KINDS, kindName } from '../game/eventkinds';
import { mapShortTitle } from '../game/names';
import { fnName } from '../game/codemessages';
import { aiBundle, eventText, GAME_CONTEXT, type EventDescription } from '../game/aiprompt';
import { AskAi } from '../ui/AskAi';
import { CodeIndex } from '../game/scripts';
import { scriptListing, type AsmFunction } from '../game/scriptasm';
import type { Session } from '../session';
import { Count, ListFilter, useActiveRow, useSticky, type PageProps } from '../ui/book';

type Filter = 'all' | 'script' | 'talk' | 'chest' | 'door' | 'cond' | 'unplaced';

const FILTERS: Record<Filter, (e: EventEntry) => boolean> = {
  all: () => true,
  script: (e) => e.kind === 0x24 || e.kind === 0x0a,
  talk: (e) => (e.kind >= 0x01 && e.kind <= 0x09) || e.kind === 0x1f || e.kind === 0x21,
  chest: (e) => e.kind >= 0x0c && e.kind <= 0x0e,
  door: (e) => (e.kind >= 0x0f && e.kind <= 0x1a) || e.kind === 0x1c,
  cond: (e) => e.conditions.length > 0,
  unplaced: (e) => e.places.length === 0,
};

const key = (e: { dungeon: number; row: number }): string => `${e.dungeon}.${e.row}`;
const hex2 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;

/** Every message the row shows: its fields, then its script's. */
const messagesOf = (e: EventEntry): number[] => [...new Set([...e.messages.map((m) => m.id), ...e.scripts.flatMap((s) => s.cls.messages)])];

export function EventPage({ session, arg, visit }: PageProps): ReactNode {
  const { game } = session;
  const master = game.master;
  const texts = master.texts;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<EventEntry[] | null>(null);
  // Re-read on every visit: rows may have been edited in the map editor.
  useEffect(() => {
    let live = true;
    eventEntries(game, session.docOf, session.eventsOf).then((e) => live && setEntries(e));
    return () => {
      live = false;
    };
  }, [game, session, visit]);
  const byKey = useMemo(() => new Map((entries ?? []).map((e) => [key(e), e])), [entries]);
  const completers = useMemo(() => completedBy(entries ?? []), [entries]);
  /** Function bounds of code.bin with every script class's vtable entries (for the listings). */
  const index = useMemo(() => (entries ? new CodeIndex(game.code.code, new Set(entries.flatMap((e) => e.scripts.map((s) => s.cls.vtable)))) : null), [game, entries]);
  const selected = useSticky(arg, (k) => !entries || byKey.has(k), () => (entries?.[0] ? key(entries[0]) : ''));
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, `${selected} ${entries?.length}`);

  const dungeonName = (d: number): string => master.dungeonName(d) || `D${d}`;
  const matches = (e: EventEntry): boolean => {
    if (!FILTERS[filter](e)) return false;
    const q = query.trim();
    if (!q) return true;
    const hay = [
      dungeonName(e.dungeon),
      kindName(e.kind),
      ...e.places.flatMap((p) => [p.map.name, mapShortTitle(p.map, game.code.maps)]),
      ...e.conditions.map((c) => c.text),
      ...e.scripts.flatMap((s) => [fnName(s.make), `0x${s.cls.vtable.toString(16).toUpperCase()}`, ...s.cls.roots.map(fnName)]),
      ...messagesOf(e).flatMap((id) => [texts.preview(id, true) ?? '', hexId(id)]),
    ];
    return hay.some((t) => t.includes(q));
  };
  const all = entries ?? [];
  const rows = all.filter(matches);
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="マップ名・本文・条件・関数で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['script', 'スクリプト (コードに書かれた動作)'], ['talk', 'キャラクター・看板'], ['chest', '宝箱'], ['door', '扉・出入口'], ['cond', '出現条件あり'], ['unplaced', 'どのマップにも置かれていない']]} />
        <div className="book-list" ref={list}>
          {!entries && <div className="muted">読み込み中…</div>}
          {entries && <Count shown={rows.length} total={all.length} unit="行" />}
          <table className="book-table">
            <thead><tr><th>ダンジョン</th><th>行</th><th>種類</th><th>メッセージ</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const k = key(e);
                const first = messagesOf(e)[0];
                return (
                  <tr key={k} className={k === selected ? 'active' : ''} onClick={() => (location.hash = `#/events/${k}`)}>
                    <td className="muted">{dungeonName(e.dungeon)}</td>
                    <td className="num muted">{e.row}</td>
                    <td className="muted">{kindName(e.kind)}</td>
                    <td className="msg-cell">{first !== undefined ? texts.preview(first, true) ?? '' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        {entries && index && <EventDetail key={selected} session={session} entry={byKey.get(selected)} byKey={byKey} completers={completers} index={index} />}
      </div>
    </div>
  );
}

function EventDetail({ session, entry: e, byKey, completers, index }: {
  session: Session; entry: EventEntry | undefined; byKey: Map<string, EventEntry>; completers: Map<string, EventEntry[]>; index: CodeIndex;
}): ReactNode {
  const { game } = session;
  const master = game.master;
  const texts = master.texts;
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState('');
  const message = (id: number): string | undefined => texts.plain(id)?.replace(/\s+/g, ' ');
  const listing = useMemo(
    (): AsmFunction[] => (e && showCode ? e.scripts.flatMap((s) => scriptListing({ code: game.code.code, message }, index, s.cls)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [e, showCode, index, game],
  );
  if (!e) return null;
  const describe = (): EventDescription => ({
    dungeonName: master.dungeonName(e.dungeon) || `D${e.dungeon}`,
    entry: e,
    places: e.places.map((p) => `${p.map.name} 区画 ${p.section} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`),
    listing: e.scripts.flatMap((s) => scriptListing({ code: game.code.code, message }, index, s.cls)),
    message,
  });
  const bundle = (): string => aiBundle(describe());
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(bundle());
      setCopied('コピーしました');
    } catch {
      setCopied('コピーできませんでした (「テキストで保存」を使ってください)');
    }
  };
  const save = (): void => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bundle()], { type: 'text/plain' }));
    a.download = `event-${e.dungeon}-${e.row}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const dungeonName = (d: number): string => master.dungeonName(d) || `ダンジョン ${d}`;
  const rowLink = (row: number): ReactNode => {
    const t = byKey.get(`${e.dungeon}.${row}`);
    return <a href={`#/events/${e.dungeon}.${row}`}>{`行 ${row}`}{t && <span className="muted">{` (${kindName(t.kind)})`}</span>}</a>;
  };
  const msg = (id: number): ReactNode => (
    <li key={id}>
      <a href={`#/messages/${hexId(id)}`}>{hexId(id)}</a>{' '}{texts.preview(id, true) ?? <span className="muted">(なし)</span>}
    </li>
  );
  const by = (completers.get(key(e)) ?? []).filter((x) => x !== e);
  const note = EVENT_KINDS[e.kind]?.note;
  return (
    <>
      <div className="book-head">
        <h2>{`${dungeonName(e.dungeon)} — イベント #${e.row}`}</h2>
        <span className="muted">{`${kindName(e.kind)} (種類 ${hex2(e.kind)})、状態の枠 ${e.slot}${e.model ? `、モデル ${e.model}` : ''}`}</span>
      </div>
      {note && <div className="muted small">{note}</div>}
      <h3>置かれている場所</h3>
      {e.places.length
        ? <ul>
            {e.places.map((p, i) => (
              <li key={i}>
                <a href={`#/map/${encodeURIComponent(p.map.name)}`}>{mapShortTitle(p.map, game.code.maps)}</a>
                {' '}<span className="muted">{`${p.map.name} 区画 ${p.section}${p.recordKind !== undefined ? `-${p.recordKind}` : ''} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`}</span>
              </li>
            ))}
          </ul>
        : <div className="muted">どのマップにも置かれていません</div>}
      <h3>出現条件</h3>
      {e.conditions.length
        ? <ul>
            {e.conditions.map((c) => (
              <li key={c.field}>
                {c.field === 0x4b ? '出る: ' : '消える: '}{c.text}
                <span className="muted">{` (+${hex2(c.field)} = ${hex2(c.type)}、値 ${c.value})`}</span>
              </li>
            ))}
          </ul>
        : <div className="muted">条件なし (いつも置かれる)</div>}
      <div className="muted small">+0x4B の条件が成り立つときだけ置かれ、+0x4C の条件が成り立つと置かれなくなります (FUN_0030B8A4)。値はそれぞれ +0x00 / +0x04。</div>
      {e.messages.length > 0 && (
        <>
          <h3>メッセージ (行の欄)</h3>
          <ul>{e.messages.map((m) => msg(m.id))}</ul>
          <div className="muted small"><a href={`#/messages/${key(e)}`}>メッセージのページで編集する</a></div>
        </>
      )}
      {(e.kind === 0x24 || e.kind === 0x0a) && (
        <>
          <h3>スクリプト</h3>
          {e.scripts.length === 0 && <div className="muted">コードはこの行に何も作りません (ダンジョンと行番号の組がコードにない、または進行で分けている)</div>}
          {e.scripts.map((s, i) => (
            <Fragment key={i}>
              <div className="small">
                {`${fnName(s.make)} が作るクラス 0x${s.cls.vtable.toString(16).toUpperCase()}。処理: `}
                {s.cls.roots.length ? s.cls.roots.map(fnName).join(' ') : <span className="muted">(共通の処理だけ)</span>}
              </div>
              {s.cls.completes.length > 0 && (
                <div>{'完了させる行: '}{s.cls.completes.map((r, j) => <Fragment key={r}>{j ? '、' : ''}{rowLink(r)}</Fragment>)}</div>
              )}
              {s.cls.messages.length > 0
                ? <ul>{s.cls.messages.map(msg)}</ul>
                : <div className="muted">コードに書かれたメッセージはありません</div>}
            </Fragment>
          ))}
          <div className="muted small">クラスは、ゲームの「動作の生成」関数をこの行で実際に動かして求めています。メッセージは、そのクラスだけが持つ関数から呼ばれる関数が読み込む ID で、進行や選択肢で出し分けるものをすべて含みます。</div>
          {e.scripts.length > 0 && (
            <>
              <h3>コード</h3>
              <div className="row">
                <button onClick={() => setShowCode(!showCode)}>{showCode ? 'アセンブラを閉じる' : 'アセンブラを見る'}</button>
                <button title="ゲームの説明・この行の情報・注釈つきのアセンブラをまとめてコピーします。AI のチャットに貼って意味を聞けます" onClick={copy}>AI 用にコピー</button>
                <button onClick={save}>テキストで保存</button>
                {copied && <span className="muted small">{copied}</span>}
              </div>
              {showCode && listing.map((f) => <AsmView key={f.addr} fn={f} />)}
              <h3>AI に聞く</h3>
              <AskAi system={GAME_CONTEXT} context={() => eventText(describe())} />
            </>
          )}
        </>
      )}
      {by.length > 0 && (
        <>
          <h3>この行を完了させるスクリプト</h3>
          <ul>{by.map((x) => <li key={key(x)}><a href={`#/events/${key(x)}`}>{`行 ${x.row}`}</a>{' '}<span className="muted">{kindName(x.kind)}</span></li>)}</ul>
        </>
      )}
    </>
  );
}

/** One function of a listing: address, instruction and note per line. */
function AsmView({ fn }: { fn: AsmFunction }): ReactNode {
  return (
    <details className="asm-fn" open={fn.role.startsWith('vtable') || fn.role === 'コールバック'}>
      <summary>
        <b>{fnName(fn.addr)}</b> <span className="muted small">{`${fn.role}、${fn.lines.length} 命令、呼び出し元 ${fn.callers} か所`}</span>
      </summary>
      <pre className="asm">
        {fn.lines.map((l) => (
          <Fragment key={l.insn.addr}>
            {l.label && <span className="asm-label">{`${l.label}:\n`}</span>}
            <span className="asm-addr">{l.insn.addr.toString(16).toUpperCase().padStart(8, '0')}</span>
            {'  '}
            {l.insn.text.padEnd(36)}
            {l.note && <span className="asm-note">{` ; ${l.note}`}</span>}
            {'\n'}
          </Fragment>
        ))}
      </pre>
    </details>
  );
}
