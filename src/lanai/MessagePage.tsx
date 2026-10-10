// The strings of 電波人間のRPG FREE! (#/messages/<archive>:<entry>): every table of the master and the language archives
// that holds strings, its rows with their strings as a reader sees them, and a search over all of them. The strings of
// a content (its talks) are on the stage page.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { romfsHref } from '../romfs/RomfsPage';
import { hex8 } from '../util/bytes';
import { LanaiMessage } from './MessageView';
import type { LanaiSession, LanaiTableRef } from './session';

/** Fields that are not text (the voice data starts with C0 DE B0 D0; naauao lanai/analysis.md §2.2). */
const NOT_TEXT = new Set(['voice']);

export const tableKey = (t: LanaiTableRef): string => `${t.archive}:${hex8(t.entry)}`;
export const messagesHref = (t: LanaiTableRef, row?: number): string => `#/messages/${tableKey(t)}${row === undefined ? '' : `:${row}`}`;

/** The string columns of a table that hold text. */
export function textColumns(t: LanaiTableRef): { offset: number; name: string }[] {
  return t.table.stringOffsets()
    .map((offset) => ({ offset, name: t.table.fieldName(offset) ?? `+${offset.toString(16).toUpperCase()}` }))
    .filter((c) => !NOT_TEXT.has(c.name));
}

interface Hit {
  ref: LanaiTableRef;
  row: number;
  column: { offset: number; name: string };
  text: string;
}

export function LanaiMessagePage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const tables = useMemo(() => session.tables.filter((t) => textColumns(t).length), [session]);
  const byKey = useMemo(() => new Map(tables.map((t) => [tableKey(t), t])), [tables]);
  const m = /^([0-9A-F]{8}:[0-9A-F]{8})(?::(\d+))?$/i.exec(arg ?? '');
  const key = useSticky<string>(m?.[1]?.toUpperCase(), (k) => byKey.has(k), () => {
    const common = tables.find((t) => t.table.name === 'MessageCommon');
    return common ? tableKey(common) : tables[0] ? tableKey(tables[0]) : '';
  });
  const row = m?.[2] === undefined ? undefined : Number(m[2]);
  const [query, setQuery] = useState('');
  const q = query.trim();
  // every string of every table, plain, for the search (made when first searched)
  const all = useMemo(() => {
    if (!q) return null;
    const out: Hit[] = [];
    for (const ref of tables)
      for (const c of textColumns(ref))
        for (let r = 0; r < ref.table.rows; r++) {
          const o = ref.table.stringOffset(r, c.offset);
          if (o >= 0) out.push({ ref, row: r, column: c, text: session.plainAt(ref.table, o) });
        }
    return out;
  }, [session, tables, !q]); // eslint-disable-line react-hooks/exhaustive-deps -- made once a search starts
  const hits = q && all ? all.filter((h) => h.text.includes(q)) : null;
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, key);
  useScrollTop(detail, key);
  const ref = byKey.get(key);
  return (
    <div className="book">
      <div className="book-side">
        <div className="row">
          <input type="search" placeholder="すべての表の本文を検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="book-list" ref={list}>
          <Count shown={tables.length} total={tables.length} unit="表" />
          <table className="book-table">
            <thead><tr><th>表</th><th>アーカイブ</th><th>行</th></tr></thead>
            <tbody>
              {tables.map((t) => (
                <tr key={tableKey(t)} className={tableKey(t) === key ? 'active' : ''} onClick={() => (location.hash = messagesHref(t))}>
                  <td>{t.table.name}</td>
                  <td className="mono muted small">{t.archive}</td>
                  <td className="num muted">{t.table.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {hits ? <SearchHits session={session} hits={hits} query={q} />
          : ref ? <TableStrings key={key} session={session} ref_={ref} row={row} /> : <p className="muted">表がありません。</p>}
      </div>
    </div>
  );
}

const HIT_LIMIT = 500;

function SearchHits({ session, hits, query }: { session: LanaiSession; hits: Hit[]; query: string }): ReactNode {
  return (
    <>
      <div className="book-head">
        <h2>{`「${query}」を含む本文`}</h2>
        <span className="muted">{`${hits.length} 件${hits.length > HIT_LIMIT ? ` (先頭 ${HIT_LIMIT} 件を表示)` : ''}`}</span>
      </div>
      <table className="book-table">
        <thead><tr><th>表</th><th>行</th><th>欄</th><th>本文</th></tr></thead>
        <tbody>
          {hits.slice(0, HIT_LIMIT).map((h) => (
            <tr key={`${tableKey(h.ref)}:${h.row}:${h.column.offset}`} onClick={() => (location.hash = messagesHref(h.ref, h.row))}>
              <td>{h.ref.table.name}</td>
              <td className="mono muted">{hex8(h.ref.table.rowId(h.row))}</td>
              <td className="mono muted small">{h.column.name}</td>
              <td className="romfs-msg"><LanaiMessage session={session} tokens={session.field(h.ref.table, h.row, h.column.offset)?.tokens ?? []} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const PAGE = 300;

function TableStrings({ session, ref_: ref, row }: { session: LanaiSession; ref_: LanaiTableRef; row?: number }): ReactNode {
  const t = ref.table;
  const cols = textColumns(ref);
  const [limit, setLimit] = useState(PAGE);
  const [showText, setShowText] = useState(false);
  const n = Math.max(limit, row === undefined ? 0 : row + 1);
  const body = useRef<HTMLTableSectionElement>(null);
  useActiveRow(body, row);
  return (
    <>
      <div className="book-head">
        <h2>{t.name}</h2>
        <a className="muted mono" href={romfsHref(ref.archive, ref.entry)} title="RomFS ビューで表のすべての欄を見る">{`${ref.archive} / ${hex8(ref.entry)}${ref.file ? ` ${ref.file}` : ''}`}</a>
        <span className="muted">{`${t.rows} 行`}</span>
        <span className="grow" />
        <label className="muted small"><input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />タグを文字で表示</label>
      </div>
      <table className="book-table">
        <thead><tr><th>行</th><th>行 ID</th>{cols.map((c) => <th key={c.offset} className="mono">{c.name}</th>)}</tr></thead>
        <tbody ref={body}>
          {Array.from({ length: Math.min(n, t.rows) }, (_, r) => (
            <tr key={r} className={r === row ? 'active' : ''}>
              <td className="num muted">{r}</td>
              <td className="mono muted">{hex8(t.rowId(r))}</td>
              {cols.map((c) => {
                const s = session.field(t, r, c.offset);
                return <td key={c.offset} className="romfs-msg">{!s ? '' : showText ? s.text : <LanaiMessage session={session} tokens={s.tokens} />}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {n < t.rows && <div className="row"><button onClick={() => setLimit(n + PAGE * 5)}>{`続きを表示 (${t.rows - n} 行)`}</button></div>}
    </>
  );
}
