// Map editor parts shared by every game: the tool buttons and the validation list. They take the edit state and
// what to show, and know nothing about a game's tables.
import type { ReactNode } from 'react';
import { useEditorState } from '../ui/useEditorState';
import type { Issue, MapEditState, Tool } from './model';

export const TOOLS: [Tool, string, string][] = [
  ['select', '選択・移動', 'V'],
  ['paint', 'タイルを置く', 'B'],
  ['erase', 'タイルを消す', 'E'],
  ['rect', '範囲選択', 'M'],
  ['room', '敵が出ないセル (区画 6)', 'G'],
];

/** The tool buttons (both games). */
export function Tools({ st, tools = TOOLS, compact = false }: { st: MapEditState; tools?: [Tool, string, string][]; compact?: boolean }): ReactNode {
  useEditorState(st);
  return (
    <div className={compact ? 'tools compact-tools' : 'tools'} role="toolbar" aria-label="マップ編集ツール">
      {tools.map(([t, label, key]) => (
        <button key={t} className={st.tool === t ? 'active' : ''} aria-label={label} aria-pressed={st.tool === t}
          title={`${label}${key ? ` (${key})` : ''}`} disabled={t === 'place' && !st.stamp} onClick={() => st.setTool(t)}>
          {compact ? <ToolIcon tool={t} /> : <>{`${label} `}<kbd>{key}</kbd></>}
        </button>
      ))}
    </div>
  );
}

export function ToolIcon({ tool }: { tool: Tool }): ReactNode {
  const paths: Record<Tool,string> = {
    select: 'M4 3v16l4-5 4 6 3-2-4-6 6-1Z',
    paint: 'm14 3 7 7-9 9-7-7Zm-9 9-2 9 9-2M12 5l7 7',
    erase: 'm14 3 7 7-11 11H6l-4-4Zm-7 9 7 7M10 21h11',
    rect: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5',
    room: 'M4 4h16v16H4ZM4 12h16M12 4v16M3 21 21 3',
    place: 'M12 3v18M3 12h18M5 5h14v14H5',
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[tool]} /></svg>;
}

/** Switching placement modes retains the selected brush and stamp, including keyboard tool changes. */
export function MapToolbox({ st, tiles, parts, onDelete, onDuplicate, tileTools=TOOLS }: {
  st: MapEditState; tiles: ReactNode; parts: ReactNode; onDelete?: () => void; onDuplicate?: () => void; tileTools?: typeof TOOLS;
}): ReactNode {
  useEditorState(st);
  if(st.readOnly) return null;
  const isTiles = st.placementMode === 'tiles';
  const tools: [Tool,string,string][] = isTiles ? tileTools : [['select','選択・移動','V'],['place','パーツを置く',''],['rect','範囲選択','M']];
  return <div className="map-toolbox">
    <div className="map-toolbox-head">
      <div className="placement-modes" role="group" aria-label="配置するもの">
        <button aria-pressed={isTiles} className={isTiles ? 'active' : ''} onClick={() => st.setPlacementMode('tiles')}>チップ</button>
        <button aria-pressed={!isTiles} className={!isTiles ? 'active' : ''} onClick={() => st.setPlacementMode('parts')}>パーツ</button>
      </div>
      <div className="map-toolbox-actions">
        <Tools st={st} tools={tools} compact />
        {!isTiles && onDuplicate && <button className="part-delete" title="選んだパーツを複製 (Ctrl+D)" aria-label="選んだパーツを複製"
          disabled={st.selection.type !== 'rec'} onClick={onDuplicate}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 8h13v13H8ZM3 16V3h13" /></svg></button>}
        {!isTiles && onDelete && <button className="part-delete" title="選んだパーツを削除 (Delete)" aria-label="選んだパーツを削除"
          disabled={st.selection.type !== 'rec'} onClick={onDelete}><ToolIcon tool="erase" /></button>}
      </div>
    </div>
    {isTiles ? tiles : parts}
  </div>;
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
