// RPG3's messages (#/messages/<ID>): every message of every file, searchable by text or ID, edited with the shared
// MessageEditor. Edits are kept by ID (saved on this device) and exported with the Update's files.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import { Count, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { MessageEditor } from '../ui/message';
import type { OahuSession } from './session';

export const oahuMessageHref = (id: number): string => `#/messages/${id}`;

/** The route argument: a decimal ID or 0x… (the links of the message previews). */
export function parseMessageArg(arg: string | undefined): number | undefined {
  if (!arg) return undefined;
  const v = /^0x[0-9a-f]+$/i.test(arg) ? parseInt(arg, 16) : /^\d+$/.test(arg) ? Number(arg) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

const PAGE = 300;

export function OahuMessagePage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { messages } = session;
  const texts = messages.texts;
  const files = messages.files;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const selected = useSticky(parseMessageArg(arg), (id) => !!texts.file(id), () => files.find((f) => f.gmsg.raw.length)?.gmsg.first ?? 0);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);

  /** Every message: [id, one-line preview]. */
  const all = useMemo(() => files.flatMap((f) => Array.from({ length: f.gmsg.raw.length }, (_, i): [number, string] => {
    const id = f.gmsg.first + i;
    return [id, texts.preview(id, true) ?? ''];
  })), [files, texts, edits]);
  const q = query.trim();
  const qid = parseMessageArg(q);
  const shown = all.filter(([id, text]) => {
    if (filter === 'edited' ? !texts.isEdited(id) : filter !== 'all' && texts.file(id)?.name !== filter) return false;
    return !q || id === qid || text.includes(q);
  });
  const apply = (f: () => void): void => {
    f();
    edited();
    session.scheduleSave();
  };
  const file = texts.file(selected);
  const copies = file ? texts.files.filter((f) => f.name === file.name && f.gmsg.first === file.gmsg.first).map((f) => f.archive) : [];
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="本文か ID (40000、0x9C40) で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべてのファイル'], ...files.map((f): [string, string] => [f.name, `${f.name.replace(/_JP\.gsmb$/, '')} (${f.gmsg.first}〜)`]), ['edited', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={all.length} />
          <table className="book-table">
            <thead><tr><th>ID</th><th>本文</th></tr></thead>
            <tbody>
              {shown.slice(0, limit).map(([id, text]) => (
                <tr key={id} className={id === selected ? 'active' : ''} onClick={() => (location.hash = oahuMessageHref(id))}>
                  <td className="num muted">{id}{texts.isEdited(id) && <b className="edited"> ●</b>}</td>
                  <td className="msg-cell">{text || <span className="muted">(空)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${shown.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        <div className="book-head">
          <h2>{`メッセージ ${selected}`}</h2>
          <span className="muted">{`${hexId(selected)}${file ? ` · ${file.name} (${copies.join('・')})` : ''}`}</span>
        </div>
        {copies.length > 1 && <p className="muted small">{`このファイルは ${copies.length} つのアーカイブに同じものが入っています。編集はすべてに書き出します。`}</p>}
        <MessageEditor texts={texts} id={selected} apply={apply} />
        <p className="muted small">{'ルビは {ruby:親字|よみ}、改ページは {page} です。ほかのタグはまだ意味が分かっていないので、{tag:XXXX} のまま残してください。'}</p>
      </div>
    </div>
  );
}
