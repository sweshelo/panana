// The export dialogs' switch for Panana's code MOD "ドロップ率の天井を撤廃" (game/dropcap.ts), written to exefs/code.ips.
import type { ReactNode } from 'react';
import { DROP_CAP_NOTE, DROP_CAP_TITLE, type DropCapTitle } from '../game/dropcap';

export function CodeModOption({ title, on, problem, onChange }: {
  title: DropCapTitle;
  on: boolean;
  /** Why it cannot be written to this dump (shown instead of the switch when it is off), or null. */
  problem: string | null;
  onChange: (on: boolean) => void;
}): ReactNode {
  return (
    <div className="code-mods">
      <h4>コードの MOD (exefs/code.ips)</h4>
      <label>
        <input type="checkbox" checked={on} disabled={!!problem && !on} onChange={(e) => onChange(e.target.checked)} />
        {` ${DROP_CAP_TITLE}`}
      </label>
      <div className="muted small">{DROP_CAP_NOTE[title]}</div>
      {problem && <div className={on ? 'error' : 'muted small'}>{problem}</div>}
    </div>
  );
}
