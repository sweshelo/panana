// The pages of a 電波人間のRPG (honolulu, the first game) dump on the shared frame (PageShell): the monsters (#155), the
// items (#154), the shop (#153), the maps (#156, view only), the messages (#157), the BGM and sound effects (#176) and the RomFS viewer (#150), and the
// export of the edits. Like the other games, the dump opens on the maps.
import { useMemo, useState, type ReactNode } from 'react';
import { HonoluluExportDialog } from '../honolulu/ExportDialog';
import { HonoluluItemPage } from '../honolulu/ItemPage';
import { HonoluluMapPage } from '../honolulu/MapPage';
import { HonoluluMessagePage } from '../honolulu/MessagePage';
import { HonoluluMonsterPage } from '../honolulu/MonsterPage';
import { HonoluluShopPage } from '../honolulu/ShopPage';
import { HonoluluSoundPage } from '../honolulu/SoundPage';
import type { HonoluluSession } from '../honolulu/session';
import { honoluluRomfsProfile } from '../romfs/honolulu';
import { RomfsPage } from '../romfs/RomfsPage';
import { PageShell } from './PageShell';

export const HONOLULU_PAGES = [['monsters', 'モンスター'], ['items', 'アイテム'], ['shops', 'ショップ'], ['maps', 'マップ'], ['messages', 'メッセージ'], ['sounds', 'BGM・効果音'], ['romfs', 'RomFS']] as const;
type HonoluluPage = (typeof HONOLULU_PAGES)[number][0];
const TITLES: Record<HonoluluPage, string> = { monsters: 'モンスター', items: 'アイテム', shops: 'ショップ', maps: 'マップ', messages: 'メッセージ', sounds: 'BGM・効果音', romfs: 'RomFS' };

export function HonoluluShell({ session }: { session: HonoluluSession }): ReactNode {
  const { dump } = session;
  const [exporting, setExporting] = useState(false);
  const context = useMemo(() => session.master.context(), [session]);
  return (
    <PageShell pages={HONOLULU_PAGES} titles={TITLES} fallback="maps" brand="電波人間のRPG エディタ" titleSuffix=" (RPG)" romLabel={dump.label}
      actions={(closeMenu) => <button className="primary" title="変更した表・メッセージを LayeredFS 用の MOD として書き出します" onClick={() => { closeMenu(); setExporting(true); }}>書き出し…</button>}
      render={(id, { arg: a }) => (
        id === 'monsters' ? <HonoluluMonsterPage session={session} arg={a} />
          : id === 'items' ? <HonoluluItemPage session={session} arg={a} />
          : id === 'shops' ? <HonoluluShopPage master={session.master} shop={session.shop} arg={a} edited={() => session.edited()} />
          : id === 'maps' ? <HonoluluMapPage session={session} arg={a} />
          : id === 'messages' ? <HonoluluMessagePage session={session} arg={a} />
          : id === 'sounds' ? <HonoluluSoundPage session={session} arg={a} />
          : <RomfsPage dump={dump} profile={honoluluRomfsProfile} arg={a} context={context} />
      )}>
      {exporting && <HonoluluExportDialog session={session} onClose={() => setExporting(false)} />}
    </PageShell>
  );
}
