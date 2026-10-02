// RPG3's monster book (#/monsters/<row>): every monster of monsterParameter with its level, HP, experience and gold;
// the name and description, stats, drops, skills and their AI, resistances and the actions of its states are edited.
// The model and motions wait for BCH (#64).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldContext } from '../game/tabledef';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { RowFields } from '../ui/RowFields';
import { OAHU_MONSTER_TEXTS, type OahuBattle } from './battle';
import { enumOptions, FieldNumber, FieldSelect, MessageFields, Stat, type FieldProps } from './FieldInput';
import type { OahuSession } from './session';
import { OAHU_AI_MODE, OAHU_MONSTER_PARAMETER, OAHU_MONSTER_RESISTS } from './tables';

export const oahuMonsterHref = (row: number): string => `#/monsters/${row}`;
export const oahuGroupHref = (row: number): string => `#/groups/${row}`;
export const oahuActionHref = (row: number): string => `#/actions/${row}`;

/** Names of the rows the field values of the battle tables point at. */
export function battleContext(battle: OahuBattle): FieldContext {
  return {
    message: (id) => battle.message(id),
    rowName: (table, row) => table === 'actionData.bin' ? battle.actionName(row)
      : table === 'monsterParameter.bin' ? battle.monsterName(row).replace(/^#\d+$/, '')
      : table === 'itemData.bin' ? battle.itemName(row)
      : table === 'conditionData.bin' ? battle.conditionName(row) : undefined,
  };
}

export function OahuMonsterPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const monsters = useMemo(() => battle.monsterList(), [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => monsters.some((m) => m.id === r), () => monsters[0]?.id ?? 1);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const q = query.trim();
  const rows = monsters.filter((m) => {
    if (q && !m.name.includes(q) && String(m.id) !== q) return false;
    if (filter === 'changed') return battle.monsterChanged(m.id);
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・行で検索" filter={filter} setFilter={setFilter} options={[['all', 'すべて'], ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={monsters.length} />
          <table className="book-table">
            <thead><tr><th>行</th><th>名前</th><th>Lv</th><th>HP</th><th>経験値</th><th>G</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.id === selected ? 'active' : ''} onClick={() => (location.hash = oahuMonsterHref(m.id))}>
                  <td className="num muted">{m.id}</td>
                  <td>{m.name}{battle.monsterChanged(m.id) && <EditedMark text=" ●" />}</td>
                  <td className="num">{m.level}</td>
                  <td className="num nowrap">{m.hp[0] === m.hp[1] ? m.hp[1] : `${m.hp[0]}〜${m.hp[1]}`}</td>
                  <td className="num">{m.exp}</td>
                  <td className="num">{m.gold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {monsters.some((m) => m.id === selected) && <MonsterDetail key={selected} session={session} row={selected} onEdit={onEdit} />}
      </div>
    </div>
  );
}

const STAT_INFO = '戦闘のたびに、下と上の間の乱数になります (FUN_004CCBE8)。上の値は固定のとき (ボスなど) の値です。';

function MonsterDetail({ session, row, onEdit }: { session: OahuSession; row: number; onEdit: () => void }): ReactNode {
  const { battle } = session;
  const rows = battle.monsters;
  const p = { rows, row, onEdit };
  const range = (label: string, lo: string, hi: string, info?: string): ReactNode => (
    <Stat label={label} info={info}><FieldNumber {...p} k={lo} />〜<FieldNumber {...p} k={hi} /></Stat>
  );
  const groups = battle.groupsOf(row);
  const context = battleContext(battle);
  return (
    <>
      <div className="book-head">
        <h2>{battle.monsterName(row)}</h2>
        <span className="muted">{`行 ${row}  ミュージアム ${rows.get(row, 'museum')}`}</span>
      </div>
      <MessageFields rows={rows} row={row} fields={OAHU_MONSTER_TEXTS} texts={battle.texts} message={(id) => battle.message(id)} onEdit={onEdit} />
      <div className="stats stat-edit oahu-stats">
        <Stat label="レベル"><FieldNumber {...p} k="level" /></Stat>
        {range('HP', 'hpMin', 'hpMax', STAT_INFO)}
        {range('AP', 'apMin', 'apMax')}
        {range('こうげき', 'attackMin', 'attackMax')}
        {range('ぼうぎょ', 'defenseMin', 'defenseMax')}
        {range('すばやさ', 'speedMin', 'speedMax')}
        <Stat label="かいひ"><FieldNumber {...p} k="evasion" /></Stat>
        <Stat label="経験値"><FieldNumber {...p} k="exp" /></Stat>
        <Stat label="ゴールド"><FieldNumber {...p} k="gold" /></Stat>
        <Stat label="こうげき倍増" info="1 ターンにこうげきする回数を増やす状態 (効果 9、conditionData 52) の値。"><FieldNumber {...p} k="attacks" /></Stat>
        <Stat label="ゴースト" info="ゴースト化の状態 (効果 0x10、conditionData 60) を持つ。"><FieldNumber {...p} k="ghost" /></Stat>
      </div>
      <div className="monster-cols stats">
        <section>
          <h3>ドロップ</h3>
          <Drops battle={battle} row={row} onEdit={onEdit} />
          <h3>ワザ <InfoTip text={SKILL_INFO} /></h3>
          <Skills battle={battle} row={row} onEdit={onEdit} />
        </section>
        <section>
          <h3>たいせい <InfoTip text={RESIST_INFO} /></h3>
          <Resists {...p} />
          <h3>状態のアクション</h3>
          <table className="enc-table oahu-fields">
            <tbody>
              {([['auto', '自動 (効果 0x2D)'], ['body', 'ボディ (効果 0x2F)'], ['body2', 'ボディ 2'], ['act2B', '効果 0x2B'], ['act2C', '効果 0x2C']] as const).map(([k, label]) => (
                <tr key={k}><th>{label}</th><td><ActionRef {...p} k={k} battle={battle} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {groups.length > 0 && (
        <div className="row">
          {'群れ: '}
          {groups.map((g) => <a key={g} href={oahuGroupHref(g)}>{`#${g}`}</a>)}
        </div>
      )}
      <div className="row">
        <span className="muted small">変更はマスター (21350000) の monsterParameter.bin とメッセージとして書き出されます。</span>
        {battle.monsterChanged(row) && <button onClick={() => { battle.revertMonster(row); onEdit(); }}>このモンスターの変更を元に戻す</button>}
      </div>
      <details className="row-fields-box">
        <summary>{`monsterParameter の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_MONSTER_PARAMETER} row={rows.row(row)} original={rows.originalRow(row)} context={context} />
      </details>
    </>
  );
}

const SKILL_INFO = [
  'ワザの枠 6 つ (+0x54〜、u16 ずつ): 上位 12 ビットがアクション (actionData の行)、下位 4 ビットが使える条件の表の行です (FUN_001BE560)。',
  '選び方 (+0x38 bit12-14) は、使えるワザからどう選ぶか。使えるワザがないときは +0x38 bit15-17 の枠のワザを使います。',
].join('\n');

function Skills({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const p = { rows: battle.monsters, row, onEdit };
  return (
    <>
      <table className="enc-table oahu-fields">
        <thead><tr><th>枠</th><th>アクション</th><th>条件</th></tr></thead>
        <tbody>
          {battle.skills(row).map((s) => (
            <tr key={s.slot}>
              <td className="num muted">{s.slot}</td>
              <td><ActionRef {...p} k={`skill${s.slot}`} battle={battle} /></td>
              <td><FieldNumber {...p} k={`cond${s.slot}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        {'選び方 '}<FieldSelect {...p} k="ai" options={enumOptions(OAHU_AI_MODE, true)} />
        {' 使えないとき '}<FieldNumber {...p} k="fallback" min={0} max={5} />{' の枠'}
      </div>
    </>
  );
}

/** An action number with its name, linked to the action book. */
function ActionRef(p: FieldProps & { battle: OahuBattle }): ReactNode {
  const v = p.rows.get(p.row, p.k);
  return (
    <span className="with-info">
      <FieldNumber {...p} />
      {v ? <a href={oahuActionHref(v)}>{p.battle.actionName(v) || `#${v}`}</a> : <span className="muted">なし</span>}
    </span>
  );
}

function Drops({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const p = { rows: battle.monsters, row, onEdit };
  return (
    <table className="enc-table oahu-fields">
      <thead><tr><th></th><th>アイテム</th><th>率 <InfoTip text="ドロップの率の値 (0〜15)。RPG2 と同じく、大きいほど出にくいと推定しています。" /></th></tr></thead>
      <tbody>
        {battle.drops(row).map((d) => (
          <tr key={d.slot}>
            <td className="num muted">{d.slot}</td>
            <td><span className="with-info"><FieldNumber {...p} k={`drop${d.slot}`} />{d.item ? <a href={`#/items/${d.item}`}>{battle.itemName(d.item)}</a> : <span className="muted">なし</span>}</span></td>
            <td><FieldNumber {...p} k={`rate${d.slot}`} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const RESIST_INFO = [
  'たいせいは −9〜+9 (5 ビットの符号つき)。RPG2 と同じく、属性は +10 で効かなくなると推定しています。',
  '戦闘のユニットの状態 1〜31 に読み込まれ、装備の効果 0x15 (属性) と 0x14 (状態異常) の対象の番号と同じ並びです (FUN_004CCBE8)。',
].join('\n');

function Resists(p: { rows: OahuBattle['monsters']; row: number; onEdit: () => void }): ReactNode {
  return (
    <div className="stats stat-edit oahu-resists">
      {OAHU_MONSTER_RESISTS.map(([k, label]) => <Stat key={k} label={label}><FieldNumber {...p} k={k} min={-9} max={10} /></Stat>)}
    </div>
  );
}
