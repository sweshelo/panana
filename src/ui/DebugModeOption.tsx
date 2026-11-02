// The RPG2 export dialog's switch for Panana's debug mode (game/debugmode.ts), which runs only in Azahar.
import type { ReactNode } from 'react';
import { DEBUG_MODE_NOTE, DEBUG_MODE_TITLE } from '../game/debugmode';

export function DebugModeOption({ on, problem, onChange }: {
  on: boolean;
  /** Why it cannot be written to this dump (shown instead of the switch when it is off), or null. */
  problem: string | null;
  onChange: (on: boolean) => void;
}): ReactNode {
  return (
    <div className="code-mods">
      <label>
        <input type="checkbox" checked={on} disabled={!!problem && !on} onChange={(e) => onChange(e.target.checked)} />
        {` ${DEBUG_MODE_TITLE}`}
      </label>
      <div className="muted small">{DEBUG_MODE_NOTE}</div>
      {problem && <div className={on ? 'error' : 'muted small'}>{problem}</div>}
    </div>
  );
}
