// The pages of a 電波人間のRPG3 (oahu) dump. Only the RomFS viewer for now (#59); the editors come page by page.
import { useEffect, useState, type ReactNode } from 'react';
import type { Dump } from '../rom/dump';
import { oahuRomfsProfile } from '../romfs/oahu';
import { RomfsPage } from '../romfs/RomfsPage';
import { useHashRoute } from './route';

export const OAHU_PAGES = [['romfs', 'RomFS']] as const;
type OahuPage = (typeof OAHU_PAGES)[number][0];
const PAGE_IDS = OAHU_PAGES.map(([id]) => id);
const TITLES: Record<OahuPage, string> = { romfs: 'RomFS' };

export function OahuShell({ dump, onChangeDump }: { dump: Dump; onChangeDump: () => void }): ReactNode {
  const { page, arg, hash } = useHashRoute<OahuPage>(PAGE_IDS, 'romfs');
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [hash]);
  useEffect(() => {
    document.title = `Panana — ${TITLES[page]} (RPG3)`;
  }, [page]);
  // a hash left by RPG2's pages (#/map/…) names no file here
  const detail = !!arg && hash.startsWith(`#/${page}/`);
  return (
    <div className="shell" data-page={page} data-detail={detail || undefined}>
      <nav className={menu ? 'topnav open' : 'topnav'}>
        <button className="nav-toggle" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <b className="brand">Panana<span className="brand-sub"> - 電波人間のRPG3 ビューア</span></b>
        <span className="nav-title">{TITLES[page]}</span>
        <div className="nav-items">
          {OAHU_PAGES.map(([id, label]) => (
            <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
          ))}
          <span className="grow" />
          <span className="muted small dump-label">{dump.label}</span>
          <button onClick={onChangeDump}>ダンプを変える</button>
        </div>
      </nav>
      {menu && <div className="nav-backdrop" onClick={() => setMenu(false)} />}
      {detail && <a className="back-bar" href={`#/${page}`}>{`← ${TITLES[page]}の一覧`}</a>}
      <div className={`page page-${page}`}>
        <RomfsPage dump={dump} profile={oahuRomfsProfile} arg={arg} />
      </div>
    </div>
  );
}
