// The map editor's React parts: the header (map picker, view mode, undo), the left pane (tools, add panel,
// palette, layers), the right pane (inspector, validation) and the status bar. The 2D / 3D views stay canvases
// owned by MapEditor and are placed between the panes.
import { useState, type ReactNode } from 'react';
import { LAYOUTS, POINT_SECTIONS } from '../game/sections';
import { MapButton } from '../ui/MapPicker';
import { Dom } from '../ui/mount';
import { useEditorState, useSignal } from '../ui/useEditorState';
import { AddPanel } from './addpanel';
import { Inspector } from './inspector';
import { SECTION_COLORS } from './legend';
import type { MapEditor, ViewMode } from './mapeditor';
import { NewMapDialog } from './newmapdialog';
import { Palette } from './palette';
import type { MapEditState, Tool } from './state';
import type { Issue } from './validate';

export function MapEditorUi({ editor }: { editor: MapEditor }): ReactNode {
  return (
    <>
      <Header editor={editor} />
      <LeftPane editor={editor} />
      <Dom node={editor.views} />
      <RightPane editor={editor} />
      <StatusBar editor={editor} />
    </>
  );
}

const MODES: [ViewMode, string][] = [['2d', '2D'], ['3d', '3D'], ['split', '分割']];

function Header({ editor }: { editor: MapEditor }): ReactNode {
  const { st, game } = editor;
  useEditorState(st);
  useSignal(editor.ui);
  const [adding, setAdding] = useState(false);
  return (
    <header>
      {st.info && (
        <MapButton game={game} value={st.info.hash} className="map-select" modified={editor.modifiedMaps()} onChange={(h) => void editor.openMap(h)} />
      )}
      <button title="既存のダンジョンに新しいマップ (階) を足す" onClick={() => setAdding(true)}>＋ マップを追加</button>
      <div className="seg">
        {MODES.map(([m, label]) => <button key={m} className={editor.mode === m ? 'active' : ''} onClick={() => editor.setMode(m)}>{label}</button>)}
      </div>
      <div className="seg" title="3D の扉・門を閉じた姿 / 開いた姿で表示する (見た目だけ。データは変えない)">
        {([false, true] as const).map((open) => (
          <button key={String(open)} className={editor.v3.doorsOpen === open ? 'active' : ''} onClick={() => editor.setDoorsOpen(open)}>{open ? '扉: 開' : '扉: 閉'}</button>
        ))}
      </div>
      <div className="seg">
        <button title="元に戻す (Ctrl+Z)" disabled={!st.canUndo()} onClick={() => st.undo()}>↶ 戻す</button>
        <button title="やり直す (Ctrl+Y)" disabled={!st.canRedo()} onClick={() => st.redo()}>↷ やり直し</button>
      </div>
      <span className="grow" />
      {adding && (
        <NewMapDialog session={editor.session} currentDungeon={st.info?.dungeon ?? null} onClose={() => setAdding(false)}
          onCreated={(m) => { setAdding(false); void editor.openMap(m.hash); }} />
      )}
    </header>
  );
}

export const TOOLS: [Tool, string, string][] = [
  ['select', '選択・移動', 'V'],
  ['paint', 'タイルを置く', 'B'],
  ['erase', 'タイルを消す', 'E'],
  ['rect', '範囲選択', 'M'],
  ['room', '敵が出ないセル (区画 6)', 'G'],
];

function LeftPane({ editor }: { editor: MapEditor }): ReactNode {
  return (
    <aside className="left">
      <Tools st={editor.st} />
      <AddPanel editor={editor} />
      <FactoryPalette editor={editor} />
      <Layers editor={editor} />
    </aside>
  );
}

/** The tool buttons (both games). */
export function Tools({ st, tools = TOOLS }: { st: MapEditState; tools?: [Tool, string, string][] }): ReactNode {
  useEditorState(st);
  return (
    <div className="tools">
      {tools.map(([t, label, key]) => (
        <button key={t} className={st.tool === t ? 'active' : ''} title={`${label} (${key})`} onClick={() => st.setTool(t)}>
          {`${label} `}<kbd>{key}</kbd>
        </button>
      ))}
    </div>
  );
}

function FactoryPalette({ editor }: { editor: MapEditor }): ReactNode {
  useSignal(editor.ui);
  const st = editor.st;
  useEditorState(st);
  const master = st.game.master;
  return <Palette st={st} factory={editor.factory} palette={master.palette(st.tileset)} partModel={(k, l) => master.partModel(k, st.tileset, l)} />;
}

/** What the views show: layers, the 2D style, the 3D ceiling, clipping and object models. */
function Layers({ editor }: { editor: MapEditor }): ReactNode {
  const { ctl, v2, v3 } = editor;
  useSignal(editor.ui);
  const change = (f: () => void): void => {
    f();
    editor.redraw();
  };
  const box = (label: string, checked: boolean, set: (v: boolean) => void, color?: string): ReactNode => (
    <label key={label} className="layer">
      <input type="checkbox" checked={checked} onChange={(e) => change(() => set(e.target.checked))} />
      {color && <span className="dot" style={{ background: color }} />}
      {` ${label}`}
    </label>
  );
  return (
    <div className="layers">
      <h3>表示</h3>
      {box('タイル', ctl.layers.tiles, (v) => (ctl.layers.tiles = v))}
      {box('敵が出ないセル (区画 6)', ctl.layers.room, (v) => (ctl.layers.room = v), 'rgba(80,200,255,0.6)')}
      {POINT_SECTIONS.map((k) => box(LAYOUTS[k]!.label, ctl.layers.sections[k]!, (v) => (ctl.layers.sections[k] = v), SECTION_COLORS[k]))}
      <h3>2D</h3>
      <div className="seg">
        <button className={v2.style === 'symbols' ? 'active' : ''} onClick={() => change(() => (v2.style = 'symbols'))}>記号</button>
        <button className={v2.style === 'minimap' ? 'active' : ''} onClick={() => change(() => (v2.style = 'minimap'))}>ミニマップ風</button>
        <button onClick={() => v2.fit()}>全体</button>
      </div>
      <h3>3D</h3>
      {box('天井を表示', v3.showCeiling, (v) => v3.setCeilingVisible(v))}
      <label className="field">
        <span>高さで切る (右端 = 切らない)</span>
        <input type="range" min={20} max={400} value={editor.clipHeight} onChange={(e) => editor.setClipHeight(Number(e.target.value))} />
      </label>
      <div className="seg">
        <button onClick={() => v3.fit()}>全体</button>
        <button onClick={() => v3.topView()}>真上</button>
      </div>
      {box('オブジェクトのモデル (階段・扉・宝箱・NPC など)', v3.showObjects, (v) => (v3.showObjects = v))}
      <p className="muted small">3D: 右ドラッグで回転、中ドラッグで移動、ホイールで拡大。2D: 右 / 中ドラッグで移動。</p>
    </div>
  );
}

function RightPane({ editor }: { editor: MapEditor }): ReactNode {
  return (
    <aside className="right">
      <Inspector editor={editor} />
      <h3>検証</h3>
      <Issues editor={editor} />
    </aside>
  );
}

function Issues({ editor }: { editor: MapEditor }): ReactNode {
  useSignal(editor.ui);
  return <IssueList st={editor.st} issues={editor.issues} />;
}

/** Validation results; clicking one selects what it is about (both games). */
export function IssueList({ st, issues }: { st: MapEditState; issues: Issue[] }): ReactNode {
  return (
    <div className="issues">
      {!issues.length && <div className="ok">問題なし</div>}
      {issues.map((i, n) => (
        <div key={n} className={`issue ${i.level}`} onClick={() => i.target && st.select(i.target)}>{`${i.level === 'error' ? '✖' : '⚠'} ${i.msg}`}</div>
      ))}
    </div>
  );
}

function StatusBar({ editor }: { editor: MapEditor }): ReactNode {
  useSignal(editor.hover);
  useSignal(editor.ui);
  const st = editor.st;
  useEditorState(st);
  const hv = editor.ctl.hover;
  const parts = [];
  if (hv) parts.push(`セル (${hv[0]}, ${hv[1]})`);
  parts.push(`ツール: ${st.tool}`);
  if (st.clip) parts.push(`コピー ${st.clip.w}×${st.clip.h}`);
  if (editor.statusMsg) parts.push(editor.statusMsg);
  if (editor.errorMsg) parts.push(`⚠ ${editor.errorMsg}`);
  return <div className="status">{parts.join('   ')}</div>;
}

