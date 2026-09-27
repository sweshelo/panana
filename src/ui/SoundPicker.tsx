// Picking a sound (a soundData row) in a <dialog>: every row as a card with its name from sound.bcsar and a play
// button, filtered by kind (BGM / 効果音 …) and by name or row. The BGM and footsteps of the map editor use it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Game } from '../game/game';
import { SOUND_KIND, type SoundKind, type SoundNames } from '../game/sound';
import { soundPlayer, usePlayer } from '../sound/player';
import { Dialog } from './Dialog';

type KindFilter = SoundKind | '';

/** ▶ plays the sound of a soundData row (■ stops it); the reason shows in the tooltip when it cannot play. */
export function PlayButton({ game, sounds, row, className = '' }: { game: Game; sounds: SoundNames; row: number; className?: string }): ReactNode {
  const st = usePlayer();
  const index = sounds.index(row);
  if (index === null) return null;
  const key = `sound:${index}`;
  const on = st.key === key;
  const error = st.error?.key === key ? st.error.message : null;
  const name = sounds.name(row) || `サウンド ${row}`;
  return (
    <button
      type="button"
      className={`play-button${on ? ' on' : ''}${error ? ' failed' : ''}${className ? ` ${className}` : ''}`}
      title={error ? `再生できません: ${error}` : on ? '止める' : `${name} を試聴`}
      aria-label={on ? '止める' : `${name} を試聴`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Sequences are rendered again each time (they may be random); the rest is kept for a while.
        void soundPlayer.toggle(key, async () => (await game.soundRenderer()).render(index), sounds.kind(row) !== 'se');
      }}
    >
      {on ? (st.loading ? '…' : '■') : '▶'}
    </button>
  );
}

/**
 * The dialog. `kind` is the filter shown first; `max` greys out rows past it (mapData holds one byte);
 * `usage` gives a short note per row (e.g. the maps that use it).
 */
export function SoundPicker({ game, sounds, current, kind = '', max = Infinity, usage, title = '音を選ぶ', onPick, onClose }: {
  game: Game;
  sounds: SoundNames;
  current: number;
  kind?: KindFilter;
  max?: number;
  usage?: (row: number) => string;
  title?: string;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KindFilter>(kind);
  const grid = useRef<HTMLDivElement>(null);
  const player = usePlayer();
  useEffect(() => grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), [filter]);
  // The preview stops with the dialog.
  useEffect(() => () => soundPlayer.stop(), []);
  const q = query.trim().toUpperCase();
  const rows: number[] = [];
  for (let r = 1; r < sounds.rows; r++) {
    if (filter && sounds.kind(r) !== filter) continue;
    if (q && String(r) !== q && !sounds.name(r).includes(q)) continue;
    rows.push(r);
  }
  const cell = (r: number): ReactNode => {
    const off = r > max;
    const pick = (): void => {
      if (!off) onPick(r);
    };
    return (
      <div
        key={r}
        role="button"
        tabIndex={off ? -1 : 0}
        aria-disabled={off}
        className={`sound-cell${off ? ' sold' : ''}${r === current ? ' current' : ''}`}
        title={off ? `マップの設定には行 ${max} までしか入りません` : `#${r} を選ぶ`}
        onClick={pick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}
      >
        {r ? <PlayButton game={game} sounds={sounds} row={r} /> : <span className="play-button placeholder">—</span>}
        <span className="sound-cell-text">
          <span className="mono sound-name">{r ? sounds.name(r) || `サウンド ${r}` : '(なし)'}</span>
          <span className="muted small">{r ? `#${r}・${SOUND_KIND[sounds.kind(r)]}` : '音を鳴らさない'}</span>
          {usage?.(r) && <span className="muted small">{usage(r)}</span>}
        </span>
      </div>
    );
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前 (BGM_CAVE など) か行番号で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as KindFilter)}>
          <option value="">すべて</option>
          {Object.entries(SOUND_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!sounds.named && <p className="muted small">sound/sound.bcsar が読めなかったので、音の名前はわかりません (行番号だけ)。</p>}
      {player.error && <p className="error small">{`再生できません: ${player.error.message}`}</p>}
      <div className="picker-list">
        <div className="sound-grid" ref={grid}>
          {!q && cell(0)}
          {rows.map(cell)}
          {!rows.length && <div className="muted">見つかりません</div>}
        </div>
      </div>
    </Dialog>
  );
}

/** A button naming the sound (clicking it opens the picker), with a play button. */
export function SoundButton({ game, sounds, value, onChange, ...opts }: {
  game: Game;
  sounds: SoundNames;
  value: number;
  kind?: KindFilter;
  max?: number;
  usage?: (row: number) => string;
  title?: string;
  onChange: (row: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <span className="sound-button">
      <PlayButton game={game} sounds={sounds} row={value} />
      <button type="button" className="map-button" title="クリックで音を選ぶ" onClick={() => setOpen(true)}>
        {sounds.label(value)}
        <span className="muted"> ▾</span>
      </button>
      {open && (
        <SoundPicker game={game} sounds={sounds} current={value} {...opts} onClose={() => setOpen(false)}
          onPick={(r) => { setOpen(false); if (r !== value) onChange(r); }} />
      )}
    </span>
  );
}
