import { useEffect, useState, type ReactNode } from 'react';
import { contentTitle, type LanaiContent } from './contents';
import { ScriptCodeEditor } from './ScriptCodeEditor';
import { StageScriptDocs } from './StageScriptEditor';
import type { LanaiSession } from './session';
import { checkStageScript } from './stageScript';
import { useLanaiRevision } from './MonsterEditor';

/** Full source editor for an added stage. Its source is the same document used by the function editor and MOD export. */
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
  const applied = session.stageScripts.get(archive)?.source ?? '';
  const [source, setSource] = useState(applied);
  const [seen, setSeen] = useState(applied);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (seen !== applied && (source === seen || source === applied)) {
    setSeen(applied);
    setSource(applied);
  }
  const dirty = source !== applied;
  const conflict = seen !== applied && source !== seen;
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

  const save = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      if (conflict) throw new Error('別の画面でスクリプトが変わりました。変更を捨てて最新の内容を読み込んでください。');
      if (source.trim()) {
        const check = await checkStageScript(session, content, source);
        if (check.problems.length) throw new Error(check.problems.join('\n'));
      }
      if ((session.stageScripts.get(archive)?.source ?? '') !== seen)
        throw new Error('確認中にスクリプトが変わりました。変更を捨てて最新の内容を読み込んでください。');
      session.setStageScript(archive, source);
      session.edited();
      setSeen(session.stageScripts.get(archive)?.source ?? '');
      setSource(session.stageScripts.get(archive)?.source ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
            <span className="error small">別の画面で変更されました</span>
          ) : (
            dirty && <span className="muted small">未反映の変更があります</span>
          )}
          <button
            disabled={!dirty || busy}
            onClick={() => {
              setSource(applied);
              setSeen(applied);
              setError('');
            }}
          >
            変更を捨てる
          </button>
          <button className="primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? '確認中…' : 'スクリプトを反映'}
          </button>
        </div>
      </header>
      <div className="stage-source-columns">
        <section className="stage-source-code" aria-label="スクリプト全文">
          <ScriptCodeEditor label="スクリプト全文" value={source} onChange={setSource} />
          {error && (
            <pre className="error" role="alert">
              {error}
            </pre>
          )}
        </section>
        <aside className="stage-source-docs" aria-label="関数ドキュメント">
          <StageScriptDocs session={session} content={content} />
        </aside>
      </div>
    </main>
  );
}
