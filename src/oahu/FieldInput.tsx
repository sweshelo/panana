// Inputs of one field of a table row (rows.ts) through the inputs shared with RPG2 (ui/FieldEdit): a number box or a
// list of choices in the range of the field, marked when the value differs from the archive's. Also the message fields.
import type { ReactNode } from 'react';
import type { MessageStore } from '../game/gmsg';
import { fieldRange } from '../game/tabledef';
import { TextBox } from '../ui/book';
import { FieldChoice, FieldNumber as SharedNumber, type FieldAccess } from '../ui/FieldEdit';
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

/** The fields of one row of a table, for the shared inputs (ui/FieldEdit). */
export function rowAccess(rows: OahuRows, row: number, added = false): FieldAccess {
  return {
    get: (k) => rows.get(row, k),
    original: (k) => rows.original(row, k),
    set: (k, v) => rows.set(row, k, v),
    range: (k) => fieldRange(rows.field(k)),
    added,
  };
}

export function FieldNumber(p: FieldProps & { min?: number; max?: number }): ReactNode {
  return <SharedNumber f={rowAccess(p.rows, p.row, p.added)} k={p.k} edited={p.onEdit} min={p.min} max={p.max} />;
}

export function FieldSelect(p: FieldProps & { options: [number, string][] }): ReactNode {
  return <FieldChoice f={rowAccess(p.rows, p.row, p.added)} k={p.k} edited={p.onEdit} options={p.options} />;
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
