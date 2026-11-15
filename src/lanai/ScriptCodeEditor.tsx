// The editor of a function's text: colours, completion, the mistakes under their lines, what the lines of talk say,
// folding (scriptCodeMirror.ts). CodeMirror is loaded when the editor is first shown; until then, and where there is
// no document (the tests render to a string), the text is a plain textarea that works the same.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NO_ASSIST, type ScriptAssist } from './scriptAssist';
import type { ScriptEditorHandle, ScriptProblem } from './scriptCodeMirror';

const NO_PROBLEMS: ScriptProblem[] = [];

export function ScriptCodeEditor({
  value,
  onChange,
  onBlur,
  label,
  readOnly = false,
  assist = NO_ASSIST,
  problems = NO_PROBLEMS,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  label: string;
  readOnly?: boolean;
  assist?: ScriptAssist;
  problems?: ScriptProblem[];
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ScriptEditorHandle | null>(null);
  const [ready, setReady] = useState(false);
  // what the editor is mounted with, and what it calls: always the latest
  const latest = useRef({ value, onChange, label, readOnly, assist, problems });
  latest.current = { value, onChange, label, readOnly, assist, problems };

  useEffect(() => {
    let live = true;
    import('./scriptCodeMirror').then(
      (m) => {
        if (!live || !host.current) return;
        const now = latest.current;
        handle.current = m.mountScriptEditor(host.current, {
          value: now.value,
          label: now.label,
          readOnly: now.readOnly,
          assist: now.assist,
          problems: now.problems,
          onChange: (v) => latest.current.onChange(v),
        });
        setReady(true);
      },
      // the textarea stays
      () => undefined,
    );
    return () => {
      live = false;
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);
  useEffect(() => handle.current?.setValue(value), [value, ready]);
  useEffect(() => handle.current?.setAssist(assist), [assist, ready]);
  useEffect(() => handle.current?.setProblems(problems), [problems, ready]);
  useEffect(() => handle.current?.setReadOnly(readOnly), [readOnly, ready]);

  return (
    <div
      className="script-code"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !e.relatedTarget?.closest('[data-script-discard]'))
          onBlur?.();
      }}
    >
      {!ready && (
        <textarea
          aria-label={label}
          className="mono"
          rows={Math.min(30, Math.max(4, value.split('\n').length + 1))}
          style={{ width: '100%' }}
          spellCheck={false}
          readOnly={readOnly}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <div ref={host} hidden={!ready} />
    </div>
  );
}
