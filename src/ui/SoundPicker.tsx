// Picking a sound (a soundData row) in a <dialog>: every row as a card with its name from sound.bcsar and a play
// button, filtered by kind (BGM / 効果音 …) and by name or row. The BGM and footsteps of the map editor use it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SOUND_KIND, type SoundField, type SoundKind, type SoundNames, type SoundSource } from '../game/sound';
import { soundPlayer, usePlayer } from '../sound/player';
import { BgmPortTab } from './BgmPort';
import { Dialog } from './Dialog';
import { openedKeys, useWorkspace } from './workspace';

type KindFilter = SoundKind | '';

/** Longest a sequenced BGM / ME is rendered when it does not loop before (then it fades out). */
const BGM_SECONDS = 300;

/** ▶ plays the sound of a soundData row (■ stops it); the reason shows in the tooltip when it cannot play. */
export function PlayButton({ game, sounds, row, className = '' }: { game: SoundSource; sounds: SoundNames; row: number; className?: string }): ReactNode {
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
        // Sound effects are rendered again each time (their sequences may be random); the BGMs and MEs are kept for a
        // while, and sequenced ones (the first game's) play to their loop and loop like the streams.
        const se = sounds.kind(row) === 'se';
        void soundPlayer.toggle(key, async () => (await game.soundRenderer()).render(index, se ? 8 : BGM_SECONDS, !se), !se);
      }}
    >
      {on ? (st.loading ? '…' : '■') : '▶'}
    </button>
  );
}

/**
 * The dialog. `kind` is the filter shown first; `max` greys out rows past it (mapData holds one byte);
 * `usage` gives a short note per row (e.g. the maps that use it). With `field` (RPG2's BGM fields), `current` and
 * the picked value are the field's values, and only the rows it can hold are shown.
 */
export function SoundPicker({ game, sounds, current, kind = '', max = Infinity, field, usage, title = '音を選ぶ', onPick, onClose }: {
  game: SoundSource;
  sounds: SoundNames;
  current: number;
  kind?: KindFilter;
  max?: number;
  field?: SoundField;
  usage?: (row: number) => string;
  title?: string;
  onPick: (value: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KindFilter>(kind);
  // RPG2's BGMs can also come from another opened game (ui/BgmPort.tsx)
  const ws = useWorkspace();
  const kahara = ws?.opened.kahara?.session;
  const portable = !!ws && !!kahara && !!field && game === kahara.game && openedKeys(ws.opened).length > 1;
  const [tab, setTab] = useState<'own' | 'port'>('own');
  const grid = useRef<HTMLDivElement>(null);
  const player = usePlayer();
  useEffect(() => { grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }); }, [filter]);
  // The preview stops with the dialog.
  useEffect(() => () => soundPlayer.stop(), []);
  const q = query.trim().toUpperCase();
  const currentRow = field ? field.row(current) : current;
  const valueOf = (r: number): number | null => (field ? field.value(r) : r > max ? null : r);
  const rows: number[] = [];
  for (let r = 1; r < sounds.rows; r++) {
    if (filter && sounds.kind(r) !== filter) continue;
    if (field && field.value(r) === null) continue;
    if (q && String(r) !== q && !sounds.name(r).includes(q)) continue;
    rows.push(r);
  }
  const cell = (r: number): ReactNode => {
    const v = valueOf(r);
    const off = v === null;
    const pick = (): void => {
      if (v !== null) onPick(v);
    };
    return (
      <div
        key={r}
        role="button"
        tabIndex={off ? -1 : 0}
        aria-disabled={off}
        className={`sound-cell${off ? ' sold' : ''}${r === currentRow ? ' current' : ''}`}
        title={off ? `マップの設定には行 ${max} までしか入りません` : `#${r} を選ぶ`}
        onClick={pick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}
      >
        {r ? <PlayButton game={game} sounds={sounds} row={r} /> : <span className="play-button placeholder">—</span>}
        <span className="sound-cell-text">
          <span className="mono sound-name">{r ? sounds.name(r) || `サウンド ${r}` : '(なし)'}</span>
          <span className="muted small">{r ? `#${r}${v !== null && v !== r ? ` (欄の値 0x${v.toString(16).toUpperCase()})` : ''}・${SOUND_KIND[sounds.kind(r)]}` : '音を鳴らさない'}</span>
          {usage?.(r) && <span className="muted small">{usage(r)}</span>}
        </span>
      </div>
    );
  };
  return (
    <Dialog title={title} onClose={onClose}>
      {portable && (
        <div className="seg">
          <button type="button" className={tab === 'own' ? 'active' : ''} onClick={() => setTab('own')}>この作品の音</button>
          <button type="button" className={tab === 'port' ? 'active' : ''} onClick={() => setTab('port')}>ほかの作品から移植</button>
        </div>
      )}
      <div className="row">
        <input type="search" placeholder="名前 (BGM_CAVE など) か行番号で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        {tab === 'own' && (
          <select value={filter} onChange={(e) => setFilter(e.target.value as KindFilter)}>
            <option value="">すべて</option>
            {Object.entries(SOUND_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
      </div>
      {!sounds.named && <p className="muted small">sound/sound.bcsar が読めなかったので、音の名前はわかりません (行番号だけ)。</p>}
      {player.error && <p className="error small">{`再生できません: ${player.error.message}`}</p>}
      {tab === 'port' && portable ? (
        <div className="picker-list">
          <BgmPortTab opened={ws.opened} session={kahara} query={query} onPicked={(r) => {
            const v = field.value(r);
            if (v !== null) onPick(v);
          }} />
        </div>
      ) : <div className="picker-list">
        <div className="sound-grid" ref={grid}>
          {!q && cell(0)}
          {rows.map(cell)}
          {!rows.length && <div className="muted">見つかりません</div>}
        </div>
      </div>}
    </Dialog>
  );
}

/** A button naming the sound (clicking it opens the picker), with a play button. */
export function SoundButton({ game, sounds, value, onChange, ...opts }: {
  game: SoundSource;
  sounds: SoundNames;
  /** The field's value (a soundData row, or as `field` reads it). */
  value: number;
  kind?: KindFilter;
  max?: number;
  field?: SoundField;
  usage?: (row: number) => string;
  title?: string;
  onChange: (row: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const row = opts.field ? opts.field.row(value) : value;
  return (
    <span className="sound-button">
      <PlayButton game={game} sounds={sounds} row={row} />
      <button type="button" className="map-button" title="クリックで音を選ぶ" onClick={() => setOpen(true)}>
        {sounds.label(row)}
        <span className="muted"> ▾</span>
      </button>
      {open && (
        <SoundPicker game={game} sounds={sounds} current={value} {...opts} onClose={() => setOpen(false)}
          onPick={(r) => { setOpen(false); if (r !== value) onChange(r); }} />
      )}
    </span>
  );
}
