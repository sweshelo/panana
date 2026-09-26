// Action list: every actionData row with the fields known so far, its raw words, and what refers to it
// (items' use effect, monsters' skills).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { h } from '../editor/dom';
import { ACTION_KIND, itemEffect, type Action, type ActionBook } from '../game/actions';
import { mountReact } from '../ui/mount';
import { hex8, s16, u32 } from '../util/bytes';

export const actionHref = (row: number): string => `#/actions/${row}`;

/** Offsets of the fields that are decoded (the raw table marks them). */
const KNOWN: Record<number, string> = { 0x00: 'w0 (種類・効果・付与・使える場面)', 0x04: '名前 (メッセージ)', 0x18: '量 (s16 最小 / 最大)' };

type Filter = 'item' | 'used-item' | 'skill' | 'all';
type Book = Pick<ActionBook, 'actions' | 'action' | 'refsOf'>;

/** The page as app.ts uses it: a `.book` element and show(row) from the router. */
export class ActionPage {
  readonly el = h('div', { class: 'book' });
  private readonly render = mountReact(this.el);
  private selected = -1;

  constructor(private readonly book: Book) {}

  show(row?: number): void {
    if (row !== undefined && this.book.action(row)) this.selected = row;
    if (this.selected < 0) this.selected = this.book.actions.find((a) => a.kind === 2)?.row ?? 0;
    this.render(<ActionView book={this.book} selected={this.selected} />);
  }
}

export function ActionView({ book, selected }: { book: Book; selected: number }): ReactNode {
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
      <div className="book-detail">{a && <ActionDetail action={a} book={book} />}</div>
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
                <td className="muted">{itemEffect(a) || kindLabel(a.kind)}</td>
                <td className="num muted">{n ? n : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActionDetail({ action: a, book }: { action: Action; book: Book }): ReactNode {
  const refs = book.refsOf(a.row);
  const [lo, hi] = a.amount;
  const field = (label: string, v: string, note = ''): ReactNode => (
    <tr><td>{label}</td><td>{v}</td><td className="muted">{note}</td></tr>
  );
  return (
    <>
      <div className="book-head">
        <h2>{a.name || `アクション #${a.row}`}</h2>
        <span className="muted">{`#${a.row}  ${kindLabel(a.kind)}  (actionData.bin、${a.raw.length} バイト)`}</span>
      </div>
      {itemEffect(a) && <div className="model-line">{`効果: ${itemEffect(a)}`}</div>}
      <h3>内容</h3>
      <table className="enc-table action-fields">
        <tbody>
          <tr><th>欄</th><th>値</th><th></th></tr>
          {field('+0x00 w0', `0x${hex8(a.w0)}`)}
          {field('  bit1-2 種類', String(a.kind), kindLabel(a.kind))}
          {field('  bit3-6 効果の種別', String(a.type), a.kind === 2 ? '' : 'アイテム以外での意味は未解析')}
          {field('  bit13-15 付与の段階', String(a.level), 'ワザの状態異常の基本の率 (BattleParameter [0x60 + 段階])')}
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
