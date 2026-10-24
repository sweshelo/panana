// The pages of a 電波人間のRPG (honolulu, the first game) dump on the shared frame (PageShell): the RomFS viewer so far,
// and the export of the edits; the shop, items, monsters, maps and messages (#153-#157) are added as tabs here.
import { useMemo, useState, type ReactNode } from 'react';
import { HonoluluExportDialog } from '../honolulu/ExportDialog';
import type { HonoluluSession } from '../honolulu/session';
import { honoluluRomfsProfile } from '../romfs/honolulu';
import { RomfsPage } from '../romfs/RomfsPage';
import { PageShell } from './PageShell';

export const HONOLULU_PAGES = [['romfs', 'RomFS']] as const;
type HonoluluPage = (typeof HONOLULU_PAGES)[number][0];
const TITLES: Record<HonoluluPage, string> = { romfs: 'RomFS' };

export function HonoluluShell({ session }: { session: HonoluluSession }): ReactNode {
  const { dump } = session;
  const [exporting, setExporting] = useState(false);
  const context = useMemo(() => session.master.context(), [session]);
  return (
    <PageShell pages={HONOLULU_PAGES} titles={TITLES} fallback="romfs" brand="電波人間のRPG ビューア" titleSuffix=" (RPG)" romLabel={dump.label}
      actions={(closeMenu) => <button className="primary" title="変更した表・メッセージを LayeredFS 用の MOD として書き出します" onClick={() => { closeMenu(); setExporting(true); }}>書き出し…</button>}
      render={(_id, { arg: a }) => <RomfsPage dump={dump} profile={honoluluRomfsProfile} arg={a} context={context} />}>
      {exporting && <HonoluluExportDialog session={session} onClose={() => setExporting(false)} />}
    </PageShell>
  );
}
