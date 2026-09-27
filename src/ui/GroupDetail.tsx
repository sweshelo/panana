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
import { Count, EditedMark, ListFilter, useActiveRow } from './book';
import { Dialog } from './Dialog';
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

/** A group at a glance: the photos of its monsters (leads first), marked when it was edited. */
export function GroupIcons({ game, book, g }: { game: Game; book: MonsterBook; g: MonsterGroup }): ReactNode {
  return (
    <span className="group-photos">
      {book.groupMonsters(g).map((r, i) => <MonsterPhoto key={i} game={game} book={book} row={r} />)}
      {!(g.leads.length + g.mates.length) && <span className="muted">(敵なし)</span>}
      {book.groupChanged(g.row) && <EditedMark />}
    </span>
  );
}

/** One side's candidates as tiles: photo, name and level, share of the weight and the count. */
function SlotTiles({ game, book, title, slots }: { game: Game; book: MonsterBook; title: string; slots: GroupSlot[] }): ReactNode {
  const total = slots.reduce((a, s) => a + s.weight, 0);
  return (
    <div className="group-side">
      <div className="group-side-title">{title}</div>
      <div className="group-tiles">
        {slots.map((s, i) => {
          const m = book.monster(s.monster);
          return (
            <a key={i} className="group-tile" href={monsterHref(s.monster)} title={m ? `${m.name} Lv${m.level} (モンスター図鑑で開く)` : `#${s.monster}`}>
              <MonsterPhoto game={game} book={book} row={s.monster} />
              <span className="group-tile-name">{m ? m.name : `#${s.monster}`}</span>
              <span className="group-tile-meta">{`${Math.round((s.weight / total) * 100)}% ×${countLabel(s.count)}`}</span>
            </a>
          );
        })}
        {!slots.length && <span className="muted small">なし</span>}
      </div>
    </div>
  );
}

export function GroupDetail({ game, book, group: g }: { game: Game; book: MonsterBook; group: MonsterGroup }): ReactNode {
  return (
    <div className="enc-group">
      <div className="small"><a href={groupHref(g.row)}>{`群れ #${g.row} を開く (編集)`}</a></div>
      <SlotTiles game={game} book={book} title="先頭 (マップで見える敵)・3 体目" slots={g.leads} />
      <SlotTiles game={game} book={book} title="2・4 体目" slots={g.mates} />
      <div className="muted small">{`+0x28〜: ${g.extra.join(' ')} (未解析)`}</div>
    </div>
  );
}

type Filter = 'all' | 'used' | 'unused' | 'changed';

/**
 * Every group (optionally only those `only` keeps) with its photos and how many maps use it,
 * searchable by monster name: the left pane of the group page and the body of the group picker.
 */
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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  const all = only ? book.groups.filter(only) : book.groups;
  const matches = (g: MonsterGroup): boolean => {
    const q = query.trim();
    if (q && String(g.row) !== q && !book.groupMonsters(g).some((r) => book.monster(r)?.name.includes(q))) return false;
    const used = (uses.get(g.hash)?.length ?? 0) > 0;
    if (filter === 'used') return used;
    if (filter === 'unused') return !used;
    if (filter === 'changed') return book.groupChanged(g.row);
    return true;
  };
  const rows = all.filter(matches);
  return (
    <>
      <ListFilter query={query} setQuery={setQuery} placeholder="モンスターの名前か群れの番号で検索" filter={filter} setFilter={setFilter}
        options={[['all', 'すべて'], ['used', 'マップで使う'], ['unused', 'どのマップも使わない'], ['changed', '変更した']]} />
      <div className="book-list" ref={list}>
        <Count shown={rows.length} total={all.length} />
        <table className="book-table">
          <thead><tr><th>#</th><th>モンスター</th><th>マップ</th></tr></thead>
          <tbody>
            {children}
            {rows.map((g) => {
              const n = uses.get(g.hash)?.length ?? 0;
              return (
                <tr key={g.row} className={g.row === selected ? 'active' : ''} onClick={() => onSelect(g)}>
                  <td className="num muted">{g.row}</td>
                  <td><GroupIcons game={game} book={book} g={g} /></td>
                  <td className="num muted">{n || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
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
