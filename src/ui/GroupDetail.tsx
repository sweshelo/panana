// The candidates of an encounter group (read only): shared by the monster book and the map inspector.
import type { ReactNode } from 'react';
import { countLabel, type GroupSlot, type MonsterBook, type MonsterGroup } from '../game/monsters';

export const monsterHref = (row: number): string => `#/monsters/${row}`;

function SlotTable({ book, title, slots }: { book: MonsterBook; title: string; slots: GroupSlot[] }): ReactNode {
  const total = slots.reduce((a, s) => a + s.weight, 0);
  return (
    <table className="enc-table">
      <tbody>
        <tr><th colSpan={3}>{title}</th></tr>
        {slots.map((s, i) => {
          const m = book.monster(s.monster);
          return (
            <tr key={i}>
              <td><a href={monsterHref(s.monster)}>{m ? `${m.name} Lv${m.level}` : `#${s.monster}`}</a></td>
              <td className="num">{`${Math.round((s.weight / total) * 100)}%`}</td>
              <td className="num muted">{`×${countLabel(s.count)}`}</td>
            </tr>
          );
        })}
        {!slots.length && <tr><td className="muted" colSpan={3}>なし</td></tr>}
      </tbody>
    </table>
  );
}

export function GroupDetail({ book, group: g }: { book: MonsterBook; group: MonsterGroup }): ReactNode {
  return (
    <div className="enc-group">
      <div className="small"><a href={`#/groups/${g.row}`}>{`群れ #${g.row} を開く (編集)`}</a></div>
      <SlotTable book={book} title="先頭 (マップで見える敵)・3 体目" slots={g.leads} />
      <SlotTable book={book} title="2・4 体目" slots={g.mates} />
      <div className="muted small">{`+0x28〜: ${g.extra.join(' ')} (未解析)`}</div>
    </div>
  );
}
