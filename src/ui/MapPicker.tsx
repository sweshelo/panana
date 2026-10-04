// Picking a map in a <dialog>: the maps grouped by dungeon (then the world maps), searchable by name or code.
// RPG2's map editor header, the destination of an exit and the world map's entrances use MapPicker / MapButton;
// RPG3's map page gives its own maps to MapPickerDialog / MapPickerButton.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { mapLabel, worldLabel } from '../editor/labels';
import type { Game } from '../game/game';
import { mapShortTitle } from '../game/names';
import { hex8 } from '../util/bytes';
import { Dialog } from './Dialog';

export interface MapPickerRow {
  hash: number;
  title: string;
  code: string;
}
type Row = MapPickerRow;

/** The maps of a game for the picker: [group label (dungeon), rows]. */
export type MapPickerGroups = [label: string, rows: MapPickerRow[]][];

/** RPG2's maps grouped by dungeon (then the world maps when `worlds`). */
function kaharaGroups(game: Game, worlds: boolean): MapPickerGroups {
  const out = new Map<string, Row[]>();
  for (const m of game.editableMaps()) {
    const label = `${game.master.dungeonName(m.dungeon) || m.dungeonCode}  (${m.dungeonCode})`;
    out.set(label, [...(out.get(label) ?? []), { hash: m.hash, title: mapShortTitle(m, game.code.maps), code: m.name }]);
  }
  if (worlds) out.set('ワールドマップ', game.worldMaps().map((w) => ({ hash: w.hash, title: worldLabel(w.code), code: hex8(w.hash) })));
  return [...out];
}

/** The dialog for RPG2. `modified` maps get a mark; `withNone` adds "(なし)" (hash 0); `worlds` adds the world maps. */
export function MapPicker({ game, worlds = false, ...rest }: {
  game: Game;
  current: number;
  withNone?: boolean;
  worlds?: boolean;
  modified?: Set<number>;
  title?: string;
  onPick: (hash: number) => void;
  onClose: () => void;
}): ReactNode {
  const groups = useMemo(() => kaharaGroups(game, worlds), [game, worlds]);
  return <MapPickerDialog groups={groups} {...rest} />;
}

/** The dialog for any game's maps (RPG3's map page gives its own groups). */
export function MapPickerDialog({ groups, current, withNone = false, modified, title = 'マップを選ぶ', onPick, onClose }: {
  groups: MapPickerGroups;
  current: number;
  withNone?: boolean;
  modified?: Set<number>;
  title?: string;
  onPick: (hash: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim().toUpperCase();
  const shown = groups
    .map(([label, rows]) => [label, q && !label.toUpperCase().includes(q) ? rows.filter((r) => r.title.toUpperCase().includes(q) || r.code.toUpperCase().includes(q)) : rows] as const)
    .filter(([, rows]) => rows.length);
  const row = (r: Row): ReactNode => (
    <tr key={r.hash} className={`pick${r.hash === current ? ' current' : ''}`} onClick={() => onPick(r.hash)}>
      <td>{modified?.has(r.hash) && <span className="edited-mark" title="変更した">● </span>}{r.title}</td>
      <td className="muted mono">{r.code}</td>
    </tr>
  );
  const known = !current || groups.some(([, rows]) => rows.some((r) => r.hash === current));
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="マップ名・ダンジョン名・コードで絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list" ref={list}>
        <table className="picker-table map-picker">
          <tbody>
            {withNone && !q && row({ hash: 0, title: '(なし)', code: '' })}
            {!known && !q && row({ hash: current, title: `${hex8(current)} (表にないマップ)`, code: '' })}
            {shown.map(([label, rows]) => (
              <Fragment key={label}>
                <tr className="group"><th colSpan={2}>{label}</th></tr>
                {rows.map(row)}
              </Fragment>
            ))}
            {!shown.length && <tr><td className="muted">見つかりません</td></tr>}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** A button naming the map (with its code); clicking it opens the picker. */
export function MapButton({ game, value, className, onChange, ...opts }: {
  game: Game;
  value: number;
  className?: string;
  withNone?: boolean;
  worlds?: boolean;
  modified?: Set<number>;
  title?: string;
  onChange: (hash: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const info = game.code.byHash(value);
  const label = !value ? '(なし)' : info ? `${mapLabel(game, value)}  ${info.name}` : game.code.world(value) ? mapLabel(game, value) : `${hex8(value)} (表にないマップ)`;
  return (
    <>
      <button type="button" className={`map-button${className ? ` ${className}` : ''}`} title="クリックでマップを選ぶ" onClick={() => setOpen(true)}>
        {opts.modified?.has(value) && <span className="edited-mark">● </span>}
        {label}
        <span className="muted"> ▾</span>
      </button>
      {open && (
        <MapPicker game={game} current={value} {...opts} onClose={() => setOpen(false)}
          onPick={(h) => { setOpen(false); if (h !== value) onChange(h); }} />
      )}
    </>
  );
}

/** A button naming the map; clicking it opens the picker with `groups` (any game). */
export function MapPickerButton({ groups, value, label, className, modified, title, onChange }: {
  groups: MapPickerGroups;
  value: number;
  label: string;
  className?: string;
  modified?: Set<number>;
  title?: string;
  onChange: (hash: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`map-button${className ? ` ${className}` : ''}`} title="クリックでマップを選ぶ" onClick={() => setOpen(true)}>
        {modified?.has(value) && <span className="edited-mark">● </span>}
        {label}
        <span className="muted"> ▾</span>
      </button>
      {open && (
        <MapPickerDialog groups={groups} current={value} modified={modified} title={title} onClose={() => setOpen(false)}
          onPick={(h) => { setOpen(false); if (h !== value) onChange(h); }} />
      )}
    </>
  );
}
