// Inspector block of a map: the enemies (section 6 monster groups). Its sounds are in sounds.tsx.
import type { ReactNode } from 'react';
import { mapEncounters, type MonsterBook, type MonsterGroup } from '../game/monsters';
import { hex8, w32 } from '../util/bytes';
import { GroupDetail } from '../ui/GroupDetail';
import { Field } from './fields';
import type { EditorState } from './state';

function groupSummary(book: MonsterBook, g: MonsterGroup): string {
  const names = book.groupMonsters(g).map((r) => book.monster(r)?.name ?? `#${r}`);
  return `群れ #${g.row}${names.length ? `: ${names.join('・')}` : ' (敵なし)'}`;
}

export function EncounterPanel({ st, book }: { st: EditorState; book: MonsterBook | null }): ReactNode {
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
        <select value={enc.group} onChange={(e) => setGroup(Number(e.target.value))}>
          <option value={0}>(なし: 敵が出ない)</option>
          {book.groups.filter((g) => g.hash).map((g) => <option key={g.hash} value={g.hash}>{groupSummary(book, g)}</option>)}
          {!!enc.group && !cur && <option value={enc.group}>{`不明な群れ ${hex8(enc.group)}`}</option>}
        </select>
      </Field>
      {cur && <GroupDetail book={book} group={cur} />}
      <div className="muted small">
        {`敵が出ないセル (区画 6): ${plain} 個${ownCount ? `、群れを指定したセル ${ownCount} 個` : ''}。マップの群れは、区画 6 にないセルにだけ出ます。左の「敵が出ないセル」ツールで付け外しできます。`}
      </div>
      {own.map(([hash, cells]) => {
        const g = book.group(hash);
        return (
          <details key={hash} className="enc-cells">
            <summary>{`セル ${cells.length} 個: ${g ? groupSummary(book, g) : `不明な群れ ${hex8(hash)}`}`}</summary>
            <div className="muted small">{cells.map(([x, y]) => `(${x}, ${y})`).join(' ')}</div>
            {g && <GroupDetail book={book} group={g} />}
          </details>
        );
      })}
    </div>
  );
}
