// Export: what changed, the validation of the changed maps, and the MOD as a zip or written into a folder.
import { useState, type ReactNode } from 'react';
import { validate, type Issue } from '../editor/validate';
import { mapLabel } from '../editor/labels';
import { buildModFiles, buildModZip, modPackage } from '../export/pack';
import { MASTER_ARCHIVE } from '../game/master';
import { mapTitle } from '../game/names';
import { TITLE_ID } from '../rom/dump';
import { tableLabel, type Session } from '../session';

function download(data: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function ExportDialog({ session, onClose }: { session: Session; onClose: () => void }): ReactNode {
  const { game, st } = session;
  const [out, setOut] = useState('');
  // What is exported is fixed when the dialog opens (like the summary shown in it).
  const [what] = useState(() => {
    const docs = st.modifiedDocs();
    const events = [...st.events.values()].filter((t) => t.changed());
    const issues: { map: string; issue: Issue }[] = [];
    for (const d of docs) {
      const info = game.code.byHash(d.hash)!;
      for (const i of validate(game, d, game.master.tileset(game.mapRef(info, d)), st.docs, st.events.get(d.dungeon) ?? null))
        issues.push({ map: mapTitle(info, game.code.maps, game.master), issue: i });
    }
    const changes: string[] = docs.map((d) => `${mapLabel(game, d.hash)} (区画 ${st.changedSections(d).join(', ')})`);
    for (const t of events) changes.push(`${game.master.dungeonName(t.dungeon)} のイベントの表 (${t.archiveName})`);
    if (game.master.treasureChanged()) changes.push(`宝箱の中身 (${MASTER_ARCHIVE})`);
    for (const n of game.master.changedTables()) changes.push(`${tableLabel(n)} (${MASTER_ARCHIVE} の ${n})`);
    const shops = session.stock;
    if (shops?.changed()) changes.push(`店の品揃え ${shops.changedShops().map((s) => `店 ${s}`).join('・')} (${shops.archiveNames().join(' と ')} の ShopItem)`);
    const texts = game.master.texts.editedIds();
    if (texts.length) changes.push(`メッセージ ${texts.length} 個 (${MASTER_ARCHIVE} の ${[...new Set(texts.map((id) => game.master.texts.file(id)!.name))].join(', ')})`);
    return { docs, events, issues, changes, shops };
  });
  const { issues, changes } = what;
  const errors = issues.filter((i) => i.issue.level === 'error').length;

  const build = (): Map<string, Uint8Array> | null => {
    try {
      const files = buildModFiles(game, what.docs, what.events, game.master.changed());
      for (const [name, bytes] of what.shops?.buildArchives() ?? []) files.set(name, bytes);
      const pkg = modPackage(game, files);
      setOut(`書き出すファイル: ${[...pkg].map(([n, b]) => `${n}${files.has(n.replace('romfs/', '')) ? ' (変更)' : ''} ${(b.length / 1024).toFixed(0)} KB`).join('、') || 'なし'}`);
      return pkg;
    } catch (err) {
      setOut(`書き出せませんでした: ${(err as Error).message}`);
      return null;
    }
  };
  const writeToFolder = async (): Promise<void> => {
    const pkg = build();
    if (!pkg?.size) return;
    try {
      const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      let dir = await picker({ mode: 'readwrite' });
      // Accept the mods folder or the title folder.
      if (dir.name.toUpperCase() !== TITLE_ID) dir = await dir.getDirectoryHandle(TITLE_ID, { create: true });
      for (const [path, data] of pkg) {
        const [sub, name] = path.split('/') as [string, string];
        const d = await dir.getDirectoryHandle(sub, { create: true });
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(data as BlobPart);
        await w.close();
      }
      setOut((o) => `${o} 書き込みました: …/${TITLE_ID}/{${[...pkg.keys()].join(', ')}}`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setOut(`書き込めませんでした: ${(err as Error).message}`);
    }
  };
  const canFs = 'showDirectoryPicker' in window;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2>書き出し</h2>
        {changes.length ? <div>{`変更: ${changes.join('、')}`}</div> : <div className="muted">変更はありません。</div>}
        {issues.length
          ? <div className="issues">{issues.map(({ map, issue }, i) => <div key={i} className={`issue ${issue.level}`}>{`${issue.level === 'error' ? '✖' : '⚠'} ${map}: ${issue.msg}`}</div>)}</div>
          : <div className="ok">検証: 問題なし</div>}
        {errors > 0 && <div className="error">{`エラーが ${errors} 件あります。このまま書き出すとゲームが正しく動かないおそれがあります。`}</div>}
        {game.baseMod
          ? <div className="muted">{`土台の MOD「${game.baseMod.label}」の全ファイル${game.baseMod.ips ? ' (code.ips を含む)' : ''}も入ります。`}</div>
          : <div className="warn-box">{`アイテム MOD など、ほかの MOD と一緒に使う場合は、ヘッダーの「土台の MOD」でその MOD のフォルダ (elpulse の mod/out など) を読み込んでから書き出してください。同じファイル (${MASTER_ARCHIVE} や code.ips) を置き換える MOD は同時に置けません。`}</div>}
        <div className="row">
          <button className="primary" onClick={() => { const f = build(); if (f?.size) download(buildModZip(f), 'denpa2-map-mod.zip'); }}>MOD の zip をダウンロード</button>
          {canFs && <button onClick={writeToFolder}>MOD フォルダに直接書き込む</button>}
          <button onClick={onClose}>閉じる</button>
        </div>
        <div className="export-result">{out}</div>
        <div className="muted small">
          <p>{`zip の中身: ${TITLE_ID}/romfs/… と ${TITLE_ID}/exefs/code.ips`}</p>
          <p>Azahar: %APPDATA%/Azahar/load/mods/ に展開 (00040000000A7900/romfs/… になるように)。</p>
          <p>Luma3DS: SD の /luma/titles/ に展開し、Luma の設定で「Enable game patching」を有効にする。</p>
        </div>
      </div>
    </div>
  );
}
