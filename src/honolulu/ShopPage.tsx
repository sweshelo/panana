// 電波人間のRPG (初代)'s shop (#/shops/<stage>): the one shop of デンパ島 by its 12 stages (shops.ts) in the shop book shared
// with the other games (ui/ShopBook): the list picks a stage instead of a shop, and a stage shows when it starts (a
// dungeon and its progress, editable), its stock as item boards (reordered, added, removed; the 目玉 bit and the new
// marks the clerk shows) and the clerk's greetings. A stock that grows or shrinks moves the stages after it.
import type { ReactNode } from 'react';
import { NumberInput, useEdits } from '../ui/book';
import { GridPicker, type GridEntry } from '../ui/GridPicker';
import { InfoTip } from '../ui/InfoTip';
import { ShopBook, type ShopBookShop } from '../ui/ShopBook';
import { honoluluItemHref } from './ItemPage';
import type { HonoluluMaster } from './master';
import { HONOLULU_SHOP_LIMITS, HONOLULU_SHOP_STAGES, honoluluShopProblems, honoluluShopRowBytes, type HonoluluShop, type HonoluluShopRow } from './shops';
import { HONOLULU_ITEM_CATEGORY } from './tables';

export const honoluluShopHref = (stage: number): string => `#/shops/${stage}`;

const STAGE_HELP = `店の品揃えは shopItemGroup の ${HONOLULU_SHOP_STAGES} 段階。上から順に条件 (ダンジョンの進み具合 = 値) を見て、満たす最後の段階を並べます。どれも満たさなければ段階 0。段階の数はコードに固定 (cmp r4, #0xc) なので増やせません。各段階の一覧がその時点の品揃えのすべてです (前の段階の品も並べ直す)。`;
const PROGRESS_HELP = 'ダンジョンの進み具合 (セーブ変数 0x40 のダンジョン − 1 番目の値) がこの値と等しいとき、この段階になります。値が何を表すか (ボスを倒した・クリアした) は未確認です。';
const FEATURED_HELP = '目玉の品 (shopItemData +0x02 bit 0)。段階が変わったとき、新しい段階にこの品があればフラグ 0x27 を立て、店に入ったときのあいさつが 135「タイミングいいな。良い物、入ってる。」になります。店の一覧では目玉の品を別の一覧にも入れます。';
const NEW_HELP = '前の段階にないアイテム。店のコードは前の段階の一覧 (shopItemGroup +0x08〜+0x0A) と比べて、この印を一覧に持ちます (画面での出方は未確認)。';
const LIMIT_HELP = `店の一覧の大きさ (コードから推定): 品数 ${HONOLULU_SHOP_LIMITS.all}・目玉の品 ${HONOLULU_SHOP_LIMITS.featured}・装備 ${HONOLULU_SHOP_LIMITS.equip}・ふく ${HONOLULU_SHOP_LIMITS.cloth} まで。`;

/** The clerk's greetings (naauao honolulu/shops.md §3): when each is said. */
const GREETINGS: [number, string][] = [
  [131, 'はじめて店に入ったとき (フラグ 0x0F を立てる)'],
  [135, '目玉の品が入荷したあと (フラグ 0x27 を下ろす)'],
  [133, 'それ以外'],
];

interface Item {
  id: number;
  name: string;
  category: number;
  price: number;
}

function itemIcon(it: Item | undefined, large = false): ReactNode {
  const label = it ? HONOLULU_ITEM_CATEGORY[it.category] ?? '?' : '?';
  return <span className={`photo${large ? ' photo-lg' : ''} item-badge item-kind-${it?.category ?? 0}`} title={label}>{it?.name[0] ?? '?'}</span>;
}

export function HonoluluShopPage({ master, shop, arg, edited }: { master: HonoluluMaster; shop: HonoluluShop; arg: string | undefined; edited: () => void }): ReactNode {
  // a condition is not in ShopBook's rows: the page redraws itself for it (the list shows the conditions)
  const [, redraw] = useEdits();
  const itemRows = master.rows('itemData.bin');
  const dungeons = master.rows('dungeonData.bin');
  // the items as they are now (the item book may have changed their names, categories and prices)
  const items = Array.from({ length: itemRows.rows }, (_, id): Item => ({
    id,
    name: master.message(itemRows.get(id, 'name')) ?? `#${id}`,
    category: itemRows.get(id, 'category'),
    price: itemRows.get(id, 'price'),
  }));
  const item = (id: number): Item | undefined => (id > 0 && id < items.length && itemRows.get(id, 'used') ? items[id] : undefined);
  const entries = (): GridEntry[] => items.filter((it) => item(it.id) && it.category !== 6).map((it) => ({
    id: it.id, name: it.name, icon: itemIcon(it, true), sub: `${it.price} G`, title: `#${it.id} ${HONOLULU_ITEM_CATEGORY[it.category] ?? ''}`, category: it.category,
  }));
  const dungeonName = (d: number): string => (d === 0 ? '最初' : d < dungeons.rows ? master.message(dungeons.get(d, 'name')) ?? `#${d}` : `#${d}`);
  const conditionText = (stage: number): string => {
    const c = shop.condition(stage);
    return c.dungeon === 0 && c.progress === 0 ? '最初の段階' : `${dungeonName(c.dungeon)} の進み具合 = ${c.progress}`;
  };
  const stages: ShopBookShop[] = Array.from({ length: shop.stages }, (_, i) => ({ id: i, label: `段階 ${i}` }));
  const setRows = (s: ShopBookShop, rows: HonoluluShopRow[]): void => {
    shop.set(s.id, rows);
    edited();
  };
  return (
    <ShopBook<HonoluluShopRow>
      shops={stages}
      unit="段階"
      arg={arg}
      href={honoluluShopHref}
      rows={(s) => shop.rows(s.id)}
      original={(s) => shop.originalRows(s.id)}
      same={(a, b) => a.item === b.item && a.featured === b.featured}
      newRow={(_, id) => ({ item: id, featured: false, bytes: honoluluShopRowBytes(id) })}
      replaceItem={(r, id) => ({ ...r, item: id, bytes: honoluluShopRowBytes(id, r.featured, r.bytes) })}
      item={(id) => {
        const it = item(id);
        return it && { name: it.name, href: honoluluItemHref(id), icon: itemIcon(it) };
      }}
      columns={(s) => [
        { head: '分類', className: 'muted nowrap', cell: (r) => { const it = item(r.item); return it ? HONOLULU_ITEM_CATEGORY[it.category] ?? '' : ''; } },
        { head: '買値', className: 'num', cell: (r) => { const it = item(r.item); return it ? `${it.price} G` : ''; } },
        {
          head: '目玉',
          className: 'num',
          cell: (r, _, setRow) => (
            <input type="checkbox" checked={r.featured} title={FEATURED_HELP}
              onChange={(e) => setRow({ ...r, featured: e.target.checked, bytes: honoluluShopRowBytes(r.item, e.target.checked, r.bytes) })} />
          ),
        },
        { head: '新', className: 'num', cell: (r) => (s.id > 0 && shop.isNew(s.id, r.item) ? <span className="muted" title={NEW_HELP}>新</span> : '') },
      ]}
      setRows={setRows}
      picker={(p) => <GridPicker title={p.title} entries={entries()} categories={HONOLULU_ITEM_CATEGORY} onPick={p.onPick} onClose={p.onClose} />}
      sub={(s) => conditionText(s.id)}
      info={(s) => {
        const featured = shop.rows(s.id).filter((r) => r.featured).length;
        return <span className="muted">{`${shop.range(s.id).join('〜')} 行${featured ? `・目玉の品 ${featured}` : ''}`}</span>;
      }}
      places={(s) => <StageCondition master={master} shop={shop} stage={s.id} dungeonName={dungeonName} edited={() => { edited(); redraw(); }} />}
      side={<div className="muted small">{`${HONOLULU_SHOP_STAGES} 段階 (固定)`}<InfoTip text={STAGE_HELP} /></div>}
      warnings={(s, rows) => {
        const w = honoluluShopProblems(rows, (id) => item(id)?.category);
        if (!rows.length) w.push('品物のない段階はゲームで確かめていません。');
        if (rows.length > shop.originalMax && rows.length <= HONOLULU_SHOP_LIMITS.all) w.push(`元のデータで一番多い段階は ${shop.originalMax} 品です。それを超える数はゲームで確かめていません。`);
        if (rows.some((r) => item(r.item)?.price === 0)) w.push('買値 0 のアイテムがあります (タダで買えます)。');
        return w;
      }}
      exportNote="品数を変えると、後ろの段階の行の範囲 (shopItemGroup +0x00〜+0x0A) をずらして書き出します (master 56562135 の shopItemData・shopItemGroup)。"
      stockNote={<>並びは店での表示順 (shopItemData)。値段はアイテムごと。<InfoTip text={`${FEATURED_HELP} ${NEW_HELP} ${LIMIT_HELP}`} /></>}
      footer={() => (
        <>
          <h3>店員のあいさつ</h3>
          <table className="enc-table">
            <tbody>
              <tr><th>ID</th><th>いつ</th><th>本文</th></tr>
              {GREETINGS.map(([id, when]) => <tr key={id}><td className="mono">{id}</td><td className="muted small">{when}</td><td>{master.message(id) ?? ''}</td></tr>)}
            </tbody>
          </table>
          <div className="muted small">店員のメッセージ (116〜149) は店の設定の行になく、コードが番号で選びます。</div>
        </>
      )}
    />
  );
}

/** When a stage starts: the dungeon (dungeonData's rows 1〜, 0 = the first stage) and its progress value. */
function StageCondition({ master, shop, stage, dungeonName, edited }: { master: HonoluluMaster; shop: HonoluluShop; stage: number; dungeonName: (d: number) => string; edited: () => void }): ReactNode {
  const c = shop.condition(stage);
  const was = shop.condition(stage, true);
  const rows = master.rows('dungeonData.bin').rows;
  const set = (next: Partial<typeof c>): void => {
    shop.setCondition(stage, { ...c, ...next });
    edited();
  };
  const changed = c.dungeon !== was.dungeon || c.progress !== was.progress;
  return (
    <div className="row">
      <span>条件:</span>
      <select value={c.dungeon} title="この段階になるダンジョン (shopItemGroup +0x04)" onChange={(e) => set({ dungeon: Number(e.target.value) })}>
        {Array.from({ length: rows }, (_, d) => <option key={d} value={d}>{d === 0 ? '0. (最初の段階)' : `${d}. ${dungeonName(d)}`}</option>)}
      </select>
      <span>の進み具合 =</span>
      <NumberInput value={c.progress} min={0} max={0xffff} title={PROGRESS_HELP} onCommit={(v) => set({ progress: v })} />
      <InfoTip text={PROGRESS_HELP} />
      {changed && <button className="small" onClick={() => set(was)}>条件を元に戻す</button>}
    </div>
  );
}
