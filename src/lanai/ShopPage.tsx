// RPG FREE!'s shops (#/shops/<content>[.<Shop row>]): the shops of one content (its Shop and ShopItem tables, shops.ts)
// in the shop book shared with RPG2 / RPG3 (ui/ShopBook): the stock as item boards with their photos, reordered by
// dragging, picked from the item photos, the most one can buy per row; and the clerks (EventObject rows of type 店の人)
// with the maps that place them, linked to the map page with the record selected and to their lines.
import { useMemo, type ReactNode } from 'react';
import { NumberInput, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ShopBook, type ShopBookShop, type ShopColumn } from '../ui/ShopBook';
import { useAsync } from '../ui/useAsync';
import { hex8, u32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiItemHref } from './ItemPage';
import { LANAI_ITEM_KINDS, lanaiItems } from './items';
import { lanaiMapHref } from './MapPage';
import { lanaiMaps, type LanaiMaps } from './maps';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiItemIcon, LanaiItemPicker } from './pickers';
import type { LanaiSession } from './session';
import { LANAI_CLERK_SHOP, lanaiClerks, lanaiShops, SHOP_LIMIT, SHOP_ONCE, type LanaiContentShops, type LanaiShopRow } from './shops';

export const lanaiShopHref = (content: number, shop?: number): string => `#/shops/${content}${shop === undefined ? '' : `.${shop}`}`;

const LIMIT_HELP = '買える数の上限と推定 (ShopItem +0x26。0 = 制限なし)。MessageTalkShop の「購入個数が限定されているアイテムです。あと〈num〉個購入可能です」に当たると推定しています (naauao lanai/shops.md §2)。';
const ONCE_HELP = '1 個だけ買える品物の番号と推定 (ShopItem +0x25。RPG3 の ShopItem +0x0C と同じ役割)。';
const CLERK_HELP = '動作の型 0x80000032 (店の人) の EventObject の行。台詞のあと店を開きます。どの店を開くかは引数になく、このコンテンツの Shop の行 0 と推定しています (店の人がいるコンテンツは、どれも店が 1 つだけ。naauao lanai/shops.md §4)。';

export function LanaiShopPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(arg ?? '');
  const index = useSticky<number>(m ? Number(m[1]) : undefined, (i) => i < contents.length, () => 0);
  const content = contents[index]!;
  const shops = useAsync(() => lanaiShops(session, content), [session, content]);
  const side = <ContentSelect contents={contents} content={content} />;
  if (!shops || shops instanceof Error)
    return (
      <div className="book">
        <div className="book-side">
          {side}
          <p className={shops instanceof Error ? 'error' : 'muted'}>{shops instanceof Error ? shops.message : shops === null ? 'このコンテンツには Shop / ShopItem の表がありません。' : 'アーカイブを読み込み中…'}</p>
        </div>
      </div>
    );
  return <ShopList key={content.index} session={session} shops={shops} side={side} arg={m?.[2]} />;
}

function ContentSelect({ contents, content }: { contents: LanaiContent[]; content: LanaiContent }): ReactNode {
  return (
    <div className="row">
      <select value={content.index} title="店の表を読むコンテンツ" onChange={(e) => (location.hash = lanaiShopHref(Number(e.target.value)))}>
        {contents.map((c) => <option key={c.index} value={c.index}>{`${c.index}. ${contentTitle(c)}`}</option>)}
      </select>
    </div>
  );
}

function ShopList({ session, shops, side, arg }: { session: LanaiSession; shops: LanaiContentShops; side: ReactNode; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const { content } = shops;
  const items = useMemo(() => new Map(lanaiItems(session).map((it) => [it.id, it])), [session, revision]);
  const data = session.need('ItemData');
  const maps = useAsync(() => lanaiMaps(session, content), [session, content]);
  const clerks = useMemo(() => (maps && !(maps instanceof Error) ? lanaiClerks(maps) : null), [maps]);
  const book: ShopBookShop[] = shops.shops.map((s) => ({ id: s.row, label: `店 ${s.row}` }));
  const setRow = (shop: number, i: number, f: (b: Uint8Array) => void): void => {
    const rows = shops.rows(shop).map((r, j) => {
      if (j !== i) return r;
      const b = r.bytes.slice();
      f(b);
      return { item: r.item, bytes: b };
    });
    shops.set(shop, rows);
    session.edited();
  };
  const columns = (s: ShopBookShop): ShopColumn<LanaiShopRow>[] => {
    const all = [...shops.rows(s.id), ...shops.originalRows(s.id)];
    const editable = shops.editable(s.id);
    return [
      { head: '分類', className: 'muted nowrap', cell: (r) => { const it = items.get(r.item); return it ? LANAI_ITEM_KINDS[it.kind] ?? `0x${it.kind.toString(16)}` : ''; } },
      { head: '買値', className: 'num', cell: (r) => { const it = items.get(r.item); return it ? `${it.buy} G` : ''; } },
      {
        head: '買える数',
        className: 'num',
        cell: (r, i) => editable
          ? <NumberInput value={r.bytes[SHOP_LIMIT]!} min={0} max={255} title={LIMIT_HELP} onCommit={(v) => setRow(s.id, i, (b) => (b[SHOP_LIMIT] = v))} />
          : r.bytes[SHOP_LIMIT] || '',
      },
      ...(all.some((r) => r.bytes[SHOP_ONCE]) ? [{ head: '1 個だけ', className: 'num', cell: (r: LanaiShopRow) => (r.bytes[SHOP_ONCE] ? <span title={ONCE_HELP}>{`#${r.bytes[SHOP_ONCE]}`}</span> : '') }] : []),
      ...(all.some((r) => u32(r.bytes, 4)) ? [{ head: '+0x04', className: 'num muted', cell: (r: LanaiShopRow) => u32(r.bytes, 4) || '' }] : []),
    ];
  };
  return (
    <ShopBook<LanaiShopRow>
      shops={book}
      arg={arg}
      href={(id) => lanaiShopHref(content.index, id)}
      side={side}
      rows={(s) => shops.rows(s.id)}
      original={(s) => shops.originalRows(s.id)}
      same={(a, b) => a.item === b.item && a.bytes.every((x, i) => x === b.bytes[i])}
      newRow={(s, item) => shops.newRow(s.id, item)}
      replaceItem={(r, item) => {
        const b = r.bytes.slice();
        new DataView(b.buffer).setUint32(0, item >>> 0, true);
        return { item, bytes: b };
      }}
      item={(id) => {
        if (id === 0) return { name: '(アイテム 0 の行)', icon: <span className="photo item-badge item-kind-0">–</span> };
        const it = items.get(id);
        return it && { name: it.name, href: lanaiItemHref(it.row), icon: lanaiItemIcon(session, it.row, it.name), changed: session.need('ItemDataCore').rowChanged(it.core) };
      }}
      columns={columns}
      setRows={(s, rows) => {
        if (!shops.editable(s.id)) return;
        shops.set(s.id, rows);
        session.edited();
      }}
      picker={(p) => <LanaiItemPicker session={session} current={0} title={p.title} onClose={p.onClose} onPick={(row) => p.onPick(data.rowId(row))} />}
      sub={(s) => {
        const n = s.id === LANAI_CLERK_SHOP ? clerks?.length ?? 0 : 0;
        return `${shops.rows(s.id).length} 品${n ? `・店の人 ${n}` : ''}`;
      }}
      warnings={(s, rows) => {
        const w: string[] = [];
        if (!shops.editable(s.id)) w.push(`Shop +0x00 (${hex8(shops.headRef(s.id)).toUpperCase()}) が ShopItem の頭の行を指していないので、品揃えは編集できません。`);
        if (!rows.length) w.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
        if (rows.length > shops.originalMax) w.push(`このコンテンツで一番多い店は ${shops.originalMax} 品です。それを超える数はゲームで確かめていません。`);
        if (rows.some((r) => items.get(r.item)?.buy === 0)) w.push('買値 0 のアイテムがあります (タダで買えます)。');
        return w;
      }}
      exportNote={`変更はコンテンツ ${content.index} のアーカイブ (${content.archive}) の ShopItem に書き出されます。品数を変えると、後ろの店の行がずれ、その店の Shop +0x00 も書き換わります。`}
      stockNote={<>並びは店での表示順 (ShopItem)。買値はアイテムごと (アイテム図鑑の ItemDataCore)。<InfoTip text={`${LIMIT_HELP} ${ONCE_HELP}`} /></>}
      info={(s) => <span className="muted">{`Shop の行 ${s.id} (行 ID ${hex8(shops.shops[s.id]!.id).toUpperCase()})・品揃え ShopItem ${hex8(shops.headRef(s.id)).toUpperCase()}`}</span>}
      places={(s) => <Clerks session={session} maps={maps} clerks={s.id === LANAI_CLERK_SHOP ? clerks : []} content={content} multi={shops.shops.length > 1} />}
      footer={(s) => {
        const t = shops.shopTable;
        return <div className="muted small mono">{`部屋 ${hex8(t.u32(s.id, 4)).toUpperCase()} / カメラ ${hex8(t.u32(s.id, 8)).toUpperCase()}・+0x0C ${t.u32(s.id, 0x0c)}・+0x10 ${hex8(t.u32(s.id, 0x10)).toUpperCase()}・+0x18 ${t.u8(s.id, 0x18)}・高さ ${t.u8(s.id, 0x19)} (未解析の欄は naauao lanai/shops.md §3)`}</div>;
      }}
    />
  );
}

/** The clerks of the shop (the content's 店の人 rows) and the maps that place them. */
function Clerks({ session, maps, clerks, content, multi }: {
  session: LanaiSession;
  maps: LanaiMaps | Error | undefined;
  clerks: ReturnType<typeof lanaiClerks> | null;
  content: LanaiContent;
  multi: boolean;
}): ReactNode {
  const head = <h3 className="with-info">店の人と場所<InfoTip text={CLERK_HELP} /></h3>;
  if (!maps) return <>{head}<p className="muted small">マップを読み込み中…</p></>;
  if (maps instanceof Error) return <>{head}<p className="muted small">{`マップを読めませんでした: ${maps.message}`}</p></>;
  if (!clerks?.length)
    return (
      <>
        {head}
        <p className="muted small">
          {multi
            ? 'このコンテンツには店が複数あり、店の人 (型 0x32) はいません。島の店などは CRO のスクリプトやメニューから開くと推定しています。'
            : 'この店を開く店の人 (型 0x32) は、このコンテンツのマップにいません。'}
        </p>
      </>
    );
  return (
    <>
      {head}
      <table className="enc-table">
        <thead><tr><th>EventObject</th><th>台詞</th><th>マップ</th></tr></thead>
        <tbody>
          {clerks.map((c) => {
            const talk = maps.talkTable(c.group);
            const row = talk ? talk.find(c.talk) : -1;
            const ref = talk ? session.refOf(talk) : undefined;
            const line = talk && row >= 0 ? session.plain(talk, row, 'message') : '';
            return (
              <tr key={`${c.group}:${c.event}:${c.action}`}>
                <td className="mono nowrap">{`${maps.groupName(c.group) || `MapGroup ${c.group}`} #${c.event}`}</td>
                <td>
                  {ref && row >= 0 ? <a href={`#/talks/${ref.archive}:${hex8(ref.entry).toUpperCase()}:${row}`} title="セリフのページで開く">{line.split('\n')[0] || `行 ${row}`}</a> : <span className="muted">{`台詞の行 ${hex8(c.talk)}`}</span>}
                </td>
                <td>
                  {c.places.length
                    ? c.places.map((p, i) => <span key={i}>{i > 0 && '、'}<a href={lanaiMapHref(content.index, p.map, p)} title="マップのページでこのキャラを選ぶ">{`${p.map} (区画 ${p.section} #${p.index})`}</a></span>)
                    : <span className="muted">置いているマップなし</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
