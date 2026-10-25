// RPG3's MOD export: the archives with edits (messages, the master's tables, the shops' stock) and code.ips of the code patches, Panana's code MODs (game/dropcap.ts) and the story's code edits, as a LayeredFS zip (00040000000EF000/romfs/…, exefs/code.ips). Needs the Update: the
// edits go on its files, so the official fixes stay (#61).
import { useState, type ReactNode } from 'react';
import { OAHU } from '../rom/titles';
import { PortStore } from '../port/store';
import { BaseModNote } from '../ui/BaseModButton';
import { CodeModOption } from '../ui/CodeModOption';
import { Dialog } from '../ui/Dialog';
import { useAsync } from '../ui/useAsync';
import { download } from '../ui/download';
import type { OahuSession } from './session';
import { storyRecords } from './story';

export function OahuExportDialog({ session, onAddUpdate, onClose }: { session: OahuSession; onAddUpdate: () => void; onClose: () => void }): ReactNode {
  const texts = session.messages.texts;
  const [error, setError] = useState('');
  const [, redraw] = useState(0);
  const edited = texts.editedIds();
  const added = texts.addedIds();
  const files = [...new Set(edited.map((id) => texts.file(id)!.name))];
  const items = session.items.items.filter((it) => session.items.changed(it.id));
  const tables = session.master.saved().map(([name]) => name);
  const patches = session.code ? session.enabledPatches() : [];
  const broken = patches.length ? [...session.buildPatches(session.exportedPatches()).values()].filter((b) => b.errors.length).length : 0;
  const shops = session.shops?.changedShops() ?? [];
  const story = session.code ? storyRecords(session.code.code, session.storyEdits) : null;
  const storyEdits = story?.records.length ?? 0;
  const loaded = useAsync(() => PortStore.of('oahu').then((s) => s.summary()), []);
  const ported = Array.isArray(loaded) ? loaded : [];
  const designs = !!session.monsterModels.saved();
  const direct = session.performances.changed;
  const world = session.world.isChanged();
  const nothing = !edited.length && !added.length && !tables.length && !patches.length && !shops.length && !storyEdits && !ported.length && !designs && !direct && !session.dropCap && !world;
  const ips = patches.length > 0 || storyEdits > 0 || session.dropCap || !!session.baseMod?.ips;
  return (
    <Dialog title="MOD の書き出し (RPG3)" onClose={onClose}>
      {!session.canExport ? (
        <>
          <p>書き出しには Update の CIA が要ります。編集は Update のファイルに重ねて書き出すので、Update の修正 (ワザ・状態・出現する敵・文の直しなど) が消えません。</p>
          <div className="row"><button className="primary" onClick={onAddUpdate}>Update の CIA を選ぶ…</button></div>
        </>
      ) : (
        <>
          <CodeModOption title="oahu" on={session.dropCap} problem={session.dropCapProblem()} onChange={(on) => {
            session.dropCap = on;
            session.scheduleSave();
            redraw((x) => x + 1);
          }} />
          {nothing ? (
            <p className="muted">まだ何も変更していません。</p>
          ) : (
            <>
              {(edited.length > 0 || added.length > 0) && <p>{`メッセージ: 変更 ${edited.length} 個${files.length ? ` (${files.join('、')})` : ''}${added.length ? `、追加 ${added.length} 個` : ''}`}</p>}
              {items.length > 0 && <p>{`アイテム ${items.length} 個 (${items.slice(0, 8).map((it) => it.name).join('、')}${items.length > 8 ? ' ほか' : ''})`}</p>}
              {shops.length > 0 && <p>{`店の品揃え ${shops.map((s) => `店 ${s}`).join('・')} (${session.shops!.archiveNames().join(' と ')} の ShopItem)`}</p>}
              {patches.length > 0 && <p>{`コードのパッチ ${patches.length} 個 (exefs/code.ips)${broken ? `。うち ${broken} 個は誤りがあるので書き出しません` : ''}`}</p>}
              {session.dropCap && <p>コードの MOD「ドロップ率の天井を撤廃」 (exefs/code.ips)</p>}
              {storyEdits > 0 && <p>{`段階・物語の値の書き込みとスクリプトのメッセージの変更 ${storyEdits} か所 (exefs/code.ips)${story!.errors.length ? `。うち ${story!.errors.length} か所は作れないので書き出しません` : ''}`}</p>}
              {(ported.length > 0 || designs) && <p>{`移植したモデル: ${[...ported, ...(designs ? ['402F0000: monsterDesign.bin (見た目の行・カメラの大きさ)'] : [])].join('、')}`}</p>}
              {direct && <p>{'アクションの演出 (402F0000 の directData.bin)'}</p>}
              {world && <p>{`ワールドマップ: ${[session.world.groundChanged() ? '地形 (21350000 の W01_ground.bin、プールの数も作り直す)' : '', session.world.changedSlots().length ? `区画 ${session.world.changedSlots().join('・')} (B68E0000 のマップ DB)` : ''].filter(Boolean).join('、')}`}</p>}
              {tables.length > 0 && <p className="muted small">{`変更した表: ${[...new Set(tables)].join('、')}`}</p>}
              <BaseModNote mod={session.baseMod} />
              <p className="muted small">{`zip の中身: ${OAHU.titleId}/romfs/…${ips ? '、exefs/code.ips' : ''} 。Luma3DS は SD の luma/titles/、Azahar は load/mods/ に置きます (Base と Update の両方を入れた状態で使います)。${ips ? 'code.ips は Update の code.bin に合わせて作るので、Update を入れずに Base だけで動かすと、戦闘に入るときなどに落ちます。' : ''}`}</p>
              {error && <div className="error">{error}</div>}
              <div className="row">
                <button className="primary" onClick={async () => {
                  try {
                    download(await session.modZip(), 'denpa3-mod.zip');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}>MOD の zip をダウンロード</button>
              </div>
            </>
          )}
        </>
      )}
      <div className="row" />
    </Dialog>
  );
}
