// RPG3's MOD export: the archives with edits (messages, the master's tables) and code.ips of the code patches, as a LayeredFS zip (00040000000EF000/romfs/…, exefs/code.ips). Needs the Update: the
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
  const added = texts.addedIds();
  const files = [...new Set(edited.map((id) => texts.file(id)!.name))];
  const items = session.items.items.filter((it) => session.items.changed(it.id));
  const tables = session.master.saved().map(([name]) => name);
  const patches = session.code ? session.enabledPatches() : [];
  const broken = patches.length ? [...session.buildPatches().values()].filter((b) => b.errors.length).length : 0;
  const nothing = !edited.length && !added.length && !tables.length && !patches.length;
  return (
    <Dialog title="MOD の書き出し (RPG3)" onClose={onClose}>
      {!session.canExport ? (
        <>
          <p>書き出しには Update の CIA が要ります。編集は Update のファイルに重ねて書き出すので、Update の修正 (ワザ・状態・出現する敵・文の直しなど) が消えません。</p>
          <div className="row"><button className="primary" onClick={onAddUpdate}>Update の CIA を選ぶ…</button></div>
        </>
      ) : nothing ? (
        <p className="muted">まだ何も変更していません。</p>
      ) : (
        <>
          {(edited.length > 0 || added.length > 0) && <p>{`メッセージ: 変更 ${edited.length} 個${files.length ? ` (${files.join('、')})` : ''}${added.length ? `、追加 ${added.length} 個` : ''}`}</p>}
          {items.length > 0 && <p>{`アイテム ${items.length} 個 (${items.slice(0, 8).map((it) => it.name).join('、')}${items.length > 8 ? ' ほか' : ''})`}</p>}
          {patches.length > 0 && <p>{`コードのパッチ ${patches.length} 個 (exefs/code.ips)${broken ? `。うち ${broken} 個は誤りがあるので書き出しません` : ''}`}</p>}
          {tables.length > 0 && <p className="muted small">{`変更した表: ${[...new Set(tables)].join('、')}`}</p>}
          <p className="muted small">{`zip の中身: ${OAHU.titleId}/romfs/…${patches.length ? '、exefs/code.ips' : ''} 。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます (Base と Update の両方を入れた状態で使います)。`}</p>
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
