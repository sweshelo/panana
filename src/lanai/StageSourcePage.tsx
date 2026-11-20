// The script editor of an added stage: the only place its variables and functions are written. What the functions are
// given to is set on the map's page (the record's "スクリプトの関数") and on the stage's page, so it is not in this
// text. The text is saved when the editor loses the focus (or with the button); a move() dragged on the map's page
// comes in function by function.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { contentTitle, type LanaiContent } from './contents';
import {
  docWithCode,
  mergeScriptCode,
  scriptDocCode,
  scriptDocFromSource,
  scriptDocSource,
  type ScriptBinding,
} from './eventScript';
import { ScriptCodeEditor } from './ScriptCodeEditor';
import { SCRIPT_SAMPLES, type ScriptSample } from './scriptDoc';
import { bindingLabel, StageScriptDocs } from './StageScriptEditor';
import type { ScriptLibraryFunction } from './scriptLibrary';
import type { LanaiSession } from './session';
import { checkStageScript } from './stageScript';
import { useLanaiRevision } from './MonsterEditor';
import { StagePreviewScene } from './ScriptPreview';

/** The names of the functions and variables a text declares ([] when it does not read). */
function declaredNames(text: string): string[] {
  try {
    const doc = scriptDocFromSource(text);
    return [...doc.vars.map((v) => v.name), ...doc.functions.map((f) => f.name)];
  } catch {
    return [];
  }
}
const withAppended = (text: string, more: string): string =>
  `${text.trimEnd() ? `${text.trimEnd()}\n\n` : ''}${more.trim()}\n`;

export function LanaiStageSourcePage({
  session,
  content,
  hostWindow,
}: {
  session: LanaiSession;
  content: LanaiContent | undefined;
  hostWindow?: Window;
}): ReactNode {
  const activeWindow = hostWindow ?? (typeof window === 'undefined' ? undefined : window);
  useLanaiRevision(session);
  const archive = content?.archive.toUpperCase() ?? '';
  const stored = session.stageScripts.get(archive);
  const applied = scriptDocCode(stored?.doc);
  const [source, setSource] = useState(applied);
  const [seen, setSeen] = useState(applied);
  /** What the text and the change made elsewhere both changed; null when nothing. */
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [dropping, setDropping] = useState<ScriptBinding[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // The script changed elsewhere: a text not edited here takes it; an edited one takes what it left as it was.
  // (What is given to the functions is not in the text: a change of that alone changes nothing here.)
  if (seen !== applied) {
    setSeen(applied);
    if (source === seen || source === applied) {
      setSource(applied);
      setConflict(null);
    } else {
      const m = mergeScriptCode(seen, source, applied);
      setSource(m.text);
      setConflict(
        !m.readable ? ['(書きかけの文字列が読めないため取り込めません)'] : m.conflicts.length ? m.conflicts : null,
      );
    }
  }
  const dirty = source !== applied;

  const save = async (manual: boolean): Promise<void> => {
    if (!content || busy || source === scriptDocCode(session.stageScripts.get(archive)?.doc)) return;
    const text = source;
    setBusy(true);
    setError('');
    try {
      const first = docWithCode(session.stageScripts.get(archive)?.doc, text);
      if (first.dropped.length) {
        setDropping(first.dropped);
        if (!manual) return;
        const ask = `次の割り当てが外れます。保存しますか？\n${first.dropped.map((b) => `${bindingLabel(b)} → ${b.fn}`).join('\n')}`;
        if (!(activeWindow?.confirm(ask) ?? false)) return;
      }
      if (first.doc.vars.length || first.doc.functions.length) {
        const check = await checkStageScript(session, content, scriptDocSource(first.doc).text);
        if (check.problems.length) throw new Error(check.problems.join('\n'));
      }
      // what is given to the functions may have changed while it was checked: the latest is kept
      const { doc } = docWithCode(session.stageScripts.get(archive)?.doc, text);
      session.setStageScriptDoc(archive, doc);
      session.edited();
      const code = scriptDocCode(session.stageScripts.get(archive)?.doc);
      setSeen(code);
      setSource((s) => (s === text ? code : s));
      setConflict(null);
      setDropping([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // the listeners of the window call the latest save
  const latestSave = useRef(save);
  latestSave.current = save;
  useEffect(() => {
    if (!activeWindow) return;
    const away = (): void => void latestSave.current(false);
    const hidden = (): void => {
      if (activeWindow.document.visibilityState === 'hidden') away();
    };
    activeWindow.addEventListener('blur', away);
    activeWindow.document.addEventListener('visibilitychange', hidden);
    return () => {
      activeWindow.removeEventListener('blur', away);
      activeWindow.document.removeEventListener('visibilitychange', hidden);
    };
  }, [activeWindow]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    activeWindow?.addEventListener('beforeunload', before);
    return () => activeWindow?.removeEventListener('beforeunload', before);
  }, [dirty, activeWindow]);

  if (!content) return <p className="error">ステージが見つかりません。</p>;
  if (!session.createdFiles.has(archive))
    return <p className="error">イベントのスクリプトは追加したステージで編集できます。</p>;

  const append = (what: string, more: string): void => {
    const names = declaredNames(source);
    const taken = declaredNames(more).filter((n) => names.includes(n));
    if (taken.length) return setNote(`「${taken.join('」「')}」はもうスクリプトにあります`);
    setSource(withAppended(source, more));
    setNote(what);
  };
  const addSample = (s: ScriptSample): void =>
    append(`例「${s.name}」を末尾に足しました。${s.about} 割り当て: ${s.give.join('、')}。`, s.source);
  const addLibrary = (f: ScriptLibraryFunction): void =>
    append(`「${f.name}」を末尾に足しました。保存すると、ライブラリの代わりにこちらが使われます`, f.source);
  const bindings = stored?.doc.bindings ?? [];

  return (
    <main className="stage-source-page">
      <header className="stage-source-head">
        <div>
          {!hostWindow ? (
            <a href={`#/stages/${content.index}`}>← {contentTitle(content)}</a>
          ) : (
            <button onClick={() => hostWindow.close()}>← {contentTitle(content)} に戻る</button>
          )}
          <h2>イベントのスクリプト</h2>
        </div>
        <div className="row">
          {conflict ? (
            <span className="error small">{`別の画面で変更されました: ${conflict.join('、')}`}</span>
          ) : (
            dirty && <span className="muted small">未保存の変更があります</span>
          )}
          <button
            disabled={!dirty || busy}
            onClick={() => {
              setSource(applied);
              setSeen(applied);
              setConflict(null);
              setDropping([]);
              setError('');
            }}
          >
            {conflict ? '最新を読み込む (変更を捨てる)' : '変更を捨てる'}
          </button>
          <button className="primary" disabled={!dirty || busy} onClick={() => void save(true)}>
            {busy ? '確認中…' : dirty ? '保存' : '保存済み'}
          </button>
        </div>
      </header>
      <div className="stage-source-columns">
        <section className="stage-source-code" aria-label="スクリプト全文">
          <ScriptCodeEditor
            label="スクリプト全文"
            value={source}
            onChange={setSource}
            onBlur={() => void latestSave.current(false)}
          />
          {error && (
            <pre className="error" role="alert">
              {error}
            </pre>
          )}
          {dropping.length > 0 && (
            <p className="error small">
              {`保存すると次の割り当てが外れるため、自動では保存しません (「保存」で確かめて保存します): ${dropping.map((b) => `${bindingLabel(b)} → ${b.fn}`).join('、')}`}
            </p>
          )}
          <div className="row">
            {SCRIPT_SAMPLES.map((s) => (
              <button key={s.name} onClick={() => addSample(s)}>{`例: ${s.name}`}</button>
            ))}
          </div>
          {note && <p className="muted small">{note}</p>}
          <h3>割り当て</h3>
          {bindings.length ? (
            <ul className="small">
              {bindings.map((b) => (
                <li key={`${b.trigger}:${b.group}:${b.row}`}>
                  {`${bindingLabel(b)} → `}
                  <span className="mono">{b.fn || '(ゲームと同じ演出だけ)'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">まだありません。</p>
          )}
          <p className="muted small">
            割り当ては、マップのページのレコードの「スクリプトの関数」と、ステージのページの「ステージに入ったとき」「マップが始まるとき」で変えます。関数の名前を変えると、その関数の割り当ては外れます。
          </p>
        </section>
        <aside className="stage-source-docs" aria-label="関数ドキュメント">
          <StagePreviewScene session={session} content={content} source={source} />
          <StageScriptDocs session={session} content={content} onAdd={addLibrary} />
        </aside>
      </div>
    </main>
  );
}
