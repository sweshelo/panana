// The opened dumps (#100): one row per game with the files it was read from, its Update and base MOD, switching the
// game shown, closing one, and adding the dumps of more games (several CIAs at once, any order).
import { useState, type ReactNode } from 'react';
import { TITLES, type TitleKey } from '../rom/titles';
import { Dialog } from './Dialog';
import { openedDump, openedKeys, type Opened } from './workspace';

export function RomDialog({ opened, active, busy, error, onShow, onClose, onUnload, onAdd, onStart }: {
  opened: Opened;
  active: TitleKey;
  /** What is being read, while adding. */
  busy: string | null;
  error: string | null;
  onShow: (key: TitleKey) => void;
  onClose: () => void;
  onUnload: (key: TitleKey) => void;
  onAdd: (files: File[]) => void;
  /** Closes every dump (back to the start screen). */
  onStart: () => void;
}): ReactNode {
  const [over, setOver] = useState(false);
  const keys = openedKeys(opened);
  return (
    <Dialog title="開いている ROM" wide={false} onClose={onClose}>
      <p className="muted small">複数の作品を同時に開いておくと、モンスターやアイテムを選ぶときに別の作品のものも選べます。</p>
      <table className="rom-list">
        <tbody>
          {TITLES.map((t) => {
            const dump = openedDump(opened, t.key);
            const shown = t.key === active;
            return (
              <tr key={t.key} className={shown ? 'active' : undefined} data-title={t.key}>
                <th>
                  <div>{t.name}</div>
                  <div className="muted small">{`${t.key} (${t.titleId})`}</div>
                </th>
                <td>
                  {dump ? (
                    <>
                      <div className="rom-files">{dump.label.split(' + ').map((f, i) => <div key={i}>{f}</div>)}</div>
                      <div className="muted small">
                        {[
                          dump.titleVersion !== undefined ? `Base v${dump.titleVersion}` : '',
                          t.updateTitleId ? (dump.update ? `Update v${dump.update.titleVersion ?? '?'}` : 'Update なし') : '',
                          t.key === 'kahara' ? `土台の MOD: ${opened.kahara!.session.game.baseMod?.label ?? 'なし'}` : '',
                        ].filter(Boolean).join(' / ')}
                      </div>
                    </>
                  ) : <span className="muted">開いていません</span>}
                </td>
                <td className="rom-actions">
                  {dump && (shown ? <span className="badge">表示中</span> : <button className="primary" onClick={() => onShow(t.key)}>表示する</button>)}
                  {dump && <button title="この作品のダンプを閉じます (編集はこの端末に保存されていて、次に開いたときに読み込めます)" onClick={() => onUnload(t.key)}>閉じる</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <div className="error">{error}</div>}
      {busy ? <p>{busy}</p> : (
        <div
          className={over ? 'drop over' : 'drop'}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const fs = [...(e.dataTransfer.files ?? [])];
            if (fs.length) onAdd(fs);
          }}
        >
          <div>ここに .cia / .cxi をドロップ (複数の作品・Base と Update をまとめて)</div>
          <label className="button-like">
            ファイルを選ぶ…
            <input type="file" multiple accept=".cia,.cxi,.app,.bin" hidden onChange={(e) => {
              const fs = [...(e.target.files ?? [])];
              e.target.value = '';
              if (fs.length) onAdd(fs);
            }} />
          </label>
          <div className="muted small">すでに開いている作品を選ぶと、その作品のダンプを置き換えます。</div>
        </div>
      )}
      <div className="row rom-foot">
        <span className="grow muted small">{`${keys.length} 作品を開いています`}</span>
        <button onClick={onStart}>すべて閉じて最初の画面へ</button>
      </div>
    </Dialog>
  );
}

/** The top bar's button for the list of the opened dumps (in place of the dump's name). */
export function RomButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }): ReactNode {
  return (
    <button className="rom-btn" title={`${label}\n開いている ROM の一覧・ほかの作品の ROM を追加`} onClick={onClick}>
      {count > 1 ? `ROM (${count} 作品)` : 'ROM…'}
    </button>
  );
}
