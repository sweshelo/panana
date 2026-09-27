// The pages of an opened dump: top bar, hash routing (#/page/arg), the map editor and the React pages.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { MapEditor } from '../editor/mapeditor';
import { buildShops, loadShopTable } from '../game/shops';
import { ActionPage } from '../pages/actions';
import { GroupPage } from '../pages/groups';
import { ItemPage } from '../pages/items';
import { EventPage } from '../pages/events';
import { MessagePage } from '../pages/messages';
import { MonsterPage } from '../pages/monsters';
import { ShopPage } from '../pages/shops';
import { SoundPage } from '../pages/sounds';
import { WorldPage } from '../pages/world';
import type { Session } from '../session';
import type { PageProps } from './book';
import { ExportDialog } from './ExportDialog';
import { Dom } from './mount';
import { useAsync } from './useAsync';
import { InfoTooltip } from './InfoTip';

export const PAGES = [
  ['map', 'マップ編集'],
  ['world', 'ワールドマップ'],
  ['monsters', 'モンスター図鑑'],
  ['items', 'アイテム図鑑'],
  ['shops', 'ショップ'],
  ['groups', '群れ'],
  ['actions', 'アクション'],
  ['events', 'イベント'],
  ['messages', 'メッセージ'],
  ['sounds', 'BGM・効果音'],
] as const;
type Page = (typeof PAGES)[number][0];

const TITLES: Record<Page, string> = {
  map: 'マップ編集', world: 'ワールドマップ', monsters: 'モンスター図鑑', items: 'アイテム図鑑', shops: 'ショップ', groups: '群れ', actions: 'アクション', events: 'イベント', messages: 'メッセージ', sounds: 'BGM・効果音',
};

const subscribeHash = (f: () => void): (() => void) => {
  window.addEventListener('hashchange', f);
  return () => window.removeEventListener('hashchange', f);
};

/** #/map[/MAPNAME], #/world[/W01[.ENTRANCE]], #/monsters[/row], #/items[/id], #/groups[/row], #/actions[/row], #/shops[/id], #/events[/dungeon.row], #/messages[/dungeon.row | /0xID] or #/sounds[/row]. */
function useRoute(): { page: Page; arg: string | undefined; hash: string } {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  const [p, arg] = hash.replace(/^#\/?/, '').split('/');
  const page = PAGES.some(([id]) => id === p) ? (p as Page) : 'map';
  return { page, arg, hash };
}

function Loading(): ReactNode {
  return <div className="start"><p>読み込み中…</p></div>;
}

function Failed({ message }: { message: string }): ReactNode {
  return <div className="start"><div className="error">{message}</div></div>;
}

function ItemsRoute(props: PageProps): ReactNode {
  const data = useAsync(() => props.session.items(), [props.session]);
  if (!data) return <Loading />;
  if (data instanceof Error) return <Failed message={data.message} />;
  return <ItemPage {...props} data={data} />;
}

function ShopsRoute(props: PageProps): ReactNode {
  const { session } = props;
  const loaded = useAsync(async () => {
    const data = await session.items();
    const table = await loadShopTable(session.game).catch(() => null);
    return { data, shops: buildShops(data.stock?.lists ?? new Map(), table) };
  }, [session]);
  if (!loaded) return <Loading />;
  if (loaded instanceof Error) return <Failed message={loaded.message} />;
  return <ShopPage {...props} data={loaded.data} shops={loaded.shops} />;
}

function PageBody({ page, ...props }: PageProps & { page: Exclude<Page, 'map'> }): ReactNode {
  const book = props.session.book;
  switch (page) {
    case 'monsters':
      return book ? <MonsterPage {...props} book={book} />
        : <Failed message="モンスターのデータ (2713402F) を読めませんでした。展開済みのフォルダで開いた場合は、そのファイルも入れてください。" />;
    case 'groups':
      return book ? <GroupPage {...props} book={book} /> : <Failed message="モンスターのデータを読めませんでした。" />;
    case 'items':
      return <ItemsRoute {...props} />;
    case 'shops':
      return <ShopsRoute {...props} />;
    case 'actions':
      return <ActionPage {...props} />;
    case 'events':
      return <EventPage {...props} />;
    case 'messages':
      return <MessagePage {...props} />;
    case 'world':
      return <WorldPage {...props} />;
    case 'sounds':
      return props.session.sounds ? <SoundPage {...props} sounds={props.session.sounds} /> : <Failed message="音の表 (soundData) を読めませんでした。" />;
  }
}

export function Shell({ session, editor, onPickBaseMod, onChangeDump }: {
  session: Session;
  editor: MapEditor;
  onPickBaseMod: () => void;
  onChangeDump: () => void;
}): ReactNode {
  const { game } = session;
  const { page, arg, hash } = useRoute();
  const [exporting, setExporting] = useState(false);
  // The page menu of narrow screens (the top bar's tabs and buttons in a drawer); closed by any navigation.
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [hash]);
  // On narrow screens a book page shows either its list or the selected entry (the one the route names).
  const detail = page !== 'map' && (page === 'world' ? !!arg?.includes('.') : !!arg);
  // Pages are built when first shown and kept (with their search and filter) while others are shown.
  // Each page keeps the route it was last shown with; `n` counts the navigations to it.
  const visits = useRef(new Map<Page, { hash: string; arg: string | undefined; n: number }>());
  const last = visits.current.get(page);
  if (!last || last.hash !== hash) visits.current.set(page, { hash, arg, n: (last?.n ?? 0) + 1 });

  useEffect(() => {
    document.title = `Panana — ${TITLES[page]}`;
    if (page === 'map') editor.show(arg);
    else editor.hide();
  }, [editor, page, arg, hash]);

  // Back on the list (narrow screens), show the entry that was open.
  useEffect(() => {
    if (!detail) document.querySelector(`.page-${page} .book-list tr.active`)?.scrollIntoView({ block: 'center' });
  }, [page, detail]);

  return (
    <div className="shell" data-page={page} data-detail={detail || undefined}>
      <nav className={menu ? 'topnav open' : 'topnav'}>
        <button className="nav-toggle" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <b className="brand">Panana<span className="brand-sub"> - 電波人間のRPG2 エディタ</span></b>
        <span className="nav-title">{TITLES[page]}</span>
        <div className="nav-items">
          {PAGES.map(([id, label]) => (
            <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
          ))}
          <span className="grow" />
          <span className="muted small dump-label">{game.dump.label}</span>
          <button className="primary" title="マップ・ワールドマップの入口・イベント・宝箱の中身・モンスター・メッセージの変更を MOD として書き出します" onClick={() => { setMenu(false); setExporting(true); }}>書き出し…</button>
          <button className="base-btn" title="既存の MOD (elpulse の mod/out など: romfs のファイルと code.ips) を土台にします。マップの書き出しにはその MOD の全ファイルが入ります" onClick={onPickBaseMod}>
            {`土台の MOD: ${game.baseMod?.label ?? 'なし'}${game.switchVersion ? ' (汎用スイッチあり)' : ''}`}
          </button>
          <button onClick={onChangeDump}>ダンプを変える</button>
        </div>
      </nav>
      {menu && <div className="nav-backdrop" onClick={() => setMenu(false)} />}
      {detail && <a className="back-bar" href={page === 'world' ? `#/world/${arg!.split('.')[0]}` : `#/${page}`}>{`← ${TITLES[page]}の一覧`}</a>}
      <Dom node={editor.el} className="page page-map" />
      <InfoTooltip />
      {PAGES.map(([id]) => {
        const v = visits.current.get(id);
        if (id === 'map' || !v) return null;
        return (
          <div key={id} className={`page page-${id}`}>
            <PageBody page={id} session={session} arg={v.arg} visit={v.n} />
          </div>
        );
      })}
      {exporting && <ExportDialog session={session} onClose={() => setExporting(false)} />}
    </div>
  );
}
