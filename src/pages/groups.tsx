// Encounter groups (monsterGroup): every row with its candidates and the maps that use it (section 6);
// the candidates can be edited, and a group can be copied into a new row.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { countLabel, GROUP_SLOTS, type GroupSlot, type MonsterBook, type MonsterGroup } from '../game/monsters';
import { mapTitle } from '../game/names';
import { hex8 } from '../util/bytes';
import type { Session } from '../session';
import { NumberInput, useEdits, useSticky, type PageProps } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import { GroupList, groupHref, groupUses, MonsterPhoto, type GroupUse } from '../ui/GroupDetail';
import { Photo } from '../ui/Photo';
import { monsterRef } from './monsters';

export { groupHref, groupUses, type GroupUse };

export function GroupPage({ session, arg, visit, book }: PageProps & { book: MonsterBook }): ReactNode {
  const { game } = session;
  const [edits, edited] = useEdits();
  // Recomputed on every visit: the maps may have been edited.
  const uses = useMemo(() => groupUses(game, session.docOf), [game, session, visit, edits]);
  const selected = useSticky(arg !== undefined && arg !== '' ? Number(arg) : undefined, (r) => !!book.groups[r], () => 0);
  const onEdit = (): void => {
    session.scheduleSave();
    edited();
  };
  const g = book.groups[selected];
  return (
    <div className="book">
      <div className="book-side">
        <GroupList game={game} book={book} uses={uses} selected={selected} onSelect={(g) => (location.hash = groupHref(g.row))} />
      </div>
      <div className="book-detail">
        {g && <GroupDetailEditor session={session} book={book} g={g} uses={uses.get(g.hash) ?? []} onEdit={onEdit} />}
      </div>
    </div>
  );
}

function GroupDetailEditor({ session, book, g, uses, onEdit }: { session: Session; book: MonsterBook; g: MonsterGroup; uses: GroupUse[]; onEdit: () => void }): ReactNode {
  const { game } = session;
  const added = book.groupAdded(g.row);
  return (
    <>
      <div className="book-head">
        <h2>{`群れ #${g.row}`}</h2>
        <span className="muted">{`ハッシュ ${g.hash ? hex8(g.hash) : '(索引なし)'}${added ? '  (追加した行)' : ''}`}</span>
      </div>
      <p className="muted small book-desc">
        戦闘の 1 体目 (マップで見える敵) と 3 体目は「先頭」から、2・4 体目は「仲間」から、重みに比例して選ばれます。数は候補ごとの出る数のコードです。
        候補は 5 個まで。変更はマスター (56562135) の monsterGroup.bin として書き出されます。
      </p>
      <div className="row">
        <button title="この群れを写した新しい行を作ります。マップ編集の「出現する敵」で選べます" onClick={() => {
          const n = book.copyGroup(g.row);
          onEdit();
          location.hash = groupHref(n);
        }}>写して新しい群れを作る</button>
        {!added && book.groupChanged(g.row) && <button onClick={() => { book.revertGroup(g.row); onEdit(); }}>この群れの変更を元に戻す</button>}
      </div>
      <div className="book-cols group-cols">
        <SlotEditor session={session} book={book} g={g} side="leads" title="先頭 (マップで見える敵)・3 体目" onEdit={onEdit} />
        <SlotEditor session={session} book={book} g={g} side="mates" title="仲間 (2・4 体目)" onEdit={onEdit} />
      </div>
      <div className="muted small">{`+0x28〜: ${g.extra.join(' ')} (未解析)`}</div>
      <h3>{`使うマップ (${uses.length})`}</h3>
      {uses.length
        ? <table className="enc-table book-chests">
            <tbody>
              <tr><th>マップ</th><th>使い方</th></tr>
              {uses.map((u, i) => (
                <tr key={i}>
                  <td><a href={`#/map/${u.map.name}`}>{mapTitle(u.map, game.code.maps, game.master)}</a></td>
                  <td className="muted">{u.cells === 'map' ? 'マップの群れ (区画 6 のヘッダー)' : `セル ${u.cells} 個`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        : <div className="muted">どのマップも使っていません (マップ編集の右ペイン「出現する敵」で選べます)</div>}
    </>
  );
}

/** Table of one side's candidates: monster, weight (with its share), count; add and remove. */
function SlotEditor({ session, book, g, side, title, onEdit }: {
  session: Session; book: MonsterBook; g: MonsterGroup; side: 'leads' | 'mates'; title: string; onEdit: () => void;
}): ReactNode {
  /** The monster picker, and what to do with the pick. */
  const [picking, setPicking] = useState<{ current: number; onPick: (row: number) => void } | null>(null);
  const slots = g[side];
  const total = slots.reduce((a, s) => a + s.weight, 0);
  const set = (next: GroupSlot[]): void => {
    book.setGroupSlots(g.row, side === 'leads' ? next : g.leads, side === 'mates' ? next : g.mates);
    onEdit();
  };
  const change = (k: number, patch: Partial<GroupSlot>): void => set(slots.map((s, i) => (i === k ? { ...s, ...patch } : s)));
  const counts = Array.from({ length: 8 }, (_, c) => c);
  return (
    <section>
      <h3>{title}</h3>
      <table className="enc-table group-slots">
        <tbody>
          <tr><th>モンスター</th><th>重み</th><th>割合</th><th>数</th><th></th></tr>
          {slots.map((s, k) => (
            <tr key={k}>
              <td>
                <div className="row">
                  <button className="monster-pick" title="モンスターを選び直す" onClick={() => setPicking({ current: s.monster, onPick: (row) => change(k, { monster: row }) })}>
                    <MonsterPhoto game={session.game} book={book} row={s.monster} />
                    <span>{book.monster(s.monster)?.name ?? `#${s.monster}`}</span>
                  </button>
                  <a href={`#/monsters/${s.monster}`} title="モンスター図鑑で開く">↗</a>
                </div>
              </td>
              <td>
                {/* weight 0 would drop the slot (the game skips it), so removing is done with × */}
                <NumberInput value={s.weight} min={1} max={255} onCommit={(v) => change(k, { weight: v })} />
              </td>
              <td className="num">{`${Math.round((s.weight / total) * 100)}%`}</td>
              <td>
                <select value={s.count} onChange={(e) => change(k, { count: Number(e.target.value) })}>
                  {[...counts, ...(s.count >= 8 ? [s.count] : [])].map((c) => <option key={c} value={c}>{countLabel(c)}</option>)}
                </select>
              </td>
              <td><button title="外す" onClick={() => set(slots.filter((_, i) => i !== k))}>×</button></td>
            </tr>
          ))}
          {!slots.length && <tr><td className="muted" colSpan={5}>なし</td></tr>}
        </tbody>
      </table>
      <button
        disabled={slots.length >= GROUP_SLOTS}
        title={slots.length >= GROUP_SLOTS ? `候補は ${GROUP_SLOTS} 個まで` : ''}
        onClick={() => setPicking({ current: 0, onPick: (row) => set([...slots, { monster: row, weight: 1, count: 0 }]) })}
      >＋ 追加</button>
      {picking && (
        <MonsterPicker session={session} book={book} current={picking.current} onClose={() => setPicking(null)}
          onPick={(row) => { setPicking(null); picking.onPick(row); }} />
      )}
    </section>
  );
}

/** Pick a monster from the photos (names only: the level and the row are in the monster book). */
export function MonsterPicker({ session, book, current, onPick, onClose }: {
  session: Session; book: MonsterBook; current: number; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const shown = book.monsters.filter((m) => !q || m.name.includes(q));
  return (
    <Dialog title="モンスターを選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list">
        <div className="monster-grid" ref={grid}>
          {shown.map((m) => (
            <button key={m.row} className={`monster-cell${m.row === current ? ' current' : ''}`} onClick={() => onPick(m.row)}>
              <Photo model={monsterRef(session.game, book, m)} className="photo photo-lg" />
              <span>{m.name}</span>
            </button>
          ))}
          {!shown.length && <div className="muted">見つかりません</div>}
        </div>
      </div>
    </Dialog>
  );
}
