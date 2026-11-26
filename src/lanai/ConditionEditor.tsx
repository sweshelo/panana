import type { ReactNode } from 'react';
import { LANAI_CONDITION_OPTIONS, type LanaiCondition } from './conditions';
/**
 * One condition: how it is judged and its two values. Conditions written as scripts (0x72) in earlier versions are kept
 * as they are but cannot be made any more.
 */
export function LanaiConditionEditor({
  value,
  onChange,
}: {
  value: LanaiCondition;
  onChange: (c: LanaiCondition) => void;
}): ReactNode {
  const known = LANAI_CONDITION_OPTIONS.some(([k]) => k === value.kind);
  return (
    <div>
      <label className="field">
        <span>判定方法</span>
        <select value={value.kind} onChange={(e) => onChange({ ...value, kind: Number(e.target.value) })}>
          {!known && (
            <option value={value.kind}>
              {value.kind === 0x72 ? `条件スクリプト #${value.v1}` : `未解析 0x${value.kind.toString(16)} (保持)`}
            </option>
          )}
          {LANAI_CONDITION_OPTIONS.map(([k, name]) => (
            <option key={k} value={k}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {known && ![0, 8, 9, 10, 11, 29].includes(value.kind) && (
        <>
          <label className="field">
            <span>番号 (値 1)</span>
            <input
              aria-label="条件の番号"
              type="number"
              min={0}
              max={4294967295}
              value={value.v1}
              onChange={(e) => onChange({ ...value, v1: Number(e.target.value) })}
            />
          </label>
          {[5, 6, 7, 12, 13].includes(value.kind) && (
            <label className="field">
              <span>比較する値 (値 2)</span>
              <input
                aria-label="条件の比較値"
                type="number"
                min={0}
                max={4294967295}
                value={value.v2}
                onChange={(e) => onChange({ ...value, v2: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
