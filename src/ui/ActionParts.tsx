// The parts of the action pages shared by RPG2 (pages/actions.tsx) and RPG3 (oahu/ActionPage.tsx): the list with its
// search and filter, the head, the message boxes, who uses the action, and the buttons to copy, remove and revert.
// Each game keeps its own fields and edits; the layout and the controls are the same.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MessageStore } from '../game/gmsg';
import { Count, EditedMark, ListFilter, useActiveRow } from './book';
import { InfoTip } from './InfoTip';
import { MessageEditor } from './message';

const PAGE = 200;

/** A row of the action list: its cells after the row number and the name. */
export interface ActionListRow {
  row: number;
  name: ReactNode;
  cells: ReactNode[];
  edited?: boolean;
  /** Class of the name cell (RPG3 marks the rows of the caught monsters). */
  nameClass?: string;
}

/**
 * The left pane: a search box and a filter, the count, and the table (shown in pages of 200, always far enough to
 * show the selected row).
 */
export function ActionListPane<F extends string>({ rows, total, columns, selected, href, query, setQuery, placeholder, filter, setFilter, filters }: {
  rows: ActionListRow[];
  total: number;
  /** Headers of the cells after 行 and 名前, with a tooltip each when given. */
  columns: [string, string?][];
  selected: number;
  href: (row: number) => string;
  query: string;
  setQuery: (q: string) => void;
  placeholder: string;
  filter: F;
  setFilter: (f: F) => void;
  filters: [F, string][];
}): ReactNode {
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const at = rows.findIndex((a) => a.row === selected);
  const shown = Math.max(limit, at + 1);
  useActiveRow(list, selected);
  useEffect(() => setLimit(PAGE), [query, filter]);
  return (
    <div className="book-side">
      <ListFilter query={query} setQuery={setQuery} placeholder={placeholder} filter={filter} setFilter={setFilter} options={filters} />
      <div className="book-list" ref={list}>
        <Count shown={rows.length} total={total} />
        <table className="book-table">
          <thead><tr><th>行</th><th>名前</th>{columns.map(([c, title]) => <th key={c} title={title}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, shown).map((a) => (
              <tr key={a.row} className={a.row === selected ? 'active' : ''} onClick={() => (location.hash = href(a.row))}>
                <td className="num muted">{a.row}</td>
                <td className={`action-name ${a.nameClass ?? ''}`}>{a.name}{a.edited && <EditedMark text=" ●" />}</td>
                {a.cells.map((c, i) => <td key={i} className="muted nowrap">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > shown && <div className="row"><button onClick={() => setLimit(shown + PAGE * 5)}>{`続きを表示 (${rows.length - shown} 件)`}</button></div>}
      </div>
    </div>
  );
}

/** The head of the detail: the name and a line of where the row is and what it is. */
export function ActionHead({ title, sub }: { title: string; sub: string }): ReactNode {
  return (
    <div className="book-head">
      <h2>{title}</h2>
      <span className="muted">{sub}</span>
    </div>
  );
}

/** A message of the action: its id, where it is in the row, and the other actions using the same message. */
export interface ActionText {
  key: string;
  label: string;
  id: number;
  /** "actionData +0x08" (shown in the tooltip). */
  place: string;
  /** Other rows with the same message: editing it changes them too. */
  shared: number[];
  /** Give this action a message of its own (same text), when it can. */
  own?: () => void;
  /** More controls under the box (RPG2: pick another message). */
  extra?: ReactNode;
}

/** The message boxes (the editors' text form), with the actions sharing them and a button to make one this row's own. */
export function ActionTexts({ texts, fields, message, onEdit, href }: {
  texts: MessageStore;
  fields: ActionText[];
  message: (id: number) => string;
  onEdit: () => void;
  href: (row: number) => string;
}): ReactNode {
  const shown = fields.filter((t) => t.id && texts.units(t.id));
  if (!shown.length) return null;
  return (
    <table className="enc-table desc-table">
      <tbody>
        {shown.map((t) => (
          <tr key={t.key}>
            <th title={`${t.place}、メッセージ ${t.id}`}>{t.label}</th>
            <td className="book-desc">
              {texts.editable(t.id) || texts.isAdded(t.id)
                ? <MessageEditor texts={texts} id={t.id} compact apply={(f) => { f(); onEdit(); }} />
                : <span>{message(t.id)}</span>}
              {(t.shared.length > 0 || t.extra) && (
                <div className="small">
                  {t.shared.length > 0 && (
                    <span className="muted with-info">
                      {'同じメッセージ: '}
                      {t.shared.slice(0, 4).map((r, i) => <span key={r}>{i > 0 && '、'}<a href={href(r)}>{`#${r}`}</a></span>)}
                      {t.shared.length > 4 && ` ほか ${t.shared.length - 4}`}
                      <InfoTip text="書き換えると、同じメッセージを使うすべてのアクションで変わります。「このアクションだけの文にする」で、同じ本文の新しいメッセージを作ってこの行だけに付けられます。" />
                    </span>
                  )}
                  {t.shared.length > 0 && t.own && <button className="small" title="同じ本文の新しいメッセージを作り、この行に付けます" onClick={() => { t.own!(); onEdit(); }}>このアクションだけの文にする</button>}
                  {t.extra}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A user of the action: a link with a note ("自動" …). */
export interface ActionUser {
  key: string;
  name: string;
  href: string;
  note?: string;
}

/** The monsters and items that use the action, as links. */
export function ActionUsers({ monsters, items }: { monsters: ActionUser[]; items: ActionUser[] }): ReactNode {
  const link = (u: ActionUser): ReactNode => <a key={u.key} href={u.href}>{u.name}{u.note && <span className="muted small">{` (${u.note})`}</span>}</a>;
  return (
    <div className="row action-users">
      <span className="muted">{`ワザとして持つモンスター (${monsters.length}): `}</span>
      {monsters.length ? monsters.map(link) : <span className="muted">なし</span>}
      <span className="muted">{`使うアイテム (${items.length}): `}</span>
      {items.length ? items.map(link) : <span className="muted">なし</span>}
    </div>
  );
}

/** Copying the action to a new row, removing an added one, putting the row back; with where the edits are written. */
export function ActionButtons({ note, copyInfo, canCopy, cannotCopy, onCopy, onRemove, onRevert }: {
  note: string;
  copyInfo: string;
  canCopy: boolean;
  /** Why it cannot be copied. */
  cannotCopy: string;
  onCopy: () => void;
  /** Remove: only for an added row that can be removed. */
  onRemove?: () => void;
  /** Revert: only for a changed row of the archive. */
  onRevert?: () => void;
}): ReactNode {
  return (
    <div className="row">
      <span className="muted small">{note}</span>
      <span className="with-info">
        <button disabled={!canCopy} title={canCopy ? '' : cannotCopy} onClick={onCopy}>写して新しいアクションを作る</button>
        <InfoTip text={copyInfo} />
      </span>
      {onRemove && <button title="追加したアクションを消します (使っているワザやアイテムは直してください)" onClick={onRemove}>このアクションを消す</button>}
      {onRevert && <button onClick={onRevert}>このアクションの変更を元に戻す</button>}
    </div>
  );
}
