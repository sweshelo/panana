// Every field of one table row by the game's definition (tabledef.ts): where it is, its value, what it names, and the
// value in the archive when it was changed. The books show it under the entry for the fields they do not edit.
import type { ReactNode } from 'react';
import { fieldPlace, fieldText, readField, type FieldContext, type TableDef } from '../game/tabledef';
import { InfoTip } from './InfoTip';

export function RowFields({ def, row, original, context }: { def: TableDef; row: Uint8Array; original?: Uint8Array; context?: FieldContext }): ReactNode {
  return (
    <table className="enc-table row-fields">
      <tbody>
        <tr><th>欄</th><th>場所</th><th>値</th><th>意味</th></tr>
        {def.fields.map((f) => {
          const v = readField(row, f);
          const o = original && readField(original, f);
          const changed = o !== undefined && o !== v;
          const text = fieldText(f, v, context);
          return (
            <tr key={f.key} className={f.unsure ? 'muted' : ''}>
              <td>
                {f.label}
                {f.note && <InfoTip text={f.note} />}
              </td>
              <td className="mono muted">{fieldPlace(f)}</td>
              <td className={`num${changed ? ' edited' : ''}`} title={changed ? `元の値 ${fieldText(f, o!, context)}` : undefined}>{f.hex ? text : v}</td>
              <td className="row-fields-text">{f.hex || text === String(v) ? '' : text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
