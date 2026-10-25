// The frame of a world map page, shared by RPG2 (pages/world.tsx) and RPG3 (oahu/WorldPage.tsx): the header (title,
// 2D / 3D, undo, fitting), the left pane (tools, the terrain's parts, the layers, then the page's list), the views
// (worldview.ts), the right pane (the page's inspector) and the status bar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSignal } from '../ui/useEditorState';
import { MapFrame, type MapViewMode } from './mappage';
import { WorldView, type WorldSelection, type WorldSource } from './worldview';

/** Builds the view of a source (rebuilt when `deps` change), puts its canvases in the panes and binds the keys. */
export function useWorldView(make: () => WorldSource, deps: unknown[], route: string, onSelect: (sel: WorldSelection) => void): {
  view: WorldView | null;
  pane2d: React.RefObject<HTMLDivElement | null>;
  pane3d: React.RefObject<HTMLDivElement | null>;
} {
  const [view, setView] = useState<WorldView | null>(null);
  const pane2d = useRef<HTMLDivElement>(null);
  const pane3d = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const v = new WorldView(make());
    pane2d.current!.append(v.grid.canvas);
    pane3d.current!.append(v.scene.canvas);
    v.onSelect = (sel) => select.current(sel);
    setView(v);
    const onKey = (e: KeyboardEvent): void => {
      if (!location.hash.startsWith(route) || document.querySelector('dialog[open], .modal')) return;
      if (v.key(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      v.grid.canvas.remove();
      v.scene.canvas.remove();
      v.dispose();
      setView(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { view, pane2d, pane3d };
}

const DUMMY = { subscribe: () => () => {}, get: () => 0 } as unknown as WorldView['signal'];

export function WorldFrame({ view, pane2d, pane3d, title, changed, onRevert, top, list, inspector, statusOf }: {
  view: WorldView | null;
  pane2d: React.RefObject<HTMLDivElement | null>;
  pane3d: React.RefObject<HTMLDivElement | null>;
  title: ReactNode;
  /** The world differs from the ROM's (a mark in the header). */
  changed: boolean;
  /** Puts the world back as in the ROM (shown while it is changed). */
  onRevert?: () => void;
  /** At the top of the left pane (picking another world …). */
  top?: ReactNode;
  /** At the bottom of the left pane (the entrances). */
  list?: ReactNode;
  inspector?: ReactNode;
  /** What the status bar says about a hovered cell, besides its coordinates. */
  statusOf?: (x: number, y: number) => string[];
}): ReactNode {
  const [mode, setMode] = useState<MapViewMode>('split');
  useSignal(view?.signal ?? DUMMY);
  useEffect(() => {
    requestAnimationFrame(() => view?.refresh());
  }, [view, mode]);
  return (
    <div className="map-detail">
      <MapFrame mode={mode} pane2d={pane2d} pane3d={pane3d}
        header={
          <>
            {title}
            {changed && <span className="edited-mark" title="変更した">●</span>}
            <span className="grow" />
            <span className="seg">
              {(['2d', 'split', '3d'] as const).map((m) => <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>{m === 'split' ? '両方' : m.toUpperCase()}</button>)}
            </span>
            {view && (
              <>
                <span className="seg">
                  <button title="元に戻す (Ctrl+Z)" disabled={!view.canUndo} onClick={() => view.undo()}>↶ 戻す</button>
                  <button title="やり直す (Ctrl+Y)" disabled={!view.canRedo} onClick={() => view.redo()}>↷ やり直し</button>
                </span>
                <button onClick={() => view.fitWorld()}>全体を表示</button>
                <button title="選んだものを 2D・3D の真ん中に (F)" onClick={() => view.focus()}>選択へ移動</button>
                <button onClick={() => view.scene.topView()}>真上から</button>
              </>
            )}
            {changed && onRevert && <button onClick={onRevert}>ワールドの変更を元に戻す</button>}
          </>
        }
        left={
          <>
            {top}
            {view && (
              <>
                <WorldTools view={view} />
                {view.tool === 'paint' && <PartPalette view={view} />}
                <WorldLayers view={view} />
              </>
            )}
            {list}
          </>
        }
        right={inspector}
        status={view && <WorldStatus view={view} statusOf={statusOf} />}
      />
    </div>
  );
}

function WorldTools({ view }: { view: WorldView }): ReactNode {
  const paintable = !!view.src.ground();
  return (
    <div className="tools">
      <button className={view.tool === 'select' ? 'active' : ''} title="入口・範囲を選んでドラッグで動かす (V)" onClick={() => view.setTool('select')}>選択・移動 <kbd>V</kbd></button>
      <button className={view.tool === 'paint' ? 'active' : ''} disabled={!paintable} title={paintable ? '地形の部品を置く (B、Alt+クリックで拾う、R で回す)' : 'このワールドの地形は編集できません'} onClick={() => view.setTool('paint')}>地形を塗る <kbd>B</kbd></button>
    </div>
  );
}

function PartPalette({ view }: { view: WorldView }): ReactNode {
  const src = view.src;
  const [query, setQuery] = useState('');
  const b = view.brush;
  const palette = src.palette();
  const cur = palette.find((p) => p.row === b.part);
  const rows = palette.filter((p) => !query || p.label.includes(query) || String(p.row) === query);
  const revision = src.revision();
  const count = useMemo(() => {
    const n = new Map<number, number>();
    for (const p of src.ground()?.parts ?? []) n.set(p, (n.get(p) ?? 0) + 1);
    return n;
  }, [src, revision]);
  const swatch = (row: number): ReactNode => (
    <span className="pal-swatch small-swatch" style={{ background: row ? src.partColor(row) : 'repeating-linear-gradient(45deg,#333 0 4px,#555 4px 8px)' }} />
  );
  return (
    <div className="world-palette">
      <h3>地形の部品</h3>
      <div className="brush-info">
        {swatch(b.part)}
        <span>{b.part ? `${b.part} ${cur?.label ?? ''}` : '0 なし (消す)'}</span>
      </div>
      <div className="row">
        <span className="muted small">向き</span>
        <span className="seg">{[0, 1, 2, 3].map((r) => <button key={r} className={r === b.rot ? 'active' : ''} onClick={() => view.setBrush({ ...b, rot: r })}>{['↑', '→', '↓', '←'][r]}</button>)}</span>
        <span className="muted small">R で回す</span>
      </div>
      <input type="search" placeholder="名前か行で絞る" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="world-parts">
        {rows.map((p) => (
          <button key={p.row} className={`world-part${p.row === b.part ? ' active' : ''}`} title={`worldmapParts の行 ${p.row}・+4 = 0x${p.flags.toString(16)}${p.flags & 0x10 ? ' (2×2)' : p.flags & 0x20 ? ' (2 マス)' : ''}`}
            onClick={() => view.setBrush({ part: p.row, rot: b.rot })}>
            {swatch(p.row)}
            <span className="world-part-name">{p.row ? `${p.row} ${p.label}` : '0 なし (消す)'}</span>
            <span className="muted small">{`${p.flags & 0x10 ? '2×2 ' : p.flags & 0x20 ? '2 ' : ''}${count.get(p.row) ?? 0}`}</span>
          </button>
        ))}
      </div>
      <p className="muted small">2×2 や 2 マスの部品は左上 (起点) のセルに置きます。書き出しで部品ごとのプールの数を作り直します。</p>
    </div>
  );
}

function WorldLayers({ view }: { view: WorldView }): ReactNode {
  const src = view.src;
  const pins = src.entrances();
  const box = (key: string, label: string, color?: string): ReactNode => (
    <label key={key} className="layer">
      <input type="checkbox" checked={!!view.layers[key]} onChange={(e) => { view.layers[key] = e.target.checked; view.refresh(); }} />
      {color && <span style={{ color }}>● </span>}
      {label}
    </label>
  );
  const plain = pins.filter((p) => p.plain).length;
  return (
    <div className="layers">
      <h3>表示</h3>
      {box('terrain', '地形')}
      {box('entrances', `入口 ${pins.length - plain}`)}
      {plain > 0 && box('returns', `出る位置 (模型なし) ${plain}`, '#ffffff')}
      {src.rangeSets.map((r) => box(r.key, `${r.label} ${r.list().length}`, r.color))}
      {src.pointSets.map((p) => box(p.key, `${p.label} ${p.list().length}`, p.color))}
      {src.overlays.map((o) => box(o.key, o.label))}
      <label className="layer">
        <input type="checkbox" checked={view.showModels} onChange={(e) => { view.showModels = e.target.checked; view.refresh(); }} />
        3D でモデルを描く
      </label>
    </div>
  );
}

function WorldStatus({ view, statusOf }: { view: WorldView; statusOf?: (x: number, y: number) => string[] }): ReactNode {
  useSignal(view.hoverSignal);
  const h = view.hover, N = view.src.size;
  const parts: string[] = [];
  if (h && h[0] >= 0 && h[1] >= 0 && h[0] < N && h[1] < N) {
    const [x, y] = h;
    parts.push(`セル (${x}, ${y})`);
    const g = view.src.ground();
    if (g) {
      const i = y * N + x, p = g.parts[i]!;
      parts.push(p ? `部品 ${p} ${view.src.palette().find((r) => r.row === p)?.label ?? ''} 向き ${g.rots[i]}` : '部品なし');
    }
    parts.push(...(statusOf?.(x, y) ?? []));
  }
  parts.push(`ツール: ${view.tool === 'paint' ? '地形を塗る' : '選択・移動'}`);
  parts.push(view.status || '右ドラッグ: 2D は移動、3D は回転 / 中ドラッグ: 3D の移動 / ホイール: 拡大');
  return <>{parts.join('   ')}</>;
}
