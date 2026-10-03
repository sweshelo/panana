// RPG3's shop list (#/shops/<ID>): every shop of ShopItem with what it sells and its settings (Shop), in the shop book
// shared with RPG2 (ui/ShopBook). The stock is edited the same way; in the ジュエル shops each row also carries its
// price, and some rows can be bought only once (naauao oahu/shops.md).
import type { ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ShopBook, type ShopBookShop, type ShopColumn } from '../ui/ShopBook';
import { hex8 } from '../util/bytes';
import { oahuItemHref } from './ItemPage';
import { oahuMessageHref } from './MessagePage';
import { OahuItemPicker } from './pickers';
import type { OahuSession } from './session';
import { OAHU_PRICE_MAX, OAHU_PRICE_UNIT, OAHU_SHOP_ALIASES, OAHU_SHOP_PAYMENT, oahuShopLabel, type OahuShop, type OahuShopRow, type OahuShops } from './shops';

export const oahuShopHref = (id: number): string => `#/shops/${id}`;

/** Shop +0x34, as in RPG2 (which itemData description each value shows is assumed from RPG2). */
const VARIANT_LABEL: Record<number, string> = { 0: '片言 (ちていじん)', 1: '片言', 2: '自然な口調' };

const ONCE_HELP = '1 回だけ買える品物の番号 (ShopItem +0x0C)。買うとセーブのフラグ (0xAD 群のビット 番号−1) が立ち、その品物は同じ番号を持つどの店のリストからも消えます。';
const PRICE_HELP = 'ジュエルなどで払う店の値段 (ShopItem +0x08)。ゴールドの店ではアイテム図鑑の買値を使います。';

export function OahuShopPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const shops = session.shops;
  if (!shops) return <div className="start"><div className="error">ショップの表 (3B630000 の ShopItem) を読めませんでした。</div></div>;
  return <ShopList session={session} shops={shops} arg={arg} />;
}

function ShopList({ session, shops, arg }: { session: OahuSession; shops: OahuShops; arg: string | undefined }): ReactNode {
  const { items } = session;
  const byId = new Map(shops.shops.map((s) => [s.id, s]));
  const book: ShopBookShop[] = shops.shops.map((s) => ({ id: s.id, label: oahuShopLabel(s), messages: s.settings?.messages ?? [] }));
  const of = (s: ShopBookShop): OahuShop => byId.get(s.id)!;
  const payment = (s: ShopBookShop): number => of(s).settings?.payment ?? 0;
  const setRows = (s: ShopBookShop, rows: OahuShopRow[]): void => {
    shops.set(s.id, rows);
    session.scheduleSave();
  };
  /** The price column: the item's gold price, or the row's own price in the ジュエル / point shops. */
  const priceColumn = (s: ShopBookShop): ShopColumn<OahuShopRow> => {
    const pay = payment(s);
    const unit = OAHU_PRICE_UNIT[pay];
    if (!unit) return { head: '買値', className: 'num', cell: (r) => { const it = items.item(r.item); return it ? `${it.price} G` : ''; } };
    return {
      head: `値段 (${unit})`,
      className: 'num',
      cell: (r, i) => (
        <NumberInput value={r.price} min={0} max={OAHU_PRICE_MAX[pay] ?? 9999} title={PRICE_HELP}
          onCommit={(v) => setRows(s, shops.rows(s.id).map((x, j) => (j === i ? { ...x, price: v } : x)))} />
      ),
    };
  };
  const onceColumn: ShopColumn<OahuShopRow> = {
    head: '1 回だけ',
    className: 'num',
    cell: (r) => (r.once ? <span title={ONCE_HELP}>{`#${r.once}`}</span> : ''),
  };
  return (
    <ShopBook<OahuShopRow>
      shops={book}
      arg={arg}
      href={oahuShopHref}
      texts={session.messages.texts}
      messageHref={oahuMessageHref}
      rows={(s) => shops.rows(s.id)}
      original={(s) => shops.originalRows(s.id)}
      same={(a, b) => a.item === b.item && a.price === b.price && a.once === b.once}
      newRow={(_, item) => ({ item, price: 0, once: 0 })}
      item={(id) => {
        const it = items.item(id);
        return it && { name: it.name, href: oahuItemHref(id), changed: items.changed(id) };
      }}
      columns={(s) => [
        { head: '分類', className: 'muted', cell: (r) => items.item(r.item)?.category ?? '' },
        priceColumn(s),
        ...([...shops.rows(s.id), ...shops.originalRows(s.id)].some((r) => r.once) ? [onceColumn] : []),
      ]}
      setRows={setRows}
      picker={(p) => <OahuItemPicker battle={session.battle} current={0} title={p.title} onClose={p.onClose} onPick={p.onPick} />}
      sub={(s) => {
        const pay = payment(s);
        const first = s.messages.find((m) => m);
        const greeting = first ? session.messages.texts.preview(first, true) ?? '' : '';
        return pay ? `${OAHU_SHOP_PAYMENT[pay]} ・ ${greeting}` : greeting;
      }}
      warnings={(s, rows) => {
        const w: string[] = [];
        if (!rows.length) w.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
        if (rows.length > shops.originalMax) w.push(`元のデータで一番多い店は ${shops.originalMax} 品です。それを超える数はゲームで確かめていません。`);
        if (OAHU_PRICE_UNIT[payment(s)] && rows.some((r) => !r.price)) w.push(`値段 0 の品物があります (タダで買えます)。`);
        if (!OAHU_PRICE_UNIT[payment(s)] && rows.some((r) => items.item(r.item)?.price === 0)) w.push('買値 0 のアイテムがあります (タダで買えます)。');
        return w;
      }}
      exportNote={`変更は ShopItem として ${shops.archiveNames().join(' と ')} に書き出されます。`}
      stockNote={<>並びは店での表示順 (ShopItem)。ゴールドの値段はアイテムごと (アイテム図鑑で編集できます)。<InfoTip text={`${PRICE_HELP} ${ONCE_HELP}`} /></>}
      info={(s) => <ShopInfo shop={of(s)} />}
      footer={(s) => {
        const st = of(s).settings;
        return st && <div className="muted small mono">{`部屋 ${hex8(st.room)} / カメラ ${hex8(st.camera)} (3B630000)・店員 ${st.clerkKind === 0 ? `mapObject #${st.clerk}` : `特別 (${st.clerkKind}: ${st.clerk})`}・高さ ${st.height}`}</div>;
      }}
    />
  );
}

function ShopInfo({ shop }: { shop: OahuShop }): ReactNode {
  const st = shop.settings;
  const alias = Object.entries(OAHU_SHOP_ALIASES).filter(([, to]) => to === shop.id).map(([from]) => from);
  return (
    <span className="muted">
      {st ? `支払い: ${OAHU_SHOP_PAYMENT[st.payment] ?? st.payment}  商品の説明: ${VARIANT_LABEL[st.variant] ?? st.variant}` : 'Shop の表に行がありません'}
      {alias.length > 0 && `  (店 ${alias.join('・')} もこの品揃えを使います)`}
    </span>
  );
}
