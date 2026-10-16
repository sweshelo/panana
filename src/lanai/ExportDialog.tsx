// RPG FREE!'s MOD export: the root archives holding changed tables or a changed map database (a content's C9F79000),
// rebuilt with the other entries as they are, in a LayeredFS zip (0004000000125D00/romfs/…). Needs the Update like
// RPG3's: the edits go on its archives.
import { useState, type ReactNode } from 'react';
import { LANAI } from '../rom/titles';
import { PortStore } from '../port/store';
import { Dialog } from '../ui/Dialog';
import { useAsync } from '../ui/useAsync';
import { download } from '../ui/download';
import type { LanaiSession } from './session';

export function LanaiExportDialog({ session, onClose }: { session: LanaiSession; onClose: () => void }): ReactNode {
  const [error, setError] = useState('');
  const [, redraw] = useState(0);
  const changed = session.changedTables();
  const maps = session.changedMapDbs();
  const loaded = useAsync(() => PortStore.of('lanai').then((p) => p.summary()), []);
  const ported = Array.isArray(loaded) ? loaded : [];
  const archives = [...new Set([...changed.map((t) => t.archive), ...maps.map((m) => m.archive), ...ported.map((p) => p.split(':')[0]!)])];
  return (
    <Dialog title="MOD の書き出し (RPG FREE!)" onClose={onClose}>
      {!session.canExport ? (
        <p>書き出しには Update の CIA が要ります (上の「Update を追加…」から)。編集は Update のアーカイブに重ねて書き出すので、Update の修正が消えません。編集は保存されているので、Update を足したあとも残ります。</p>
      ) : !changed.length && !maps.length && !ported.length ? (
        <p className="muted">まだ何も変更していません。</p>
      ) : (
        <>
          <ul>
            {changed.map((t) => {
              const rows = t.table.changedRows();
              const added = t.table.rows - t.table.originalRows;
              const strings = t.table.changedStrings().length;
              const more = [added > 0 ? `うち追加 ${added} 行` : '', strings > 0 ? `文字列 ${strings} 欄` : ''].filter(Boolean).join('、');
              return <li key={`${t.archive}/${t.entry}`}>{`${t.archive} の ${t.table.name}: ${rows.length} 行${more ? ` (${more})` : ''}`}</li>;
            })}
            {maps.map((m) => <li key={`map/${m.archive}`}>{`${m.archive} のマップ DB (C9F79000): ${m.sections} 区画`}</li>)}
            {ported.map((p) => <li key={`port/${p}`}>{p}</li>)}
          </ul>
          <p className="muted small">{`zip の中身: ${LANAI.titleId}/romfs/${archives.join('、')}。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます (Base と Update の両方を入れた状態で使います)。行を足した表や、区画の大きさを変えたマップ (タイル・レコードの増減) は、ゲームが受け付けるか確かめていません。`}</p>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="primary" onClick={async () => {
              try {
                download(await session.modZip(), 'denpa-free-mod.zip');
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
