import { useState, type ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { STAGE_BIT_FLAGS, STAGE_BYTE_FLAGS, type ScriptDoc } from './eventScript';
import type { LanaiMaps } from './maps';

export type LanaiFlagKind = 'byte' | 'bit';

export interface LanaiStageFlag {
  name: string;
  flag: number;
  reset: boolean;
}

/** The flag number of each variable of a kind: the variables of a kind take numbers in the order they are declared. */
export function scriptVarFlags(vars: ScriptDoc['vars'], kind: LanaiFlagKind): LanaiStageFlag[] {
  const first = (kind === 'byte' ? STAGE_BYTE_FLAGS : STAGE_BIT_FLAGS).first;
  return vars.filter((v) => v.kind === kind).map((v, k) => ({ name: v.name, flag: first + k, reset: v.reset }));
}

/** The variables of the open content's event script (an added stage's), of one kind. */
export function lanaiStageFlags(maps: LanaiMaps, kind: LanaiFlagKind): LanaiStageFlag[] {
  const archive = maps.content?.archive?.toUpperCase();
  const doc = archive ? maps.session?.stageScripts?.get(archive)?.doc : undefined;
  return doc ? scriptVarFlags(doc.vars, kind) : [];
}

const MANUAL = 'manual';

/**
 * A byte (0x52) or bit (0x51) flag number: the stage's script variables by name, then "手動" with a number box. A
 * native <option> holds only text, so the box sits beside the list inside the same frame, shown only for 手動.
 */
export function FlagSelect({
  maps,
  kind,
  value,
  max = 0xffff,
  label,
  onChange,
}: {
  maps: LanaiMaps;
  kind: LanaiFlagKind;
  value: number;
  max?: number;
  label?: string;
  onChange: (v: number) => void;
}): ReactNode {
  const flags = lanaiStageFlags(maps, kind);
  const named = flags.find((f) => f.flag === value);
  const [manual, setManual] = useState(!named);
  const isManual = manual || !named;
  return (
    <div className="flag-select">
      <select
        aria-label={label ?? (kind === 'byte' ? '数値フラグ' : 'ビットのフラグ')}
        value={isManual ? MANUAL : String(value)}
        onChange={(e) => {
          if (e.target.value === MANUAL) setManual(true);
          else {
            setManual(false);
            onChange(Number(e.target.value));
          }
        }}
      >
        {flags.length > 0 && (
          <optgroup label={kind === 'byte' ? 'スクリプトの変数 (byte)' : 'スクリプトの変数 (bit)'}>
            {flags.map((f) => (
              <option key={f.flag} value={f.flag}>
                {`${f.name} (${f.flag}${f.reset ? '、離れると 0' : ''})`}
              </option>
            ))}
          </optgroup>
        )}
        <option value={MANUAL}>{isManual ? `手動 (${value})` : '手動'}</option>
      </select>
      {isManual && (
        <NumberInput value={value} min={0} max={Math.max(max, value)} title="フラグ番号" onCommit={onChange} />
      )}
    </div>
  );
}
