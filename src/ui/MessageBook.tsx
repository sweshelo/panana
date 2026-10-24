// The message page of a game whose messages are one GMSG store over its files (RPG3, 初代; #/messages/<ID>): every
// message, searchable by text or ID, filtered by file, edited with the shared MessageEditor. A game gives its store, its
// files (one per name and range) and how an edit is kept (saved, undo).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import type { MessageFile, MessageStore } from '../game/gmsg';
import { Count, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from './book';
import { MessageEditor } from './message';

export const messageHref = (id: number): string => `#/messages/${id}`;

/** The route argument: a decimal ID or 0x… (the links of the message previews). */
export function parseMessageArg(arg: string | undefined): number | undefined {
  if (!arg) return undefined;
  const v = /^0x[0-9a-f]+$/i.test(arg) ? parseInt(arg, 16) : /^\d+$/.test(arg) ? Number(arg) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

const PAGE = 300;

export function MessageBook({ texts, files, arg, onEdit, placeholder, help }: {
  texts: MessageStore;
  /** The files of the filter and the list (copies of a file in other archives left out). */
  files: MessageFile[];
  arg: string | undefined;
  /** Called after each edit (save it). */
  onEdit: () => void;
  /** The search box's hint (e.g. which IDs there are). */
  placeholder: string;
  /** Under the editor: how the tags are written. */
  help: ReactNode;
}): ReactNode {
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
  // a file is named by its name and range: two files of one name (初代's unnamed entries) stay apart
  const fileKey = (f: MessageFile): string => `${f.name}:${f.gmsg.first}`;
  const shown = all.filter(([id, text]) => {
    const f = texts.file(id);
    if (filter === 'edited' ? !texts.isEdited(id) : filter !== 'all' && (!f || fileKey(f) !== filter)) return false;
    return !q || id === qid || text.includes(q);
  });
  const apply = (f: () => void): void => {
    f();
    edited();
    onEdit();
  };
  const file = texts.file(selected);
  const copies = file ? texts.files.filter((f) => f.name === file.name && f.gmsg.first === file.gmsg.first).map((f) => f.archive) : [];
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder={placeholder} filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべてのファイル'], ...files.map((f): [string, string] => [fileKey(f), `${f.name.replace(/_JP\.gsmb$/, '')} (${f.gmsg.first}〜)`]), ['edited', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={all.length} />
          <table className="book-table">
            <thead><tr><th>ID</th><th>本文</th></tr></thead>
            <tbody>
              {shown.slice(0, limit).map(([id, text]) => (
                <tr key={id} className={id === selected ? 'active' : ''} onClick={() => (location.hash = messageHref(id))}>
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
        <p className="muted small">{help}</p>
      </div>
    </div>
  );
}
