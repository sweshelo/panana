// Inspector block of a map: the enemies (section 6 monster groups). Its sounds are in sounds.tsx.
import { useState, type ReactNode } from 'react';
import { mapEncounters, type MonsterBook } from '../game/monsters';
import type { Session } from '../session';
import { hex8, w32 } from '../util/bytes';
import { GroupDetail, GroupIcons, GroupPicker } from '../ui/GroupDetail';
import { Field } from './fields';
import type { EditorState } from './state';

export function EncounterPanel({ session, st, book }: { session: Session; st: EditorState; book: MonsterBook | null }): ReactNode {
  const [picking, setPicking] = useState(false);
  const doc = st.current!;
  const head = <h3>出現する敵</h3>;
  if (!book) return <div className="enc-box">{head}<div className="muted">モンスターのデータを読めませんでした</div></div>;
  const enc = mapEncounters(doc);
  const cur = book.group(enc.group);
  const setGroup = (hash: number): void =>
    st.edit((d) => {
      if (d.sec6Header.length < 8) {
        d.sec6Header = new Uint8Array(8);
        w32(d.sec6Header, 4, 0xffffffff);
      }
      w32(d.sec6Header, 0, hash);
    });
  const own = [...enc.cells].filter(([hash]) => hash);
  const plain = enc.cells.get(0)?.length ?? 0;
  const ownCount = doc.cells6.length - plain;
  return (
    <div className="enc-box">
      {head}
      <Field label="マップの群れ (区画 6 のヘッダー)">
        <button className="group-pick" title="群れを選び直す" onClick={() => setPicking(true)}>
          {cur
            ? <><span className="muted">{`#${cur.row}`}</span><GroupIcons game={st.game} book={book} g={cur} /></>
            : <span className="muted">{enc.group ? `不明な群れ ${hex8(enc.group)}` : '(なし: 敵が出ない)'}</span>}
        </button>
      </Field>
      {cur && <GroupDetail game={st.game} book={book} group={cur} />}
      {picking && (
        <GroupPicker session={session} book={book} current={enc.group} onClose={() => setPicking(false)}
          onPick={(hash) => { setPicking(false); if (hash !== enc.group) setGroup(hash); }} />
      )}
      <div className="muted small">
        {`敵が出ないセル (区画 6): ${plain} 個${ownCount ? `、群れを指定したセル ${ownCount} 個` : ''}。マップの群れは、区画 6 にないセルにだけ出ます。左の「敵が出ないセル」ツールで付け外しできます。`}
      </div>
      {own.map(([hash, cells]) => {
        const g = book.group(hash);
        return (
          <details key={hash} className="enc-cells">
            <summary>
              {`セル ${cells.length} 個: `}
              {g ? <><span className="muted">{`#${g.row} `}</span><GroupIcons game={st.game} book={book} g={g} /></> : `不明な群れ ${hex8(hash)}`}
            </summary>
            <div className="muted small">{cells.map(([x, y]) => `(${x}, ${y})`).join(' ')}</div>
            {g && <GroupDetail game={st.game} book={book} group={g} />}
          </details>
        );
      })}
    </div>
  );
}
