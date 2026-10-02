// RPG3's item book (#/items/<ID>): every item of itemData with its category and prices; the name and descriptions,
// prices, ☆, limit, a tool's action and an equipment's effects are edited, and an item can be copied as a new one.
// The photo and the 3D view are the item's BCH model (itemModels.ts); a badge of the category when it has none.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fieldRange, field, type FieldContext } from '../game/tabledef';
import { Count, EditedMark, ListFilter, NumberInput, TextBox, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ModelView } from '../ui/ModelView';
import { useAsync } from '../ui/useAsync';
import { RowFields } from '../ui/RowFields';
import { hex8 } from '../util/bytes';
import { textureUrl, type OahuItemModels } from './itemModels';
import { OAHU_ITEM_FILE, type OahuItem, type OahuItemNumber, type OahuItems } from './items';
import type { OahuSession } from './session';
import { OAHU_EFFECT_KINDS, OAHU_EFFECT_SUBS, OAHU_EQUIP_EFFECTS, OAHU_ITEM_DATA, OAHU_ITEM_KIND, OAHU_ITEM_TEXTS } from './tables';

export const oahuItemHref = (id: number): string => `#/items/${id}`;

/** The first letter of the main category (items without a model). */
export function ItemBadge({ item, className = 'photo' }: { item: OahuItem; className?: string }): ReactNode {
  const label = OAHU_ITEM_KIND[item.kind] ?? '?';
  return <span className={`${className} item-badge item-kind-${item.kind}`} title={item.category}>{label[0]}</span>;
}

/** The photo of an item's model (or its texture), made once it scrolls into view; the badge without one. */
export function ItemPhoto({ models, item, className = 'photo' }: { models: OahuItemModels; item: OahuItem; className?: string }): ReactNode {
  const box = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setUrl(undefined);
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      models.photo(item.model).then((u) => live && setUrl(u), () => live && setUrl(null));
    });
    io.observe(box.current!);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [models, item.model]);
  if (url === null) return <ItemBadge item={item} className={className} />;
  return (
    <span ref={box} className={className} title={item.category}>
      {url && <img src={url} alt="" />}
    </span>
  );
}

/** The 3D view of an item's model, or its texture (floors, walls, clothes patterns). */
function ItemModel({ models, it }: { models: OahuItemModels; it: OahuItem }): ReactNode {
  const m = useAsync(() => models.model(it.model), [models, it.model]);
  const where = it.model ? `モデル ${hex8(it.model)}` : 'モデルなし';
  if (m === undefined) return <div className="model-placeholder"><div className="muted small">{`${where} を読み込み中…`}</div></div>;
  if (m instanceof Error || m === null) {
    return (
      <div className="model-placeholder">
        <ItemBadge item={it} />
        <div className="muted small">{m instanceof Error ? `${where} を読めませんでした: ${m.message}` : it.model ? `${where} はどのアーカイブにも見つかりませんでした` : where}</div>
      </div>
    );
  }
  if (m.kind === 'texture') {
    return (
      <div className="model-placeholder item-texture">
        <img src={textureUrl(m.texture)} alt="" />
        <div className="muted small">{`${where} (${m.archive}) はテクスチャ ${m.texture.name} (${m.texture.width}×${m.texture.height}) のみ`}</div>
      </div>
    );
  }
  return (
    <div>
      <ModelView model={m.ref} name={it.name} />
      <div className="muted small">{`${where} (${m.archive})`}</div>
    </div>
  );
}

const PAGE = 300;

export function OahuItemPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { items } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const selected = useSticky(Number(arg) || undefined, (id) => !!items.item(id), () => items.items[0]?.id ?? 0);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const q = query.trim();
  const rows = useMemo(() => items.items.filter((it) => {
    if (q && !it.text.includes(q) && String(it.id) !== q) return false;
    if (filter.startsWith('k')) return it.kind === Number(filter.slice(1));
    if (filter === 'changed') return items.changed(it.id);
    return true;
  }), [items, q, filter, edits]);
  const it = items.item(selected);
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="名前・説明・ID で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべて'], ...Object.entries(OAHU_ITEM_KIND).map(([k, v]): [string, string] => [`k${k}`, v]), ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={items.items.length} />
          <table className="book-table">
            <thead><tr><th></th><th>ID</th><th>名前</th><th>分類</th><th>買値</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((x) => (
                <tr key={x.id} className={x.id === selected ? 'active' : ''} onClick={() => (location.hash = oahuItemHref(x.id))}>
                  <td className="photo-cell"><ItemPhoto models={session.itemModels} item={x} /></td>
                  <td className="num muted">{x.id}</td>
                  <td>{x.name}{items.changed(x.id) && <EditedMark text=" ●" />}</td>
                  <td className="muted nowrap">{x.category}</td>
                  <td className="num">{x.price || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${rows.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {it && <ItemDetail key={it.id} session={session} it={it} onEdit={onEdit} />}
      </div>
    </div>
  );
}

function ItemDetail({ session, it, onEdit }: { session: OahuSession; it: OahuItem; onEdit: () => void }): ReactNode {
  const { items } = session;
  const context: FieldContext = { message: (id) => items.message(id), rowName: (table, row) => (table === 'actionData.bin' ? items.actionName(row).replace(/^#\d+ /, '') : undefined) };
  return (
    <>
      <div className="book-head">
        <h2>{it.name}</h2>
        <span className="muted">{`ID ${it.id}  ${it.category}`}</span>
      </div>
      <div className="book-top">
        <div>
          <TextEditor items={items} it={it} onEdit={onEdit} />
          <FieldEditor items={items} it={it} onEdit={onEdit} />
        </div>
        <ItemModel models={session.itemModels} it={it} />
      </div>
      <div className="row">
        <span className="muted small">変更はマスター (21350000) の itemData.bin とメッセージとして書き出されます。</span>
        {items.changed(it.id) && !items.added(it.id) && <button onClick={() => { items.revert(it.id); onEdit(); }}>このアイテムの変更を元に戻す</button>}
        <CopyButtons items={items} it={it} onEdit={onEdit} />
      </div>
      <details className="row-fields-box">
        <summary>{`itemData の行 ${it.id} のすべての欄`}</summary>
        <RowFields def={OAHU_ITEM_DATA} row={items.table.row(it.id)} original={items.added(it.id) ? undefined : session.master.originalRow(OAHU_ITEM_FILE, it.id)} context={context} />
      </details>
    </>
  );
}

const COPY_INFO = [
  'このアイテムを itemData の空きの行 (分類ごとの予約の行、なければ表の後ろの空き) に写して、新しいアイテムを作ります。',
  '名前と説明は同じ本文の新しいメッセージ (MessageSystemCommon の 8658 番から) になり、元と別に書き換えられます。',
  '並びの番号 (+0x30) は使われている最大 + 1 にします。',
  'RPG3 で、道具を使ったときに減るアイテムがどう決まるかはまだ確かめていません (RPG2 はアクションの +0x14)。写した道具は元と同じアクションを使います。',
].join('\n');

function CopyButtons({ items, it, onEdit }: { items: OahuItems; it: OahuItem; onEdit: () => void }): ReactNode {
  const can = items.canCopy(it.id);
  return (
    <>
      <span className="with-info">
        <button disabled={!can} title={can ? '' : '空きの行か、メッセージの空きがありません'} onClick={() => {
          const n = items.copyItem(it.id);
          onEdit();
          location.hash = oahuItemHref(n);
        }}>写して新しいアイテムを作る</button>
        <InfoTip text={COPY_INFO} />
      </span>
      {items.added(it.id) && (
        <button title="追加したアイテムを消して、空きの行に戻します" onClick={() => {
          items.removeItem(it.id);
          onEdit();
          location.hash = '#/items';
        }}>このアイテムを消す</button>
      )}
    </>
  );
}

/** The name and the description messages: text boxes in the editors' text form ({ruby:…} and tags). */
function TextEditor({ items, it, onEdit }: { items: OahuItems; it: OahuItem; onEdit: () => void }): ReactNode {
  const texts = items.texts;
  const box = (key: string, label: string, offset: number, multi: boolean): ReactNode => {
    const id = items.messageId(it.id, key);
    if (!id || !texts.units(id)) return null;
    return (
      <tr key={key}>
        <th title={`itemData +0x${offset.toString(16).toUpperCase()}、メッセージ ${id}`}>{label}</th>
        <td className="book-desc">
          {texts.editable(id) || texts.isAdded(id)
            ? <TextBox value={texts.text(id)?.text ?? ''} multi={multi} edited={texts.isEdited(id)} onCommit={(v) => { items.setText(it.id, key, v); onEdit(); }} />
            : <span>{items.message(id)}</span>}
        </td>
      </tr>
    );
  };
  return (
    <table className="enc-table desc-table">
      <tbody>
        {box('name', '名前', 0x14, false)}
        {OAHU_ITEM_TEXTS.map(([key, offset, label]) => box(key, label, offset, true))}
      </tbody>
    </table>
  );
}

/** Prices, ☆, limit, a tool's action and an equipment's effects. */
function FieldEditor({ items, it, onEdit }: { items: OahuItems; it: OahuItem; onEdit: () => void }): ReactNode {
  const added = items.added(it.id);
  const set = (key: OahuItemNumber, v: number): void => {
    items.set(it.id, key, v);
    onEdit();
  };
  const mark = (key: string): { className: string; title: string } => {
    const now = items.get(it.id, key);
    const was = items.original(it.id, key);
    return !added && now !== was ? { className: 'edited', title: `元の値 ${was}` } : { className: '', title: '' };
  };
  const number = (key: OahuItemNumber, shown = items.get(it.id, key), min = fieldRange(field(OAHU_ITEM_DATA, key))[0], max = fieldRange(field(OAHU_ITEM_DATA, key))[1]): ReactNode => {
    const m = mark(key);
    return <NumberInput value={shown} min={min} max={max} className={`num-input ${m.className}`} title={m.title} onCommit={(v) => set(key, v)} />;
  };
  const stat = (label: string, input: ReactNode, suffix = '', info?: string): ReactNode => (
    <label className="stat"><span className="muted">{label}{info && <InfoTip text={info} />}</span><span>{input}{suffix}</span></label>
  );
  const actions = useMemo(() => items.itemActions(), [items]);
  return (
    <div className="item-fields">
      <div className="stats">
        {stat('買値', number('price'), ' G')}
        {stat('売値', number('sell'), ' G')}
        {stat('☆', number('rarity'), '', 'フラグ (+0x10) の bit15-17 と推定 (RPG2 の ☆ と多くのアイテムで同じ)。')}
        {stat('上限', number('limit', it.limit, 1, 255), '', '持てる数 (+0x3F、0 は 99)。')}
      </div>
      {it.kind !== 3 && (
        <div className="model-line">
          {'アクション: '}
          <select className={mark('action').className} title={mark('action').title} value={it.action} onChange={(e) => set('action', Number(e.target.value))}>
            <option value={0}>なし</option>
            {!!it.action && !actions.some((a) => a.row === it.action) && <option value={it.action}>{items.actionName(it.action)}</option>}
            {actions.map((a) => <option key={a.row} value={a.row}>{a.label}</option>)}
          </select>
          <InfoTip text={'道具を使ったときのアクション (+0x34、actionData の行)。アイテムのアクション (種類 2) から選べます。たね・つりざおなどは別の意味の値です。'} />
        </div>
      )}
      {it.kind === 3 && <EquipEffects items={items} it={it} set={set} mark={mark} />}
    </div>
  );
}

const EQUIP_INFO = [
  '装備している間に付く効果です。1 つの装備に 2 つまで。',
  '効果 1 = 種類 +0x3B・対象 +0x3C・値 +0x34 (s16)、効果 2 = 種類 +0x3D・対象 +0x3E・値 +0x36 (s16)。',
  '種類は code.bin の対応表 (FUN_001A6348) で conditionData の状態に当たり、名前はその状態の名前です (名前が「なし」の状態は、持っている装備から付けた名前か「状態 番号」)。',
  '値の読み方 (足し算・%・付くかどうか) は、その状態の足し合わせ方 (conditionData +0x36) から。',
].join('\n');

function EquipEffects({ items, it, set, mark }: {
  items: OahuItems;
  it: OahuItem;
  set: (key: OahuItemNumber, v: number) => void;
  mark: (key: string) => { className: string; title: string };
}): ReactNode {
  const kinds = Array.from({ length: OAHU_EFFECT_KINDS + 1 }, (_, k) => k);
  return (
    <div className="model-line equip-effects">
      <div className="with-info">{'装備の効果'}<InfoTip text={EQUIP_INFO} /></div>
      {[1, 2].map((slot) => {
        const kindKey = `effect${slot}` as OahuItemNumber;
        const subKey = `effect${slot}Sub` as OahuItemNumber;
        const valueKey = `amount${slot}` as OahuItemNumber;
        const kind = items.get(it.id, kindKey);
        const sub = items.get(it.id, subKey);
        const value = items.get(it.id, valueKey);
        const def = OAHU_EQUIP_EFFECTS[kind];
        const subs = def?.sub ? OAHU_EFFECT_SUBS[def.sub] : undefined;
        const m = mark(valueKey);
        return (
          <div key={slot} className="equip-effect">
            <span className="muted">{`${slot}: `}</span>
            <select {...mark(kindKey)} value={kind} onChange={(e) => set(kindKey, Number(e.target.value))}>
              <option value={0}>なし</option>
              {kinds.slice(1).map((k) => <option key={k} value={k}>{`0x${k.toString(16).toUpperCase().padStart(2, '0')} ${OAHU_EQUIP_EFFECTS[k]?.label ?? ''}`}</option>)}
              {kind > OAHU_EFFECT_KINDS && <option value={kind}>{`0x${kind.toString(16).toUpperCase()}`}</option>}
            </select>
            {!!kind && (subs
              ? <select {...mark(subKey)} value={sub} onChange={(e) => set(subKey, Number(e.target.value))}>
                  {Object.entries(subs).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  {!(sub in subs) && <option value={sub}>{String(sub)}</option>}
                </select>
              : sub ? <span className="muted small">{`対象 ${sub}`}</span> : null)}
            {!!kind && <NumberInput value={value} min={-32768} max={32767} className={`num-input ${m.className}`} title={m.title} onCommit={(v) => set(valueKey, v)} />}
            {!!kind && <span className="muted">{items.effectText({ slot, kind, sub, value })}</span>}
          </div>
        );
      })}
    </div>
  );
}
