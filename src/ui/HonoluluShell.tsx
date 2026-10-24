// The pages of a 電波人間のRPG (honolulu, the first game) dump. Only the RomFS viewer for now (#150); the other pages
// (shop, items, monsters, maps, messages: #153-#157) come once the shells are one (#151).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HonoluluSession } from '../honolulu/session';
import { honoluluRomfsProfile } from '../romfs/honolulu';
import { RomfsPage } from '../romfs/RomfsPage';
import { InfoTooltip } from './InfoTip';
import { useHashRoute } from './route';
import { RomButton } from './RomDialog';
import { openedKeys, useWorkspace } from './workspace';

export const HONOLULU_PAGES = [['romfs', 'RomFS']] as const;
type HonoluluPage = (typeof HONOLULU_PAGES)[number][0];
const PAGE_IDS = HONOLULU_PAGES.map(([id]) => id);
const TITLES: Record<HonoluluPage, string> = { romfs: 'RomFS' };

export function HonoluluShell({ session }: { session: HonoluluSession }): ReactNode {
  const { dump } = session;
  const ws = useWorkspace();
  const { page, arg, hash } = useHashRoute<HonoluluPage>(PAGE_IDS, 'romfs');
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [hash]);
  useEffect(() => {
    document.title = `Panana — ${TITLES[page]} (RPG)`;
  }, [page]);
  const context = useMemo(() => session.master.context(), [session]);
  const visits = useRef(new Map<HonoluluPage, string | undefined>());
  visits.current.set(page, arg);
  return (
    <div className="shell" data-page={page}>
      <nav className={menu ? 'topnav open' : 'topnav'}>
        <button className="nav-toggle" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <b className="brand">Panana<span className="brand-sub"> - 電波人間のRPG ビューア</span></b>
        <span className="nav-title">{TITLES[page]}</span>
        <div className="nav-items">
          {HONOLULU_PAGES.map(([id, label]) => (
            <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
          ))}
          <span className="grow" />
          {ws && <RomButton label={dump.label} count={openedKeys(ws.opened).length} onClick={() => { setMenu(false); ws.showRoms(); }} />}
        </div>
      </nav>
      {menu && <div className="nav-backdrop" onClick={() => setMenu(false)} />}
      <InfoTooltip />
      {HONOLULU_PAGES.map(([id]) => {
        if (!visits.current.has(id)) return null;
        return (
          <div key={id} className={`page page-${id}`}>
            <RomfsPage dump={dump} profile={honoluluRomfsProfile} arg={visits.current.get(id)} context={context} />
          </div>
        );
      })}
    </div>
  );
}
