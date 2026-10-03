// Inputs of one numeric field of a row, shared by the books of RPG2 and RPG3: a number box, a list of the field's values
// with labels, a check box, and the grid of stats (one value or a "min 〜 max" range). A field differs from the archive
// is marked (its value in the tooltip). The fields are reached through a FieldAccess, so each game keeps its tables.
import type { ReactNode } from 'react';
import { NumberInput } from './book';
import { InfoTip } from './InfoTip';

/** Reading and writing the fields of one row. */
export interface FieldAccess {
  get(k: string): number;
  /** The value in the archive (for marking edits). */
  original(k: string): number;
  set(k: string, v: number): void;
  /** Values the field holds. */
  range(k: string): [number, number];
  /** A row added by an edit has no archive value: nothing is marked. */
  added?: boolean;
}

export interface FieldProps {
  f: FieldAccess;
  k: string;
  edited: () => void;
}

const changed = (f: FieldAccess, k: string): boolean => !f.added && f.get(k) !== f.original(k);

/** A number box for a field. */
export function FieldNumber({ f, k, edited, min, max }: FieldProps & { min?: number; max?: number }): ReactNode {
  const [lo, hi] = f.range(k);
  const v = f.get(k);
  const ch = changed(f, k);
  return (
    <NumberInput
      value={v}
      min={min ?? lo}
      max={max ?? hi}
      className={`num-input${ch ? ' edited' : ''}`}
      title={ch ? `元の値 ${f.original(k)}` : `${min ?? lo}〜${max ?? hi}`}
      onCommit={(x) => { f.set(k, x); edited(); }}
    />
  );
}

/** A select of a field's values: `options`, or every value of the field with `labels`. */
export function FieldChoice({ f, k, edited, labels, options, disabled, title }: FieldProps & { labels?: (v: number) => string; options?: [number, string][]; disabled?: boolean; title?: string }): ReactNode {
  const v = f.get(k);
  const [lo, hi] = f.range(k);
  const opts = options ?? Array.from({ length: hi - lo + 1 }, (_, i): [number, string] => [lo + i, (labels ?? String)(lo + i)]);
  const label = (x: number): string => opts.find(([o]) => o === x)?.[1] ?? String(x);
  const ch = changed(f, k);
  return (
    <select className={ch ? 'edited' : ''} title={ch ? `元の値 ${label(f.original(k))}` : title ?? ''} value={v} disabled={disabled}
      onChange={(e) => { f.set(k, Number(e.target.value)); edited(); }}>
      {!opts.some(([o]) => o === v) && <option value={v}>{String(v)}</option>}
      {opts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
    </select>
  );
}

export function FieldCheck({ f, k, edited, label }: FieldProps & { label: string }): ReactNode {
  const v = f.get(k);
  return (
    <label className={changed(f, k) ? 'edited-label' : ''}>
      <input type="checkbox" checked={v === 1} onChange={(e) => { f.set(k, e.target.checked ? 1 : 0); edited(); }} />
      {label}
    </label>
  );
}

/** A labelled box of the stats grid around any inputs; `wide` takes two columns (a long list of choices). */
export function Stat({ label, info, wide, children }: { label: string; info?: string; wide?: boolean; children: ReactNode }): ReactNode {
  return <label className={`stat${wide ? ' stat-wide' : ''}`}><span className="muted">{label}{info && <InfoTip text={info} />}</span><span>{children}</span></label>;
}

/** A box of the stats grid: one field ("経験値"), a range of two ("HP 10〜12") or any input. */
export type StatSpec =
  | { label: string; k: string; unit?: string; info?: string }
  | { label: string; range: [string, string]; info?: string }
  | { label: string; node: ReactNode; info?: string };

/** The stats grid; warns when the low end of a range is above its high end. */
export function StatFields({ f, edited, stats }: { f: FieldAccess; edited: () => void; stats: StatSpec[] }): ReactNode {
  const head = (s: StatSpec): ReactNode => s.info
    ? <span className="muted with-info">{s.label}<InfoTip text={s.info} /></span>
    : <span className="muted">{s.label}</span>;
  return (
    <>
      <div className="stats stat-edit">
        {stats.map((s) => (
          'range' in s
            ? <div key={s.label} className="stat stat-range">{head(s)}<span><FieldNumber f={f} k={s.range[0]} edited={edited} />〜<FieldNumber f={f} k={s.range[1]} edited={edited} /></span></div>
            : <div key={s.label} className="stat">{head(s)}{'k' in s ? <span><FieldNumber f={f} k={s.k} edited={edited} />{s.unit ?? ''}</span> : s.node}</div>
        ))}
      </div>
      {stats.some((s) => 'range' in s && f.get(s.range[0]) > f.get(s.range[1])) && (
        <div className="issue warn">⚠ 最小が最大より大きい欄があります (ゲームで確かめていません)。</div>
      )}
    </>
  );
}
