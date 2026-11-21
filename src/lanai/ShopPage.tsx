// RPG FREE!'s shops (#/shops/<content>[.<Shop row>]): the shops of one content (its Shop and ShopItem tables, shops.ts)
// in the shop book shared with RPG2 / RPG3 (ui/ShopBook): the stock as item boards with their photos, reordered by
// dragging, picked from the item photos, the most one can buy per row; and the clerks (EventObject rows of type 店の人 /
// 範囲に入ると店, whose second argument names the shop) with the maps that place them, linked to the map page with the
// record selected and to their lines. A shop can be added to a content (a Shop row and an empty stock) and removed again.
import { useMemo, useState, type ReactNode } from 'react';
import { EditedMark, NumberInput, useSticky } from '../ui/book';
import { GridPicker } from '../ui/GridPicker';
import { InfoTip } from '../ui/InfoTip';
import { ShopBook, type ShopBookShop, type ShopColumn } from '../ui/ShopBook';
import { useAsync } from '../ui/useAsync';
import { hex8, u32 } from '../util/bytes';
import { contentTitle, type LanaiContent } from './contents';
import { useLanaiContents } from './useContents';
import { lanaiItemHref } from './ItemPage';
import { lanaiShopHref, lanaiShopSharedHref } from './hrefs';
import { LANAI_ITEM_KINDS, lanaiItems, type LanaiItem } from './items';
import { lanaiMapHref } from './MapPage';
import { lanaiMaps, type LanaiMaps } from './maps';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiItemIcon, LanaiItemPicker } from './pickers';
import type { LanaiSession } from './session';
import {
  LANAI_SHARED_COUNTERS,
  LANAI_SHOP_ARG,
  LANAI_SHOP_SAVE_SHOPS,
  LANAI_SHOP_SLOTS,
  lanaiClerks,
  lanaiFreeSharedCounter,
  lanaiSharedCounterUses,
  lanaiInSlotPool,
  lanaiSetSlotPool,
  lanaiShopItemRow,
  lanaiShops,
  lanaiShopSlotItems,
  lanaiShopSlotKind,
  lanaiSlotKindItems,
  SHOP_COND,
  SHOP_COND_NUMBER,
  SHOP_COND_VALUE,
  SHOP_LIMIT,
  SHOP_PRICE,
  SHOP_SHARED_COUNTER,
  SHOP_SHARED_LIMIT,
  SHOP_SLOT,
  type LanaiContentShops,
  type LanaiSharedCounterUse,
  type LanaiShopRow,
} from './shops';

/** The page of the items a random slot of `kind` draws (the kind's pool). */
export const lanaiShopSlotHref = (kind: number): string => `#/shops/slot.${kind.toString(16)}`;

export { lanaiShopHref };

const LIMIT_HELP =
  '買える数の上限 (ShopItem +0x26。0 = 制限なし。買った数は店と並びの位置ごとに数えます)。+0x27 が 0 でない行は、+0x27 が上限で、買った数は +0x28 の番号ごと (同じ番号の行で共通) に数えます (naauao lanai/shops.md §2)。';
const POOL_HELP =
  '枠は、その種別のアイテムのうち ItemDataCore +0x30 の bit 0 が立っているものから 1 つを、毎日選び直します (一様。同じ店に固定の品としてあるものは除く)。候補を変えると、同じ種別のすべての店の枠が変わり、アイテム図鑑の ItemDataCore の変更として書き出されます。ほかの種別のアイテムは、アイテム図鑑で種別を変えないと加えられません。この bit を読むのはランダム枠の候補選びだけです (ほかの処理には影響しません)。候補は ItemData の行の順に最初の 300 個までです。';
const SLOT_HELP =
  'ランダム枠 (ShopItem +0x00 が種別、+0x25 が枠の番号)。店を開くと、その種別のアイテムから 1 つが選ばれます。選び直すのは日付が変わったとき。選ばれたアイテムはセーブに枠の番号ごとに残ります。枠の番号は 1〜99 (セーブの 0x97 は 100 個)。同じ番号の枠は、ほかの店にあっても種別が違っても同じアイテムになります (naauao lanai/shops.md §2.1)。';
const SHARED_HELP =
  '共通の上限 (ShopItem +0x27)。0 でなければ「買える数」(+0x26) より優先されます。買った数は右の番号 (+0x28) ごとにセーブ全体で 1 つ数え、同じ番号の行どうしで合算します (ほかの店も、ほかのステージの店も)。消えるのは新しいセーブのとき (推定) と、ゲームの配信で店の品が変わったときだけです。0 にすると上限は「買える数」に戻ります。買った数はセーブに 99 までしか記録されないので、100 以上の上限は 99 個買ったあとも残りが減らず、実質無制限になります。1 回に買える数は所持の上限 (ItemDataCore +0x34、ほぼ 99。所持数はコードで 99 に頭打ち) でも止まります。';
const COUNTER_HELP =
  '共通の上限の番号 (ShopItem +0x28)。買った数をセーブのこの番号に記録します (0〜199。セーブの 0x9A はゲーム全体で 1 つ)。ほかのステージの店と同じ番号にすると、買った数を共有します。ROM で使われているのはコンテンツ 0 の 1〜6・13〜19・24 と、コンテンツ 97 の 101〜156 の一部。「空き」で、どの店も使っていない番号を入れます。200 以上にすると記録されず、店に入るたびに上限まで買えます。';
/** The contents whose ROM shops use shared limits (the others are read when asked). */
const SHARED_CONTENTS = [0, 97];
const COND_HELP =
  '陳列の条件 (ShopItem +0x10 が種類、+0x08 が番号、+0x0C が比べる値)。条件を満たさないと品物は並びません。';

const isItem = (v: number): boolean => v >= 0x80000000;

const slotKindName = (k: number): string => LANAI_ITEM_KINDS[k] ?? `種別 0x${k.toString(16)}`;

/** The kinds a new random slot can draw (the kinds of the item book; 0x56 is drawn as 0x55). */
const SLOT_KINDS = Object.keys(LANAI_ITEM_KINDS)
  .map(Number)
  .filter((k) => k !== 0x56);

/** A display condition (ShopItem +0x10 / +0x08 / +0x0C), as words. */
function conditionText(b: Uint8Array): string {
  const type = b[SHOP_COND]!;
  const n = u32(b, SHOP_COND_NUMBER);
  const v = u32(b, SHOP_COND_VALUE);
  switch (type) {
    case 0:
      return '';
    case 1:
      return `フラグ ${n} が立っている`;
    case 2:
      return `フラグ ${n} が立っていない`;
    case 3:
      return `スイッチ ${n} が真 (推定)`;
    case 4:
      return `スイッチ ${n} が偽 (推定)`;
    case 5:
      return `値 ${n} が ${v}`;
    default:
      return `種類 0x${type.toString(16)} (${n}, ${v}) 未解析`;
  }
}
const CLERK_HELP =
  '動作の型 0x80000032 (店の人) と 0x80000033 (範囲に入ると店) の EventObject の行。台詞のあと、引数 2 が名指す店 (このコンテンツの Shop の行番号か行 ID。ない行は行 0) を開きます。マップのページの「動作・報酬」の引数 2 で店を選べます。';
const ADD_HELP =
  'このステージに店を足します (Shop の行 0 を写した行と、品のない品揃え)。開くには、マップに店の人を置き、その引数 2 でこの店を選びます。足した店は最後のものから消せます (ROM にある店は消せません)。';

export function LanaiShopPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const slot = /^slot\.([0-9a-f]+)$/i.exec(arg ?? '');
  const shared = /^shared(?:\.(\d+))?$/.exec(arg ?? '');
  return shared ? (
    <SharedLimitPage session={session} counter={shared[1] === undefined ? undefined : Number(shared[1])} />
  ) : slot ? (
    <SlotKindPage session={session} kind={parseInt(slot[1]!, 16)} />
  ) : (
    <ShopsPage session={session} arg={arg} />
  );
}

function ShopsPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useLanaiContents(session);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(arg ?? '');
  const index = useSticky<number>(
    m ? Number(m[1]) : undefined,
    (i) => i < contents.length,
    () => 0,
  );
  const content = contents[index]!;
  const shops = useAsync(() => lanaiShops(session, content), [session, content]);
  const side = <ContentSelect contents={contents} content={content} />;
  if (!shops || shops instanceof Error)
    return (
      <div className="book">
        <div className="book-side">
          {side}
          <p className={shops instanceof Error ? 'error' : 'muted'}>
            {shops instanceof Error
              ? shops.message
              : shops === null
                ? 'このコンテンツには Shop / ShopItem の表がありません。'
                : 'アーカイブを読み込み中…'}
          </p>
        </div>
      </div>
    );
  return <ShopList key={content.index} session={session} shops={shops} side={side} arg={m?.[2]} />;
}

function ContentSelect({ contents, content }: { contents: LanaiContent[]; content: LanaiContent }): ReactNode {
  return (
    <div className="row">
      <select
        value={content.index}
        title="店の表を読むコンテンツ"
        onChange={(e) => (location.hash = lanaiShopHref(Number(e.target.value)))}
      >
        {contents.map((c) => (
          <option key={c.index} value={c.index}>{`${c.index}. ${contentTitle(c)}`}</option>
        ))}
      </select>
      <a className="small" href={lanaiShopSharedHref()}>
        共通の上限の番号
      </a>
    </div>
  );
}

function ShopList({
  session,
  shops,
  side,
  arg,
}: {
  session: LanaiSession;
  shops: LanaiContentShops;
  side: ReactNode;
  arg: string | undefined;
}): ReactNode {
  const revision = useLanaiRevision(session);
  const contents = useLanaiContents(session);
  const { content } = shops;
  const items = useMemo(() => new Map(lanaiItems(session).map((it) => [it.id, it])), [session, revision]);
  const data = session.need('ItemData');
  const maps = useAsync(() => lanaiMaps(session, content), [session, content]);
  const clerks = useMemo(
    () => (maps && !(maps instanceof Error) ? lanaiClerks(maps, shops) : null),
    [maps, shops, revision],
  );
  // the rows of the ROM's shared limits in other contents (their numbers are shared with this content's)
  const sharedElsewhere = useAsync(
    () =>
      lanaiSharedCounterUses(
        session,
        SHARED_CONTENTS.filter((i) => i !== content.index && i < contents.length).map((i) => contents[i]!),
      ),
    [session, content, contents, revision],
  );
  const freeCounter = async (shop: number, i: number): Promise<void> => {
    const n = lanaiFreeSharedCounter(await lanaiSharedCounterUses(session, contents));
    if (n > 0) setRow(shop, i, (b) => (b[SHOP_SHARED_COUNTER] = n));
  };
  const addShop = (): void => {
    const row = shops.addShop(0);
    session.edited();
    location.hash = lanaiShopHref(content.index, row);
  };
  const removeShop = (shop: number): void => {
    // the clerks that opened it open shop 0 again
    if (maps && !(maps instanceof Error))
      for (const c of clerks ?? [])
        if (c.shop === shop) maps.eventTable(c.group)!.setU32(c.event, c.action + LANAI_SHOP_ARG, 0);
    shops.removeShop(shop);
    session.edited();
    location.hash = lanaiShopHref(content.index, Math.max(0, shop - 1));
  };
  // the random slots offered in the item picker (a kind; the pick is its negative)
  // (kinds with no candidate are left out: a slot of one draws nothing; the search also finds a slot by its items' names)
  const slotChoices = useMemo(
    () =>
      SLOT_KINDS.flatMap((k) => {
        const pool = lanaiShopSlotItems(session, k);
        if (!pool.length) return [];
        const names = pool.map((it) => it.name);
        return [
          {
            value: -k,
            label: `ランダム枠: ${LANAI_ITEM_KINDS[k]}`,
            sub: `${pool.length} 個から`,
            icon: <span className="photo photo-lg item-badge item-kind-0">?</span>,
            title: `${names.slice(0, 40).join('、')}${names.length > 40 ? ' …' : ''}`,
            keywords: `ランダム ${names.join(' ')}`,
          },
        ];
      }),
    [session, revision],
  );
  const book: ShopBookShop[] = shops.shops.map((s) => ({
    id: s.row,
    label: `店 ${s.row}${shops.added(s.row) ? ' (追加)' : ''}`,
  }));
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
      {
        head: '分類',
        className: 'muted nowrap',
        cell: (r) => {
          const it = items.get(r.item);
          return it ? (LANAI_ITEM_KINDS[it.kind] ?? `0x${it.kind.toString(16)}`) : '';
        },
      },
      {
        head: '買値',
        className: 'num',
        cell: (r) => {
          const it = items.get(r.item);
          return it ? `${it.buy} G` : '';
        },
      },
      {
        head: '買える数',
        className: 'num',
        cell: (r, i) =>
          editable ? (
            <NumberInput
              value={r.bytes[SHOP_LIMIT]!}
              min={0}
              max={255}
              title={LIMIT_HELP}
              onCommit={(v) => setRow(s.id, i, (b) => (b[SHOP_LIMIT] = v))}
            />
          ) : (
            r.bytes[SHOP_LIMIT] || ''
          ),
      },
      ...(editable || all.some((r) => r.bytes[SHOP_SHARED_LIMIT])
        ? [
            {
              head: '共通の上限 (番号)',
              className: 'num nowrap',
              cell: (r: LanaiShopRow, i: number) =>
                editable ? (
                  <span className="shared-limit">
                    <NumberInput
                      value={r.bytes[SHOP_SHARED_LIMIT]!}
                      min={0}
                      max={255}
                      title={SHARED_HELP}
                      onCommit={(v) => setRow(s.id, i, (b) => (b[SHOP_SHARED_LIMIT] = v))}
                    />
                    <NumberInput
                      value={r.bytes[SHOP_SHARED_COUNTER]!}
                      min={0}
                      max={255}
                      title={COUNTER_HELP}
                      onCommit={(v) => setRow(s.id, i, (b) => (b[SHOP_SHARED_COUNTER] = v))}
                    />
                    <button
                      className="small"
                      title="どの店も使っていない番号を入れる (すべてのコンテンツの店を調べます)"
                      onClick={() => void freeCounter(s.id, i)}
                    >
                      空き
                    </button>
                    <a
                      className="small"
                      href={lanaiShopSharedHref(r.bytes[SHOP_SHARED_COUNTER]!)}
                      title="この番号を使う行"
                    >
                      →
                    </a>
                  </span>
                ) : r.bytes[SHOP_SHARED_LIMIT] ? (
                  <span title={SHARED_HELP}>{`${r.bytes[SHOP_SHARED_LIMIT]} (#${r.bytes[SHOP_SHARED_COUNTER]})`}</span>
                ) : (
                  ''
                ),
            },
          ]
        : []),
      ...(all.some((r) => r.bytes[SHOP_COND])
        ? [
            {
              head: '陳列の条件',
              className: 'muted small',
              cell: (r: LanaiShopRow) => <span title={COND_HELP}>{conditionText(r.bytes)}</span>,
            },
          ]
        : []),
      ...(all.some((r) => lanaiShopSlotKind(r.bytes) >= 0)
        ? [
            {
              head: '枠',
              className: 'num',
              cell: (r: LanaiShopRow, i: number) =>
                lanaiShopSlotKind(r.bytes) < 0 ? (
                  ''
                ) : editable ? (
                  <NumberInput
                    value={r.bytes[SHOP_SLOT]!}
                    min={1}
                    max={255}
                    title={SLOT_HELP}
                    onCommit={(v) => setRow(s.id, i, (b) => (b[SHOP_SLOT] = v))}
                  />
                ) : (
                  <span title={SLOT_HELP}>{`#${r.bytes[SHOP_SLOT]}`}</span>
                ),
            },
          ]
        : []),
      ...(all.some((r) => u32(r.bytes, SHOP_PRICE))
        ? [
            {
              head: '+0x04',
              className: 'num muted',
              cell: (r: LanaiShopRow) => (
                <span title="値段の欄と推定 (値段を求める処理に渡される)。">{u32(r.bytes, SHOP_PRICE) || ''}</span>
              ),
            },
          ]
        : []),
    ];
  };
  return (
    <ShopBook<LanaiShopRow>
      shops={book}
      arg={arg}
      href={(id) => lanaiShopHref(content.index, id)}
      side={
        <>
          {side}
          <div className="row">
            <button onClick={addShop}>＋ 店を追加</button>
            <InfoTip text={ADD_HELP} />
          </div>
        </>
      }
      rows={(s) => shops.rows(s.id)}
      original={(s) => shops.originalRows(s.id)}
      same={(a, b) => a.item === b.item && a.bytes.every((x, i) => x === b.bytes[i])}
      newRow={(s, item) => shops.newRow(s.id, item)}
      replaceItem={(r, item) => {
        const slot = lanaiShopSlotKind(r.bytes) >= 0;
        // a random slot that becomes an item is a plain row (no slot, no condition of the template)
        if (slot && isItem(item)) return { item, bytes: lanaiShopItemRow(r.bytes, item) };
        const b = r.bytes.slice();
        new DataView(b.buffer).setUint32(0, item >>> 0, true);
        // an item that becomes a random slot gets a slot number of its own; a slot of another kind keeps its number
        if (!isItem(item) && !slot) b[SHOP_SLOT] = shops.nextSlot();
        return { item, bytes: b };
      }}
      item={(id) => {
        if (id === 0)
          return { name: '(アイテム 0 の行)', icon: <span className="photo item-badge item-kind-0">–</span> };
        if (id < 0x80000000) {
          const kind = id & 0xff;
          const pool = lanaiShopSlotItems(session, kind);
          const names = pool.map((it) => it.name);
          return {
            many: true,
            href: lanaiShopSlotHref(kind),
            name: `ランダム枠: ${slotKindName(kind)} (${pool.length} 個から)`,
            icon: (
              <span
                className="photo item-badge item-kind-0"
                title={`${SLOT_HELP}\n${names.slice(0, 40).join('、')}${names.length > 40 ? ' …' : ''}`}
              >
                ?
              </span>
            ),
          };
        }
        const it = items.get(id);
        return (
          it && {
            name: it.name,
            href: lanaiItemHref(it.row),
            icon: lanaiItemIcon(session, it.row, it.name),
            changed: session.need('ItemDataCore').rowChanged(it.core),
          }
        );
      }}
      columns={columns}
      setRows={(s, rows) => {
        if (!shops.editable(s.id)) return;
        shops.set(s.id, rows);
        session.edited();
      }}
      picker={(p) => (
        <LanaiItemPicker
          session={session}
          current={0}
          title={p.title}
          choices={slotChoices}
          choicesLabel="ランダム枠 (店を開くと、その種別の候補から 1 つが並ぶ)"
          onClose={p.onClose}
          onPick={(row) => p.onPick(row < 0 ? -row : data.rowId(row))}
        />
      )}
      sub={(s) => {
        const n = clerks?.filter((c) => c.shop === s.id).length ?? 0;
        return `${shops.rows(s.id).length} 品${n ? `・店の人 ${n}` : ''}`;
      }}
      warnings={(s, rows) => {
        const w: string[] = [];
        if (!shops.editable(s.id))
          w.push(
            `Shop +0x00 (${hex8(shops.headRef(s.id)).toUpperCase()}) が ShopItem の頭の行を指していないので、品揃えは編集できません。`,
          );
        if (!rows.length) w.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
        if (rows.length > shops.originalMax)
          w.push(
            `このコンテンツで一番多い店は ${shops.originalMax} 品です。それを超える数はゲームで確かめていません。`,
          );
        if (rows.some((r) => items.get(r.item)?.buy === 0)) w.push('買値 0 のアイテムがあります (タダで買えます)。');
        const slots = rows.filter((r) => lanaiShopSlotKind(r.bytes) >= 0).map((r) => r.bytes[SHOP_SLOT]!);
        if (slots.some((n) => n > LANAI_SHOP_SLOTS))
          w.push(`枠の番号が ${LANAI_SHOP_SLOTS} を超えています (セーブに残らず、店を開くたびに選び直されます)。`);
        const others = shops.shops
          .filter((x) => x.row !== s.id)
          .flatMap((x) => shops.rows(x.row))
          .filter((r) => lanaiShopSlotKind(r.bytes) >= 0)
          .map((r) => r.bytes[SHOP_SLOT]!);
        const dup = [...new Set(slots.filter((n, i) => slots.indexOf(n) !== i || others.includes(n)))];
        if (dup.length)
          w.push(
            `同じ番号の枠があります (${dup.map((n) => `#${n}`).join('、')})。同じ番号の枠には同じアイテムが並びます。`,
          );
        if (sharedElsewhere && !(sharedElsewhere instanceof Error)) {
          const mine = new Set(
            rows.filter((r) => r.bytes[SHOP_SHARED_LIMIT]).map((r) => r.bytes[SHOP_SHARED_COUNTER]!),
          );
          const hits = sharedElsewhere.filter((u) => mine.has(u.counter));
          const nums = [...new Set(hits.map((u) => u.counter))];
          const where = [...new Set(hits.map((u) => `コンテンツ ${u.content} の店 ${u.shop}`))];
          if (nums.length)
            w.push(
              `共通の上限の番号 ${nums.map((n) => `#${n}`).join('、')} は、ほかのステージの店 (${where.slice(0, 3).join('、')}${where.length > 3 ? ' ほか' : ''}) も使っています。買った数を共有するので、別の番号 (「空き」) にしてください。`,
            );
        }
        if (rows.some((r) => r.bytes[SHOP_SHARED_LIMIT]! > 99))
          w.push('共通の上限が 99 を超えています (99 個買ったあとは残りが減らず、実質無制限です)。');
        if (rows.some((r) => r.bytes[SHOP_SHARED_LIMIT] && r.bytes[SHOP_SHARED_COUNTER]! >= 200))
          w.push('共通の上限の番号が 200 以上の行は、買った数が記録されません (店に入るたびに上限まで買えます)。');
        if (s.id >= LANAI_SHOP_SAVE_SHOPS && rows.some((r) => !r.bytes[SHOP_SHARED_LIMIT] && r.bytes[SHOP_LIMIT]))
          w.push(
            s.id === LANAI_SHOP_SAVE_SHOPS
              ? `店 ${s.id} の「買える数」は買った数がセーブに記録されません (記録は店 0〜${LANAI_SHOP_SAVE_SHOPS - 1} だけ)。共通の上限を使ってください。`
              : `店 ${s.id} の「買える数」は、買った数を店 ${s.id % LANAI_SHOP_SAVE_SHOPS} と同じ場所に記録します (セーブの記録は店 0〜${LANAI_SHOP_SAVE_SHOPS - 1} だけ)。共通の上限を使ってください。`,
          );
        if (rows.some((r, i) => i >= 50 && !r.bytes[SHOP_SHARED_LIMIT] && r.bytes[SHOP_LIMIT]))
          w.push(
            '51 番目より後ろの品の「買える数」は数えられないので、買えなくなります (共通の上限を使ってください)。',
          );
        return w;
      }}
      exportNote={`変更はコンテンツ ${content.index} のアーカイブ (${content.archive}) の ShopItem に書き出されます。品数を変えると、後ろの店の行がずれ、その店の Shop +0x00 も書き換わります。`}
      stockNote={
        <>
          並びは店での表示順 (ShopItem)。買値はアイテムごと (アイテム図鑑の ItemDataCore)。
          <InfoTip text={`${LIMIT_HELP} ${SLOT_HELP} ${COND_HELP}`} />
        </>
      }
      info={(s) => (
        <span className="muted">{`Shop の行 ${s.id} (行 ID ${hex8(shops.shops[s.id]!.id).toUpperCase()})・品揃え ShopItem ${hex8(shops.headRef(s.id)).toUpperCase()}`}</span>
      )}
      places={(s) => (
        <Clerks
          session={session}
          maps={maps}
          clerks={clerks && clerks.filter((c) => c.shop === s.id)}
          content={content}
          multi={shops.shops.length > 1}
        />
      )}
      footer={(s) => {
        const t = shops.shopTable;
        const kinds = [
          ...new Set(
            shops
              .rows(s.id)
              .map((r) => lanaiShopSlotKind(r.bytes))
              .filter((k) => k >= 0),
          ),
        ];
        return (
          <>
            {kinds.length > 0 && <SlotPools session={session} kinds={kinds} rows={shops.rows(s.id)} />}
            {shops.added(s.id) && s.id === shops.shops.length - 1 && (
              <div className="row">
                <button className="danger" onClick={() => removeShop(s.id)}>
                  {`店 ${s.id} を消す`}
                </button>
                <span className="muted small">この店を開く店の人は店 0 を開くようになります。</span>
              </div>
            )}
            <div className="muted small mono">{`部屋 ${hex8(t.u32(s.id, 4)).toUpperCase()} / カメラ ${hex8(t.u32(s.id, 8)).toUpperCase()}・+0x0C ${t.u32(s.id, 0x0c)}・+0x10 ${hex8(t.u32(s.id, 0x10)).toUpperCase()}・+0x18 ${t.u8(s.id, 0x18)}・高さ ${t.u8(s.id, 0x19)} (未解析の欄は naauao lanai/shops.md §3)`}</div>
          </>
        );
      }}
    />
  );
}

/** The clerks of the shop (the content's 店の人 rows) and the maps that place them. */
function Clerks({
  session,
  maps,
  clerks,
  content,
  multi,
}: {
  session: LanaiSession;
  maps: LanaiMaps | Error | undefined;
  clerks: ReturnType<typeof lanaiClerks> | null;
  content: LanaiContent;
  multi: boolean;
}): ReactNode {
  const head = (
    <h3 className="with-info">
      店の人と場所
      <InfoTip text={CLERK_HELP} />
    </h3>
  );
  if (!maps)
    return (
      <>
        {head}
        <p className="muted small">マップを読み込み中…</p>
      </>
    );
  if (maps instanceof Error)
    return (
      <>
        {head}
        <p className="muted small">{`マップを読めませんでした: ${maps.message}`}</p>
      </>
    );
  if (!clerks?.length)
    return (
      <>
        {head}
        <p className="muted small">
          この店を開く店の人 (型 0x32 / 0x33) は、このコンテンツのマップにいません。
          {multi && ' 島の店・釣り具の店などは CRO のスクリプトやメニューから開きます。'}{' '}
          <a href={lanaiMapHref(content.index)}>マップのページ</a>
          のパーツ「店の人」を置き、開く店にこの店を選ぶと開けます。
        </p>
      </>
    );
  return (
    <>
      {head}
      <table className="enc-table">
        <thead>
          <tr>
            <th>EventObject</th>
            <th>台詞</th>
            <th>マップ</th>
          </tr>
        </thead>
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
                  {ref && row >= 0 ? (
                    <a
                      href={`#/talks/${ref.archive}:${hex8(ref.entry).toUpperCase()}:${row}`}
                      title="セリフのページで開く"
                    >
                      {line.split('\n')[0] || `行 ${row}`}
                    </a>
                  ) : (
                    <span className="muted">{`台詞の行 ${hex8(c.talk)}`}</span>
                  )}
                </td>
                <td>
                  {c.places.length ? (
                    c.places.map((p, i) => (
                      <span key={i}>
                        {i > 0 && '、'}
                        <a
                          href={lanaiMapHref(content.index, p.map, p)}
                          title="マップのページでこのキャラを選ぶ"
                        >{`${p.map} (区画 ${p.section} #${p.index})`}</a>
                      </span>
                    ))
                  ) : (
                    <span className="muted">置いているマップなし</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/**
 * The pools of the random slots of a shop, one per kind: the items a slot draws from (each as likely), with × to take
 * one out and ＋ to put one of the kind in (ItemDataCore +0x30 bit 0, shared by every slot of the kind in every shop).
 */
function SlotPools({
  session,
  kinds,
  rows,
  heading = true,
}: {
  session: LanaiSession;
  kinds: number[];
  rows: LanaiShopRow[];
  heading?: boolean;
}): ReactNode {
  useLanaiRevision(session);
  const [adding, setAdding] = useState<number | null>(null);
  const set = (it: LanaiItem, on: boolean): void => {
    lanaiSetSlotPool(session, it, on);
    session.edited();
  };
  const core = session.need('ItemDataCore');
  return (
    <div className="slot-pools">
      {heading && (
        <h3>
          ランダム枠の候補 <InfoTip text={POOL_HELP} />
        </h3>
      )}
      {kinds.map((k) => {
        const pool = lanaiShopSlotItems(session, k);
        const fixed = new Set(rows.map((r) => r.item));
        const draws = pool.filter((it) => !fixed.has(it.id));
        const slots = rows.filter((r) => lanaiShopSlotKind(r.bytes) === k).map((r) => `#${r.bytes[SHOP_SLOT]}`);
        return (
          <div key={k} className="slot-pool">
            <div className="row">
              {heading ? (
                <a href={lanaiShopSlotHref(k)}>
                  <strong>{slotKindName(k)}</strong>
                </a>
              ) : (
                <strong>{slotKindName(k)}</strong>
              )}
              <span className="muted small">{`${slots.length ? `枠 ${slots.join('・')}・この店では ` : ''}${draws.length} 個から 1 つ (各 ${draws.length ? Math.round(1000 / draws.length) / 10 : 0}%)${draws.length > 300 ? '・300 個を超えた分は選ばれません' : ''}`}</span>
            </div>
            <div className="loot">
              {pool.map((it, n) => (
                <div
                  key={it.row}
                  className={`loot-row${fixed.has(it.id) || n >= 300 ? ' muted' : ''}`}
                  title={n >= 300 ? '300 個を超えた分なので選ばれません' : undefined}
                >
                  <span className="loot-item">
                    <a
                      className="loot-item"
                      href={lanaiItemHref(it.row)}
                      title={fixed.has(it.id) ? 'この店に固定の品としてあるので、この店の枠では選ばれません' : it.name}
                    >
                      {lanaiItemIcon(session, it.row, it.name)}
                      {it.name}
                      {core.rowChanged(it.core) && <EditedMark text=" ●" title="アイテム図鑑で変更した" />}
                    </a>
                  </span>
                  <button
                    className="danger"
                    title="候補から外す (この種別のすべての枠から)"
                    onClick={() => set(it, false)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {!pool.length && <div className="muted">候補がありません (枠に何も出ないおそれがあります)。</div>}
              <button className="loot-add" onClick={() => setAdding(k)}>
                ＋ 追加
              </button>
            </div>
            {!heading &&
              (() => {
                const out = lanaiSlotKindItems(session, k).filter((it) => !lanaiInSlotPool(session, it));
                return (
                  out.length > 0 && (
                    <>
                      <h4>{`同じ種別で候補に入っていないアイテム (${out.length} 個)`}</h4>
                      <div className="loot">
                        {out.map((it) => (
                          <div key={it.row} className="loot-row">
                            <span className="loot-item">
                              <a className="loot-item" href={lanaiItemHref(it.row)}>
                                {lanaiItemIcon(session, it.row, it.name)}
                                {it.name}
                              </a>
                            </span>
                            <button title="候補に入れる" onClick={() => set(it, true)}>
                              ＋
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                );
              })()}
          </div>
        );
      })}
      {adding !== null && (
        <GridPicker
          title={`${LANAI_ITEM_KINDS[adding] ?? ''} の候補に加えるアイテムを選ぶ`}
          entries={lanaiSlotKindItems(session, adding)
            .filter((it) => !lanaiInSlotPool(session, it))
            .map((it) => ({
              id: it.row,
              name: it.name,
              sub: `#${it.row}`,
              icon: lanaiItemIcon(session, it.row, it.name, true),
            }))}
          onClose={() => setAdding(null)}
          onPick={(row) => {
            const it = lanaiItems(session).find((x) => x.row === row);
            setAdding(null);
            if (it) set(it, true);
          }}
        />
      )}
    </div>
  );
}

/** Numbers as ranges (6〜12、20). */
function rangesText(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    out.push(i === j ? `${ns[i]}` : `${ns[i]}〜${ns[j]}`);
    i = j + 1;
  }
  return out.join('、');
}

/**
 * The numbers of the shared limits (#/shops/shared[.<number>]): the rows of each number (ShopItem +0x28) in the shops of
 * the contents that use them in the ROM (0 and 97), or of every content when asked, and the numbers no row uses.
 */
function SharedLimitPage({ session, counter }: { session: LanaiSession; counter: number | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const contents = useLanaiContents(session);
  const [all, setAll] = useState(false);
  const uses = useAsync(
    () =>
      lanaiSharedCounterUses(
        session,
        all ? contents : SHARED_CONTENTS.filter((i) => i < contents.length).map((i) => contents[i]!),
      ),
    [session, contents, all, revision],
  );
  const items = useMemo(() => new Map(lanaiItems(session).map((it) => [it.id, it])), [session, revision]);
  const groups = useMemo(() => {
    const m = new Map<number, LanaiSharedCounterUse[]>();
    if (uses && !(uses instanceof Error)) for (const u of uses) m.set(u.counter, [...(m.get(u.counter) ?? []), u]);
    return m;
  }, [uses]);
  const free = [...Array(LANAI_SHARED_COUNTERS).keys()].filter((n) => n > 0 && !groups.has(n));
  return (
    <div className="book">
      <div className="book-side">
        <div className="row">
          <a href={lanaiShopHref(0)}>← ショップ</a>
        </div>
        <p className="muted small">{COUNTER_HELP}</p>
      </div>
      <div className="book-detail">
        <div className="book-head">
          <h2>共通の上限の番号</h2>
          <span className="muted">ShopItem +0x27 (上限) / +0x28 (番号)・セーブの 0x9A</span>
        </div>
        <p className="muted small">{SHARED_HELP}</p>
        {uses === undefined ? (
          <p className="muted">読み込み中…</p>
        ) : uses instanceof Error ? (
          <p className="error">{uses.message}</p>
        ) : (
          <>
            <p>
              <strong>どの店も使っていない番号: </strong>
              {free.length ? rangesText(free) : 'なし'}
              <span className="muted small">
                {all ? ' (すべてのコンテンツ)' : ` (コンテンツ ${SHARED_CONTENTS.join('・')} の店を調べた範囲)`}
              </span>
            </p>
            <table className="enc-table">
              <thead>
                <tr>
                  <th>番号</th>
                  <th>店</th>
                  <th>品</th>
                  <th>上限</th>
                </tr>
              </thead>
              <tbody>
                {[...groups].flatMap(([n, list]) =>
                  list.map((u, k) => {
                    const it = items.get(u.item);
                    return (
                      <tr key={`${n}.${u.content}.${u.shop}.${u.index}`} className={n === counter ? 'active' : ''}>
                        {k === 0 && (
                          <td className="num" rowSpan={list.length}>
                            {n >= LANAI_SHARED_COUNTERS ? `${n} (記録されない)` : n}
                          </td>
                        )}
                        <td>
                          <a href={lanaiShopHref(u.content, u.shop)}>
                            {`${u.content}. ${contentTitle(contents[u.content]!)} の店 ${u.shop}`}
                          </a>
                          <span className="muted small">{` ${u.index + 1} 番目`}</span>
                        </td>
                        <td>{it ? it.name : hex8(u.item).toUpperCase()}</td>
                        <td className="num">{u.limit || <span className="muted">0 (番号だけ)</span>}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
            {counter !== undefined && !groups.has(counter) && (
              <p className="muted">{`番号 ${counter} を使う行はありません${all ? '' : ' (調べた範囲)'}。`}</p>
            )}
          </>
        )}
        {!all && <button onClick={() => setAll(true)}>すべてのコンテンツの店を調べる</button>}
      </div>
    </div>
  );
}

/**
 * The page of a random slot's kind (#/shops/slot.<kind>): the items its slots draw from, edited as in a shop, and the
 * slots of the shops that draw from it. The pool is not a table of its own: it is the items of the kind with
 * ItemDataCore +0x30 bit 0, so a new pool needs a kind the items have.
 */
function SlotKindPage({ session, kind }: { session: LanaiSession; kind: number }): ReactNode {
  const revision = useLanaiRevision(session);
  const contents = useLanaiContents(session);
  const [all, setAll] = useState(false);
  // the shops of content 0 (the ROM's slots are there), or of every content when asked
  const users = useAsync(async () => {
    const out: { content: number; shop: number; slot: number; index: number }[] = [];
    for (const c of all ? contents : contents.slice(0, 1)) {
      const s = await lanaiShops(session, c);
      for (const sh of s?.shops ?? [])
        s!.rows(sh.row).forEach((r, index) => {
          if (lanaiShopSlotKind(r.bytes) === kind || (kind === 0x55 && lanaiShopSlotKind(r.bytes) === 0x56))
            out.push({ content: c.index, shop: sh.row, slot: r.bytes[SHOP_SLOT]!, index });
        });
    }
    return out;
  }, [session, contents, all, revision]);
  const kinds = useMemo(
    () => SLOT_KINDS.map((k) => ({ k, n: lanaiShopSlotItems(session, k).length })),
    [session, revision],
  );
  return (
    <div className="book">
      <div className="book-side">
        <div className="row">
          <a href={lanaiShopHref(0)}>← ショップ</a>
        </div>
        <div className="book-list">
          <table className="book-table">
            <thead>
              <tr>
                <th>種別</th>
                <th>ランダム枠の候補</th>
                <th>数</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map(({ k, n }) => (
                <tr
                  key={k}
                  className={k === kind ? 'active' : n ? '' : 'muted'}
                  onClick={() => (location.hash = lanaiShopSlotHref(k))}
                >
                  <td className="num muted">{`0x${k.toString(16)}`}</td>
                  <td>{slotKindName(k)}</td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        <div className="book-head">
          <h2>{`ランダム枠: ${slotKindName(kind)}`}</h2>
          <span className="muted">{`種別 0x${kind.toString(16)} (ItemDataCore +0x32)`}</span>
        </div>
        <p className="muted small">{POOL_HELP}</p>
        <SlotPools session={session} kinds={[kind]} rows={[]} heading={false} />
        <h3>この候補から選ぶ枠</h3>
        {users === undefined ? (
          <p className="muted">読み込み中…</p>
        ) : users instanceof Error ? (
          <p className="error">{users.message}</p>
        ) : users.length ? (
          <ul>
            {users.map((u) => (
              <li key={`${u.content}.${u.shop}.${u.index}`}>
                <a
                  href={lanaiShopHref(u.content, u.shop)}
                >{`${u.content}. ${contentTitle(contents[u.content]!)} の店 ${u.shop}`}</a>
                <span className="muted">{` ${u.index + 1} 番目・枠 #${u.slot}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{all ? 'どの店にもありません。' : 'コンテンツ 0 の店にはありません。'}</p>
        )}
        {!all && <button onClick={() => setAll(true)}>すべてのコンテンツの店を調べる</button>}
      </div>
    </div>
  );
}
