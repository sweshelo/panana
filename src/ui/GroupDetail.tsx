// Encounter groups shown with the monsters' photos: the candidates of a group (read only, used by the
// monster book and the map inspector), the searchable list of every group (the left pane of the group
// page) and the <dialog> that picks a group from that same list (the map inspector).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import type { Game } from '../game/game';
import { countLabel, mapEncounters, type GroupSlot, type MonsterBook, type MonsterGroup } from '../game/monsters';
import type { MapDoc } from '../game/sections';
import { hex8 } from '../util/bytes';
import { monsterRef } from '../pages/monsters';
import type { Session } from '../session';
import { Count, EditedMark, ListFilter, NumberInput, useActiveRow } from './book';
import { Dialog } from './Dialog';
import { InfoTip } from './InfoTip';
import { Photo } from './Photo';

export const monsterHref = (row: number): string => `#/monsters/${row}`;
export const groupHref = (row: number): string => `#/groups/${row}`;

export interface GroupUse {
  map: MapInfo;
  /** 'map' = the map's group (section 6 header), else the number of cells with this group. */
  cells: number | 'map';
}

/** Group hash -> maps that use it (current map documents, so edits show up). */
export function groupUses(game: Game, docOf: (m: MapInfo) => MapDoc): Map<number, GroupUse[]> {
  const out = new Map<number, GroupUse[]>();
  const add = (hash: number, use: GroupUse): void => {
    if (hash) out.set(hash, [...(out.get(hash) ?? []), use]);
  };
  for (const m of game.editableMaps()) {
    const enc = mapEncounters(docOf(m));
    add(enc.group, { map: m, cells: 'map' });
    for (const [hash, cells] of enc.cells) add(hash, { map: m, cells: cells.length });
  }
  return out;
}

/** Photo (model) of a monster, with its name as the tooltip. */
export function MonsterPhoto({ game, book, row, className }: { game: Game; book: MonsterBook; row: number; className?: string }): ReactNode {
  const m = book.monster(row);
  return <Photo model={m ? monsterRef(game, book, m) : null} className={className} title={m?.name ?? `#${row}`} />;
}

/** A group at a glance: the pictures of its monsters (leads first), marked when it was edited. */
export function GroupIconRow({ icons, changed }: { icons: ReactNode[]; changed: boolean }): ReactNode {
  return (
    <span className="group-photos">
      {icons}
      {!icons.length && <span className="muted">(敵なし)</span>}
      {changed && <EditedMark />}
    </span>
  );
}

export function GroupIcons({ game, book, g }: { game: Game; book: MonsterBook; g: MonsterGroup }): ReactNode {
  return <GroupIconRow icons={book.groupMonsters(g).map((r, i) => <MonsterPhoto key={i} game={game} book={book} row={r} />)} changed={book.groupChanged(g.row)} />;
}

/** What the group parts show of a monster. */
export interface GroupMonster {
  name: string;
  /** Sub line ("Lv3"). */
  sub?: string;
  /** Its picture (class "photo"). */
  icon: ReactNode;
}

/** One side's candidates as tiles: picture, name and level, share of the weight and the count. */
export function SlotTiles({ title, slots, monster, count = countLabel }: {
  title: string;
  slots: GroupSlot[];
  monster: (row: number) => GroupMonster | undefined;
  count?: (code: number) => string;
}): ReactNode {
  const total = slots.reduce((a, s) => a + s.weight, 0);
  return (
    <div className="group-side">
      <div className="group-side-title">{title}</div>
      <div className="group-tiles">
        {slots.map((s, i) => {
          const m = monster(s.monster);
          return (
            <a key={i} className="group-tile" href={monsterHref(s.monster)} title={m ? `${m.name}${m.sub ? ` ${m.sub}` : ''} (モンスター図鑑で開く)` : `#${s.monster}`}>
              {m?.icon ?? <Photo model={null} />}
              <span className="group-tile-name">{m ? m.name : `#${s.monster}`}</span>
              <span className="group-tile-meta">{s.weight ? `${Math.round((s.weight / total) * 100)}% ×${count(s.count)}` : `×${count(s.count)}`}</span>
            </a>
          );
        })}
        {!slots.length && <span className="muted small">なし</span>}
      </div>
    </div>
  );
}

/** An RPG2 monster for the group parts. */
export function rpg2Monster(game: Game, book: MonsterBook): (row: number) => GroupMonster | undefined {
  return (row) => {
    const m = book.monster(row);
    return m && { name: m.name, sub: `Lv${m.level}`, icon: <MonsterPhoto game={game} book={book} row={row} /> };
  };
}

export function GroupDetail({ game, book, group: g }: { game: Game; book: MonsterBook; group: MonsterGroup }): ReactNode {
  const monster = rpg2Monster(game, book);
  return (
    <div className="enc-group">
      <div className="small"><a href={groupHref(g.row)}>{`群れ #${g.row} を開く (編集)`}</a></div>
      <SlotTiles title="先頭 (マップで見える敵)・3 体目" slots={g.leads} monster={monster} />
      <SlotTiles title="2・4 体目" slots={g.mates} monster={monster} />
      <div className="muted small">{`+0x28〜: ${g.extra.join(' ')} (未解析)`}</div>
    </div>
  );
}

/** A filter of the group list: key, label, which groups it keeps. */
export type GroupFilter<G> = [string, string, (g: G) => boolean];

/**
 * Every group with the pictures of its monsters, searchable by monster name or row and filtered by `filters` (the first
 * is the default): the left pane of the group pages and the body of the group picker. `extra` adds a column.
 */
export function GroupListView<G extends { row: number }>({ groups, monsters, name, icon, changed, filters, extra, selected, onSelect, children }: {
  groups: G[];
  /** Monster rows of a group (leads first, each once). */
  monsters: (g: G) => number[];
  name: (row: number) => string | undefined;
  icon: (row: number, key: number) => ReactNode;
  changed: (g: G) => boolean;
  filters: GroupFilter<G>[];
  extra?: { head: string; cell: (g: G) => ReactNode };
  /** Row of the highlighted group. */
  selected: number | undefined;
  onSelect: (g: G) => void;
  /** Rows shown before the groups (the picker's "none"). */
  children?: ReactNode;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(filters[0]?.[0] ?? '');
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  const keep = filters.find(([k]) => k === filter)?.[2] ?? (() => true);
  const matches = (g: G): boolean => {
    const q = query.trim();
    if (q && String(g.row) !== q && !monsters(g).some((r) => name(r)?.includes(q))) return false;
    return keep(g);
  };
  const rows = groups.filter(matches);
  return (
    <>
      <ListFilter query={query} setQuery={setQuery} placeholder="モンスターの名前か群れの番号で検索" filter={filter} setFilter={setFilter}
        options={filters.map(([k, label]): [string, string] => [k, label])} />
      <div className="book-list" ref={list}>
        <Count shown={rows.length} total={groups.length} />
        <table className="book-table">
          <thead><tr><th>#</th><th>モンスター</th>{extra && <th>{extra.head}</th>}</tr></thead>
          <tbody>
            {children}
            {rows.map((g) => (
              <tr key={g.row} className={g.row === selected ? 'active' : ''} onClick={() => onSelect(g)}>
                <td className="num muted">{g.row}</td>
                <td><GroupIconRow icons={monsters(g).map((r, i) => icon(r, i))} changed={changed(g)} /></td>
                {extra && <td className="num muted">{extra.cell(g)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** RPG2's groups (optionally only those `only` keeps) with how many maps use each. */
export function GroupList({ game, book, uses, selected, only, onSelect, children }: {
  game: Game;
  book: MonsterBook;
  uses: Map<number, GroupUse[]>;
  /** Row of the highlighted group. */
  selected: number | undefined;
  only?: (g: MonsterGroup) => boolean;
  onSelect: (g: MonsterGroup) => void;
  /** Rows shown before the groups (the picker's "none"). */
  children?: ReactNode;
}): ReactNode {
  const used = (g: MonsterGroup): boolean => (uses.get(g.hash)?.length ?? 0) > 0;
  return (
    <GroupListView
      groups={only ? book.groups.filter(only) : book.groups}
      monsters={(g) => book.groupMonsters(g)}
      name={(r) => book.monster(r)?.name}
      icon={(r, i) => <MonsterPhoto key={i} game={game} book={book} row={r} />}
      changed={(g) => book.groupChanged(g.row)}
      filters={[['all', 'すべて', () => true], ['used', 'マップで使う', used], ['unused', 'どのマップも使わない', (g) => !used(g)], ['changed', '変更した', (g) => book.groupChanged(g.row)]]}
      extra={{ head: 'マップ', cell: (g) => uses.get(g.hash)?.length || '' }}
      selected={selected}
      onSelect={onSelect}
    >
      {children}
    </GroupListView>
  );
}

/** Pick the group of a map (or none) from the same list as the group page. */
export function GroupPicker({ session, book, current, onPick, onClose }: {
  session: Session; book: MonsterBook; current: number; onPick: (hash: number) => void; onClose: () => void;
}): ReactNode {
  const { game } = session;
  // The maps' current documents (edits of the open map included); computed once per opening.
  const uses = useMemo(() => groupUses(game, session.docOf), [game, session]);
  const cur = book.group(current);
  return (
    <Dialog title="群れを選ぶ" onClose={onClose}>
      <p className="muted small">「マップ」はこの群れを使うマップの数。群れの中身は「群れ」のページで編集できます (共有している群れを変えると、使っているマップ全部に効きます)。</p>
      <div className="group-picker">
        <GroupList game={game} book={book} uses={uses} selected={cur?.row} only={(g) => !!g.hash} onSelect={(g) => onPick(g.hash)}>
          <tr className={current === 0 ? 'active' : ''} onClick={() => onPick(0)}>
            <td></td>
            <td className="muted">(なし: 敵が出ない)</td>
            <td></td>
          </tr>
          {!!current && !cur && (
            <tr className="active">
              <td></td>
              <td className="muted">{`不明な群れ ${hex8(current)}`}</td>
              <td></td>
            </tr>
          )}
        </GroupList>
      </div>
    </Dialog>
  );
}

/**
 * Table of one side's candidates: monster (picked from the pictures), weight (with its share), count; add and remove.
 * `counts` are the choices of the count code.
 */
export function GroupSlotEditor({ title, info, slots, max, monster, counts, set, picker }: {
  title: string;
  info?: string;
  slots: GroupSlot[];
  max: number;
  monster: (row: number) => GroupMonster | undefined;
  counts: (current: number) => [number, string][];
  set: (next: GroupSlot[]) => void;
  picker: (current: number, pick: (row: number) => void, close: () => void) => ReactNode;
}): ReactNode {
  /** The monster picker, and what to do with the pick. */
  const [picking, setPicking] = useState<{ current: number; onPick: (row: number) => void } | null>(null);
  const total = slots.reduce((a, s) => a + s.weight, 0);
  const change = (k: number, patch: Partial<GroupSlot>): void => set(slots.map((s, i) => (i === k ? { ...s, ...patch } : s)));
  return (
    <section>
      <h3 className={info ? 'with-info' : undefined}>{title}{info && <InfoTip text={info} />}</h3>
      <table className="enc-table group-slots">
        <tbody>
          <tr><th>モンスター</th><th>重み</th><th>割合</th><th>数</th><th></th></tr>
          {slots.map((s, k) => {
            const m = monster(s.monster);
            const options = counts(s.count);
            return (
              <tr key={k}>
                <td>
                  <div className="row">
                    <button className="monster-pick" title="モンスターを選び直す" onClick={() => setPicking({ current: s.monster, onPick: (row) => change(k, { monster: row }) })}>
                      {m?.icon ?? <Photo model={null} />}
                      <span>{m?.name ?? `#${s.monster}`}</span>
                    </button>
                    <a href={monsterHref(s.monster)} title="モンスター図鑑で開く">↗</a>
                  </div>
                </td>
                <td>
                  {/* weight 0 would drop the slot (the game skips it), so removing is done with × */}
                  <NumberInput value={s.weight} min={1} max={255} onCommit={(v) => change(k, { weight: v })} />
                </td>
                <td className="num">{`${Math.round((s.weight / total) * 100)}%`}</td>
                <td>
                  <select value={s.count} onChange={(e) => change(k, { count: Number(e.target.value) })}>
                    {[...options, ...(options.some(([c]) => c === s.count) ? [] : [[s.count, String(s.count)] as [number, string]])].map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                  </select>
                </td>
                <td><button title="外す" onClick={() => set(slots.filter((_, i) => i !== k))}>×</button></td>
              </tr>
            );
          })}
          {!slots.length && <tr><td className="muted" colSpan={5}>なし</td></tr>}
        </tbody>
      </table>
      <button
        disabled={slots.length >= max}
        title={slots.length >= max ? `候補は ${max} 個まで` : ''}
        onClick={() => setPicking({ current: 0, onPick: (row) => set([...slots, { monster: row, weight: 1, count: 0 }]) })}
      >＋ 追加</button>
      {picking && picker(picking.current, (row) => { setPicking(null); picking.onPick(row); }, () => setPicking(null))}
    </section>
  );
}
