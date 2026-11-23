// 「スクリプトを閲覧」(STATE #17): a shipped stage's events read back from its CRO (croDecompile.ts) as stage script,
// read only. A shipped stage's CRO is not rebuilt from a script (only an added stage's is, StageScriptEditor.tsx), so
// nothing here is saved; the text is copied, or inserted into an added stage's script with 「既存のイベントから挿入」.
import { useMemo, useState, type ReactNode } from 'react';
import { useAsync } from '../ui/useAsync';
import { contentTitle, type LanaiContent } from './contents';
import { decompileContentCro, decompiledSource } from './croDecompile';
import { ScriptCodeEditor } from './ScriptCodeEditor';
import type { LanaiSession } from './session';
import { contentScript } from './stageEdit';

function openViewTab(session: LanaiSession, content: LanaiContent): void {
  const tab = window.open('', '_blank');
  if (!tab) return;
  tab.document.title = `${content.stages[0]?.name ?? 'ステージ'} — スクリプト (閲覧)`;
  tab.document.head.innerHTML = document.head.innerHTML;
  tab.document.body.innerHTML = '<div id="stage-source-root"></div>';
  void import('react-dom/client').then((react) => {
    if (tab.closed) return;
    const host = tab.document.getElementById('stage-source-root');
    if (!host) return;
    const root = react.createRoot(host);
    root.render(<CroScriptPage session={session} content={content} />);
    tab.addEventListener('pagehide', () => root.unmount(), { once: true });
  });
}

/** The section of a shipped stage's page: the button that opens the script read back from the CRO. */
export function CroScriptSection({ session, content }: { session: LanaiSession; content: LanaiContent }): ReactNode {
  return (
    <>
      <h3>イベントのスクリプト</h3>
      <div className="row">
        <button onClick={() => openViewTab(session, content)}>スクリプトを閲覧 ↗</button>
      </div>
      <p className="muted small">
        このステージのイベントは CRO (ネイティブコード)
        のままです。それをスクリプトに戻したものを読むだけで、編集や反映はできません。言語で書けない部分は「//
        未対応:」の注記になります。自作のステージのスクリプトのエディタでは「既存のイベントから挿入」でここのイベントを取り込めます。
      </p>
    </>
  );
}

export function CroScriptPage({ session, content }: { session: LanaiSession; content: LanaiContent }): ReactNode {
  const decompiled = useAsync(async () => {
    const { body } = await contentScript(session, content, await session.archive(content.archive));
    return decompileContentCro(body);
  }, [session, content]);
  const d = decompiled && !(decompiled instanceof Error) ? decompiled : null;
  /** The event shown; '' is all of them. */
  const [shown, setShown] = useState('');
  const text = useMemo(
    () => (d ? decompiledSource(d, shown ? [shown] : d.events.map((e) => e.cls), content.index) : ''),
    [d, shown, content.index],
  );
  const clean = d?.events.filter((e) => !e.notes.length).length ?? 0;

  return (
    <main className="stage-source-page">
      <h2>{`${content.index}: ${contentTitle(content)} — スクリプト (閲覧)`}</h2>
      <p className="muted small">
        CRO をスクリプトに戻したもので、読むだけです (保存も反映もされません)。行
        ID・台詞・フラグの番号は元のステージのものです。元の割り当ては関数の前の注記にあります。
      </p>
      {decompiled instanceof Error && <p className="error small">{decompiled.message}</p>}
      {!decompiled && <p className="muted small">読み込み中…</p>}
      {d && (
        <>
          <div className="row">
            <label className="field">
              <span>イベント</span>
              <select value={shown} onChange={(e) => setShown(e.target.value)}>
                <option value="">{`すべて (${d.events.length} 件、未対応なし ${clean} 件)`}</option>
                {d.events.map((e) => (
                  <option key={e.cls} value={e.cls}>
                    {`${e.cls}${e.notes.length ? ` (未対応 ${e.notes.length})` : ''}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {d.events.length ? (
            <div className="stage-source-view">
              <ScriptCodeEditor value={text} onChange={() => {}} label="スクリプト (閲覧)" readOnly />
            </div>
          ) : (
            <p className="muted small">このコンテンツの CRO にはイベントがありません。</p>
          )}
        </>
      )}
    </main>
  );
}
