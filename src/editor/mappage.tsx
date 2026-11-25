// The frame and panes shared by the map pages of RPG3 (oahu/MapPage.tsx) and RPG FREE! (lanai/MapPage.tsx): the
// layout (header, left pane, the 2D / 3D views, right pane, status bar), the header's view and undo buttons, the
// layer switches, the checks and the status bar. What differs (the picker's groups, the add panel, the inspector's
// fields, the map's facts) is given by each game's page.
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { MapDoc, RecordLayout } from '../game/sections';
import { useEditorState, useSignal, type Signal } from '../ui/useEditorState';
import type { Controller } from './controller';
import type { GridCanvas } from './gridcanvas';
import { SECTION_COLORS } from './legend';
import type { MapScene } from './mapscene';
import type { Issue, MapEditState, Selection } from './model';
import { IssueList } from './tools';

export type MapViewMode = 'split' | '2d' | '3d';

/** What the shared panes need of a game's map view (oahu/mapview.ts OahuMapView, lanai/mapview.ts LanaiMapView). */
export interface MapPageView {
  readonly grid: GridCanvas;
  /** The 3D view; none on a page with the 2D view only (初代's). */
  readonly scene?: MapScene;
  readonly ctl: Controller;
  /** Emitted when what the panes show changes (models loaded, layers). */
  readonly signal: Signal;
  /** Emitted when the hovered cell changes. */
  readonly hover: Signal;
  readonly doc: MapDoc;
  status: string;
  errorMsg: string;
  fit(): void;
  refresh(): void;
}

/**
 * The map page's layout: the header, then the left pane, the views (their canvases are put into `pane2d` /
 * `pane3d`), the right pane and the status bar; `placeholder` (a map that cannot be shown) takes the place of all
 * but the header.
 */
export function MapFrame({
  mode,
  header,
  left,
  right,
  status,
  pane2d,
  pane3d,
  placeholder,
}: {
  mode: MapViewMode;
  header: ReactNode;
  left: ReactNode;
  right: ReactNode;
  status: ReactNode;
  pane2d: RefObject<HTMLDivElement | null>;
  pane3d: RefObject<HTMLDivElement | null>;
  placeholder?: ReactNode;
}): ReactNode {
  return (
    <div className="oahu-map" data-mode={mode}>
      <header>{header}</header>
      {placeholder ?? (
        <>
          <aside className="left">{left}</aside>
          <div className="views">
            <div className="pane pane2d" ref={pane2d} />
            <div className="pane pane3d" ref={pane3d} />
          </div>
          <aside className="right">{right}</aside>
          <div className="status">{status}</div>
        </>
      )}
    </div>
  );
}

/** The header's right side: view mode, undo / redo, fitting the views, and reverting the map. */
export function MapHeaderControls({
  st,
  view,
  open,
  mode,
  setMode,
  showModes,
  onRevert,
}: {
  st: MapEditState;
  view: MapPageView | null;
  /** The map is open in the editor (undo and the revert apply to it). */
  open: boolean;
  mode: MapViewMode;
  setMode: (m: MapViewMode) => void;
  showModes: boolean;
  /** Puts the map back as in the ROM; given while it differs from the ROM's. */
  onRevert?: () => void;
}): ReactNode {
  useEditorState(st);
  return (
    <>
      <span className="grow" />
      {showModes && (
        <span className="seg">
          {(['2d', 'split', '3d'] as const).map((m) => (
            <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'split' ? '両方' : m.toUpperCase()}
            </button>
          ))}
        </span>
      )}
      {open && (
        <span className="seg">
          <button title="元に戻す (Ctrl+Z)" disabled={!st.canUndo()} onClick={() => st.undo()}>
            ↶ 戻す
          </button>
          <button title="やり直す (Ctrl+Y)" disabled={!st.canRedo()} onClick={() => st.redo()}>
            ↷ やり直し
          </button>
        </span>
      )}
      {view && <button onClick={() => view.fit()}>全体を表示</button>}
      {view?.scene && <button onClick={() => view.scene!.topView()}>真上から</button>}
      {open && onRevert && <button onClick={onRevert}>このマップの変更を元に戻す</button>}
    </>
  );
}

/** The status bar: the hovered cell, the tool, the copied range, the view's message or the last edit's error. */
export function MapStatus({ st, view }: { st: MapEditState; view: MapPageView }): ReactNode {
  useSignal(view.signal);
  useSignal(view.hover);
  useEditorState(st);
  const hv = view.ctl.hover;
  const parts: string[] = [];
  if (hv) parts.push(`セル (${hv[0]}, ${hv[1]})`);
  parts.push(`ツール: ${st.tool}`);
  if (st.clip) parts.push(`コピー ${st.clip.w}×${st.clip.h}`);
  const stack = view.ctl.stackHint();
  if (stack) parts.push(stack);
  if (view.status) parts.push(view.status);
  if (view.errorMsg) parts.push(`⚠ ${view.errorMsg}`);
  if (!view.status && !view.errorMsg)
    parts.push('右ドラッグ: 2D は移動、3D は回転 / 中ドラッグ: 3D の移動 / ホイール: 拡大');
  return <>{parts.join('   ')}</>;
}

/** A switch of the layers pane (redraws the views). */
export function LayerBox({
  view,
  label,
  checked,
  set,
  color,
}: {
  view: MapPageView;
  label: string;
  checked: boolean;
  set: (v: boolean) => void;
  color?: string;
}): ReactNode {
  return (
    <label className="layer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          set(e.target.checked);
          view.refresh();
        }}
      />
      {color && <span style={{ color }}>● </span>}
      {label}
    </label>
  );
}

/** What the views show: the tiles, section 6's cells and the point sections (with their counts), then `children`. */
export function MapLayers({
  st,
  view,
  sections,
  layouts,
  room = true,
  children,
}: {
  st: MapEditState;
  view: MapPageView;
  sections: readonly number[];
  layouts: Record<number, RecordLayout>;
  /** Whether the maps have section 6's cells (初代's have no such section). */
  room?: boolean;
  children?: ReactNode;
}): ReactNode {
  useSignal(view.signal);
  useEditorState(st);
  const layers = view.ctl.layers;
  const doc = view.doc;
  return (
    <div className="layers">
      <h3>表示</h3>
      <LayerBox
        view={view}
        label={`タイル ${doc.tiles.length}`}
        checked={layers.tiles}
        set={(v) => (layers.tiles = v)}
      />
      {room && (
        <LayerBox
          view={view}
          label={`区画 6 のセル ${doc.cells6.length}`}
          checked={layers.room}
          set={(v) => (layers.room = v)}
          color="rgba(80,200,255,0.8)"
        />
      )}
      {sections.map((k) => (
        <LayerBox
          key={k}
          view={view}
          label={`${layouts[k]!.label} ${doc.recs[k]?.length ?? 0}`}
          checked={!!layers.sections[k]}
          set={(v) => (layers.sections[k] = v)}
          color={SECTION_COLORS[k]}
        />
      ))}
      {children}
    </div>
  );
}

/**
 * Whether a problem is of what is selected: the record itself, one of the cells, or (a range) a cell or a record
 * inside it. A problem without a target is of the map alone, so of no selection.
 */
export function issueTouches(issue: Issue, sel: Selection, doc: MapDoc | null): boolean {
  const t = issue.target;
  if (!t || sel.type === 'none') return false;
  if (sel.type === 'rec') return t.type === 'rec' && t.section === sel.section && t.index === sel.index;
  const cells = t.type === 'tiles' ? t.cells : [];
  if (sel.type === 'tiles') return cells.some(([x, y]) => sel.cells.some(([a, b]) => a === x && b === y));
  if (sel.type !== 'rect') return false;
  const inside = (x: number, y: number): boolean =>
    x >= Math.min(sel.x0, sel.x1) &&
    x <= Math.max(sel.x0, sel.x1) &&
    y >= Math.min(sel.y0, sel.y1) &&
    y <= Math.max(sel.y0, sel.y1);
  if (t.type === 'rec') {
    const r = doc?.recs[t.section]?.[t.index];
    return !!r && inside(r.x, r.y);
  }
  return cells.some(([x, y]) => inside(x, y));
}

/**
 * The checks of the open map, run a moment after the last edit (`deps`: what else they read, e.g. the event tables).
 * `title` with `bySelection`: nothing selected shows every problem under the title; with a selection, only the
 * problems of it, and nothing at all (not the title) when it has none.
 */
export function MapChecks({
  st,
  hash,
  validate,
  deps,
  title,
  bySelection,
}: {
  st: MapEditState;
  hash: number;
  validate: (doc: MapDoc) => Issue[];
  deps?: unknown;
  title?: ReactNode;
  bySelection?: boolean;
}): ReactNode {
  const revision = useEditorState(st);
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const doc = st.current;
      if (doc?.hash === hash) setIssues(validate(doc));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `validate` is made on every render
  }, [st, hash, revision, deps]);
  const sel = st.selection;
  if (bySelection && sel.type !== 'none') {
    const own = issues.filter((i) => issueTouches(i, sel, st.current));
    if (!own.length) return null;
    return (
      <>
        {title}
        <IssueList st={st} issues={own} />
      </>
    );
  }
  return (
    <>
      {title}
      <IssueList st={st} issues={issues} />
    </>
  );
}
