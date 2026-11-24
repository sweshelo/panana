// The script editor of an added stage: the only place its variables and functions are written. What the functions are
// given to is set on the map's page (the record's "スクリプトの関数") and on the stage's page, so it is not in this
// text. The text is saved when the editor loses the focus (or with the button); a position (move() / SetPos) dragged
// or typed in the preview is written into the text (ScriptMovePanel.tsx). The lines of talk the editor shows and adds (ScriptLineDialog.tsx) are of the MapGroup
// of the map the preview shows.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAsync } from '../ui/useAsync';
import { contentTitle, type LanaiContent } from './contents';
import {
  docWithCode,
  mergeScriptCode,
  scriptDocCode,
  scriptDocFromSource,
  scriptDocSource,
  type ScriptBinding,
} from './eventScript';
import { ScriptCodeEditor, type ScriptCodeInsert } from './ScriptCodeEditor';
import { ScriptLineDialog } from './ScriptLineDialog';
import { CroEventDialog } from './CroEventDialog';
import type { LanaiMapInfo } from './maps';
import { NO_ASSIST, scriptOwnNames, type ScriptAssist } from './scriptAssist';
import { SCRIPT_SAMPLES } from './scriptDoc';
import { bindingLabel, StageScriptDocs, stageScriptAssist } from './StageScriptEditor';
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
  const revision = useLanaiRevision(session);
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
  const insertRef = useRef<ScriptCodeInsert | null>(null);
  const loaded = useAsync(
    async () => (content ? (await import('./maps')).lanaiMaps(session, content) : null),
    [session, content],
  );
  const maps = loaded && !(loaded instanceof Error) ? loaded : null;
  /** The map the preview shows: its MapGroup's lines are the ones the editor names. */
  const [map, setMap] = useState<LanaiMapInfo | undefined>(undefined);
  const group = map?.dungeon;
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  /** The tab the code column shows: the script, or one of the samples to read (not inserted). */
  const [tab, setTab] = useState<'code' | 'samples'>('code');
  const [sampleAt, setSampleAt] = useState(0);
  const sample = SCRIPT_SAMPLES[sampleAt] ?? SCRIPT_SAMPLES[0]!;
  // the names as one string: the help is made again only when they change
  // (read by their words: the text being written does not compile, and the names must not go while it is)
  const names = JSON.stringify(scriptOwnNames(source));
  const stage = useMemo(
    () => (maps ? stageScriptAssist(session, maps, group, []) : NO_ASSIST),
    [session, maps, group, revision],
  );
  const assist = useMemo<ScriptAssist>(
    () => ({ ...stage, ...(JSON.parse(names) as Pick<ScriptAssist, 'vars' | 'functions'>) }),
    [stage, names],
  );
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
          <div className="stage-source-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
              スクリプト
            </button>
            <button role="tab" aria-selected={tab === 'samples'} onClick={() => setTab('samples')}>
              サンプルを見る
            </button>
          </div>
          {tab === 'samples' && (
            <div className="stage-source-samples" role="tabpanel" aria-label="サンプル">
              <select aria-label="サンプル" value={sampleAt} onChange={(e) => setSampleAt(Number(e.target.value))}>
                {SCRIPT_SAMPLES.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="small">{sample.about}</p>
              <p className="small">{`割り当て: ${sample.give.join('、')}`}</p>
              <p className="muted small">
                サンプルは読むためのもので、スクリプトには足しません。使うときは必要なところを写し、番号を自分のステージのものに直してください。
              </p>
              <ScriptCodeEditor key={sample.name} label="サンプル" value={sample.source} onChange={() => {}} readOnly />
            </div>
          )}
          <div className="stage-source-tab" role="tabpanel" aria-label="スクリプト" hidden={tab !== 'code'}>
            <ScriptCodeEditor
              label="スクリプト全文"
              value={source}
              onChange={setSource}
              onBlur={() => void latestSave.current(false)}
              assist={assist}
              insertRef={insertRef}
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
              <button
                disabled={!maps || group === undefined || !maps.talkTable(group)}
                title="台詞の表に新しい台詞を足し、それを出す呼び出しをカーソルの位置に書きます (MapGroup は演出プレビューのマップのもの)"
                onClick={() => setAdding(true)}
              >
                {`＋ 台詞を追加${group === undefined ? '' : ` (MapGroup ${group})`}`}
              </button>
              <button
                title="元のステージのイベント (CRO) をスクリプトに戻した雛形を、関数として末尾に足します"
                onClick={() => setImporting(true)}
              >
                既存のイベントから挿入
              </button>
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
          </div>
        </section>
        <aside className="stage-source-docs" aria-label="関数ドキュメント">
          <StagePreviewScene session={session} content={content} source={source} onMap={setMap} onSource={setSource} />
          <StageScriptDocs
            session={session}
            content={content}
            onAdd={addLibrary}
            onInsert={(text) => insertRef.current?.insert(text)}
          />
        </aside>
      </div>
      {importing && (
        <CroEventDialog
          session={session}
          initial={content.index}
          onInsert={(text, names) =>
            append(
              `${names.join('、')} を末尾に足しました。行 ID・台詞・マップは元のステージのものです。割り当てはマップのページで行います`,
              // the variables the script has already (an earlier insert of the same content) are not declared again
              text
                .split('\n')
                .filter((l) => !declaredNames(source).includes(/^var (\w+)/u.exec(l)?.[1] ?? ''))
                .join('\n'),
            )
          }
          onClose={() => setImporting(false)}
        />
      )}
      {adding && maps && group !== undefined && (
        <ScriptLineDialog
          session={session}
          maps={maps}
          group={group}
          onInsert={(call) => {
            insertRef.current?.insert(call);
            setNote(`MapGroup ${group} の台詞の表に足して、${call} を書きました。保存すると反映されます`);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </main>
  );
}
