// RPG3's actions (#/actions/<row>): the skills of the monsters, the items' actions and the antennas of actionData, with
// their category, element, range, power and the state they give; the messages and the known fields are edited, and
// the monsters and items that use an action are listed.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACTION_RANGE } from '../game/actions';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { RowFields } from '../ui/RowFields';
import { OAHU_ACTION_TEXTS, type OahuBattle } from './battle';
import { enumOptions, FieldNumber, FieldSelect, MessageFields, Stat } from './FieldInput';
import { battleContext, oahuActionHref, oahuMonsterHref } from './MonsterPage';
import type { OahuSession } from './session';
import { OAHU_ACTION_CATEGORY, OAHU_ACTION_DATA, OAHU_ACTION_KIND, OAHU_ACTION_SIDE, OAHU_ELEMENT_NAMES, OAHU_STATE_CODE } from './tables';

const PAGE = 300;

export function OahuActionPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => battle.actionList(), [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => r > 0 && r < battle.actions.rows, () => actions[0]?.row ?? 1);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const q = query.trim();
  const rows = actions.filter((a) => {
    if (q && !a.name.includes(q) && String(a.row) !== q) return false;
    if (filter.startsWith('c')) return a.category === Number(filter.slice(1));
    if (filter.startsWith('k')) return a.kind === Number(filter.slice(1));
    if (filter === 'changed') return battle.actionChanged(a.row);
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="名前・行で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべて'], ...Object.entries(OAHU_ACTION_KIND).map(([k, v]): [string, string] => [`k${k}`, `種類: ${v}`]),
            ...Object.entries(OAHU_ACTION_CATEGORY).map(([k, v]): [string, string] => [`c${k}`, `系統: ${v}`]), ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={actions.length} />
          <table className="book-table">
            <thead><tr><th>行</th><th>名前</th><th>系統</th><th>属性</th><th>威力</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((a) => (
                <tr key={a.row} className={a.row === selected ? 'active' : ''} onClick={() => (location.hash = oahuActionHref(a.row))}>
                  <td className="num muted">{a.row}</td>
                  <td className={a.kind === 2 ? 'action-monster' : ''}>{a.name}{battle.actionChanged(a.row) && <EditedMark text=" ●" />}</td>
                  <td className="muted nowrap">{a.kind === 2 ? OAHU_ACTION_KIND[2] : OAHU_ACTION_CATEGORY[a.category] ?? a.category}</td>
                  <td className="nowrap">{a.element ? OAHU_ELEMENT_NAMES[a.element] ?? a.element : ''}</td>
                  <td className="num nowrap">{a.power[0] || a.power[1] ? `${a.power[0]}〜${a.power[1]}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${rows.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        <ActionDetail key={selected} battle={battle} row={selected} onEdit={onEdit} />
      </div>
    </div>
  );
}

function ActionDetail({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const rows = battle.actions;
  const p = { rows, row, onEdit };
  const users = useMemo(() => battle.actionUsers(row), [battle, row]);
  const shared = useMemo(() => OAHU_ACTION_TEXTS.filter(([k]) => battle.actionsSharing(row, k) > 1).map(([, label]) => label), [battle, row]);
  return (
    <>
      <div className="book-head">
        <h2>{battle.actionName(row) || `アクション ${row}`}</h2>
        <span className="muted">{`actionData の行 ${row}  ${OAHU_ACTION_KIND[rows.get(row, 'kind')] ?? `種類 ${rows.get(row, 'kind')}`} / ${OAHU_ACTION_CATEGORY[rows.get(row, 'category')] ?? `系統 ${rows.get(row, 'category')}`}`}</span>
      </div>
      {rows.get(row, 'kind') === 2 && <MonsterRowNote battle={battle} row={row} />}
      <MessageFields rows={rows} row={row} fields={OAHU_ACTION_TEXTS} texts={battle.texts} message={(id) => battle.message(id)} onEdit={onEdit} />
      {shared.length > 0 && <div className="muted small">{`${shared.join('・')}のメッセージはほかのアクションと共通です。書き換えると、同じメッセージを使うすべてのアクションで変わります。`}</div>}
      <div className="stats stat-edit oahu-stats">
        <Stat label="威力・量" info="+0x18 と +0x1A。攻撃の威力、回復の量など。"><FieldNumber {...p} k="min" />〜<FieldNumber {...p} k="max" /></Stat>
        <Stat label="属性" info={ELEMENT_INFO}><FieldSelect {...p} k="element" options={enumOptions(OAHU_ELEMENT_NAMES)} /></Stat>
        <Stat label="範囲" info="w0 bit21-24。番号の意味は RPG2 と同じと推定しています。"><FieldSelect {...p} k="range" options={enumOptions(ACTION_RANGE, true)} /></Stat>
        <Stat label="狙う側" info="w0 bit19-20。1 なら自分の側 (回復・能力アップ)。"><FieldSelect {...p} k="side" options={enumOptions(OAHU_ACTION_SIDE)} /></Stat>
        <Stat label="状態" info="+0x2E。付ける (治す) 状態の番号で、装備の効果 0x14 の対象と同じ並び。"><FieldSelect {...p} k="state" options={[[0, 'なし'], ...enumOptions(OAHU_STATE_CODE, true)]} /></Stat>
      </div>
      {(users.monsters.length > 0 || users.items.length > 0) && (
        <div className="row">
          {'使うもの: '}
          {users.monsters.map((m) => <a key={`m${m}`} href={oahuMonsterHref(m)}>{battle.monsterName(m)}</a>)}
          {users.items.map((i) => <a key={`i${i}`} href={`#/items/${i}`}>{battle.itemName(i)}</a>)}
        </div>
      )}
      <div className="row">
        <span className="muted small">変更はマスター (21350000) の actionData.bin とメッセージとして書き出されます。</span>
        {battle.actionChanged(row) && <button onClick={() => { battle.revertAction(row); onEdit(); }}>このアクションの変更を元に戻す</button>}
      </div>
      <details className="row-fields-box" open>
        <summary>{`actionData の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_ACTION_DATA} row={rows.row(row)} original={rows.originalRow(row)} context={battleContext(battle)} />
      </details>
    </>
  );
}

const ELEMENT_INFO = 'w0 bit27-31。10〜25 は 2 つの属性 (火・氷 など) で、ダメージを半分ずつそれぞれの属性のたいせいで計算して足します (FUN_001B82B0)。';

/**
 * The action of a caught monster (kind 2): named after the monster (monsterParameter +0x3C points here) and followed
 * by its skills. A 電波人間 holding a monster caught with the antenna つかまえる (+0x6A) uses it (FUN_004CB7C0).
 */
function MonsterRowNote({ battle, row }: { battle: OahuBattle; row: number }): ReactNode {
  const monsters = useMemo(() => {
    const out: number[] = [];
    for (let m = 1; m < battle.monsters.rows; m++) if (battle.monsters.get(m, 'name') && battle.monsters.get(m, 'own') === row) out.push(m);
    return out;
  }, [battle, row]);
  const skills = useMemo(() => [...new Set(monsters.flatMap((m) => battle.usedSkills(m).map((s) => s.action)))].sort((a, b) => a - b), [battle, monsters]);
  return (
    <div className="muted small book-desc">
      {'アンテナ「つかまえる」でつかまえたモンスターを、戦闘で使ったときのアクションです。'}
      {monsters.length > 0 && <>{'この行を持つモンスター: '}{monsters.map((m, i) => <Fragment key={m}>{i > 0 && '・'}<a href={oahuMonsterHref(m)}>{`${battle.monsterName(m)} (#${m})`}</a></Fragment>)}{'。'}</>}
      {skills.length > 0 && <>{'ワザ: '}{skills.map((a, i) => <Fragment key={a}>{i > 0 && '・'}<a href={oahuActionHref(a)}>{`#${a}`}</a></Fragment>)}{'。'}</>}
      {'つかまえたモンスターは電波人間の +0x6A に入り、使うとこの行が実行されます (FUN_004CB7C0)。威力・属性・演出もこの行のものが使われます。'}
    </div>
  );
}
