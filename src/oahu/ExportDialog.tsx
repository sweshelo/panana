// RPG3's MOD export: the archives with edits, as a LayeredFS zip (00040000000EF000/romfs/…). Needs the Update: the
// edits go on its files, so the official fixes stay (#61).
import { useState, type ReactNode } from 'react';
import { OAHU } from '../rom/titles';
import { Dialog } from '../ui/Dialog';
import { download } from '../ui/download';
import type { OahuSession } from './session';

export function OahuExportDialog({ session, onAddUpdate, onClose }: { session: OahuSession; onAddUpdate: () => void; onClose: () => void }): ReactNode {
  const texts = session.messages.texts;
  const [error, setError] = useState('');
  const edited = texts.editedIds();
  const files = [...new Set(edited.map((id) => texts.file(id)!.name))];
  return (
    <Dialog title="MOD の書き出し (RPG3)" onClose={onClose}>
      {!session.canExport ? (
        <>
          <p>書き出しには Update の CIA が要ります。編集は Update のファイルに重ねて書き出すので、Update の修正 (ワザ・状態・出現する敵・文の直しなど) が消えません。</p>
          <div className="row"><button className="primary" onClick={onAddUpdate}>Update の CIA を選ぶ…</button></div>
        </>
      ) : !edited.length ? (
        <p className="muted">まだ何も変更していません。</p>
      ) : (
        <>
          <p>{`メッセージ ${edited.length} 個 (${files.join('、')})`}</p>
          <p className="muted small">{`zip の中身: ${OAHU.titleId}/romfs/… 。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます (Base と Update の両方を入れた状態で使います)。`}</p>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="primary" onClick={() => {
              try {
                download(session.modZip(), 'denpa3-mod.zip');
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
