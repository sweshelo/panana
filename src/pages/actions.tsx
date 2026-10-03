// Action list: every actionData row with the fields known so far, its raw words, and what refers to it
// (items' use effect, monsters' skills).
import { useMemo, useState, type ReactNode } from 'react';
import { ActionBook, actionKindLabel, itemEffect, type Action } from '../game/actions';
import { KAHARA_ACTION_DATA } from '../game/kaharatables';
import type { FieldContext } from '../game/tabledef';
import type { Monster } from '../game/monsters';
import type { Session } from '../session';
import { actionEdits, ActionEditor } from '../ui/ActionEditor';
import { useEdits, useSticky, type PageProps } from '../ui/book';
import { ActionButtons, ActionHead, ActionListPane, ActionUsers } from '../ui/ActionParts';
import { ActionPreview } from '../ui/PerformanceEditor';
import { RowFields } from '../ui/RowFields';

export const actionHref = (row: number): string => `#/actions/${row}`;

type Filter = 'item' | 'used-item' | 'skill' | 'all';
type Book = Pick<ActionBook, 'actions' | 'action' | 'refsOf'>;

export function ActionPage({ session, arg, visit }: PageProps): ReactNode {
  const { game, book: monsters } = session;
  const [edits, edited] = useEdits();
  // Rebuilt on every visit and edit: the items and monsters that use each action may have been edited elsewhere.
  const book = useMemo((): ActionBook | string => {
    try {
      return new ActionBook(game.master, (row) => monsters?.monster(row)?.name ?? '', monsters?.directData ?? null);
    } catch (err) {
      return `アクションの表を読めませんでした: ${(err as Error).message}`;
    }
  }, [game, monsters, visit, edits]);
  const row = arg ? Number(arg) : undefined;
  const selected = useSticky(row, (r) => typeof book !== 'string' && !!book.action(r),
    () => (typeof book === 'string' ? 0 : book.actions.find((a) => a.kind === 2)?.row ?? 0));
  if (typeof book === 'string') return <div className="start"><div className="error">{book}</div></div>;
  const changed = (): void => {
    session.scheduleSave();
    edited();
  };
  const master = game.master;
  return (
    <div className="book">
      <ActionView book={book} selected={selected} context={{ message: (id) => master.message(id) }}
        original={(r) => (r < master.originalRows('actionData.bin') ? master.originalRow('actionData.bin', r) : undefined)}
        editor={(a) => <ActionEdit session={session} book={book} row={a.row} onChange={changed} />} />
    </div>
  );
}

const EDIT_INFO = [
  'この行を写した新しいアクションを表の最後に足します。名前は同じ本文の新しいメッセージになります。モンスターのワザの枠で選べます。',
  '新しいワザは、既存のワザの組み替えで作れます: 演出の枠 (使用者・対象・追加) にほかのモンスターのワザや変身の演出を入れ、「効果を写す」でほかのワザの効果を写します。',
  '演出を変えたアクションは、演出の表 (2713402F の directData.bin) も書き出します。',
].join('\n');

/** The editable fields of the action, copying it, putting it back, and the preview of its performance. */
function ActionEdit({ session, book, row, onChange }: { session: Session; book: ActionBook; row: number; onChange: () => void }): ReactNode {
  const edits = actionEdits(session);
  const users = book.refsOf(row).monsters.map((m) => session.book?.monster(m.row)).filter((m): m is Monster => !!m);
  const added = edits.added(row);
  return (
    <>
      <ActionEditor session={session} actions={book} row={row} monsters={users} onChange={onChange} />
      <ActionButtons note="変更はマスター (56562135) の actionData.bin と、演出を変えたときは 2713402F の directData.bin として書き出されます。" copyInfo={EDIT_INFO}
        canCopy cannotCopy="" onCopy={() => { const n = edits.copy(row); onChange(); location.hash = actionHref(n); }}
        onRevert={!added && edits.changed(row) ? () => { edits.revert(row); session.book?.reload(); onChange(); } : undefined} />
      {session.book?.directData && <ActionPreview session={session} actions={book} edits={edits} row={row} users={users} onChange={onChange} />}
    </>
  );
}

const FILTERS: [Filter, string][] = [['item', 'アイテムの効果 (種類 2)'], ['used-item', 'アイテムが使う'], ['skill', 'モンスターのワザ'], ['all', 'すべて']];

export function ActionView({ book, selected, editor, context, original }: {
  book: Book;
  selected: number;
  editor?: (a: Action) => ReactNode;
  /** Names of the messages in the table of all the fields. */
  context?: FieldContext;
  /** The row in the archive (undefined for an added row), to mark the changed fields. */
  original?: (row: number) => Uint8Array | undefined;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('item');
  const a = book.action(selected);
  const rows = book.actions.filter((x) => matches(book, x, query.trim(), filter));
  return (
    <>
      <ActionListPane
        rows={rows.map((x) => {
          const refs = book.refsOf(x.row);
          const n = refs.items.length + refs.monsters.length;
          return { row: x.row, name: x.name || <span className="muted">(名前なし)</span>, cells: [itemEffect(x) || actionKindLabel(x.kind, x.type), n ? String(n) : ''] };
        })}
        total={book.actions.length} columns={[['内容'], ['参照', '使うアイテムとモンスターの数']]} selected={selected} href={actionHref}
        query={query} setQuery={setQuery} placeholder="名前・効果・アイテム・モンスターで検索" filter={filter} setFilter={setFilter} filters={FILTERS} />
      <div className="book-detail">{a && <ActionDetail action={a} book={book} editor={editor} context={context} original={original?.(a.row)} />}</div>
    </>
  );
}

function matches(book: Book, a: Action, q: string, f: Filter): boolean {
  const refs = book.refsOf(a.row);
  if (q && String(a.row) !== q && ![a.name, itemEffect(a), ...refs.items.map((i) => i.name), ...refs.monsters.map((m) => m.name)].some((t) => t.includes(q))) return false;
  if (f === 'item') return a.kind === 2;
  if (f === 'used-item') return refs.items.length > 0;
  if (f === 'skill') return refs.monsters.length > 0;
  return true;
}

function ActionDetail({ action: a, book, editor, context, original }: { action: Action; book: Book; editor?: (a: Action) => ReactNode; context?: FieldContext; original?: Uint8Array }): ReactNode {
  const refs = book.refsOf(a.row);
  return (
    <>
      <ActionHead title={a.name || `アクション #${a.row}`} sub={`actionData の行 ${a.row}  ${actionKindLabel(a.kind, a.type)}`} />
      {itemEffect(a) && <div className="model-line">{`効果: ${itemEffect(a)}`}</div>}
      {editor?.(a)}
      <ActionUsers monsters={refs.monsters.map((m) => ({ key: `m${m.row}`, name: m.name, href: `#/monsters/${m.row}` }))}
        items={refs.items.map((i) => ({ key: `i${i.id}`, name: i.name, href: `#/items/${i.id}` }))} />
      <details className="row-fields-box" open={!editor}>
        <summary>{`actionData の行 ${a.row} のすべての欄`}</summary>
        {a.raw.length >= KAHARA_ACTION_DATA.rowSize
          ? <RowFields def={KAHARA_ACTION_DATA} row={a.raw} original={original} context={context} />
          : <div className="muted">{`行が短い (${a.raw.length} バイト)`}</div>}
      </details>
    </>
  );
}
