// Picking a battle message (MessageBattle and the added ones) by its text: the names of the actions, the line a
// monster says when it turns into a form. The list can be limited to the messages nothing listed uses.
import { useState, type ReactNode } from 'react';
import type { Session } from '../session';
import { Dialog } from './Dialog';
import { InfoTip } from './InfoTip';

/** A message of MessageBattle (0x17DB〜0x1BDE), to find the file when there is no current message. */
export const BATTLE_MESSAGE = 0x1b00;

export function BattleMessagePicker({ session, title, current, users, freeLabel, info, onPick, onClose }: {
  session: Session;
  title: string;
  current: number;
  /** Who uses each message ("#12", "まおう #45"), for the column and the "free" filter. */
  users: Map<number, string[]>;
  /** Label of the filter keeping the messages no one in `users` uses. */
  freeLabel: string;
  info: string;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const texts = session.game.master.texts;
  const [query, setQuery] = useState('');
  const [free, setFree] = useState(true);
  const file = texts.file(current && !texts.isAdded(current) ? current : BATTLE_MESSAGE);
  const q = query.trim();
  const ids: number[] = [];
  const range = [...(file ? Array.from({ length: file.gmsg.last - file.gmsg.first + 1 }, (_, i) => file.gmsg.first + i) : []), ...texts.addedIds()];
  for (const id of range) {
    if (free && users.has(id) && id !== current) continue;
    const t = texts.preview(id, true) ?? '';
    if (q && !t.includes(q) && String(id) !== q) continue;
    ids.push(id);
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" className="picker-search" placeholder="本文・番号で絞り込み" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <label><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />{freeLabel}</label>
        <InfoTip text={`${file?.name ?? ''} と追加したメッセージです。${info}`} />
      </div>
      <div className="picker-list">
        <table className="book-table">
          <thead><tr><th>#</th><th>本文</th><th>使うもの</th></tr></thead>
          <tbody>
            {ids.slice(0, 500).map((id) => (
              <tr key={id} className={id === current ? 'active current' : ''} onClick={() => onPick(id)}>
                <td className="num muted">{id}</td>
                <td>{texts.preview(id, true) || <span className="muted">(空)</span>}</td>
                <td className="muted small">{(users.get(id) ?? []).join('、')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ids.length > 500 && <div className="muted small">{`ほか ${ids.length - 500} 件 (絞り込んでください)`}</div>}
      </div>
    </Dialog>
  );
}
