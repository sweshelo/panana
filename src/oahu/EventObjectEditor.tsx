// One EventObject row (naauao oahu/map.md §5) as editable fields, with what its conditions check and where an exit
// leads; shared by the map page's inspector and the event page.
import type { ReactNode } from 'react';
import { fieldPlace, fieldRange, readField, writeField } from '../game/tabledef';
import { NumberInput } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { hex8, u32 } from '../util/bytes';
import { oahuConditions, oahuKindName, OAHU_EVENT_OBJECT } from './events';
import type { OahuMapInfo, OahuMaps } from './maps';

/** "出入口 #2" when the destination map has an exit with that point ID, else the ID. */
export function pointLabel(maps: OahuMaps, map: OahuMapInfo, id: number): string {
  const i = maps.exitByPoint(map, id);
  return i >= 0 ? `の出入口 #${i}` : `の地点 ${hex8(id).toUpperCase()}`;
}

export function EventObjectEditor({ maps, row, original, edit = (f) => f(), onEdit }: {
  maps: OahuMaps;
  /** The row in the table (edited in place). */
  row: Uint8Array;
  original: Uint8Array | null;
  /** Runs a change of the row (the map page records an undo point first). */
  edit?: (f: () => void) => void;
  onEdit: () => void;
}): ReactNode {
  const conds = oahuConditions(row);
  const dest = maps.map(u32(row, 0x10));
  return (
    <>
      <p className="small">
        {oahuKindName(row[0x55]!)}
        {dest && <> ・ 行き先 <a href={`#/maps/${encodeURIComponent(dest.name)}`}>{dest.name}</a>{` ${pointLabel(maps, dest, u32(row, 0x14))}`}</>}
      </p>
      {conds.map((c) => <p key={c.field} className="small muted">{`${c.field === 0x53 ? '出る' : '消える'}: ${c.text}`}</p>)}
      <table className="enc-table row-fields">
        <tbody>
          {OAHU_EVENT_OBJECT.fields.map((f) => {
            const v = readField(row, f);
            const o = original ? readField(original, f) : v;
            const [lo, hi] = fieldRange(f);
            return (
              <tr key={f.key} className={f.unsure ? 'muted' : ''}>
                <td>{f.label}{f.note && <InfoTip text={f.note} />}</td>
                <td className="mono muted">{fieldPlace(f)}</td>
                <td>
                  <NumberInput value={v} min={lo} max={hi} className={`num-input${o !== v ? ' edited' : ''}`} title={o !== v ? `元の値 ${o}` : `${lo}〜${hi}`}
                    onCommit={(x) => { edit(() => writeField(row, f, x)); onEdit(); }} />
                </td>
                <td className="mono muted small">{f.hex ? (f.type === 'u32' ? hex8(v).toUpperCase() : `0x${v.toString(16).toUpperCase()}`) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
