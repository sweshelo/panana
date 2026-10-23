// A box of sound fields (RPG2's map BGM and footsteps, first): a heading with a "shared" badge, one row per field with
// the play button and the picker (SoundButton), and a note. The map inspectors of all three games use it.
import type { ReactNode } from 'react';
import type { SoundKind, SoundNames, SoundSource } from '../game/sound';
import { SoundButton } from './SoundPicker';

export interface SoundSlot {
  key: string;
  label: string;
  /** soundData / SoundData row. */
  value: number;
  kind: SoundKind;
  /** Largest row the field holds (one byte in RPG2 / RPG3's mapData). */
  max?: number;
  /** Shown when the label is hovered. */
  note?: string;
  onChange: (row: number) => void;
}

export function SoundSlotsBox({ title, shared, game, sounds, slots, usage, note, children, className = 'enc-box' }: {
  title: string;
  /** The places sharing these fields (a badge "N マップで共有" when more than one). */
  shared?: { count: number; title: string };
  game: SoundSource;
  /** Null while the names load (or without sound.bcsar): the rows show as numbers. */
  sounds: SoundNames | null;
  slots: SoundSlot[];
  usage?: (row: number) => string;
  note?: ReactNode;
  /** More fields after the sounds (e.g. a battle background). */
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={className}>
      <h3>
        {title}
        {shared && shared.count > 1 && <span className="badge" title={shared.title}>{`${shared.count} マップで共有`}</span>}
      </h3>
      {slots.map((s) => (
        // Not a <label>: a click on the caption would press the play button.
        <div key={s.key} className="field" title={s.note}>
          <span>{s.label}</span>
          {sounds
            ? <SoundButton game={game} sounds={sounds} value={s.value} kind={s.kind} max={s.max} usage={usage} title={`${s.label} を選ぶ`} onChange={s.onChange} />
            : <span>{`サウンド ${s.value}`}</span>}
        </div>
      ))}
      {children}
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}
