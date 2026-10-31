// One appearance condition of an EventObject row (+0x4B with +0x00, or +0x4C with +0x04): the type picked from the
// types read off this ROM's FUN_0030B8A4 (game/conditions.ts), story progress first, and its value.
import type { ReactNode } from 'react';
import { CONDITION_GROUPS, conditionTypeLabel, describeCondition, type ConditionType } from '../game/conditions';
import { NumberInput } from './book';

const hex2 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

export function ConditionPicker({ types, type, value, edited, dungeonName, onChange }: {
  types: Map<number, ConditionType>;
  /** 0 = no condition. */
  type: number;
  value: number;
  edited?: boolean;
  dungeonName?: (d: number) => string;
  onChange: (type: number, value: number) => void;
}): ReactNode {
  const groups = CONDITION_GROUPS.map((g) => ({ ...g, types: [...types.values()].filter((c) => g.getters.includes(c.getter)).sort((a, b) => a.type - b.type) }));
  const known = type === 0 || types.has(type);
  return (
    <div className="row condition-picker">
      <select value={type} className={edited ? 'edited' : undefined} title="条件の種類" onChange={(e) => onChange(Number(e.target.value), value)}>
        <option value={0}>条件なし</option>
        {!known && <option value={type}>{`種類 ${hex2(type)} (この ROM では常に偽)`}</option>}
        {groups.filter((g) => g.types.length).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.types.map((c) => <option key={c.type} value={c.type}>{`${hex2(c.type)}  ${conditionTypeLabel(c, dungeonName)}`}</option>)}
          </optgroup>
        ))}
      </select>
      {type !== 0 && (
        <>
          <NumberInput value={value} min={0} max={0xffff} className={`num-input${edited ? ' edited' : ''}`} title="値" onCommit={(v) => onChange(type, v)} />
          <span className="muted small">{describeCondition(types.get(type), type, value)}</span>
        </>
      )}
    </div>
  );
}
