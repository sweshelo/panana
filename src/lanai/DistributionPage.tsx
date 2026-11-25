// #/distribution, shown when the editor runs from Panana's executable (localServer.ts): the custom-stage distribution
// to the 3DS (server/app.ts) — on / off and its port, the address to enter in the game's せってい, the packages
// (distribution ZIPs) and what is published. Ported from lanai-custom-stages web/src/Packages.tsx (99304a5).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Conflict, StoredPackage } from '../../server/uwapo/packages';
import type { Manifest } from '../../server/uwapo/publish';
import { NumberInput } from '../ui/book';
import { setDistribution, useLocalStatus, type LocalStatus } from './localServer';

const conflictLabel: Record<Conflict['kind'], string> = {
  content: 'コンテンツ番号',
  archive: 'アーカイブ',
  crr: 'CRR',
  slot: 'ステージ枠',
  message: 'MessageMapStage ID',
  integration: 'MapStageIntegration ID',
  script: '条件スクリプト番号',
  codeIps: 'code.ips',
  masterRow: 'master の行',
  rowId: '追加行の ID',
};

/** The error text of a refused publication: the collisions renumbering cannot resolve. */
function refusal(data: { error?: string; conflicts?: (Conflict & { message?: string })[] }, fallback: string): string {
  const detail = data.conflicts
    ?.filter((c) => !c.message || !data.error?.includes(c.message))
    .map((c) => c.message ?? `${conflictLabel[c.kind] ?? c.kind} ${c.value}`)
    .join('、');
  return `${data.error ?? fallback}${detail ? ` (${detail})` : ''}`;
}

const kib = (n: number): string => `${(n / 1024).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} KiB`;
const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

export function LanaiDistributionPage(): ReactNode {
  const [status, setStatus] = useLocalStatus();
  if (!status)
    return (
      <div className="book-detail distribution-page">
        <p className="muted">配信は Panana のアプリ版 (実行ファイル) で使えます。</p>
      </div>
    );
  return (
    <div className="book-detail distribution-page">
      <DistributionSwitch status={status} onStatus={setStatus} />
      <PatchSection status={status} />
      <PackagesSection />
    </div>
  );
}

function DistributionSwitch({
  status,
  onStatus,
}: {
  status: LocalStatus;
  onStatus: (s: LocalStatus) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const d = status.distribution;
  const change = async (c: { enabled?: boolean; port?: number }): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      onStatus(await setDistribution(c));
    } catch (e) {
      setError(message(e, '設定を変えられませんでした。'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>カスタムステージの配信</h2>
      <label className="row">
        <input
          type="checkbox"
          checked={d.enabled}
          disabled={busy}
          onChange={(e) => void change({ enabled: e.target.checked })}
        />
        同じネットワークの 3DS へ配信する
      </label>
      <label className="field">
        <span>ポート</span>
        <NumberInput value={d.port} min={1} max={65535} onCommit={(port) => void change({ port })} />
      </label>
      {d.enabled && d.running && (
        <>
          <p>ゲームの「せってい」→「カスタムステージサーバ」に、次のどれかを入力します:</p>
          <ul className="mono">
            {d.urls.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <p className="muted small">
            初めて配信を始めると、Windows のファイアウォールが許可を求めることがあります。プライベート
            ネットワークで許可してください。
          </p>
        </>
      )}
      {d.enabled && !d.running && <p className="error">{d.error ?? '配信を始められません。'}</p>}
      {!d.enabled && <p className="muted small">オフのあいだは、3DS からこの PC へは接続できません。</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function PatchSection({ status }: { status: LocalStatus }): ReactNode {
  return (
    <section>
      <h2>ゲームのパッチ</h2>
      {status.patch ? (
        <>
          <p>
            <a className="button" href="/api/local/patch" download="code.ips">
              code.ips をダウンロード
            </a>
          </p>
          <p className="muted small">
            カスタムステージを読み込むためのパッチです (Update v17408 用)。3DS は Luma3DS の
            <code> luma/titles/0004000000125D00/code.ips</code>、Azahar は MOD フォルダの
            <code> exefs/code.ips</code> に置きます。サーバのアドレスはゲームの「せってい」で入力するので、 パッチは PC
            が変わっても同じものを使えます。
          </p>
        </>
      ) : (
        <p className="muted">このビルドにはパッチが入っていません。</p>
      )}
    </section>
  );
}

function PackagesSection(): ReactNode {
  const [packages, setPackages] = useState<StoredPackage[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [published, setPublished] = useState<Manifest | null>(null);
  const [publishError, setPublishError] = useState('');
  const [clearConditions, setClearConditions] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/packages', { cache: 'no-store' });
    if (!response.ok) throw new Error('取り込んだ ZIP の一覧を読めませんでした。');
    const data = (await response.json()) as { packages: StoredPackage[]; conflicts: Conflict[] };
    setPackages(data.packages);
    setConflicts(data.conflicts);
    setSelected((ids) => ids.filter((id) => data.packages.some((p) => p.id === id)));
    const stages = await fetch('/api/stages', { cache: 'no-store' });
    if (stages.ok) {
      const m = (await stages.json()) as Manifest;
      setPublished(m);
      // the published packages start selected, so publishing again keeps them
      setSelected((ids) => (ids.length ? ids : [...new Set(m.stages.map((s) => s.package.id))]));
    }
  }, []);

  useEffect(() => {
    reload().catch((e: unknown) => setError(message(e, '接続できません。')));
  }, [reload]);

  async function upload(files: FileList | null): Promise<void> {
    if (!files?.length || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      for (const file of files) {
        const response = await fetch(`/api/packages?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/zip' },
          body: file,
        });
        const data = (await response.json()) as { package?: StoredPackage; duplicate?: boolean; error?: string };
        if (!response.ok || !data.package) throw new Error(`${file.name}: ${data.error ?? '取り込めませんでした。'}`);
        setNotice(
          data.duplicate
            ? `${file.name} は取り込み済みです。`
            : `${file.name} から ${data.package.summary.stages.length} 件のステージを検出しました。`,
        );
      }
      await reload();
    } catch (e) {
      setError(message(e, '取り込めませんでした。'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function publish(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setPublishError('');
    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packages: selected, clearConditions }),
      });
      const data = (await response.json()) as { manifest?: Manifest; error?: string; conflicts?: Conflict[] };
      if (!response.ok || !data.manifest) throw new Error(refusal(data, '公開できませんでした。'));
      setPublished(data.manifest);
    } catch (e) {
      setPublishError(message(e, '公開できませんでした。'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: StoredPackage): Promise<void> {
    if (!confirm(`${p.fileName} を取り込み一覧から削除しますか?`)) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/packages/${p.id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('削除できませんでした。');
      await reload();
    } catch (e) {
      setError(message(e, '削除できませんでした。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>配信するステージ</h2>
      <p className="muted small">
        書き出しの「Uwapo」で「配信に登録」すると、ここに入って公開されます。ほかの人が作った配信用 ZIP も取り込めます。
      </p>
      <label className="button">
        {busy ? '処理中…' : 'ZIP を取り込む…'}
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          multiple
          disabled={busy}
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </label>
      {error ? <p className="error">{error}</p> : notice && <p className="muted">{notice}</p>}

      {packages.length === 0 ? (
        <p className="muted">まだステージを取り込んでいません。</p>
      ) : (
        packages.map((p) => (
          <article className="distribution-package" key={p.id}>
            <div className="row">
              <label className="grow">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))
                  }
                />{' '}
                <strong>{p.fileName}</strong>
                <span className="muted small">{` ${kib(p.size)}・${new Date(p.uploadedAt).toLocaleString('ja-JP')}`}</span>
              </label>
              <button onClick={() => void remove(p)} disabled={busy}>
                削除
              </button>
            </div>
            {p.summary.stages.length > 0 && (
              <table className="book-table">
                <thead>
                  <tr>
                    <th>コンテンツ</th>
                    <th>ステージ名</th>
                    <th>アーカイブ</th>
                    <th>枠 / スタミナ</th>
                  </tr>
                </thead>
                <tbody>
                  {p.summary.stages.map((s) => (
                    <tr key={s.archive}>
                      <td>{`${s.content} (${s.kind === 'added' ? '追加' : '既存を変更'})`}</td>
                      <td>
                        {s.name || '(名前なし)'}
                        {s.warnings.map((w) => (
                          <div className="error small" key={w}>
                            {w}
                          </div>
                        ))}
                      </td>
                      <td className="mono">{s.archive}</td>
                      <td>{s.stages.map((r) => `${r.slot} / ${r.stamina}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.summary.warnings.map((w) => (
              <div className="error small" key={w}>
                {w}
              </div>
            ))}
          </article>
        ))
      )}

      {conflicts.length > 0 && (
        <>
          <h3>一緒に配信するときに衝突する値</h3>
          <ul>
            {conflicts.map((c) => (
              <li key={`${c.kind}/${c.value}`}>
                {`${conflictLabel[c.kind] ?? c.kind} ${c.value}: `}
                {c.packages.map((id) => packages.find((p) => p.id === id)?.fileName ?? id).join('、')}{' '}
                <span className="muted">
                  {c.resolvable ? '(一緒に配信するとき番号を振り直します)' : '(一緒には配信できません)'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={clearConditions}
            onChange={(e) => setClearConditions(e.target.checked)}
            disabled={busy}
          />
          出現条件を外して配信する (カスタムのタブに必ず出す)
        </label>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void publish()} disabled={busy}>
          {selected.length > 1
            ? `選んだ ${selected.length} 件をまとめて配信`
            : selected.length
              ? '選んだ 1 件を配信'
              : '配信を取り下げる (空にする)'}
        </button>
      </div>
      {publishError && <p className="error">{publishError}</p>}

      {published && (
        <>
          <h3>{`公開中: 版 ${published.revision}`}</h3>
          {published.stages.length === 0 ? (
            <p className="muted">公開しているステージはありません。</p>
          ) : (
            <ul>
              {published.stages.map((s) => (
                <li key={s.id}>
                  <span className="mono">{s.id}</span>
                  {` コンテンツ ${s.content}「${s.name}」 枠 ${s.slots.join(', ')}・master ${s.rows.length} 行`}
                  {s.conditionsCleared && ' (出現条件を外した)'}
                </li>
              ))}
            </ul>
          )}
          {published.warnings.map((w) => (
            <div className="error small" key={w}>
              {w}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
