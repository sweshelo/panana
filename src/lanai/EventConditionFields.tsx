import type { ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { LANAI_CONDITIONS, lanaiConditionLabel } from './conditions';
import { ContentSelect } from './MapParts';
import type { LanaiEditState } from './mapedit';
import { LanaiEventSelect } from './EventSelect';
import { LanaiConditionEditor } from './ConditionEditor';

export function EventConditionFields({
  st,
  event,
  field,
}: {
  st: LanaiEditState;
  event: number;
  field: 0x5f | 0x60;
}): ReactNode {
  const table = st.maps.eventTable(st.info!.dungeon)!;
  const kind = table.u8(event, field);
  const spec = LANAI_CONDITIONS[kind];
  const offset = field === 0x5f ? 0 : 8;
  const first = table.u32(event, offset);
  const second = table.u32(event, offset + 4);
  const set = (o: number, value: number): void => st.setEventField(event, (t) => t.setU32(event, o, value));
  return (
    <div className="event-box">
      <label className="field">
        <span>{field === 0x5f ? '出る条件' : '消える条件'}</span>
        <select
          value={kind}
          onChange={(e) => st.setEventField(event, (t) => t.setU8(event, field, Number(e.target.value)))}
        >
          <option value={0}>{field === 0x5f ? 'いつも出る' : '消えない'}</option>
          {Object.entries(LANAI_CONDITIONS).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
          {kind !== 0 && !spec && <option value={kind}>{lanaiConditionLabel(kind)}</option>}
        </select>
      </label>
      {spec?.first && (
        <label className="field">
          <span>{spec.first}</span>
          {kind <= 2 ? (
            <ContentSelect maps={st.maps} value={first} allowNone={false} checking onChange={(v) => set(offset, v)} />
          ) : kind === 12 || kind === 13 ? (
            <LanaiEventSelect st={st} value={first} allowNone={false} references onChange={(v) => set(offset, v)} />
          ) : (
            <NumberInput value={first} min={0} max={spec.firstMax ?? 0xffffffff} onCommit={(v) => set(offset, v)} />
          )}
        </label>
      )}
      {spec?.second && (
        <label className="field">
          <span>{spec.second}</span>
          <NumberInput
            value={second}
            min={0}
            max={Math.max(second, spec.secondMax ?? 0xffffffff)}
            onCommit={(v) => set(offset + 4, v)}
          />
        </label>
      )}
      {kind !== 0 && kind !== 0x72 && !spec && (
        <p className="muted small">意味が未確定の条件です。現在の種類と値を保持します。</p>
      )}
      <LanaiConditionEditor
        key={`${st.info!.dungeon}:${event}:${field}`}
        session={st.maps.session}
        value={{ kind, v1: first, v2: second }}
        scriptOnly
        onChange={(c) =>
          st.setEventField(event, (t) => {
            t.setU8(event, field, c.kind);
            t.setU32(event, offset, c.v1);
            t.setU32(event, offset + 4, c.v2);
          })
        }
      />
    </div>
  );
}
