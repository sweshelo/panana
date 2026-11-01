// The RPG2 export dialog's switch for Panana's code MOD "レベルステルス" (game/levelstealth.ts), with its Lv difference.
import type { ReactNode } from 'react';
import { LEVEL_STEALTH_DEFAULT, LEVEL_STEALTH_MAX, LEVEL_STEALTH_MIN, LEVEL_STEALTH_TITLE, levelStealthNote } from '../game/levelstealth';

export function LevelStealthOption({ diff, problem, onChange }: {
  /** The Lv difference, or 0 when it is off. */
  diff: number;
  /** Why it cannot be written to this dump (shown instead of the switch when it is off), or null. */
  problem: string | null;
  onChange: (diff: number) => void;
}): ReactNode {
  const on = diff > 0;
  return (
    <div className="code-mods">
      <label>
        <input type="checkbox" checked={on} disabled={!!problem && !on} onChange={(e) => onChange(e.target.checked ? LEVEL_STEALTH_DEFAULT : 0)} />
        {` ${LEVEL_STEALTH_TITLE}`}
      </label>
      {on && (
        <label>
          {' Lv の差 '}
          <input type="number" min={LEVEL_STEALTH_MIN} max={LEVEL_STEALTH_MAX} value={diff} style={{ width: '4em' }}
            onChange={(e) => onChange(Math.min(LEVEL_STEALTH_MAX, Math.max(LEVEL_STEALTH_MIN, Number(e.target.value) || LEVEL_STEALTH_MIN)))} />
        </label>
      )}
      <div className="muted small">{levelStealthNote(on ? diff : LEVEL_STEALTH_DEFAULT)}</div>
      {problem && <div className={on ? 'error' : 'muted small'}>{problem}</div>}
    </div>
  );
}
