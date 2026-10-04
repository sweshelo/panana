// One EventObject row (naauao oahu/map.md §5) as editable fields, with what its conditions check and where an exit
// leads; shared by the map page's inspector and the event page.
import type { ReactNode } from 'react';
import { fieldPlace, fieldRange, readField, writeField } from '../game/tabledef';
import { NumberInput } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { hex8, u32, w32 } from '../util/bytes';
import { oahuConditions, oahuKindName, OAHU_EVENT_OBJECT, type OahuEventCondition } from './events';
import type { OahuMapInfo, OahuMaps } from './maps';
import type { OahuSession } from './session';
import { conditionReads, oahuRangeOf, valueLabel, valueNameKey, type OahuValueRange, type ValueKind } from './story';

/** What the inspector needs to name the save values a condition reads (#87). */
export interface ConditionNames {
  /** "values.4" -> name (session.storyNames). */
  names: Record<string, string>;
  ranges: OahuValueRange[];
  /** The Update's code.bin (the named conditions are run to see what they read), or null. */
  code: Uint8Array | null;
  /** The dungeon (mapGroup row) of the row. */
  here: number;
}

/** How a condition kind picks its element: by v1 (global), v1 in the current dungeon, or (v1 dungeon, v2). */
function pickBy(kind: number): { kind: ValueKind; by: 'global' | 'here' | 'dungeon' } | null {
  if (kind === 0x12 || kind === 0x13) return { kind: 'flags', by: 'global' };
  if (kind >= 0x14 && kind <= 0x16) return { kind: 'values', by: 'global' };
  if (kind >= 0x04 && kind <= 0x06) return { kind: 'values', by: 'here' };
  if (kind >= 0x07 && kind <= 0x11) return { kind: 'values', by: 'dungeon' };
  if (kind === 0x02 || kind === 0x03) return { kind: 'flags', by: 'dungeon' };
  return null;
}

/** The names of what a condition reads, and a select of the named values to point it at another one. */
function ConditionLine({ row, c, story, edit, onEdit }: { row: Uint8Array; c: OahuEventCondition; story: ConditionNames; edit: (f: () => void) => void; onEdit: () => void }): ReactNode {
  const reads = conditionReads(story.code, story.ranges, c.kind, c.v1, c.v2, story.here);
  const named = reads.map((t) => story.names[valueNameKey(t.kind, t.index)]).filter(Boolean);
  const how = pickBy(c.kind);
  const o = c.field === 0x53 ? 0x00 : 0x08;
  const options = how
    ? Object.entries(story.names).flatMap(([k, name]) => {
        const [kind, i] = k.split('.') as [ValueKind, string];
        const index = Number(i);
        if (kind !== how.kind) return [];
        const g = oahuRangeOf(story.ranges, kind, index);
        if (how.by === 'global') return [{ index, name, v1: index, v2: c.v2 }];
        if (!g?.dungeon) return [];
        if (how.by === 'here') return g.dungeon === story.here ? [{ index, name, v1: index - g[kind][0], v2: c.v2 }] : [];
        return [{ index, name, v1: g.dungeon, v2: index - g[kind][0] }];
      })
    : [];
  const current = how ? reads[0] : undefined;
  return (
    <p className="small muted">
      {`${c.field === 0x53 ? '出る' : '消える'}: ${c.text}`}
      {reads.length > 0 && <> ・ {reads.map((t, i) => <a key={i} href={`#/flags/${t.kind}.${t.index}`}>{`${i ? ' ' : ''}${valueLabel(t.kind, t.index)}${story.names[valueNameKey(t.kind, t.index)] ? ` ${story.names[valueNameKey(t.kind, t.index)]}` : ''}`}</a>)}</>}
      {options.length > 0 && (
        <select className="small" value={current ? valueNameKey(current.kind, current.index) : ''} title={named.length ? undefined : '名前の付いた値から選ぶ'}
          onChange={(e) => {
            const opt = options.find((x) => valueNameKey(how!.kind, x.index) === e.target.value);
            if (!opt) return;
            edit(() => {
              w32(row, o, opt.v1);
              w32(row, o + 4, opt.v2);
            });
            onEdit();
          }}>
          <option value="">名前で選ぶ…</option>
          {options.map((x) => <option key={x.index} value={valueNameKey(how!.kind, x.index)}>{`${valueLabel(how!.kind, x.index)} ${x.name}`}</option>)}
        </select>
      )}
    </p>
  );
}

/** The names for the inspector of a row in dungeon `here`. */
export function conditionNames(session: OahuSession, here: number): ConditionNames {
  return { names: session.storyNames, ranges: session.story().ranges, code: session.code?.code ?? null, here };
}

/** "出入口 #2" when the destination map has an exit with that point ID, else the ID. */
export function pointLabel(maps: OahuMaps, map: OahuMapInfo, id: number): string {
  const i = maps.exitByPoint(map, id);
  return i >= 0 ? `の出入口 #${i}` : `の地点 ${hex8(id).toUpperCase()}`;
}

export function EventObjectEditor({ maps, row, original, story, edit = (f) => f(), onEdit }: {
  maps: OahuMaps;
  /** Names of the save values the conditions read (#87). */
  story?: ConditionNames;
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
      {conds.map((c) => story
        ? <ConditionLine key={c.field} row={row} c={c} story={story} edit={edit} onEdit={onEdit} />
        : <p key={c.field} className="small muted">{`${c.field === 0x53 ? '出る' : '消える'}: ${c.text}`}</p>)}
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
