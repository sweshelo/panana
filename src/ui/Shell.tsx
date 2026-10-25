// The pages of an opened dump: top bar, hash routing (#/page/arg), the map editor and the React pages.
import { useState, type ReactNode } from 'react';
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
import { kaharaRomfsProfile } from '../romfs/kahara';
import { RomfsPage } from '../romfs/RomfsPage';
import type { Session } from '../session';
import type { PageProps } from './book';
import { ExportDialog } from './ExportDialog';
import { Dom } from './mount';
import { useAsync } from './useAsync';
import type { BaseMod } from '../rom/dump';
import { BaseModButton } from './BaseModButton';
import { PageShell } from './PageShell';

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
  ['romfs', 'RomFS'],
] as const;
type Page = (typeof PAGES)[number][0];

const TITLES: Record<Page, string> = {
  map: 'マップ編集', world: 'ワールドマップ', monsters: 'モンスター図鑑', items: 'アイテム図鑑', shops: 'ショップ', groups: '群れ', actions: 'アクション', events: 'イベント', messages: 'メッセージ', sounds: 'BGM・効果音', romfs: 'RomFS',
};

// The routes: #/map[/MAPNAME], #/world[/W01[.ENTRANCE]], #/monsters[/row], #/items[/id], #/groups[/row], #/actions[/row], #/shops[/id], #/events[/dungeon.row], #/messages[/dungeon.row | /0xID], #/sounds[/row] or #/romfs[/path[:entry]].

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
    case 'romfs':
      return <RomfsPage dump={props.session.game.dump} profile={kaharaRomfsProfile} arg={props.arg} context={{ message: (id) => props.session.game.master.texts.preview(id, true) }} />;
    case 'sounds':
      return props.session.sounds ? <SoundPage {...props} sounds={props.session.sounds} /> : <Failed message="音の表 (soundData) を読めませんでした。" />;
  }
}

export function Shell({ session, editor, onBaseMod }: {
  session: Session;
  editor: MapEditor;
  /** Reopens the dump on another base MOD (null: none), keeping the edits. */
  onBaseMod: (mod: BaseMod | null) => Promise<void>;
}): ReactNode {
  const { game } = session;
  const [exporting, setExporting] = useState(false);
  return (
    <PageShell pages={PAGES} titles={TITLES} fallback="map" brand="電波人間のRPG2 エディタ" romLabel={game.dump.label}
      isDetail={(page, arg) => page !== 'map' && (page !== 'world' || arg.includes('.'))}
      backHref={(page, arg) => (page === 'world' ? `#/world/${arg.split('.')[0]}` : `#/${page}`)}
      onRoute={(page, arg) => (page === 'map' ? editor.show(arg) : editor.hide())}
      actions={(closeMenu) => (
        <>
          <button className="primary" title="マップ・ワールドマップの入口・イベント・宝箱の中身・モンスター・メッセージの変更を MOD として書き出します" onClick={() => { closeMenu(); setExporting(true); }}>書き出し…</button>
          <BaseModButton title={game.dump.title} mod={game.baseMod} onChange={onBaseMod}>
            {`土台の MOD: ${game.baseMod?.label ?? 'なし'}${game.switchVersion ? ' (汎用スイッチあり)' : ''}`}
          </BaseModButton>
        </>
      )}
      render={(page, v) => (page === 'map' ? null : <PageBody page={page} session={session} arg={v.arg} visit={v.n} />)}
      outside={<Dom node={editor.el} className="page page-map" />}>
      {exporting && <ExportDialog session={session} onClose={() => setExporting(false)} />}
    </PageShell>
  );
}
