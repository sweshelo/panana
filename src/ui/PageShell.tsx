// The frame every game's pages share (#151): the top bar with the tabs (a drawer on narrow screens), the hash routing
// (#/page/arg), the "← 一覧" bar of a book page's entry on narrow screens, and the pages, each built when first shown and
// kept (with its search and filter) while others are shown. A game gives its tabs, its buttons and how to draw a page.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { InfoTooltip } from './InfoTip';
import { useHashRoute } from './route';
import { RomButton } from './RomDialog';
import { openedKeys, useWorkspace } from './workspace';

/** The route a page was last shown with; `n` counts the navigations to it. */
export interface Visit {
  hash: string;
  arg: string | undefined;
  n: number;
}

export interface PageShellProps<P extends string> {
  /** The tabs: the page's id (the hash's first part) and its label. */
  pages: readonly (readonly [P, string])[];
  /** The page's name in the top bar, the window title and the back bar. */
  titles: Record<P, string>;
  /** The page of an empty hash or one that names no page here. */
  fallback: P;
  /** The game's name after "Panana - " in the top bar. */
  brand: string;
  /** Added to the window title (e.g. " (RPG3)"). */
  titleSuffix?: string;
  /** The ROM button's label. */
  romLabel: string;
  /** The game's buttons in the top bar, before the ROM button; `closeMenu` closes the drawer. */
  actions: (closeMenu: () => void) => ReactNode;
  /** A page's content; `null` for a page drawn outside of React (it is given as `outside`). */
  render: (page: P, visit: Visit) => ReactNode;
  /** Whether the route shows a book page's entry rather than its list (default: when there is an argument). */
  isDetail?: (page: P, arg: string) => boolean;
  /** Where the back bar of an entry leads (default: the page's list). */
  backHref?: (page: P, arg: string) => string;
  /** Called with each route shown (after it is drawn). */
  onRoute?: (page: P, arg: string | undefined) => void;
  /** The pages drawn outside of React (their elements, e.g. RPG2's map editor). */
  outside?: ReactNode;
  /** The dialogs, after the pages. */
  children?: ReactNode;
}

export function PageShell<P extends string>({ pages, titles, fallback, brand, titleSuffix = '', romLabel, actions, render, isDetail, backHref, onRoute, outside, children }: PageShellProps<P>): ReactNode {
  const ws = useWorkspace();
  const ids = pages.map(([id]) => id);
  const { page, arg, hash } = useHashRoute(ids, fallback);
  // The page menu of narrow screens (the top bar's tabs and buttons in a drawer); closed by any navigation.
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [hash]);
  // On narrow screens a book page shows either its list or the selected entry (the one the route names);
  // a hash left by another game's pages names no page here.
  const detail = !!arg && hash.startsWith(`#/${page}/`) && (isDetail ? isDetail(page, arg) : true);
  const visits = useRef(new Map<P, Visit>());
  const last = visits.current.get(page);
  if (!last || last.hash !== hash) visits.current.set(page, { hash, arg, n: (last?.n ?? 0) + 1 });

  useEffect(() => {
    document.title = `Panana — ${titles[page]}${titleSuffix}`;
    onRoute?.(page, arg);
  }, [page, arg, hash]);

  // Back on the list (narrow screens), show the entry that was open.
  useEffect(() => {
    if (!detail) document.querySelector(`.page-${page} .book-list tr.active`)?.scrollIntoView({ block: 'center' });
  }, [page, detail]);

  const closeMenu = (): void => setMenu(false);
  return (
    <div className="shell" data-page={page} data-detail={detail || undefined}>
      <nav className={menu ? 'topnav open' : 'topnav'}>
        <button className="nav-toggle" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <b className="brand">Panana<span className="brand-sub">{` - ${brand}`}</span></b>
        <span className="nav-title">{titles[page]}</span>
        <div className="nav-items">
          {pages.map(([id, label]) => (
            <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
          ))}
          <span className="grow" />
          {actions(closeMenu)}
          {ws && <RomButton label={romLabel} count={openedKeys(ws.opened).length} onClick={() => { closeMenu(); ws.showRoms(); }} />}
        </div>
      </nav>
      {menu && <div className="nav-backdrop" onClick={closeMenu} />}
      {detail && <a className="back-bar" href={backHref ? backHref(page, arg!) : `#/${page}`}>{`← ${titles[page]}の一覧`}</a>}
      {outside}
      <InfoTooltip />
      {pages.map(([id]) => {
        const v = visits.current.get(id);
        const content = v && render(id, v);
        if (content === undefined || content === null) return null;
        return <div key={id} className={`page page-${id}`}>{content}</div>;
      })}
      {children}
    </div>
  );
}
