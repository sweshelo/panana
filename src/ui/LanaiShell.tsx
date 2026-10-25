// The pages of a 電波人間のRPG FREE! (lanai) dump: the stages (contents), the maps, the talks, the strings of the tables, the
// monsters, the items, the shops, the codes and the check-in tables, and the RomFS viewer. The Update is added like RPG3's.
import { useMemo, useState, type ReactNode } from 'react';
import { LanaiCodePage } from '../lanai/CodePage';
import { LanaiExportDialog } from '../lanai/ExportDialog';
import { contentTitle, lanaiContents } from '../lanai/contents';
import { LanaiGroupPage } from '../lanai/GroupPage';
import { LanaiItemPage } from '../lanai/ItemPage';
import { LanaiMapPage } from '../lanai/MapPage';
import { LanaiMessagePage } from '../lanai/MessagePage';
import { LanaiMonsterPage } from '../lanai/MonsterPage';
import { LanaiSession } from '../lanai/session';
import { LanaiShopPage } from '../lanai/ShopPage';
import { LanaiStagePage } from '../lanai/StagePage';
import { LanaiTalkPage } from '../lanai/TalkPage';
import { openUpdate, withUpdate, type BaseMod } from '../rom/dump';
import { lanaiRomfsProfile } from '../romfs/lanai';
import type { RomfsProfile } from '../romfs/profile';
import { RomfsPage } from '../romfs/RomfsPage';
import { BaseModButton } from './BaseModButton';
import { PageShell } from './PageShell';

export const LANAI_PAGES = [['stages', 'ステージ'], ['maps', 'マップ'], ['talks', 'セリフ'], ['messages', 'メッセージ'], ['monsters', 'モンスター'], ['groups', '群れ'], ['items', 'アイテム'], ['shops', 'ショップ'], ['codes', 'コード・配信'], ['romfs', 'RomFS']] as const;
type LanaiPage = (typeof LANAI_PAGES)[number][0];
const TITLES: Record<LanaiPage, string> = { stages: 'ステージ', maps: 'マップ', talks: 'セリフ', messages: 'メッセージ', monsters: 'モンスター', groups: '群れ', items: 'アイテム', shops: 'ショップ', codes: 'コード入力・チェックイン', romfs: 'RomFS' };

/** Asks for the Update's CIA and opens the dump again with it. */
function pickUpdate(session: LanaiSession, done: (s: LanaiSession) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.cia,.cxi,.app';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      session.saveNow(); // the edits are put back on the dump with the Update
      done(await LanaiSession.open(withUpdate(session.raw, await openUpdate(f, f.name)), { baseMod: session.baseMod }));
    } catch (err) {
      alert(`Update を読めませんでした: ${(err as Error).message}`);
    }
  });
  input.click();
}

export function LanaiShell({ session, onSession, onBaseMod }: {
  session: LanaiSession;
  /** The session reopened with the Update. */
  onSession: (s: LanaiSession) => void;
  /** Reopens the dump on another base MOD (null: none), keeping the edits. */
  onBaseMod: (mod: BaseMod | null) => Promise<void>;
}): ReactNode {
  const { dump } = session;
  const [exporting, setExporting] = useState(false);
  // the RomFS viewer names the archives of the contents by their stages
  const profile = useMemo((): RomfsProfile => {
    const files = { ...lanaiRomfsProfile.files };
    for (const c of lanaiContents(session)) files[c.archive] ??= `コンテンツ ${c.index}: ${contentTitle(c)}`;
    return { ...lanaiRomfsProfile, files };
  }, [session]);
  const u = dump.update;
  return (
    <PageShell pages={LANAI_PAGES} titles={TITLES} fallback="maps" brand="電波人間のRPG FREE! エディタ" titleSuffix=" (RPG FREE!)" romLabel={dump.label}
      actions={(closeMenu) => (
        <>
          {u ? <span className="muted small" title={`patchList.bin: ${u.patched.length} 個`}>{`Update v${u.titleVersion ?? '?'}`}</span>
            : <button title="ゲームが実際に読むのは Update のアーカイブです (資料のアドレスや行も Update が基準)" onClick={() => pickUpdate(session, onSession)}>Update を追加…</button>}
          <button className="primary" title="変更した表・マップを LayeredFS 用の MOD として書き出します" onClick={() => { closeMenu(); setExporting(true); }}>書き出し…</button>
          <BaseModButton title={dump.title} mod={session.baseMod} onChange={onBaseMod} />
        </>
      )}
      render={(id, { arg: a }) => (
        id === 'stages' ? <LanaiStagePage session={session} arg={a} />
          : id === 'maps' ? <LanaiMapPage session={session} arg={a} />
          : id === 'talks' ? <LanaiTalkPage session={session} arg={a} />
          : id === 'messages' ? <LanaiMessagePage session={session} arg={a} />
          : id === 'monsters' ? <LanaiMonsterPage session={session} arg={a} />
          : id === 'groups' ? <LanaiGroupPage session={session} arg={a} />
          : id === 'items' ? <LanaiItemPage session={session} arg={a} />
          : id === 'shops' ? <LanaiShopPage session={session} arg={a} />
          : id === 'codes' ? <LanaiCodePage session={session} arg={a} />
          : <RomfsPage dump={dump} profile={profile} arg={a} />
      )}>
      {exporting && <LanaiExportDialog session={session} onClose={() => setExporting(false)} />}
    </PageShell>
  );
}
