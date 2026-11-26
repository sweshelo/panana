// The stage page's "インポート": a custom-stage distribution zip (LanaiSession.distributionZip) read and brought into the
// session as new stages (stageImport.ts). The rows of the ROM this session changed too are skipped unless checked.
import { useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import type { LanaiSession } from './session';
import { applyLanaiImport, readLanaiImport, type LanaiImport, type LanaiImportResult } from './stageImport';

const SCRIPT_LABEL: Record<LanaiImport['stages'][number]['script'], string> = {
  source: 'スクリプトあり (編集できる)',
  compiled: 'スクリプトはビルド済みの CRO のみ (編集できない)',
  none: 'スクリプトなし',
};

export function LanaiStageImportDialog({
  session,
  onClose,
}: {
  session: LanaiSession;
  onClose: () => void;
}): ReactNode {
  const [imp, setImp] = useState<LanaiImport | null>(null);
  const [file, setFile] = useState('');
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<LanaiImportResult | null>(null);
  const conflicts = imp?.edits.filter((e) => e.conflict) ?? [];
  const plain = imp?.edits.filter((e) => !e.conflict) ?? [];
  return (
    <Dialog title="ステージのインポート" onClose={onClose}>
      {done ? (
        <>
          <p>{`ステージを取り込みました (コンテンツ ${done.contents.join('、')})。`}</p>
          {done.warnings.length > 0 && (
            <ul className="muted small">
              {done.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <button
            className="primary"
            onClick={() => {
              location.hash = `#/stages/${done.contents[0]}`;
              onClose();
            }}
          >
            取り込んだステージを開く
          </button>
        </>
      ) : (
        <>
          <p>
            カスタムステージ配信用の zip (MOD の書き出しの「配信用の zip」)
            のステージを、このセッションの新しいステージとして取り込みます。コンテンツ番号・ステージの枠・追加した行の番号は、このセッションのものと重ならないように振り直します。
          </p>
          <label className="field">
            <span>zip</span>
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                setError('');
                setImp(null);
                setOverwrite(new Set());
                setFile(f.name);
                try {
                  setImp(await readLanaiImport(session, new Uint8Array(await f.arrayBuffer())));
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {imp && (
            <>
              <p>{`${file} のステージ:`}</p>
              <ul>
                {imp.stages.map((st) => (
                  <li key={st.content}>
                    {`${st.names.filter(Boolean).join('・') || '(名前なし)'} (zip のコンテンツ ${st.content}、${SCRIPT_LABEL[st.script]})`}
                  </li>
                ))}
              </ul>
              {imp.extras.length > 0 && (
                <p className="muted small">{`ほかに追加する行: ${imp.extras.map((x) => `${x.table} ${x.rows} 行`).join('、')}`}</p>
              )}
              {plain.length > 0 && (
                <p className="muted small">{`ROM の行の変更: ${plain.map((e) => `${e.table} ${e.row}`).join('、')}`}</p>
              )}
              {conflicts.length > 0 && (
                <fieldset className="field">
                  <legend>このセッションでも変えた ROM の行</legend>
                  <p className="muted small">チェックしない行は取り込みません (このセッションの変更が残ります)。</p>
                  {conflicts.map((e) => (
                    <label key={e.key}>
                      <input
                        type="checkbox"
                        checked={overwrite.has(e.key)}
                        onChange={(ev) => {
                          const next = new Set(overwrite);
                          if (ev.target.checked) next.add(e.key);
                          else next.delete(e.key);
                          setOverwrite(next);
                        }}
                      />
                      {`${e.table} の行 ${e.row} を zip の内容で上書きする`}
                    </label>
                  ))}
                </fieldset>
              )}
              {imp.notes.length > 0 && (
                <ul className="muted small">
                  {imp.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={!imp || busy}
            onClick={async () => {
              if (!imp) return;
              setBusy(true);
              setError('');
              try {
                setDone(await applyLanaiImport(session, imp, { overwrite }));
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '取り込み中…' : '取り込む'}
          </button>
        </>
      )}
    </Dialog>
  );
}
