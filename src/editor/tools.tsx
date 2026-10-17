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
