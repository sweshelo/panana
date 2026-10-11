// RPG FREE!'s MOD export: the root archives holding changed tables, rebuilt with the other entries as they are, in a
// LayeredFS zip (0004000000125D00/romfs/…). Needs the Update like RPG3's: the edits go on its archives.
import { useState, type ReactNode } from 'react';
import { LANAI } from '../rom/titles';
import { Dialog } from '../ui/Dialog';
import { download } from '../ui/download';
import type { LanaiSession } from './session';

export function LanaiExportDialog({ session, onClose }: { session: LanaiSession; onClose: () => void }): ReactNode {
  const [error, setError] = useState('');
  const [, redraw] = useState(0);
  const changed = session.changedTables();
  return (
    <Dialog title="MOD の書き出し (RPG FREE!)" onClose={onClose}>
      {!session.canExport ? (
        <p>書き出しには Update の CIA が要ります (上の「Update を追加…」から)。編集は Update のアーカイブに重ねて書き出すので、Update の修正が消えません。編集は保存されているので、Update を足したあとも残ります。</p>
      ) : !changed.length ? (
        <p className="muted">まだ何も変更していません。</p>
      ) : (
        <>
          <ul>
            {changed.map((t) => {
              const rows = t.table.changedRows();
              const added = t.table.rows - t.table.originalRows;
              return <li key={`${t.archive}/${t.entry}`}>{`${t.archive} の ${t.table.name}: ${rows.length} 行${added > 0 ? ` (うち追加 ${added} 行)` : ''}`}</li>;
            })}
          </ul>
          <p className="muted small">{`zip の中身: ${LANAI.titleId}/romfs/${[...new Set(changed.map((t) => t.archive))].join('、')}。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます (Base と Update の両方を入れた状態で使います)。行を足した表は、ゲームが受け付けるか確かめていません。`}</p>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="primary" onClick={() => {
              try {
                download(session.modZip(), 'denpa-free-mod.zip');
              } catch (e) {
                setError((e as Error).message);
              }
            }}>MOD の zip をダウンロード</button>
            <button onClick={() => {
              if (!confirm('すべての変更を元に戻しますか?')) return;
              session.revertAll();
              redraw((x) => x + 1);
            }}>すべての変更を元に戻す</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
