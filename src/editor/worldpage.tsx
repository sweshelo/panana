// The frame of a world map page, shared by RPG2 (pages/world.tsx) and RPG3 (oahu/WorldPage.tsx): the header (title,
// 2D / 3D, undo, fitting), the left pane (tools, the terrain's parts, the layers, then the page's list), the views
// (worldview.ts), the right pane (the page's inspector) and the status bar.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSignal } from '../ui/useEditorState';
import { InfoTip } from '../ui/InfoTip';
import { ROT_ARROW } from './legend';
import { MapFrame, type MapViewMode } from './mappage';
import { MapSettings } from './partpalette';
import { ToolboxLayout } from './tools';
import { WorldView, type WorldSelection, type WorldSource, type WorldTool } from './worldview';

/** Builds the view of a source (rebuilt when `deps` change), puts its canvases in the panes and binds the keys. */
export function useWorldView(
  make: () => WorldSource,
  deps: unknown[],
  route: string,
  onSelect: (sel: WorldSelection) => void,
): {
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

export function WorldFrame({
  view,
  pane2d,
  pane3d,
  title,
  changed,
  onRevert,
  top,
  parts,
  canEditPart,
  list,
  inspector,
  statusOf,
}: {
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
  /** The "パーツ" mode's panel (choosing what to put; the page sets view.stamp). Without it there is no "パーツ" mode. */
  parts?: ReactNode;
  /** The selection can be duplicated / deleted (view.onDuplicate / view.onDelete). */
  canEditPart?: boolean;
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
      <MapFrame
        mode={mode}
        pane2d={pane2d}
        pane3d={pane3d}
        header={
          <>
            {title}
            {changed && (
              <span className="edited-mark" title="変更した">
                ●
              </span>
            )}
            <span className="grow" />
            <span className="seg">
              {(['2d', 'split', '3d'] as const).map((m) => (
                <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>
                  {m === 'split' ? '両方' : m.toUpperCase()}
                </button>
              ))}
            </span>
            {view && (
              <>
                <span className="seg">
                  <button title="元に戻す (Ctrl+Z)" disabled={!view.canUndo} onClick={() => view.undo()}>
                    ↶ 戻す
                  </button>
                  <button title="やり直す (Ctrl+Y)" disabled={!view.canRedo} onClick={() => view.redo()}>
                    ↷ やり直し
                  </button>
                </span>
                <button onClick={() => view.fitWorld()}>全体を表示</button>
                <button title="選んだものを 2D・3D の真ん中に (F)" onClick={() => view.focus()}>
                  選択へ移動
                </button>
                <button onClick={() => view.scene.topView()}>真上から</button>
              </>
            )}
            {changed && onRevert && <button onClick={onRevert}>ワールドの変更を元に戻す</button>}
          </>
        }
        left={
          <>
            {top}
            {view && <WorldToolbox view={view} parts={parts} canEditPart={!!canEditPart} />}
            {view && (
              <MapSettings>
                <WorldLayers view={view} />
              </MapSettings>
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

const TILE_TOOLS: [WorldTool, string, string][] = [
  ['select', '選択・移動', 'V'],
  ['paint', '地形を塗る', 'B'],
  ['erase', '地形を消す', 'E'],
];
const PART_TOOLS: [WorldTool, string, string][] = [
  ['select', '選択・移動', 'V'],
  ['place', 'パーツを置く', ''],
];

/** The toolbox of the dungeon map editor (editor/tools.tsx) for a world: "チップ" paints the terrain, "パーツ" puts entrances. */
function WorldToolbox({
  view,
  parts,
  canEditPart,
}: {
  view: WorldView;
  parts?: ReactNode;
  canEditPart: boolean;
}): ReactNode {
  const paintable = !!view.src.ground();
  const tiles = view.placementMode === 'tiles';
  return (
    <ToolboxLayout
      tiles={tiles}
      tools={tiles ? TILE_TOOLS : PART_TOOLS}
      tool={view.tool}
      onTool={(t) => view.setTool(t)}
      toolDisabled={(t) =>
        (t === 'paint' || t === 'erase') && !paintable
          ? 'このワールドの地形は編集できません'
          : t === 'place' && !view.stamp
            ? 'パーツを選ぶと置けます'
            : null
      }
      onMode={(t) => view.setPlacementMode(t ? 'tiles' : 'parts')}
      partsDisabled={parts ? null : 'このワールドにはパーツを置けません'}
      onDelete={view.onDelete ? () => view.onDelete?.() : undefined}
      onDuplicate={view.onDuplicate ? () => view.onDuplicate?.() : undefined}
      canEditPart={canEditPart}
    >
      {tiles ? <TilePalette view={view} /> : parts}
    </ToolboxLayout>
  );
}

/** The terrain's parts as the dungeon editor's chip grid (editor/palette.tsx): a picture of each part's model. */
function TilePalette({ view }: { view: WorldView }): ReactNode {
  const src = view.src;
  const [query, setQuery] = useState('');
  const b = view.brush;
  const palette = src.palette();
  if (!src.ground()) return <p className="muted small">このワールドの地形は編集できません。</p>;
  const cur = palette.find((p) => p.row === b.part);
  const q = query.trim();
  const rows = palette.filter((p) => !q || p.label.includes(q) || String(p.row) === q);
  const erasing = view.tool === 'erase';
  const label = erasing ? '消す (海にする)' : b.part ? `${b.part} ${cur?.label ?? ''}` : '0 なし (海)';
  const size = (f: number): string => (f & 0x10 ? '2×2' : f & 0x20 ? '2 マス' : '');
  return (
    <div className="palette world-palette">
      <div className="brush-info">
        <span className="brush-label" title={label}>
          {label}
        </span>
        <button aria-label="左に回す" title="左に回す (Shift+R)" onClick={() => view.rotateBrush(-1)}>
          ⟲
        </button>
        <span className="rot" title={`${b.rot * 90}°`}>
          {ROT_ARROW[b.rot]}
        </span>
        <button aria-label="右に回す" title="右に回す (R)" onClick={() => view.rotateBrush(1)}>
          ⟳
        </button>
        <InfoTip
          text={
            'チップを選ぶと「地形を塗る」に切り替わります。ドラッグで連続して置き、Alt+クリックで地図から拾います。消しゴム (E) で海に戻します。\n2×2 や 2 マスの部品は左上 (起点) のセルに置きます。書き出しで部品ごとのプールの数を作り直します。'
          }
        />
      </div>
      <input type="search" placeholder="名前か番号で絞る" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="pal-items tile-grid" role="group" aria-label="地形のチップ">
        {rows
          .filter((p) => p.row)
          .map((p) => {
            const url = src.partThumb?.(p.row) ?? null;
            const active = !erasing && view.tool !== 'place' && p.row === b.part;
            const sz = size(p.flags);
            return (
              <button
                key={p.row}
                className={`pal-item${active ? ' active' : ''}`}
                aria-pressed={active}
                aria-label={`${p.row} ${p.label}`}
                title={`${p.row} ${p.label}${sz ? ` (${sz})` : ''}`}
                onClick={() => {
                  view.setBrush({ part: p.row, rot: b.rot });
                  view.setTool('paint');
                }}
              >
                {url ? (
                  <img src={url} alt="" />
                ) : (
                  <span className="pal-swatch" style={{ background: src.partColor(p.row) }} />
                )}
                <span className="pal-label">{`${p.row} ${p.label}`}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function WorldLayers({ view }: { view: WorldView }): ReactNode {
  const src = view.src;
  const pins = src.entrances();
  const box = (key: string, label: string, color?: string): ReactNode => (
    <label key={key} className="layer">
      <input
        type="checkbox"
        checked={!!view.layers[key]}
        onChange={(e) => {
          view.layers[key] = e.target.checked;
          view.refresh();
        }}
      />
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
        <input
          type="checkbox"
          checked={view.showModels}
          onChange={(e) => {
            view.showModels = e.target.checked;
            view.refresh();
          }}
        />
        3D でモデルを描く
      </label>
    </div>
  );
}

function WorldStatus({
  view,
  statusOf,
}: {
  view: WorldView;
  statusOf?: (x: number, y: number) => string[];
}): ReactNode {
  useSignal(view.hoverSignal);
  const h = view.hover,
    N = view.src.size;
  const parts: string[] = [];
  if (h && h[0] >= 0 && h[1] >= 0 && h[0] < N && h[1] < N) {
    const [x, y] = h;
    parts.push(`セル (${x}, ${y})`);
    const g = view.src.ground();
    if (g) {
      const i = y * N + x,
        p = g.parts[i]!;
      parts.push(
        p ? `部品 ${p} ${view.src.palette().find((r) => r.row === p)?.label ?? ''} 向き ${g.rots[i]}` : '部品なし',
      );
    }
    parts.push(...(statusOf?.(x, y) ?? []));
  }
  parts.push(
    `ツール: ${{ select: '選択・移動', paint: '地形を塗る', erase: '地形を消す', place: `パーツを置く (${view.stamp?.label ?? ''})` }[view.tool]}`,
  );
  parts.push(view.status || '右ドラッグ: 2D は移動、3D は回転 / 中ドラッグ: 3D の移動 / ホイール: 拡大');
  return <>{parts.join('   ')}</>;
}
