// The strings of 電波人間のRPG FREE! (#/messages/<archive>:<entry>:<row>), laid out like RPG2's and RPG3's message
// pages (pages/messages.tsx, oahu/MessagePage.tsx): every row of the master's and the language archives' tables that
// holds text, searchable by text or row ID and narrowed by table, and the selected row's strings in the message
// box of the other games (ui/message.tsx MessageView; read only, the string pools are not rebuilt yet). The strings of
// a content (its talks) are on the stage page.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { romfsHref } from '../romfs/RomfsPage';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { MessageView } from '../ui/message';
import { hex8 } from '../util/bytes';
import { LanaiMessage } from './MessageView';
import type { LanaiSession, LanaiTableRef } from './session';
import type { LanaiTable } from './table';

/** Fields that are not text (the voice data starts with C0 DE B0 D0; naauao lanai/analysis.md §2.2). */
const NOT_TEXT = new Set(['voice']);

export const tableKey = (t: LanaiTableRef): string => `${t.archive}:${hex8(t.entry)}`;
export const messagesHref = (t: LanaiTableRef, row?: number): string => `#/messages/${tableKey(t)}${row === undefined ? '' : `:${row}`}`;

/**
 * Whether a string column holds ASCII names (file and layout names, URLs: Font, layout, EffectData …) rather than
 * UTF-16 text: every sampled string is printable ASCII bytes up to its NUL, and some of them cannot be UTF-16. A
 * UTF-16 string has NULs (its ASCII characters, tags) or bytes above 0x7E (most kana and kanji) within a few characters.
 */
function asciiColumn(t: LanaiTable, offset: number): boolean {
  let n = 0;
  for (let r = 0; r < t.rows && n < 16; r++) {
    const o = t.stringOffset(r, offset);
    if (o < 0 || (!t.data[o] && !t.data[o + 1])) continue;
    let i = o;
    for (; i < t.data.length && t.data[i]; i++) if (t.data[i]! < 0x20 || t.data[i]! > 0x7e) return false;
    // undecided: one byte (a UTF-16 string starting with an ASCII letter), or an even length ending in 00 00 (a UTF-16
    // string of kana whose bytes all happen to be printable, "あいか" 42 30 44 30 4B 30)
    if (i - o >= 2 && ((i - o) % 2 || t.data[i + 1])) n++;
  }
  return n > 0;
}

const columns = new WeakMap<LanaiTable, { offset: number; name: string }[]>();

/** The string columns of a table that hold text. */
export function textColumns(t: LanaiTableRef): { offset: number; name: string }[] {
  let c = columns.get(t.table);
  if (!c) {
    c = t.table.stringOffsets()
      .map((offset) => ({ offset, name: t.table.fieldName(offset) ?? `+${offset.toString(16).toUpperCase()}` }))
      .filter((x) => !NOT_TEXT.has(x.name) && !asciiColumn(t.table, x.offset));
    columns.set(t.table, c);
  }
  return c;
}

/** A row of the list: a table row with at least one string. */
interface Entry {
  ref: LanaiTableRef;
  row: number;
  key: string;
}

const PAGE = 300;

/** "MessageCommon", or with the file name (else the entry) when several tables have that name ("MessageMenu (…)"). */
function tableLabels(tables: LanaiTableRef[]): Map<string, string> {
  const n = new Map<string, number>();
  for (const t of tables) n.set(t.table.name, (n.get(t.table.name) ?? 0) + 1);
  return new Map(tables.map((t) => [tableKey(t), n.get(t.table.name)! > 1 ? `${t.table.name} (${t.file ?? hex8(t.entry)})` : t.table.name]));
}

export function LanaiMessagePage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  // the message tables (Message*) first, then the other tables with strings (names of items, monsters …)
  const tables = useMemo(() => {
    const ts = session.tables.filter((t) => textColumns(t).length);
    return [...ts.filter((t) => t.table.name.startsWith('Message')), ...ts.filter((t) => !t.table.name.startsWith('Message'))];
  }, [session]);
  const labels = useMemo(() => tableLabels(tables), [tables]);
  /** Every row that holds a string, in the order of the tables. */
  const all = useMemo(() => tables.flatMap((ref) => {
    const cols = textColumns(ref);
    const out: Entry[] = [];
    for (let r = 0; r < ref.table.rows; r++) if (cols.some((c) => ref.table.stringOffset(r, c.offset) >= 0)) out.push({ ref, row: r, key: `${tableKey(ref)}:${r}` });
    return out;
  }), [tables]);
  const byKey = useMemo(() => new Map(all.map((e) => [e.key, e])), [all]);
  const m = /^([0-9A-F]{8}:[0-9A-F]{8})(?::(\d+))?$/i.exec(arg ?? '');
  const wanted = m ? `${m[1]!.toUpperCase()}:${m[2] ?? all.find((e) => tableKey(e.ref) === m[1]!.toUpperCase())?.row ?? 0}` : undefined;
  const selected = useSticky<string>(wanted, (k) => byKey.has(k), () => all.find((e) => e.ref.table.name === 'MessageCommon')?.key ?? all[0]?.key ?? '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  /** The strings of a row as a reader sees them, without markup, for the list and the search. */
  const plain = (e: Entry): string[] => textColumns(e.ref).map((c) => {
    const o = e.ref.table.stringOffset(e.row, c.offset);
    return o < 0 ? '' : session.plainAt(e.ref.table, o);
  });
  const q = query.trim();
  // the plain strings of every row (made when first searched)
  const haystack = useMemo(() => (q ? new Map(all.map((e) => [e.key, plain(e).join('\n')])) : null), [all, !q]); // eslint-disable-line react-hooks/exhaustive-deps -- made once a search starts
  const qid = /^(0x)?[0-9a-f]{1,8}$/i.test(q) ? parseInt(q.replace(/^0x/i, ''), 16) : NaN;
  const shown = all.filter((e) => {
    if (filter !== 'all' && tableKey(e.ref) !== filter) return false;
    return !q || e.ref.table.rowId(e.row) === qid || !!haystack?.get(e.key)?.includes(q);
  });
  const sel = byKey.get(selected);
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="本文か行 ID (8000000C) で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべての表'], ...tables.map((t): [string, string] => [tableKey(t), labels.get(tableKey(t))!])]} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={all.length} />
          <table className="book-table">
            <thead><tr><th>表</th><th>ID</th><th>本文</th></tr></thead>
            <tbody>
              {shown.slice(0, limit).map((e) => (
                <tr key={e.key} className={e.key === selected ? 'active' : ''} onClick={() => (location.hash = messagesHref(e.ref, e.row))}>
                  <td className="muted nowrap small">{e.ref.table.name}</td>
                  <td className="num muted mono">{hex8(e.ref.table.rowId(e.row))}</td>
                  <td className="msg-cell">{plain(e).find((s) => s) || <span className="muted">(空)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${shown.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {sel ? <RowStrings key={sel.key} session={session} e={sel} label={labels.get(tableKey(sel.ref))!} /> : <p className="muted">表がありません。</p>}
      </div>
    </div>
  );
}

const HELP = 'ルビは {ruby:親字|よみ}、改ページは {page}、ほかの表の文字列の差し込みは {ins:表:行 ID:欄}、ほかのタグは {tag:XX,引数…} で表しています。文字列は表の文字列領域にあり、作り直しにまだ対応していないので、ここでは表示だけです。';

/** The strings of a row, each in the message box (the RPG2 / RPG3 message page's detail). */
function RowStrings({ session, e, label }: { session: LanaiSession; e: Entry; label: string }): ReactNode {
  const t = e.ref.table;
  const id = t.rowId(e.row);
  return (
    <>
      <div className="book-head">
        <h2>{`メッセージ ${hex8(id)}`}</h2>
        <span className="muted">{`${label} の行 ${e.row} · `}</span>
        <a className="muted mono" href={romfsHref(e.ref.archive, e.ref.entry)} title="RomFS ビューで表のすべての欄を見る">{`${e.ref.archive} / ${hex8(e.ref.entry)}${e.ref.file ? ` ${e.ref.file}` : ''}`}</a>
      </div>
      {textColumns(e.ref).map((c) => {
        const s = session.field(t, e.row, c.offset);
        return (
          <div key={c.offset} className="msg-slot">
            <div className="msg-slot-head mono">{c.name}</div>
            {s ? <MessageView head={`${hex8(id)} · ${t.name}.${c.name}`} preview={<LanaiMessage session={session} tokens={s.tokens} />} text={s.text} note="RPG FREE! の文字列はまだ書き換えられません。" />
              : <div className="msg-edit"><div className="muted">(なし)</div></div>}
          </div>
        );
      })}
      <p className="muted small">{HELP}</p>
    </>
  );
}
