// Action list: every actionData row with the fields known so far, its raw words, and what refers to it
// (items' use effect, monsters' skills).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACTION_KIND, ActionBook, actionKindLabel, actionTypeLabel, itemEffect, type Action } from '../game/actions';
import type { Monster } from '../game/monsters';
import type { Session } from '../session';
import { actionEdits, ActionEditor } from '../ui/ActionEditor';
import { useEdits, useSticky, type PageProps } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ActionPreview } from '../ui/PerformanceEditor';
import { hex8, s16, u32 } from '../util/bytes';

export const actionHref = (row: number): string => `#/actions/${row}`;

/** Offsets of the fields that are decoded (the raw table marks them). */
const KNOWN: Record<number, string> = { 0x00: 'w0 (種類・効果・付与・使える場面)', 0x04: '名前 (メッセージ)', 0x18: '量 (s16 最小 / 最大)', 0x1c: '演出の進行 / 使用者の演出 (directData)', 0x20: '対象 / 追加の演出 (directData)', 0x24: 'その他の演出 (directData)', 0x28: 'その他の演出 (directData)', 0x2c: '別の組の演出 (directData)' };

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
  return (
    <div className="book">
      <ActionView book={book} selected={selected}
        editor={(a) => <ActionEdit session={session} book={book} row={a.row} onChange={changed} />} />
    </div>
  );
}

const EDIT_INFO = [
  '「複製」で、この行を写した新しいアクションを表の最後に足します。モンスターのワザの枠で選べます。',
  '新しいワザは、既存のワザの組み替えで作れます: 演出の枠 (使用者・対象・追加) にほかのモンスターのワザや変身の演出を入れ、「効果を写す」でほかのワザの効果を写します。',
  '演出を変えたアクションは、演出の表 (2713402F の directData.bin) も書き出します。',
].join('\n');

/** The editable fields of the action, copying it, and putting it back. */
function ActionEdit({ session, book, row, onChange }: { session: Session; book: ActionBook; row: number; onChange: () => void }): ReactNode {
  const edits = actionEdits(session);
  const users = book.refsOf(row).monsters.map((m) => session.book?.monster(m.row)).filter((m): m is Monster => !!m);
  const added = edits.added(row);
  return (
    <section>
      <h3 className="with-info">
        {'編集'}<InfoTip text={EDIT_INFO} />
        {added && <span className="muted small">{' (追加したアクション)'}</span>}
      </h3>
      <ActionEditor session={session} actions={book} row={row} monsters={users} onChange={onChange} />
      <div className="row">
        <button onClick={() => {
          const n = edits.copy(row);
          onChange();
          location.hash = actionHref(n);
        }}>複製して新しいワザにする</button>
        {!added && <button disabled={!edits.changed(row)} onClick={() => { edits.revert(row); session.book?.reload(); onChange(); }}>元に戻す</button>}
      </div>
      {session.book?.directData && <ActionPreview session={session} actions={book} edits={edits} row={row} users={users} onChange={onChange} />}
    </section>
  );
}

export function ActionView({ book, selected, editor }: { book: Book; selected: number; editor?: (a: Action) => ReactNode }): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('item');
  const a = book.action(selected);
  return (
    <>
      <div className="book-side">
        <div className="row">
          <input type="search" placeholder="名前・効果・アイテム・モンスターで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="item">アイテムの効果 (種類 2)</option>
            <option value="used-item">アイテムが使う</option>
            <option value="skill">モンスターのワザ</option>
            <option value="all">すべて</option>
          </select>
        </div>
        <ActionList book={book} rows={book.actions.filter((x) => matches(book, x, query.trim(), filter))} selected={selected} />
      </div>
      <div className="book-detail">{a && <ActionDetail action={a} book={book} editor={editor} />}</div>
    </>
  );
}

function matches(book: Book, a: Action, q: string, f: Filter): boolean {
  const refs = book.refsOf(a.row);
  if (q && ![a.name, itemEffect(a), ...refs.items.map((i) => i.name), ...refs.monsters.map((m) => m.name)].some((t) => t.includes(q))) return false;
  if (f === 'item') return a.kind === 2;
  if (f === 'used-item') return refs.items.length > 0;
  if (f === 'skill') return refs.monsters.length > 0;
  return true;
}

function ActionList({ book, rows, selected }: { book: Book; rows: Action[]; selected: number }): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' }), [selected]);
  return (
    <div className="book-list" ref={list}>
      <div className="muted small">{`${rows.length} / ${book.actions.length} 件`}</div>
      <table className="book-table">
        <thead>
          <tr><th>#</th><th>名前</th><th>内容</th><th title="使うアイテムとモンスターの数">参照</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const refs = book.refsOf(a.row);
            const n = refs.items.length + refs.monsters.length;
            return (
              <tr key={a.row} className={a.row === selected ? 'active' : ''} onClick={() => (location.hash = actionHref(a.row))}>
                <td className="num muted">{a.row}</td>
                <td>{a.name || <span className="muted">(名前なし)</span>}</td>
                <td className="muted">{itemEffect(a) || actionKindLabel(a.kind, a.type)}</td>
                <td className="num muted">{n ? n : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActionDetail({ action: a, book, editor }: { action: Action; book: Book; editor?: (a: Action) => ReactNode }): ReactNode {
  const refs = book.refsOf(a.row);
  const [lo, hi] = a.amount;
  const field = (label: string, v: string, note = ''): ReactNode => (
    <tr><td>{label}</td><td>{v}</td><td className="muted">{note}</td></tr>
  );
  return (
    <>
      <div className="book-head">
        <h2>{a.name || `アクション #${a.row}`}</h2>
        <span className="muted">{`#${a.row}  ${actionKindLabel(a.kind, a.type)}  (actionData.bin、${a.raw.length} バイト)`}</span>
      </div>
      {itemEffect(a) && <div className="model-line">{`効果: ${itemEffect(a)}`}</div>}
      {editor?.(a)}
      <h3>内容</h3>
      <table className="enc-table action-fields">
        <tbody>
          <tr><th>欄</th><th>値</th><th></th></tr>
          {field('+0x00 w0', `0x${hex8(a.w0)}`)}
          {field('  bit1-2 種類', String(a.kind), kindLabel(a.kind))}
          {field('  bit3-6 種別', String(a.type), actionTypeLabel(a.kind, a.type))}
          {field('  bit13-15 付与の段階', String(a.level), '状態異常を付ける基本の率 (BattleParameter [0x60 + 段階])。攻撃では +0x32 の追加効果の率')}
          {field('  bit29-31 使える場面', a.scenes.join('・') || 'なし', 'アイテム')}
          {field('+0x04 名前', a.nameId ? `${a.nameId} (0x${a.nameId.toString(16).toUpperCase()})` : '0', a.name)}
          {field('+0x18 / +0x1A 量', `${lo} / ${hi}`, a.kind === 2 && a.type <= 1 ? '回復量 (最小〜最大)' : '')}
        </tbody>
      </table>
      <div className="book-cols">
        <section>
          <h3>{`使うアイテム (${refs.items.length})`}</h3>
          {refs.items.length ? (
            <ul>{refs.items.map((i) => <li key={i.id}><a href={`#/items/${i.id}`}>{i.name}</a> <span className="muted">{`#${i.id}`}</span></li>)}</ul>
          ) : (
            <div className="muted">なし (itemData +0x24、道具のみ)</div>
          )}
        </section>
        <section>
          <h3>{`ワザとして持つモンスター (${refs.monsters.length})`}</h3>
          {refs.monsters.length ? (
            <ul>{refs.monsters.map((m) => <li key={m.row}><a href={`#/monsters/${m.row}`}>{m.name}</a> <span className="muted">{`#${m.row}`}</span></li>)}</ul>
          ) : (
            <div className="muted">なし (MonsterParameter +0x3C)</div>
          )}
        </section>
      </div>
      <h3>生データ</h3>
      <RawTable raw={a.raw} />
    </>
  );
}

function kindLabel(kind: number): string {
  return ACTION_KIND[kind] ?? `種類 ${kind}`;
}

/** The row as u32 words (hex, decimal, two s16), with the decoded offsets marked. */
function RawTable({ raw }: { raw: Uint8Array }): ReactNode {
  const rows: ReactNode[] = [];
  for (let o = 0; o + 4 <= raw.length; o += 4) {
    const v = u32(raw, o);
    rows.push(
      <tr key={o} className={KNOWN[o] ? 'known' : v ? '' : 'muted'}>
        <td className="mono">{`+0x${o.toString(16).toUpperCase().padStart(2, '0')}`}</td>
        <td className="mono">{hex8(v)}</td>
        <td className="num">{v}</td>
        <td className="num">{`${s16(raw, o)} / ${s16(raw, o + 2)}`}</td>
        <td className="muted">{KNOWN[o] ?? ''}</td>
      </tr>,
    );
  }
  const rest = raw.length % 4;
  return (
    <table className="enc-table action-raw">
      <tbody>
        <tr><th>オフセット</th><th>u32 (16 進)</th><th>u32</th><th>s16 × 2</th><th></th></tr>
        {rows}
        {rest > 0 && (
          <tr><td className="muted" colSpan={5}>{`残り ${rest} バイト: ${[...raw.subarray(raw.length - rest)].join(' ')}`}</td></tr>
        )}
      </tbody>
    </table>
  );
}
