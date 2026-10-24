// 初代's MOD export: the archives with edits (the master's tables and messages) as a LayeredFS zip
// (0004000000077E00/romfs/…). The game has no Update, so the edits go on the Base's files.
import { useState, type ReactNode } from 'react';
import { HONOLULU } from '../rom/titles';
import { Dialog } from '../ui/Dialog';
import { download } from '../ui/download';
import type { HonoluluSession } from './session';

export function HonoluluExportDialog({ session, onClose }: { session: HonoluluSession; onClose: () => void }): ReactNode {
  const texts = session.messages.texts;
  const [error, setError] = useState('');
  const edited = texts.editedIds();
  const files = [...new Set(edited.map((id) => texts.file(id)!.name))];
  const tables = [...new Set(session.master.saved().map(([name]) => name))];
  return (
    <Dialog title="MOD の書き出し (RPG)" onClose={onClose}>
      {!session.changed() ? (
        <p className="muted">まだ何も変更していません。</p>
      ) : (
        <>
          {edited.length > 0 && <p>{`メッセージ: 変更 ${edited.length} 個 (${files.join('、')})`}</p>}
          {tables.length > 0 && <p>{`変更した表: ${tables.join('、')}`}</p>}
          <p className="muted small">{`zip の中身: ${HONOLULU.titleId}/romfs/${[...session.modFiles().keys()].join('・')} 。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます。`}</p>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="primary" onClick={() => {
              try {
                download(session.modZip(), 'denpa1-mod.zip');
              } catch (e) {
                setError((e as Error).message);
              }
            }}>MOD の zip をダウンロード</button>
          </div>
        </>
      )}
      <div className="row" />
    </Dialog>
  );
}
