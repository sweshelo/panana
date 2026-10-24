// The pages of a 電波人間のRPG (honolulu, the first game) dump on the shared frame (PageShell). Only the RomFS viewer
// for now (#150); the shop, items, monsters, maps and messages (#153-#157) are added as tabs here.
import { useMemo, type ReactNode } from 'react';
import type { HonoluluSession } from '../honolulu/session';
import { honoluluRomfsProfile } from '../romfs/honolulu';
import { RomfsPage } from '../romfs/RomfsPage';
import { PageShell } from './PageShell';

export const HONOLULU_PAGES = [['romfs', 'RomFS']] as const;
type HonoluluPage = (typeof HONOLULU_PAGES)[number][0];
const TITLES: Record<HonoluluPage, string> = { romfs: 'RomFS' };

export function HonoluluShell({ session }: { session: HonoluluSession }): ReactNode {
  const { dump } = session;
  const context = useMemo(() => session.master.context(), [session]);
  return (
    <PageShell pages={HONOLULU_PAGES} titles={TITLES} fallback="romfs" brand="電波人間のRPG ビューア" titleSuffix=" (RPG)" romLabel={dump.label}
      actions={() => null}
      render={(_id, { arg: a }) => <RomfsPage dump={dump} profile={honoluluRomfsProfile} arg={a} context={context} />} />
  );
}
