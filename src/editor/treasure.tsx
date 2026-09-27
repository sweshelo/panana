// Chest contents: which treasureGroup row a chest uses (chosen in a <dialog> listing every row with its items)
// and the items of that row (filled slots only; items are picked with the shared item picker, src/ui/ItemPicker.tsx).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventTable } from '../game/events';
import type { Master } from '../game/master';
import type { Session } from '../session';
import { NumberInput } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import { ItemPicker } from '../ui/ItemPicker';
import { Photo } from '../ui/Photo';
import { useAsync } from '../ui/useAsync';
import { itemRef } from '../pages/items';
import type { EditorState } from './state';

const CHEST_KIND = 0x0c;

type Slot = { item: number; weight: number };

export function itemLabel(master: Master, id: number): string {
  return master.itemName(id) || `アイテム ${id}`;
}

function filled(slots: Slot[]): Slot[] {
  return slots.filter((s) => s.item);
}

function summary(master: Master, slots: Slot[]): string {
  const f = filled(slots);
  const total = f.reduce((a, s) => a + s.weight, 0);
  if (!f.length) return '(空)';
  return f.map((s) => `${itemLabel(master, s.item)}${f.length > 1 && total ? ` ${Math.round((s.weight / total) * 100)}%` : ''}`).join('、');
}

/** Write the filled slots back packed at the front; empty slots are {0, 1} like the game's data. */
function writeSlots(master: Master, row: number, slots: Slot[]): void {
  const f = filled(slots);
  for (let i = 0; i < 10; i++) {
    const s = f[i];
    master.setTreasureSlot(row, i, s ? s.item : 0, s ? s.weight : 1);
  }
}

/** The chests (in the loaded dungeons) using each treasureGroup row. */
function usage(st: EditorState): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [d, t] of st.events)
    for (let i = 0; i < t.rows; i++)
      if (t.kind(i) === CHEST_KIND) {
        const row = t.treasureRow(i);
        out.set(row, [...(out.get(row) ?? []), `${st.game.master.dungeonName(d)} #${i}`]);
      }
  return out;
}

/** Pick a treasureGroup row for a chest, or make a new one from the current contents. */
function TreasureRowPicker({ st, current, apply, onPick, onClose }: {
  st: EditorState; current: number; apply: (f: () => void) => void; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const master = st.game.master;
  const [query, setQuery] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), []);
  const used = usage(st);
  const q = query.trim();
  const rows: { row: number; text: string; users: string[] }[] = [];
  for (let row = 0; row < master.treasureGroup.rows; row++) {
    const text = summary(master, master.treasureSlots(row));
    const users = used.get(row) ?? [];
    if (onlyFree && users.length) continue;
    if (q && String(row) !== q && !text.includes(q)) continue;
    rows.push({ row, text, users });
  }
  return (
    <Dialog title="宝箱の中身を選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="アイテム名か行番号で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="layer"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> どの宝箱も使っていない行だけ</label>
        <button className="primary" onClick={() => {
          let row = -1;
          apply(() => (row = master.addTreasureRow(master.treasureSlots(current))));
          onPick(row);
        }}>今の中身を写して新しい行を作る</button>
      </div>
      <p className="muted small">「使っている宝箱」は、読み込んだダンジョンの宝箱のうちこの行を指す数。共有している行の中身を変えると、それらの宝箱も全部変わります。</p>
      <div className="picker-list" ref={list}>
        <table className="picker-table">
          <thead><tr><th>行</th><th>中身</th><th>使っている宝箱</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row} className={'pick' + (r.row === current ? ' current' : '')} onClick={() => onPick(r.row)}>
                <td className="num">{r.row}</td>
                <td>{r.text}</td>
                <td className="muted" title={r.users.join('、')}>{r.users.length ? `${r.users.length} 個` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/**
 * Contents of the chest of EventObject row `evRow` (+0x08 -> treasureGroup row, 10 x {item, weight};
 * FUN_00305dc8). `apply` makes an edit of the shared tables (with an undo point in the map editor).
 */
export function TreasureEditor({ session, ev, evRow, apply }: {
  session: Session; ev: EventTable; evRow: number; apply: (f: () => void) => void;
}): ReactNode {
  const { game, st } = session;
  const master = game.master;
  const data = useAsync(() => session.items(), [session]);
  const items = data && !(data instanceof Error) ? data.items : null;
  /** The item picker, and what to do with the pick. */
  const [picking, setPicking] = useState<{ current?: number; onPick: (id: number) => void } | null>(null);
  const [pickingRow, setPickingRow] = useState(false);
  const row = ev.treasureRow(evRow);
  const users = usage(st).get(row) ?? [];
  const valid = row >= 0 && row < master.treasureGroup.rows;
  const slots = valid ? filled(master.treasureSlots(row)) : [];
  const total = slots.reduce((a, s) => a + s.weight, 0);
  const write = (next: Slot[]): void => apply(() => writeSlots(master, row, next));
  const update = (i: number, next: Slot | null): void => {
    const copy = slots.map((x) => ({ ...x }));
    if (next) copy[i] = next;
    else copy.splice(i, 1);
    write(copy);
  };
  return (
    <div className="treasure">
      <h3>宝箱の中身</h3>
      <div className="row">
        <span className="grow">
          {`中身の表 #${row}`}
          {users.length > 1 && <span className="badge" title={users.join('、')}>{`${users.length} 個の宝箱で共有`}</span>}
        </span>
        <button onClick={() => setPickingRow(true)}>変更…</button>
      </div>
      {!valid && <div className="error">{`中身の表に行 ${row} がありません`}</div>}
      {valid && (
        <>
          <div className="loot">
            {slots.map((s, i) => {
              const it = items?.item(s.item);
              return (
                <div key={i} className="loot-row">
                  <button className="loot-item" title="クリックでアイテムを変える" disabled={!items}
                    onClick={() => setPicking({ current: s.item, onPick: (id) => update(i, { item: id, weight: s.weight }) })}>
                    {it && <Photo model={itemRef(game, it)} />}
                    <span className="muted">{`${s.item} `}</span>{itemLabel(master, s.item)}
                  </button>
                  <NumberInput value={s.weight} min={1} max={0xffff} className="" title="重み (出やすさ)" onCommit={(v) => update(i, { item: s.item, weight: v })} />
                  <span className="loot-pct">{total ? `${Math.round((s.weight / total) * 100)}%` : ''}</span>
                  <button className="danger" title="外す" onClick={() => update(i, null)}>×</button>
                </div>
              );
            })}
            {!slots.length && <div className="muted">空です (開けても何も出ません)。</div>}
            {slots.length < 10 && (
              <button className="loot-add" disabled={!items} onClick={() => setPicking({ onPick: (id) => write([...slots, { item: id, weight: 1 }]) })}>＋ 追加</button>
            )}
          </div>
          <div className="muted small">
            {`開けると、並んだアイテムから重みに比例して 1 つ選ばれます (最大 10 個)。${users.length > 1 ? 'この中身を変えると共有している宝箱も変わります。別の中身にするには「変更…」で新しい行を作ってください。' : ''}${master.treasureRowChanged(row) ? ' 変更済み。' : ''}`}
          </div>
        </>
      )}
      {picking && items && (
        <ItemPicker game={game} items={items} title="宝箱に入れるアイテムを選ぶ" current={picking.current}
          onClose={() => setPicking(null)} onPick={(id) => { setPicking(null); picking.onPick(id); }} />
      )}
      {pickingRow && (
        <TreasureRowPicker st={st} current={row} apply={apply} onClose={() => setPickingRow(false)}
          onPick={(v) => { setPickingRow(false); if (v !== row) apply(() => ev.setTreasureRow(evRow, v)); }} />
      )}
    </div>
  );
}
