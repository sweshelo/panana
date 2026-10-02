// Start screen: open a decrypted CIA / CXI, an extracted folder, or the dump cached last time.
import { useEffect, useState, type ReactNode } from 'react';
import { cachedDumpInfo, openCachedDump } from '../rom/cache';
import { openFolder, openImages, type Dump } from '../rom/dump';
import { KAHARA, OAHU } from '../rom/titles';
import { idbClear } from '../util/idb';

type Cached = Awaited<ReturnType<typeof cachedDumpInfo>>;

export function StartScreen({ error, onOpen }: { error?: string; onOpen: (open: () => Promise<Dump>) => void }): ReactNode {
  const [cached, setCached] = useState<Cached>(undefined);
  const [over, setOver] = useState(false);
  useEffect(() => {
    cachedDumpInfo().then(setCached);
  }, []);
  return (
    <div className="start">
      <h1>Panana</h1>
      <p>{`『${KAHARA.name}』v1.1.0 (${KAHARA.titleId}) のデータを調べるツールです。ダンジョンのマップを編集して LayeredFS 用の MOD として書き出すほか、モンスター図鑑、マップの出現する敵・BGM を見られます。`}</p>
      <p>{`『${OAHU.name}』(${OAHU.titleId}) は、Base の CIA でメッセージと RomFS の中身を見て、メッセージを編集できます。MOD の書き出しには Update の CIA も要ります (Base と一緒に選ぶか、開いたあとで足せます)。`}</p>
      <p className="muted">ROM のデータはブラウザの中だけで読み取ります (どこにも送信しません)。読み取った一部のファイルは、この端末の IndexedDB にキャッシュします。</p>
      {error && <div className="error">{error}</div>}
      <div className="choices">
        <label className="choice">
          <b>復号済みの CIA / CXI</b>
          <span className="muted">GodMode9 などで復号したダンプ (RPG3 は Base、または Base と Update の 2 つ)</span>
          <input type="file" multiple accept=".cia,.cxi,.app,.bin" onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            if (fs.length) onOpen(() => openImages(fs, (f) => (f as File).name));
          }} />
        </label>
        <label className="choice">
          <b>展開済みのフォルダ</b>
          <span className="muted">RomFS のファイル (A90C8038 など) と code.bin を含むフォルダ</span>
          <input type="file" {...{ webkitdirectory: '' }} onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) onOpen(() => openFolder(files, files[0]!.webkitRelativePath.split('/')[0] ?? 'folder'));
          }} />
        </label>
        {cached && (
          <div className="choice">
            <b>前回のダンプ</b>
            <span className="muted">{`${cached.label} (${new Date(cached.savedAt).toLocaleString()})`}</span>
            <div className="row">
              <button className="primary" onClick={() => onOpen(async () => (await openCachedDump())!)}>キャッシュから開く</button>
              <button onClick={async () => { await idbClear(); setCached(undefined); }}>キャッシュを消す</button>
            </div>
          </div>
        )}
      </div>
      <div
        className={over ? 'drop over' : 'drop'}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const fs = [...(e.dataTransfer.files ?? [])];
          if (fs.length) onOpen(() => openImages(fs, (f) => (f as File).name));
        }}
      >ここに .cia / .cxi をドロップ</div>
    </div>
  );
}
