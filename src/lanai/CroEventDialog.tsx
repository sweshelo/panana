// 「既存のイベントから挿入」(STATE #17-5): a shipped content's CRO decompiled (croDecompile.ts); the author picks events
// and their functions (with the variables of the flags they use) are written at the end of the script. Where they were
// bound is a note: the rows, lines and maps are the source stage's, and the binding is made on the map page.
import { useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import { useAsync } from '../ui/useAsync';
import { contentTitle, lanaiContents } from './contents';
import { ANY_GROUP, decompileContentCro, decompiledSource, type CroEventSource } from './croDecompile';
import { SCRIPT_TRIGGER_LABEL } from './eventScript';
import type { LanaiSession } from './session';
import { contentScript } from './stageEdit';

const bindingText = (e: CroEventSource): string =>
  e.bindings.length
    ? [
        ...new Set(
          e.bindings.map(
            (b) =>
              `${SCRIPT_TRIGGER_LABEL[b.trigger]} (${b.group === ANY_GROUP ? 'どの MapGroup でも' : `MapGroup ${b.group}`}${b.anyRow ? '、どの行でも' : b.row ? `, 0x${b.row.toString(16)}` : ''})`,
          ),
        ),
      ].join('、')
    : '割り当てなし';

export function CroEventDialog({
  session,
  initial,
  onInsert,
  onClose,
}: {
  session: LanaiSession;
  /** The content shown first (the stage's source, when it was copied from one). */
  initial?: number;
  onInsert: (text: string, names: string[]) => void;
  onClose: () => void;
}): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const [index, setIndex] = useState(initial ?? contents[0]?.index ?? 0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [onlyClean, setOnlyClean] = useState(false);
  const decompiled = useAsync(async () => {
    const c = contents.find((x) => x.index === index);
    if (!c) throw new Error(`コンテンツ ${index} がありません`);
    const { body } = await contentScript(session, c, await session.archive(c.archive));
    return decompileContentCro(body);
  }, [session, index]);
  const d = decompiled && !(decompiled instanceof Error) ? decompiled : null;
  const events = (d?.events ?? []).filter((e) => !onlyClean || !e.notes.length);
  const preview = d && (shown ?? chosen[0]) ? d.events.find((e) => e.cls === (shown ?? chosen[0])) : undefined;
  const toggle = (cls: string): void =>
    setChosen(chosen.includes(cls) ? chosen.filter((x) => x !== cls) : [...chosen, cls]);

  return (
    <Dialog title="既存のイベントから挿入" onClose={onClose}>
      <p className="muted small">
        元のステージの CRO (ネイティブコード) をスクリプトに戻した雛形です。言語で書けない部分は「//
        未対応:」の注記になります。行
        ID・台詞・マップは元のステージのままなので、このステージに合わせて直してください。フラグは変数として宣言され、このステージ専用の番号に替わります。割り当ては注記に残すだけなので、マップのページで割り当てます。
      </p>
      <div className="row">
        <label className="field">
          <span>コンテンツ</span>
          <select
            value={index}
            onChange={(e) => {
              setIndex(Number(e.target.value));
              setChosen([]);
              setShown(null);
            }}
          >
            {contents.map((c) => (
              <option key={c.index} value={c.index}>
                {`${c.index}: ${contentTitle(c)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="row small">
          <input type="checkbox" checked={onlyClean} onChange={(e) => setOnlyClean(e.target.checked)} />
          未対応のないイベントだけ
        </label>
      </div>
      {decompiled instanceof Error && <p className="error small">{decompiled.message}</p>}
      {!decompiled && <p className="muted small">読み込み中…</p>}
      {d && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <ul
            className="small"
            style={{ listStyle: 'none', padding: 0, maxHeight: '50vh', overflow: 'auto', minWidth: '18em' }}
          >
            {events.map((e) => (
              <li key={e.cls}>
                <label className="row" title={bindingText(e)}>
                  <input type="checkbox" checked={chosen.includes(e.cls)} onChange={() => toggle(e.cls)} />
                  <span className="mono" onMouseEnter={() => setShown(e.cls)}>
                    {e.cls}
                  </span>
                  <span className={e.notes.length ? 'muted' : ''}>
                    {e.notes.length ? `未対応 ${e.notes.length}` : '✓'}
                  </span>
                </label>
              </li>
            ))}
            {!events.length && <li className="muted">イベントがありません</li>}
          </ul>
          {preview && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="small">{`${preview.base} ・ ${bindingText(preview)}`}</p>
              <pre className="mono small" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                {preview.text}
              </pre>
            </div>
          )}
        </div>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={!d || !chosen.length}
          onClick={() => {
            onInsert(decompiledSource(d!, chosen, index), chosen);
            onClose();
          }}
        >
          {`選んだ ${chosen.length} 件を末尾に足す`}
        </button>
      </div>
    </Dialog>
  );
}
