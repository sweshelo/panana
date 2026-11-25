// RPG FREE!'s MOD export, by where it is played: a LayeredFS zip (0004000000125D00/…) for Luma3DS on a 3DS (code.ips in
// the title folder) or for Azahar (exefs/code.ips), or the custom-stage distribution sent to a self-hosted uwapo. The
// zips hold the root archives with changed tables or a changed map database (a content's C9F79000), rebuilt with the
// other entries as they are, and the code patch of Panana's code MODs that are on (game/dropcap.ts). Needs the Update
// like RPG3's: the edits go on its archives and code.bin.
import { useState, type ReactNode } from 'react';
import { LANAI } from '../rom/titles';
import { PortStore } from '../port/store';
import { BaseModNote } from '../ui/BaseModButton';
import { CodeModOption } from '../ui/CodeModOption';
import { Dialog } from '../ui/Dialog';
import { useAsync } from '../ui/useAsync';
import { download } from '../ui/download';
import {
  LANAI_DELIVERABLE_TABLES,
  LANAI_DISTRIBUTION_LOCK,
  type LanaiDistributionDiscard,
  type LanaiModTarget,
  type LanaiSession,
} from './session';
import { pushToUwapo, setUwapoUrl, uwapoUrl, UwapoPushError, type UwapoPushResult } from './uwapoPush';

type ExportTarget = LanaiModTarget | 'uwapo';

const TARGET_KEY = 'lanai/export-target';

const TARGETS: { id: ExportTarget; title: string; sub: string }[] = [
  { id: '3ds', title: '3DS', sub: 'Luma3DS の標準機能で読み込む' },
  { id: 'azahar', title: 'Azahar', sub: 'エミュレータの MOD として読み込む' },
  { id: 'uwapo', title: 'Uwapo', sub: 'カスタムステージ MOD で配信する' },
];

function savedTarget(): ExportTarget | null {
  try {
    const t = globalThis.localStorage?.getItem(TARGET_KEY);
    return TARGETS.some((x) => x.id === t) ? (t as ExportTarget) : null;
  } catch {
    return null;
  }
}

function saveTarget(t: ExportTarget): void {
  try {
    globalThis.localStorage?.setItem(TARGET_KEY, t);
  } catch {
    // the choice is only a convenience
  }
}

export function LanaiExportDialog({ session, onClose }: { session: LanaiSession; onClose: () => void }): ReactNode {
  const [tick, redraw] = useState(0);
  const [target, setTarget] = useState<ExportTarget | null>(savedTarget);
  const loaded = useAsync(() => PortStore.of('lanai').then((p) => p.summary()), []);
  const ported = Array.isArray(loaded) ? loaded : [];
  const discardsLoaded = useAsync(() => session.distributionDiscards(), [session, tick]);
  const discards = Array.isArray(discardsLoaded) ? discardsLoaded : [];
  const scripts = session.conditionScripts.size;
  const changed =
    session.changedTables().length > 0 ||
    session.changedMapDbs().length > 0 ||
    session.changedMapTables().length > 0 ||
    session.changedLayouts().length > 0 ||
    ported.length > 0 ||
    session.createdFiles.size > 0 ||
    scripts > 0 ||
    session.needsFieldStartGuard ||
    session.dropCap;
  const refresh = () => redraw((x) => x + 1);
  return (
    <Dialog title="MOD の書き出し (RPG FREE!)" onClose={onClose}>
      {!session.canExport ? (
        <p>
          書き出しには Update の CIA が要ります (上の「Update を追加…」から)。編集は Update
          のアーカイブに重ねて書き出すので、Update の修正が消えません。編集は保存されているので、Update
          を足したあとも残ります。
        </p>
      ) : (
        <>
          <p className="muted small">遊ぶ環境を選んでください。</p>
          <div className="export-targets" role="tablist">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={target === t.id}
                className={target === t.id ? 'export-target selected' : 'export-target'}
                onClick={() => {
                  setTarget(t.id);
                  saveTarget(t.id);
                }}
              >
                <span className="export-target-title">{t.title}</span>
                <span className="export-target-sub">{t.sub}</span>
              </button>
            ))}
          </div>
          {target && (
            <div className="export-panel" role="tabpanel">
              {target === 'uwapo' ? (
                <UwapoPanel
                  session={session}
                  scripts={scripts}
                  discards={discards}
                  error={discardsLoaded}
                  onChange={refresh}
                />
              ) : (
                <ModZipPanel session={session} target={target} changed={changed} onChange={refresh} />
              )}
            </div>
          )}
          <Maintenance
            session={session}
            uwapo={target === 'uwapo'}
            changed={changed}
            discards={discards}
            onChange={refresh}
          />
        </>
      )}
    </Dialog>
  );
}

/** The LayeredFS zip for Luma3DS on a 3DS or for Azahar: where it goes, and its download. */
function ModZipPanel({
  session,
  target,
  changed,
  onChange,
}: {
  session: LanaiSession;
  target: LanaiModTarget;
  changed: boolean;
  onChange: () => void;
}): ReactNode {
  const [error, setError] = useState('');
  const is3ds = target === '3ds';
  return (
    <>
      <CodeModOption
        title="lanai"
        on={session.dropCap}
        problem={session.distributionMode && !session.dropCap ? LANAI_DISTRIBUTION_LOCK : session.dropCapProblem()}
        onChange={(on) => {
          session.dropCap = on;
          session.edited();
          onChange();
        }}
      />
      {is3ds ? (
        <p className="small">
          zip を展開して、SD の <code>luma/titles/</code> に <code>{LANAI.titleId}</code> フォルダごと置きます。Luma3DS
          の設定で「Enable game patching」を有効にしてください。コードのパッチは <code>{LANAI.titleId}/code.ips</code>{' '}
          に入ります。カスタムステージ (lanai-cs) はこの方法では読み込めません。
        </p>
      ) : (
        <p className="small">
          zip を展開して、Azahar の <code>load/mods/</code> に <code>{LANAI.titleId}</code> フォルダごと置きます
          (ゲームを右クリック →「Open Mods Location」)。コードのパッチは <code>{LANAI.titleId}/exefs/code.ips</code>{' '}
          に入ります。
        </p>
      )}
      <p className="muted small">
        Base と Update の両方を入れた状態で使います。
        {session.dropCap
          ? 'code.ips は Update の code.bin に合わせて作るので、Update を入れずに Base だけで動かすと落ちます。'
          : ''}
      </p>
      <BaseModNote mod={session.baseMod} />
      {!changed && <p className="muted">まだ何も変更していません。</p>}
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button
          className="primary"
          disabled={!changed}
          onClick={async () => {
            setError('');
            try {
              download(await session.modZip({ target }), is3ds ? 'denpa-free-3ds.zip' : 'denpa-free-azahar.zip');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {is3ds ? '3DS 用の zip をダウンロード' : 'Azahar 用の zip をダウンロード'}
        </button>
      </div>
    </>
  );
}

/**
 * The custom-stage distribution through a self-hosted uwapo: sending the release zip to it, the zips themselves, and
 * the changes the distribution leaves out (master tables the game cannot take, exefs/code.ips).
 */
function UwapoPanel({
  session,
  scripts,
  discards,
  error: loadError,
  onChange,
}: {
  session: LanaiSession;
  scripts: number;
  discards: LanaiDistributionDiscard[];
  error: unknown;
  onChange: () => void;
}): ReactNode {
  const [error, setError] = useState('');
  // without a base MOD every difference from the ROM is an edit of this session
  const fromBase = session.baseMod ? discards.filter((d) => d.edited === false) : [];
  const edited = discards.filter((d) => !fromBase.includes(d));
  const save = async (release: boolean) => {
    setError('');
    try {
      download(
        await session.distributionZip({ release }),
        release ? 'denpa-free-stage-release.zip' : 'denpa-free-stage.zip',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <p className="small">
        Luma3DS のパッチ機能でカスタムステージ用の MOD を有効にしている場合に使います。Uwapo サーバ (lanai-custom-stages
        の web/) は自分で起動し、カスタムステージ用の MOD のパッチも Uwapo から入手します。ゲームは SD の{' '}
        <code>lanai-cs</code> フォルダからステージを読み込みます。コードの MOD は Uwapo では使えません。
      </p>
      <label className="small">
        <input
          type="checkbox"
          checked={session.distributionMode}
          onChange={(e) => {
            session.distributionMode = e.target.checked;
            session.edited();
            onChange();
          }}
        />
        Uwapo 用の編集モード (Uwapo で欠落する変更を加えられなくする: master の {LANAI_DELIVERABLE_TABLES.length}{' '}
        表以外・条件スクリプトの追加・コードの MOD)
      </label>
      {scripts > 0 && <p className="error">条件スクリプトがあるので、Uwapo には書き出せません。</p>}
      <UwapoPush session={session} disabled={scripts > 0} />
      {loadError instanceof Error && <div className="error">{loadError.message}</div>}
      {(discards.length > 0 || session.dropCap) && (
        <>
          <p className="small">Uwapo では次の変更が欠落します:</p>
          <ul className="small">
            {edited.map((d) => (
              <li key={d.table}>{`master の ${d.table}: ${d.rows} 行`}</li>
            ))}
            {fromBase.map((d) => (
              <li key={d.table}>{`master の ${d.table}: ${d.rows} 行 (ベース MOD の変更。ここでは取り消せません)`}</li>
            ))}
            {session.dropCap && <li>コードの MOD「ドロップ率の天井を撤廃」 (code.ips)</li>}
          </ul>
          <p className="muted small">
            master の表は {LANAI_DELIVERABLE_TABLES.join('・')} の変更だけが届きます
            (ゲームはほかの表の行を含むステージを丸ごと読み込まないため)。
          </p>
        </>
      )}
      <details className="small">
        <summary>zip で保存する</summary>
        <p className="muted small">
          編集用の zip にはイベントのスクリプト (コメントを含む)
          を入れるので、ステージのページの「インポート」で取り込み直して編集を続けられます。公開するときは、スクリプトを入れない「リリース用の
          zip」を使います (取り込むとスクリプトは編集できません)。
        </p>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button disabled={scripts > 0} onClick={() => save(true)}>
            リリース用の zip をダウンロード
          </button>
          <button disabled={scripts > 0} onClick={() => save(false)}>
            編集用の zip をダウンロード
          </button>
        </div>
      </details>
    </>
  );
}

/** The undo buttons, below the export: all the changes, and (for Uwapo) only those the distribution leaves out. */
function Maintenance({
  session,
  uwapo,
  changed,
  discards,
  onChange,
}: {
  session: LanaiSession;
  uwapo: boolean;
  changed: boolean;
  discards: LanaiDistributionDiscard[];
  onChange: () => void;
}): ReactNode {
  const undoable = discards.some((d) => d.edited !== false || !session.baseMod) || session.dropCap;
  return (
    <div className="export-maintenance">
      <div className="row">
        {uwapo && (
          <button
            disabled={!undoable}
            onClick={() => {
              if (!confirm('Uwapo で欠落する変更だけを元に戻しますか? (ほかの変更は残ります)')) return;
              session.revertUndeliverable();
              onChange();
            }}
          >
            Uwapo で欠落する変更だけを取り消す
          </button>
        )}
        <button
          className="danger"
          disabled={!changed}
          onClick={() => {
            if (!confirm('すべての変更を元に戻しますか?')) return;
            session.revertAll();
            onChange();
          }}
        >
          すべての変更を元に戻す
        </button>
      </div>
    </div>
  );
}

/**
 * Sends the release zip to a uwapo server, which publishes it in place of the same stage and writes it into the SD it
 * mirrors (lanai-cs): reopening the stage select in the game shows it (no harbor download).
 */
function UwapoPush({ session, disabled }: { session: LanaiSession; disabled: boolean }): ReactNode {
  const [url, setUrl] = useState(uwapoUrl);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UwapoPushResult | null>(null);
  const [error, setError] = useState<{ message: string; conflicts?: unknown } | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await pushToUwapo(await session.distributionZip({ release: true }), { url }));
    } catch (e) {
      setError({ message: (e as Error).message, conflicts: e instanceof UwapoPushError ? e.conflicts : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="row">
        <label>
          Uwapo の URL{' '}
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUwapoUrl(e.target.value.trim());
            }}
            placeholder="http://localhost:8787"
          />
        </label>
        <button className="primary" disabled={disabled || busy || !url.trim()} onClick={send}>
          {busy ? '送信中…' : 'Uwapo に送る'}
        </button>
      </div>
      <p className="muted small">
        Uwapo は同じステージを入れ替えて公開し、SD の lanai-cs
        に書き込みます。ゲームではステージ選択を開き直すと反映されます (ステージの中にいるときは島に戻ってから)。
      </p>
      {error && (
        <div className="error">
          {error.message}
          {error.conflicts !== undefined && <pre className="small">{JSON.stringify(error.conflicts, null, 2)}</pre>}
        </div>
      )}
      {result && (
        <div className="small">
          <p>
            {`リビジョン ${result.revision} として公開しました。`}
            {result.mirrored
              ? `${result.mirrored} に書き込みました。ステージ選択を開き直してください。`
              : result.mirrorError
                ? ''
                : 'SD への書き込みは無効です (uwapo の LANAI_SDMC)。港の「カスタム」でダウンロードしてください。'}
          </p>
          {result.mirrorError && <p className="error">{`SD への書き込みに失敗しました: ${result.mirrorError}`}</p>}
          <ul>
            {result.stages.map((s) => (
              <li
                key={s.id}
              >{`${s.name || '(名前なし)'} (コンテンツ ${s.content}, ${s.id})${s.pushed ? ' ← 今回' : ''}`}</li>
            ))}
          </ul>
          {result.replaced.length > 0 && (
            <p className="muted">{`入れ替えた旧パッケージ: ${result.replaced.join('、')}`}</p>
          )}
          {result.warnings.length > 0 && (
            <ul className="muted">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
