// The parts of a monster's page shared by RPG2 and RPG3: the drop slots and the skill slots as name boards (picked
// from a dialog, skills reordered by dragging) and the resistance charts. Each game passes its entries and pickers.
import { useRef, useState, type ReactNode } from 'react';
import { Board, EmptyBoard } from './Board';
import { InfoTip } from './InfoTip';
import { Radar } from './Radar';

/** A section heading with its explanation behind an info icon. */
export function Heading({ title, info }: { title: string; info: string }): ReactNode {
  return <h3 className="with-info">{title}<InfoTip text={info} /></h3>;
}

/** Badge of an action (no model): its element, or a letter of its kind; colored by the element. */
export function ActionBadge({ element, label }: { element: number; label: string }): ReactNode {
  return <span className={`badge-icon elem-${element}`}>{label}</span>;
}

/** What a board shows of an entry (an item, a monster, an action). */
export interface BoardEntry {
  icon: ReactNode;
  name: string;
  href: string;
}

/** A picker dialog opened by a slot: what is there now and what to do with the pick. */
export type RenderPicker = (current: number | undefined, pick: (id: number) => void, close: () => void) => ReactNode;

export interface DropSlot {
  item: number;
  /** The item in the archive. */
  original: number;
  /** Second line of the board (the class and the odds). */
  sub?: string;
  /** The input of the rate. */
  rate: ReactNode;
}

/** Drop slots: the item's board (picked from the pictures), the rate, × to empty the slot. */
export function DropSlots({ info, slots, entry, setItem, picker }: {
  info: string;
  slots: DropSlot[];
  entry: (item: number) => BoardEntry;
  setItem: (slot: number, item: number) => void;
  picker: (slot: number, current: number, pick: (id: number) => void, close: () => void) => ReactNode;
}): ReactNode {
  const [picking, setPicking] = useState<number | null>(null);
  return (
    <section>
      <Heading title="ドロップ" info={info} />
      <div className="slot-list drop-slots">
        {slots.map((d, k) => {
          const e = d.item ? entry(d.item) : null;
          return (
            <div key={k} className="slot-row">
              {e
                ? <Board icon={e.icon} name={e.name} sub={d.sub} id={d.item} href={e.href} edited={d.item !== d.original}
                    title={d.item !== d.original ? `元: ${d.original ? entry(d.original).name : 'なし'}` : 'アイテムを選び直す'}
                    onClick={() => setPicking(k)} />
                : <EmptyBoard label="＋ アイテム" title="この枠にアイテムを入れる" onClick={() => setPicking(k)} />}
              {d.rate}
              <button className="small slot-remove" title="この枠を空にする" disabled={!d.item} onClick={() => setItem(k, 0)}>×</button>
            </div>
          );
        })}
      </div>
      {picking !== null && picker(picking, slots[picking]?.item ?? 0, (id) => { setPicking(null); setItem(picking, id); }, () => setPicking(null))}
    </section>
  );
}

export interface SkillSlot {
  action: number;
  /** The board: the action's badge, name and link. */
  entry: BoardEntry;
  sub?: string;
  edited: boolean;
  /** Inputs after the board (the share, a condition, an edit button). */
  extra?: ReactNode;
}

/**
 * The skill slots: drag to reorder, × to remove, ＋ to add (up to `max`), a board to pick another action. The slots are
 * changed through `move`, `pick` (slot index, or -1 to add) and `remove`.
 */
export function SkillSlots({ slots, max, move, pick, remove, picker, empty }: {
  slots: SkillSlot[];
  max: number;
  move: (from: number, to: number) => void;
  pick: (slot: number, action: number) => void;
  remove: (slot: number) => void;
  picker: RenderPicker;
  /** Said when there are no skills. */
  empty: string;
}): ReactNode {
  const [picking, setPicking] = useState<{ slot: number; current?: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const endDrag = (): void => {
    dragFrom.current = null;
    setDragging(null);
    setDropAt(null);
  };
  return (
    <>
      <div className="slot-list skill-slots">
        {slots.map((s, i) => {
          const cls = ['slot-row', i === dragging ? 'dragging' : '', i === dropAt ? 'drop-before' : '',
            dropAt === slots.length && i === slots.length - 1 ? 'drop-after' : ''].filter(Boolean).join(' ');
          return (
            <div key={`${i}:${s.action}`} className={cls} draggable
              onDragStart={(e) => {
                dragFrom.current = i;
                e.dataTransfer.setData('text/plain', `skill ${i}`);
                e.dataTransfer.effectAllowed = 'move';
                requestAnimationFrame(() => setDragging(i));
              }}
              onDragOver={(e) => {
                if (dragFrom.current === null) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY > r.top + r.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null && dropAt !== null && dropAt !== dragFrom.current && dropAt !== dragFrom.current + 1) move(dragFrom.current, dropAt);
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              <span className="drag-handle" title="ドラッグで並べ替え">⠿</span>
              <Board icon={s.entry.icon} name={s.entry.name} sub={s.sub} id={s.action} href={s.entry.href} edited={s.edited} title="ワザを選び直す"
                onClick={() => setPicking({ slot: i, current: s.action })} />
              {s.extra}
              <button className="small slot-remove" title="この枠を外す" onClick={() => remove(i)}>×</button>
            </div>
          );
        })}
        {slots.length < max && (
          <div className="slot-row">
            <span className="drag-handle" />
            <EmptyBoard label="＋ ワザを追加" onClick={() => setPicking({ slot: -1 })} />
          </div>
        )}
        {!slots.length && <div className="muted small">{empty}</div>}
      </div>
      {picking && picker(picking.current, (a) => { setPicking(null); pick(picking.slot, a); }, () => setPicking(null))}
    </>
  );
}

/** Move an element of a list before the position `to` (0〜length). */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [a] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, a!);
  return next;
}

export interface ResistAxis {
  name: string;
  value: number;
  original: number;
  /** Tooltip of the value (e.g. the state number). */
  title?: string;
}

export interface ResistChart {
  label: string;
  axes: ResistAxis[];
  /** Heading of the effect column of the table ("ダメージ", "係数"); no column when undefined. */
  effectHead?: string;
}

const fmt = (v: number): string => `${v > 0 ? '+' : ''}${v}`;

/**
 * Resistances by chart, each with its effect. The handles of the charts can be dragged; the tables (folded) pick any
 * value between `min` and `max`.
 */
export function ResistCharts({ charts, min, max, rings, effect, cell = effect, onChange }: {
  charts: ResistChart[];
  min: number;
  max: number;
  /** Rings of the charts (values). */
  rings: number[];
  /** The effect of a value on an axis ("×2 (弱点)"); '' for none. */
  effect: (chart: number, axis: number, v: number) => string;
  /** The effect as the table shows it (the same by default). */
  cell?: (chart: number, axis: number, v: number) => string;
  onChange: (chart: number, axis: number, v: number) => void;
}): ReactNode {
  const values = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return (
    <div className="resists">
      <div className="radars">
        {charts.map((c, ci) => (
          <figure key={c.label} className="radar-box">
            <Radar
              axes={c.axes.map((a) => ({ label: a.name, value: a.value, original: a.original }))}
              min={min}
              max={max}
              rings={rings}
              format={(v, j) => `${fmt(v)} ${effect(ci, j, v)}`.trimEnd()}
              onChange={(j, v) => onChange(ci, j, v)}
            />
            <figcaption>{`${c.label} (ドラッグで変更。点線 = 元の値)`}</figcaption>
          </figure>
        ))}
      </div>
      <details className="fold">
        <summary>数値で編集</summary>
        {charts.map((c, ci) => (
          <table key={c.label} className="res-table">
            <tbody>
              <tr><th>{c.label}</th><th>値</th>{c.effectHead && <th>{c.effectHead}</th>}</tr>
              {c.axes.map((a, j) => {
                const cls = a.value > 0 ? 'plus' : a.value < 0 ? 'minus' : '';
                return (
                  <tr key={j}>
                    <td>{a.name}</td>
                    <td>
                      <select className={a.value !== a.original ? 'edited' : ''} title={a.value !== a.original ? `元の値 ${fmt(a.original)}` : a.title}
                        value={a.value} onChange={(e) => onChange(ci, j, Number(e.target.value))}>
                        {[...new Set([...values, a.value])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{fmt(v)}</option>)}
                      </select>
                    </td>
                    {c.effectHead && <td className={`num ${cls}`}>{cell(ci, j, a.value)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </details>
    </div>
  );
}
