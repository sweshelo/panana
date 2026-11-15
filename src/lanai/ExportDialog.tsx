// RPG FREE!'s MOD export: the root archives holding changed tables or a changed map database (a content's C9F79000),
// rebuilt with the other entries as they are, and exefs/code.ips of Panana's code MODs that are on (game/dropcap.ts), in a
// LayeredFS zip (0004000000125D00/…). Needs the Update like RPG3's: the edits go on its archives and code.bin.
import { useState, type ReactNode } from 'react';
import { LANAI } from '../rom/titles';
import { PortStore } from '../port/store';
import { BaseModNote } from '../ui/BaseModButton';
import { CodeModOption } from '../ui/CodeModOption';
import { Dialog } from '../ui/Dialog';
import { useAsync } from '../ui/useAsync';
import { download } from '../ui/download';
import { LANAI_DELIVERABLE_TABLES, type LanaiSession } from './session';

export function LanaiExportDialog({ session, onClose }: { session: LanaiSession; onClose: () => void }): ReactNode {
  const [error, setError] = useState('');
  const [tick, redraw] = useState(0);
  const changed = session.changedTables();
  const maps = session.changedMapDbs();
  const mapTables = session.changedMapTables();
  const layouts = session.changedLayouts();
  const created = [...session.createdFiles.keys()];
  const scripts = session.conditionScripts.size;
  const fieldStartGuard = session.needsFieldStartGuard;
  const loaded = useAsync(() => PortStore.of('lanai').then((p) => p.summary()), []);
  const ported = Array.isArray(loaded) ? loaded : [];
  const archives = [
    ...new Set([
      ...changed.map((t) => t.archive),
      ...maps.map((m) => m.archive),
      ...mapTables.map((m) => m.archive),
      ...layouts.map((l) => l.archive),
      ...ported.map((p) => p.split(':')[0]!),
      ...(session.baseMod?.romfs.keys() ?? []),
    ]),
  ];
  const ips = scripts > 0 || session.dropCap || fieldStartGuard || !!session.baseMod?.ips;
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
          <CodeModOption
            title="lanai"
            on={session.dropCap}
            problem={session.dropCapProblem()}
            onChange={(on) => {
              session.dropCap = on;
              session.edited();
              redraw((x) => x + 1);
            }}
          />
          {!changed.length &&
          !maps.length &&
          !mapTables.length &&
          !layouts.length &&
          !ported.length &&
          !created.length &&
          !scripts &&
          !fieldStartGuard &&
          !session.dropCap ? (
            <p className="muted">まだ何も変更していません。</p>
          ) : (
            <>
              <ul>
                {created.map((n) => (
                  <li key={n}>{`${n}: 新しいファイル`}</li>
                ))}
                {scripts > 0 && <li>{`条件スクリプト ${scripts} 件 (exefs/code.ips)`}</li>}
                {fieldStartGuard && <li>追加マップの開始イベント保護 (exefs/code.ips)</li>}
                {layouts.map((l) => (
                  <li key={`layout/${l.archive}/${l.hash}`}>{`${l.archive} のステージ画像`}</li>
                ))}
                {changed.map((t) => {
                  const rows = t.table.changedRows();
                  const added = t.table.rows - t.table.originalRows;
                  const strings = t.table.changedStrings().length;
                  const more = [added > 0 ? `うち追加 ${added} 行` : '', strings > 0 ? `文字列 ${strings} 欄` : '']
                    .filter(Boolean)
                    .join('、');
                  return (
                    <li
                      key={`${t.archive}/${t.entry}`}
                    >{`${t.archive} の ${t.table.name}: ${rows.length} 行${more ? ` (${more})` : ''}`}</li>
                  );
                })}
                {maps.map((m) => (
                  <li key={`map/${m.archive}`}>{`${m.archive} のマップ DB (C9F79000): ${m.sections} 区画`}</li>
                ))}
                {mapTables.map((m) => (
                  <li key={`map-table/${m.archive}`}>{`${m.archive} のマップ表`}</li>
                ))}
                {ported.map((p) => (
                  <li key={`port/${p}`}>{p}</li>
                ))}
                {session.dropCap && <li>コードの MOD「ドロップ率の天井を撤廃」 (exefs/code.ips)</li>}
              </ul>
              <BaseModNote mod={session.baseMod} />
              <p className="muted small">{`zip の中身: ${[archives.length ? `${LANAI.titleId}/romfs/${archives.join('、')}` : '', ips ? `${LANAI.titleId}/exefs/code.ips` : ''].filter(Boolean).join('、')}。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます (Base と Update の両方を入れた状態で使います)。${session.dropCap ? 'code.ips は Update の code.bin に合わせて作るので、Update を入れずに Base だけで動かすと落ちます。' : ''}行を足した表や、区画の大きさを変えたマップ (タイル・レコードの増減) は、ゲームが受け付けるか確かめていません。`}</p>
              {error && <div className="error">{error}</div>}
              <div className="row">
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      download(await session.modZip(), 'denpa-free-mod.zip');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  MOD の zip をダウンロード
                </button>
                <button
                  onClick={() => {
                    if (!confirm('すべての変更を元に戻しますか?')) return;
                    session.revertAll();
                    redraw((x) => x + 1);
                  }}
                >
                  すべての変更を元に戻す
                </button>
              </div>
              <DistributionBox session={session} scripts={scripts} tick={tick} onChange={() => redraw((x) => x + 1)} />
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

/**
 * The custom-stage distribution: what its zip leaves out (master tables the game cannot take, exefs/code.ips), its
 * download, and a button that undoes only the edits it would leave out.
 */
function DistributionBox({
  session,
  scripts,
  tick,
  onChange,
}: {
  session: LanaiSession;
  scripts: number;
  tick: number;
  onChange: () => void;
}): ReactNode {
  const [error, setError] = useState('');
  const loaded = useAsync(() => session.distributionDiscards(), [session, tick]);
  const discards = Array.isArray(loaded) ? loaded : [];
  const edited = discards.filter((d) => d.edited);
  const fromBase = discards.filter((d) => !d.edited);
  const undoable = edited.length > 0 || session.dropCap;
  return (
    <fieldset className="field">
      <legend>カスタムステージ配信 (uwapo)</legend>
      <p className="muted small">
        配信用の zip には、配信がゲームに届けられる変更だけを入れます。master の表は{' '}
        {LANAI_DELIVERABLE_TABLES.join('・')} の変更だけを残し、ほかの表は ROM のままに戻します
        (ゲームはほかの表の行を含むステージを丸ごと読み込まないため)。exefs/code.ips は入れません。
      </p>
      {scripts > 0 && <p className="error">条件スクリプトがあるので、配信用には書き出せません。</p>}
      {loaded instanceof Error && <div className="error">{loaded.message}</div>}
      {discards.length > 0 || session.dropCap ? (
        <>
          <p>配信では次の変更が欠落します:</p>
          <ul>
            {edited.map((d) => (
              <li key={d.table}>{`master の ${d.table}: ${d.rows} 行`}</li>
            ))}
            {fromBase.map((d) => (
              <li key={d.table}>{`master の ${d.table}: ${d.rows} 行 (ベース MOD の変更。ここでは取り消せません)`}</li>
            ))}
            {session.dropCap && <li>コードの MOD「ドロップ率の天井を撤廃」 (exefs/code.ips)</li>}
          </ul>
        </>
      ) : (
        loaded !== undefined && <p className="muted small">配信で欠落する変更はありません。</p>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button
          className="primary"
          onClick={async () => {
            try {
              download(await session.distributionZip(), 'denpa-free-stage.zip');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          配信用の zip をダウンロード
        </button>
        <button
          disabled={!undoable}
          onClick={() => {
            if (!confirm('配信で欠落する変更だけを元に戻しますか? (ほかの変更は残ります)')) return;
            session.revertUndeliverable();
            onChange();
          }}
        >
          配信で欠落する変更だけを取り消す
        </button>
      </div>
    </fieldset>
  );
}
