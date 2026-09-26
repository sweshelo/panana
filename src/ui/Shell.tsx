// The pages of an opened dump: top bar, hash routing (#/page/arg), the map editor and the React pages.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { MapEditor } from '../editor/mapeditor';
import { buildShops, loadShopTable } from '../game/shops';
import { ActionPage } from '../pages/actions';
import { GroupPage } from '../pages/groups';
import { ItemPage } from '../pages/items';
import { MessagePage } from '../pages/messages';
import { MonsterPage } from '../pages/monsters';
import { ShopPage } from '../pages/shops';
import { WorldPage } from '../pages/world';
import type { Session } from '../session';
import type { PageProps } from './book';
import { ExportDialog } from './ExportDialog';
import { Dom } from './mount';
import { useAsync } from './useAsync';

const PAGES = [
  ['map', 'マップ編集'],
  ['world', 'ワールドマップ'],
  ['monsters', 'モンスター図鑑'],
  ['items', 'アイテム図鑑'],
  ['shops', 'ショップ'],
  ['groups', '群れ'],
  ['actions', 'アクション'],
  ['messages', 'メッセージ'],
] as const;
type Page = (typeof PAGES)[number][0];

const TITLES: Record<Page, string> = {
  map: 'マップ編集', world: 'ワールドマップ', monsters: 'モンスター図鑑', items: 'アイテム図鑑', shops: 'ショップ', groups: '群れ', actions: 'アクション', messages: 'メッセージ',
};

const subscribeHash = (f: () => void): (() => void) => {
  window.addEventListener('hashchange', f);
  return () => window.removeEventListener('hashchange', f);
};

/** #/map[/MAPNAME], #/world[/W01[.ENTRANCE]], #/monsters[/row], #/items[/id], #/groups[/row], #/actions[/row], #/shops[/id] or #/messages[/dungeon.row | /0xID]. */
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
    case 'messages':
      return <MessagePage {...props} />;
    case 'world':
      return <WorldPage {...props} />;
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

  return (
    <div className="shell" data-page={page}>
      <nav className="topnav">
        <b className="brand">Panana - 電波人間のRPG2 エディタ</b>
        {PAGES.map(([id, label]) => (
          <a key={id} className={id === page ? 'tab active' : 'tab'} data-page={id} href={`#/${id}`}>{label}</a>
        ))}
        <span className="grow" />
        <span className="muted small">{game.dump.label}</span>
        <button className="primary" title="マップ・ワールドマップの入口・イベント・宝箱の中身・モンスター・メッセージの変更を MOD として書き出します" onClick={() => setExporting(true)}>書き出し…</button>
        <button className="base-btn" title="既存の MOD (elpulse の mod/out など: romfs のファイルと code.ips) を土台にします。マップの書き出しにはその MOD の全ファイルが入ります" onClick={onPickBaseMod}>
          {`土台の MOD: ${game.baseMod?.label ?? 'なし'}${game.switchVersion ? ' (汎用スイッチあり)' : ''}`}
        </button>
        <button onClick={onChangeDump}>ダンプを変える</button>
      </nav>
      <Dom node={editor.el} className="page page-map" />
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
