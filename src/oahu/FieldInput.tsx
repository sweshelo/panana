// Inputs of one field of a table row (rows.ts): a number box or a list of choices in the range of the field, marked
// when the value differs from the archive's (its value in the tooltip). The RPG3 books edit their rows with them.
import type { ReactNode } from 'react';
import type { MessageStore } from '../game/gmsg';
import { fieldRange } from '../game/tabledef';
import { NumberInput, TextBox } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import type { OahuRows } from './rows';

export interface FieldProps {
  rows: OahuRows;
  row: number;
  k: string;
  onEdit: () => void;
  /** A row added by an edit has no archive value to compare with. */
  added?: boolean;
}

function mark({ rows, row, k, added }: FieldProps): { className: string; title: string } {
  const now = rows.get(row, k);
  const was = rows.original(row, k);
  return !added && now !== was ? { className: 'edited', title: `元の値 ${was}` } : { className: '', title: '' };
}

export function FieldNumber(p: FieldProps & { min?: number; max?: number }): ReactNode {
  const { rows, row, k, onEdit } = p;
  const [lo, hi] = fieldRange(rows.field(k));
  const m = mark(p);
  return <NumberInput value={rows.get(row, k)} min={p.min ?? lo} max={p.max ?? hi} className={`num-input ${m.className}`} title={m.title} onCommit={(v) => { rows.set(row, k, v); onEdit(); }} />;
}

export function FieldSelect(p: FieldProps & { options: [number, string][] }): ReactNode {
  const { rows, row, k, onEdit, options } = p;
  const v = rows.get(row, k);
  const m = mark(p);
  return (
    <select className={m.className} title={m.title} value={v} onChange={(e) => { rows.set(row, k, Number(e.target.value)); onEdit(); }}>
      {!options.some(([o]) => o === v) && <option value={v}>{String(v)}</option>}
      {options.map(([o, label]) => <option key={o} value={o}>{label}</option>)}
    </select>
  );
}

/** A labelled box of the stats grid. */
export function Stat({ label, info, children }: { label: string; info?: string; children: ReactNode }): ReactNode {
  return <label className="stat"><span className="muted">{label}{info && <InfoTip text={info} />}</span><span>{children}</span></label>;
}

/** The choices of an enum field ("2: 単体"). */
export function enumOptions(values: Record<number, string>, numbered = false): [number, string][] {
  return Object.entries(values).map(([v, label]): [number, string] => [Number(v), numbered ? `${v}: ${label}` : label]);
}

/** The message fields of a row as text boxes (the editors' text form); messages the store cannot change are shown. */
export function MessageFields({ rows, row, fields, texts, message, onEdit }: {
  rows: OahuRows;
  row: number;
  fields: [string, string][];
  texts: MessageStore;
  message: (id: number) => string;
  onEdit: () => void;
}): ReactNode {
  return (
    <table className="enc-table desc-table">
      <tbody>
        {fields.map(([key, label]) => {
          const id = rows.get(row, key);
          if (!id || !texts.units(id)) return null;
          const f = rows.field(key);
          return (
            <tr key={key}>
              <th title={`${rows.def.file} +0x${f.offset.toString(16).toUpperCase()}、メッセージ ${id}`}>{label}</th>
              <td className="book-desc">
                {texts.editable(id) || texts.isAdded(id)
                  ? <TextBox value={texts.text(id)?.text ?? ''} multi={key !== 'name'} edited={texts.isEdited(id)} onCommit={(v) => { texts.setText(id, v); onEdit(); }} />
                  : <span>{message(id)}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
