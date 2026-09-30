// Item book: every item with its category, prices, use effect, and where to get it (shops, chests,
// monster drops).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import type { EventTable } from '../game/events';
import type { Game } from '../game/game';
import { COMBINE, ITEM_CATEGORY, STATE_ACTION, MAX_LIMIT, MAX_RARITY, type Item, type ItemBook, type ItemFields } from '../game/items';
import { InfoTip } from '../ui/InfoTip';
import { dropClass, type MonsterBook } from '../game/monsters';
import { mapTitle } from '../game/names';
import { oneIn, pct } from './monsteredit';
import { LAYOUTS, recCellPos, type MapDoc } from '../game/sections';
import { hex8, u32 } from '../util/bytes';
import type { ModelRef } from './modelview';
import type { ItemData, Session } from '../session';
import { Count, EditedMark, ListFilter, NumberInput, useActiveRow, useEdits, useScrollTop, useSticky, type PageProps } from '../ui/book';
import { ModelView } from '../ui/ModelView';
import { Photo } from '../ui/Photo';
import { loadObjectModels, objKey } from '../cgfx/loader';
import { itemModelArchive } from '../game/items';
import { shopLabel } from '../game/shops';
import { shopHref } from './shops';

const CHEST_KINDS = new Set([0x0c, 0x0d, 0x0e]);

export interface ChestSource {
  map: MapInfo;
  x: number;
  y: number;
  /** treasureGroup row and the chance (%) of this item in it. */
  row: number;
  chance: number;
}

/** Item -> chests that can hold it (current map documents and event tables). */
export async function chestSources(game: Game, docOf: (m: MapInfo) => MapDoc, events: (d: number) => Promise<EventTable | null>): Promise<Map<number, ChestSource[]>> {
  const out = new Map<number, ChestSource[]>();
  const master = game.master;
  for (const m of game.editableMaps()) {
    const ev = await events(m.dungeon);
    if (!ev) continue;
    for (const rec of docOf(m).recs[4] ?? []) {
      const evRow = u32(rec.raw, 0);
      if (!ev.has(evRow) || !CHEST_KINDS.has(ev.kind(evRow))) continue;
      const row = ev.treasureRow(evRow);
      const slots = master.treasureSlots(row).filter((s) => s.item);
      const total = slots.reduce((a, s) => a + s.weight, 0);
      const [x, y] = recCellPos(rec, LAYOUTS[4]!);
      const seen = new Set<number>();
      for (const s of slots) {
        if (seen.has(s.item)) continue;
        seen.add(s.item);
        const w = slots.filter((o) => o.item === s.item).reduce((a, o) => a + o.weight, 0);
        out.set(s.item, [...(out.get(s.item) ?? []), { map: m, x: Math.floor(x), y: Math.floor(y), row, chance: total ? (w / total) * 100 : 0 }]);
      }
    }
  }
  return out;
}

/** Model of an item (itemData +0x20, an entry of one of the item model archives). */
export function itemRef(game: Game, it: Item): ModelRef | null {
  if (!it.model) return null;
  return {
    key: `item/${hex8(it.model)}`,
    load: async () => {
      const name = await itemModelArchive(game, it.model);
      if (!name) return null;
      const archive = parseInt(name, 16);
      const sets = await loadObjectModels(game, [{ archive, entry: it.model }]);
      const set = sets.get(objKey(archive, it.model));
      return set ? { set, hash: it.model } : null;
    },
  };
}

type Filter = string; // 'all' | 'c<category>' | 'shop' | 'chest' | 'drop' | 'changed'

export function ItemPage({ session, arg, visit, data }: PageProps & { data: ItemData }): ReactNode {
  const { game, book: monsters } = session;
  const { items } = data;
  const [, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [chests, setChests] = useState(new Map<number, ChestSource[]>());
  // Recomputed on every visit: the maps and the chests may have been edited.
  useEffect(() => {
    let live = true;
    chestSources(game, session.docOf, session.eventsOf).then((c) => live && setChests(c));
    return () => {
      live = false;
    };
  }, [game, session, visit]);
  const selected = useSticky(Number(arg) || undefined, (id) => !!items.item(id), () => items.items[0]?.id ?? 0);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const drops = (id: number): { row: number; name: string; rate: number }[] =>
    (monsters?.monsters ?? []).flatMap((m) => m.drops.filter((d) => d.item === id).map((d) => ({ row: m.row, name: m.name, rate: d.rate })));
  const onEdit = (): void => {
    session.scheduleSave();
    edited();
  };

  const matches = (it: Item): boolean => {
    const q = query.trim();
    if (q && !it.name.includes(q) && !it.description.includes(q) && !it.effect.includes(q)) return false;
    if (filter.startsWith('c')) return (it.categoryByte & 0xf) === Number(filter.slice(1));
    if (filter === 'shop') return it.shops.length > 0;
    if (filter === 'chest') return chests.has(it.id);
    if (filter === 'drop') return drops(it.id).length > 0;
    if (filter === 'changed') return items.changed(it.id);
    return true;
  };
  const rows = items.items.filter(matches);
  const it = items.item(selected);
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・説明・効果で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ...Object.entries(ITEM_CATEGORY).map(([k, v]): [string, string] => [`c${k}`, v]),
            ['shop', 'お店で買える'], ['chest', '宝箱から出る'], ['drop', 'モンスターが落とす'], ['changed', '変更した']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={items.items.length} />
          <table className="book-table">
            <thead><tr><th></th><th>ID</th><th>名前</th><th>分類</th><th>買値</th></tr></thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id} className={it.id === selected ? 'active' : ''} onClick={() => (location.hash = `#/items/${it.id}`)}>
                  <td className="photo-cell"><Photo model={itemRef(game, it)} /></td>
                  <td className="num muted">{it.id}</td>
                  <td>{it.name}{items.changed(it.id) && <EditedMark text=" ●" />}</td>
                  <td className="muted">{it.category}</td>
                  <td className="num">{it.price || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {it && <ItemDetail session={session} items={items} it={it} chests={chests.get(it.id) ?? []} drops={drops(it.id)} onEdit={onEdit} />}
      </div>
    </div>
  );
}

function ItemDetail({ session, items, it, chests, drops, onEdit }: {
  session: Session; items: ItemBook; it: Item; chests: ChestSource[]; drops: { row: number; name: string; rate: number }[]; onEdit: () => void;
}): ReactNode {
  const { game } = session;
  const changed = items.changed(it.id);
  return (
    <>
      <div className="book-head">
        <h2>{it.name}</h2>
        <span className="muted">{`ID ${it.id}  ${it.category} (0x${it.categoryByte.toString(16).padStart(2, '0').toUpperCase()})`}</span>
      </div>
      <div className="book-top">
        <div>
          <DescriptionTable it={it} />
          <FieldEditor items={items} it={it} onEdit={onEdit} />
        </div>
        <ModelView model={itemRef(game, it)} name={it.name} />
      </div>
      <div className="row">
        <span className="muted small">変更はマスター (56562135) の itemData.bin として書き出されます。</span>
        {changed && <button onClick={() => { items.revert(it.id); onEdit(); }}>このアイテムの変更を元に戻す</button>}
      </div>
      <div className="book-cols">
        <section>
          <h3>{`お店 (${it.shops.length})`}</h3>
          {it.shops.length
            ? <div>{it.shops.map((s, i) => <Fragment key={s}>{i ? '、' : ''}<a href={shopHref(s)}>{shopLabel(s)}</a></Fragment>)}</div>
            : <div className="muted">なし</div>}
        </section>
        <section>
          <h3>{`落とすモンスター (${drops.length})`}</h3>
          {drops.length
            ? <ul>{drops.map((d, i) => {
                const label = dropClass(d.rate)[1];
                const odds = session.book?.battle.dropOdds(d.rate);
                return (
                  <li key={i}>
                    <a href={`#/monsters/${d.row}`}>{d.name}</a>{' '}
                    <span className="muted" title={`率の値 ${d.rate}`}>{odds === undefined ? `(${label})` : `(${label}・${pct(odds)} = ${oneIn(odds)})`}</span>
                  </li>
                );
              })}</ul>
            : <div className="muted">なし</div>}
        </section>
      </div>
      <h3>{`宝箱 (${chests.length})`}</h3>
      {chests.length
        ? <table className="enc-table book-chests">
            <tbody>
              <tr><th>マップ</th><th>セル</th><th>中身の表</th><th>確率</th></tr>
              {chests.map((c, i) => (
                <tr key={i}>
                  <td><a href={`#/map/${c.map.name}`}>{mapTitle(c.map, game.code.maps, game.master)}</a></td>
                  <td className="muted">{`(${c.x}, ${c.y})`}</td>
                  <td className="num muted">{`#${c.row}`}</td>
                  <td className="num">{`${c.chance.toFixed(c.chance < 10 ? 1 : 0)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        : <div className="muted">なし (ダンジョンの宝箱のみ数えます)</div>}
    </>
  );
}

/** The message fields (+0x10..+0x1C), one row each; empty fields are left out. */
function DescriptionTable({ it }: { it: Item }): ReactNode {
  const rows = it.descriptions.filter((d) => d.text);
  if (!rows.length) return <p className="muted">説明はありません</p>;
  return (
    <table className="enc-table desc-table">
      <tbody>
        {rows.map((d) => (
          <tr key={d.offset}>
            <th title={`itemData +0x${d.offset.toString(16).toUpperCase()}、メッセージ ${d.id}`}>{d.label}</th>
            <td className="book-desc">{d.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Prices, stars, stack limit, use effect (tools) and the item that replaces it at the limit. */
function FieldEditor({ items, it, onEdit }: { items: ItemBook; it: Item; onEdit: () => void }): ReactNode {
  const orig = items.original(it.id);
  const set = (patch: Partial<ItemFields>): void => {
    items.set(it.id, patch);
    onEdit();
  };
  const mark = <K extends keyof ItemFields>(k: K, show: (v: ItemFields[K]) => string = String): { className: string; title: string } =>
    it[k] !== orig[k] ? { className: 'edited', title: `元の値 ${show(orig[k])}` } : { className: '', title: '' };
  const number = (k: 'price' | 'sell' | 'rarity' | 'limit', min: number, max: number): ReactNode => {
    const m = mark(k);
    return <NumberInput value={it[k]} min={min} max={max} className={`num-input ${m.className}`} title={m.title} onCommit={(v) => set({ [k]: v })} />;
  };
  const stat = (label: string, input: ReactNode, suffix = ''): ReactNode => (
    <label className="stat"><span className="muted">{label}</span><span>{input}{suffix}</span></label>
  );
  const choices = items.itemActions();
  const chainName = (id: number): string => (id ? items.item(id)?.name ?? `#${id}` : 'なし');
  return (
    <div className="item-fields">
      <div className="stats">
        {stat('買値', number('price', 0, 0xffffffff), ' G')}
        {stat('売値', number('sell', 0, 0xffffffff), ' G')}
        {stat('☆', number('rarity', 0, MAX_RARITY))}
        {stat('上限', number('limit', 1, MAX_LIMIT))}
      </div>
      {(it.categoryByte & 0xf) === 1 && (
        <div className="model-line">
          {'効果: '}
          <select {...mark('action', (v) => `#${v}`)} value={it.action} onChange={(e) => set({ action: Number(e.target.value) })}>
            <option value={0}>なし</option>
            {!!it.action && !choices.some((c) => c.row === it.action) && <option value={it.action}>{`#${it.action} (アイテム以外のアクション)`}</option>}
            {choices.map((c) => <option key={c.row} value={c.row}>{`#${c.row} ${c.name || '(名前なし)'} — ${c.effect}`}</option>)}
          </select>
          {' '}
          {!!it.action && <a href={`#/actions/${it.action}`} title="アクションで開く">↗</a>}
          {it.effect && <span className="muted">{` ${it.effect}`}</span>}
        </div>
      )}
      {(it.categoryByte & 0xf) === 3 && <EquipEffects items={items} it={it} set={set} mark={mark} />}
      <div className="model-line">
        {'上限に達すると: '}
        <select {...mark('chain', chainName)} value={it.chain} onChange={(e) => set({ chain: Number(e.target.value) })}>
          <option value={0}>なし</option>
          {!!it.chain && !items.item(it.chain) && <option value={it.chain}>{`#${it.chain}`}</option>}
          {items.items.filter((o) => o.id !== it.id).map((o) => <option key={o.id} value={o.id}>{`${o.id} ${o.name}`}</option>)}
        </select>
        {' '}
        {!!it.chain && items.item(it.chain) && <a href={`#/items/${it.chain}`} title="このアイテムを開く">↗</a>}
      </div>
    </div>
  );
}

const EQUIP_INFO = [
  '装備している間、電波人間に付く状態 (conditionData) とその値です。1 つの装備に 2 つまで。',
  '効果 1 = +0x2D の状態と +0x24 (s16) の値、効果 2 = +0x2E の状態と +0x26 (s16) の値 (FUN_0030a3d0)。',
  '装備の欄 (首・腕・足・背中・服) ごとに状態の枠があり、ほかの装備や元の値との合わせ方は状態ごとに決まっています (conditionData +0x32 の下位 4 ビット、FUN_0030aff4)。たいせいや能力は足し算、経験値・ゴールド・ドロップ率は % の掛け算 (100 = そのまま)、必中などは付くかどうかです。',
  'たいせいは + で強くなります (モンスターの耐性と同じ向き。+9 で効かない)。合わせた値は状態の範囲 (最小〜最大) に収まります。',
  '装備の分類 (首・腕 …) と違う欄の状態には入りません (+0x2C の上位 4 ビットが欄の番号)。',
].join('\n');

type Mark = <K extends keyof ItemFields>(k: K, show?: (v: ItemFields[K]) => string) => { className: string; title: string };

/** The two states an equipment gives while it is worn, and their values. */
function EquipEffects({ items, it, set, mark }: { items: ItemBook; it: Item; set: (patch: Partial<ItemFields>) => void; mark: Mark }): ReactNode {
  const stateName = (id: number): string => (id ? items.states[id]?.name || `状態 ${id}` : 'なし');
  const slots = [['state1', 'amount1'], ['state2', 'amount2']] as const;
  return (
    <div className="model-line equip-effects">
      <div className="with-info">{'装備の効果'}<InfoTip text={EQUIP_INFO} /></div>
      {slots.map(([sk, ak], i) => {
        const id = it[sk];
        const st = items.states[id];
        const m = mark(ak);
        return (
          <div key={sk} className="equip-effect">
            <span className="muted">{`${i + 1}: `}</span>
            <select {...mark(sk, stateName)} value={id} onChange={(e) => set({ [sk]: Number(e.target.value) })}>
              <option value={0}>なし</option>
              {items.states.map((s) => s.id && (s.name || s.id === id) ? <option key={s.id} value={s.id}>{`${s.id} ${s.name || '(名前なし)'}`}</option> : null)}
              {id >= items.states.length && <option value={id}>{`状態 ${id}`}</option>}
            </select>
            <NumberInput value={it[ak]} min={-32768} max={32767} className={`num-input ${m.className}`} title={m.title} onCommit={(v) => set({ [ak]: v })} />
            {!!id && <span className="muted">{items.equipEffects({ ...it, state1: id, amount1: it[ak], state2: 0 })[0]}</span>}
            {id === STATE_ACTION && <a href={`#/actions/${it[ak]}`} title="アクションで開く">↗</a>}
            {!!id && st && <span className="muted small">{`(${COMBINE[st.combine] ?? `方式 ${st.combine}`}、範囲 ${st.min}〜${st.max})`}</span>}
          </div>
        );
      })}
    </div>
  );
}
