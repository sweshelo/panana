// Picking a sound (a soundData row) in a <dialog>: every row with its name from sound.bcsar, filtered by kind
// (BGM / 効果音) and by name or row. The BGM and footsteps of the map editor use it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SOUND_KIND, type SoundKind, type SoundNames } from '../game/sound';
import { Dialog } from './Dialog';

type KindFilter = SoundKind | '';

/**
 * The dialog. `kind` is the filter shown first; `max` greys out rows past it (mapData holds one byte);
 * `usage` gives a short note per row (e.g. the maps that use it).
 */
export function SoundPicker({ sounds, current, kind = '', max = Infinity, usage, title = '音を選ぶ', onPick, onClose }: {
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
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), [filter]);
  const q = query.trim().toUpperCase();
  const rows: number[] = [];
  for (let r = 1; r < sounds.rows; r++) {
    if (filter && sounds.kind(r) !== filter) continue;
    if (q && String(r) !== q && !sounds.name(r).includes(q)) continue;
    rows.push(r);
  }
  const row = (r: number): ReactNode => {
    const off = r > max;
    return (
      <tr key={r} className={`${off ? 'muted' : 'pick'}${r === current ? ' current' : ''}`}
        title={off ? `マップの設定には行 ${max} までしか入りません` : undefined}
        onClick={() => !off && onPick(r)}>
        <td className="num">{r || ''}</td>
        <td className="mono">{r ? sounds.name(r) || '(名前なし)' : '(なし)'}</td>
        <td className="muted">{r ? SOUND_KIND[sounds.kind(r)] : ''}</td>
        <td className="muted">{usage?.(r) ?? ''}</td>
      </tr>
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
      <div className="picker-list" ref={list}>
        <table className="picker-table">
          <thead><tr><th>行</th><th>名前</th><th>種類</th><th>使っているところ</th></tr></thead>
          <tbody>
            {!q && row(0)}
            {rows.map(row)}
            {!rows.length && <tr><td colSpan={4} className="muted">見つかりません</td></tr>}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** A button naming the sound; clicking it opens the picker. */
export function SoundButton({ sounds, value, onChange, ...opts }: {
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
    <>
      <button type="button" className="map-button" title="クリックで音を選ぶ" onClick={() => setOpen(true)}>
        {sounds.label(value)}
        <span className="muted"> ▾</span>
      </button>
      {open && (
        <SoundPicker sounds={sounds} current={value} {...opts} onClose={() => setOpen(false)}
          onPick={(r) => { setOpen(false); if (r !== value) onChange(r); }} />
      )}
    </>
  );
}
