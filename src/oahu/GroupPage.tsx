// RPG3's encounter groups (#/groups/<row>): the candidates of the lead and the mates (monster, weight, count) and the
// fixed formation of each monsterGroup row, edited in place. Same layout as RPG2's groups (src/pages/groups.tsx).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { RowFields } from '../ui/RowFields';
import type { OahuBattle } from './battle';
import { FieldNumber, FieldSelect } from './FieldInput';
import { battleContext, oahuGroupHref, oahuMonsterHref } from './MonsterPage';
import type { OahuSession } from './session';
import { OAHU_MONSTER_GROUP } from './tables';

export function OahuGroupPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('used');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => battle.groupList(), [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => r > 0 && r < battle.groups.rows, () => 1);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const q = query.trim();
  const names = (g: (typeof groups)[number]): string[] => [...new Set([...g.leads, ...g.mates].map((s) => s.monster).concat(g.fixed))].map((m) => battle.monsterName(m));
  const rows = groups.filter((g) => {
    if (q && String(g.row) !== q && !names(g).some((n) => n.includes(q))) return false;
    if (filter === 'used') return g.leads.length + g.mates.length + g.fixed.length > 0;
    if (filter === 'fixed') return !g.leads.length && g.fixed.length > 0;
    if (filter === 'changed') return battle.groups.changed(g.row);
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="モンスターの名前・行で検索" filter={filter} setFilter={setFilter}
          options={[['used', 'モンスターのいる群れ'], ['fixed', '決まった並びだけ (ボスなど)'], ['all', 'すべて'], ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={groups.length} />
          <table className="book-table">
            <thead><tr><th>行</th><th>モンスター</th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.row} className={g.row === selected ? 'active' : ''} onClick={() => (location.hash = oahuGroupHref(g.row))}>
                  <td className="num muted">{g.row}</td>
                  <td>{names(g).join('・') || <span className="muted">なし</span>}{battle.groups.changed(g.row) && <EditedMark text=" ●" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        <GroupDetail key={selected} battle={battle} row={selected} onEdit={onEdit} />
      </div>
    </div>
  );
}

const SLOT_INFO = [
  '候補は 5 つずつ: モンスター (monsterParameter の行)、重み、数のコード (+0x03) です。重み 0 か行 0 の枠は使われません。',
  '先頭は 1 体目 (マップで見える) と 3 体目、なかまは 2 体目と 4 体目の候補です (RPG2 と同じ並びと推定)。数のコードは RPG2 (0〜7) にない 10・11・14 なども使われていて、意味はまだ分かりません。',
].join('\n');

function GroupDetail({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const rows = battle.groups;
  const p = { rows, row, onEdit };
  const monsters = useMemo((): [number, string][] => [[0, 'なし'], ...battle.monsterList().map((m): [number, string] => [m.id, `#${m.id} ${m.name}`])], [battle]);
  const slots = (side: 'lead' | 'mate'): ReactNode => (
    <table className="enc-table oahu-fields">
      <thead><tr><th></th><th>モンスター</th><th>重み</th><th>数</th></tr></thead>
      <tbody>
        {[1, 2, 3, 4, 5].map((i) => {
          const m = rows.get(row, `${side}${i}`);
          return (
            <tr key={i}>
              <td className="num muted">{i}</td>
              <td><FieldSelect {...p} k={`${side}${i}`} options={monsters} />{m > 0 && <a href={oahuMonsterHref(m)}> →</a>}</td>
              <td><FieldNumber {...p} k={`${side}${i}Weight`} /></td>
              <td><FieldNumber {...p} k={`${side}${i}Count`} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="book-head">
        <h2>{`群れ ${row}`}</h2>
        <span className="muted">monsterGroup の行</span>
      </div>
      <div className="monster-cols stats oahu-group-cols">
        <section><h3>先頭の候補 <InfoTip text={SLOT_INFO} /></h3>{slots('lead')}</section>
        <section><h3>なかまの候補</h3>{slots('mate')}</section>
        <section>
          <h3>決まった並び <InfoTip text="+0x28 から 5 体。ボス・宝箱の群れはこれだけを持ちます。ふつうの群れにある並びがいつ使われるかは未確認です。" /></h3>
          <table className="enc-table oahu-fields">
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i}><td className="num muted">{i}</td><td><FieldSelect {...p} k={`fixed${i}`} options={monsters} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <div className="row">
        <span className="muted small">変更はマスター (21350000) の monsterGroup.bin として書き出されます。</span>
        {rows.changed(row) && <button onClick={() => { rows.revert(row); onEdit(); }}>この群れの変更を元に戻す</button>}
      </div>
      <details className="row-fields-box">
        <summary>{`monsterGroup の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_MONSTER_GROUP} row={rows.row(row)} original={rows.originalRow(row)} context={battleContext(battle)} />
      </details>
    </>
  );
}
