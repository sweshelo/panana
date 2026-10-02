// RPG3's monster book (#/monsters/<row>), built from the same parts as RPG2's (ui/FieldEdit, ui/MonsterSlots,
// ui/GroupDetail): the name and description, stats, drops, skills and their AI, the actions of its states,
// resistances and the groups it is in. The model and motions wait for BCH (#64).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldContext } from '../game/tabledef';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { FieldChoice, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { SlotTiles } from '../ui/GroupDetail';
import { InfoTip } from '../ui/InfoTip';
import { Board, EmptyBoard } from '../ui/Board';
import { DropSlots, Heading, moveTo, ResistCharts, SkillSlots, type ResistChart } from '../ui/MonsterSlots';
import { RowFields } from '../ui/RowFields';
import { OAHU_MONSTER_TEXTS, type OahuBattle } from './battle';
import { enumOptions, MessageFields, rowAccess } from './FieldInput';
import {
  oahuActionEntry, OahuActionPicker, oahuGroupHref, oahuGroupMonster, oahuItemEntry, OahuItemPicker, oahuMonsterHref,
} from './pickers';
import type { OahuSession } from './session';
import { OAHU_AI_MODE, OAHU_MONSTER_PARAMETER, OAHU_MONSTER_RESISTS, OAHU_SKILLS } from './tables';

export { oahuActionHref, oahuGroupHref, oahuMonsterHref } from './pickers';

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

type Filter = 'all' | 'seen' | 'changed';

export function OahuMonsterPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const monsters = useMemo(() => battle.monsterList(), [battle, edits]);
  const groups = useMemo(() => {
    const out = new Map<number, number[]>();
    for (const g of battle.groupList()) {
      for (const m of new Set([...g.leads, ...g.mates].map((s) => s.monster).concat(g.fixed))) out.set(m, [...(out.get(m) ?? []), g.row]);
    }
    return out;
  }, [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => monsters.some((m) => m.id === r), () => monsters[0]?.id ?? 1);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const q = query.trim();
  const rows = monsters.filter((m) => {
    if (q && String(m.id) !== q && ![m.name, ...battle.usedSkills(m.id).map((s) => battle.actionName(s.action)), ...battle.drops(m.id).map((d) => battle.itemName(d.item))].some((t) => t.includes(q))) return false;
    if (filter === 'seen') return groups.has(m.id);
    if (filter === 'changed') return battle.monsterChanged(m.id);
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・ワザ・ドロップで検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['seen', '群れにいる'], ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={monsters.length} />
          <table className="book-table">
            <thead><tr><th>#</th><th>名前</th><th>Lv</th><th>HP</th><th>群れ</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.id === selected ? 'active' : ''} onClick={() => (location.hash = oahuMonsterHref(m.id))}>
                  <td className="num muted">{m.id}</td>
                  <td>{m.name}{battle.monsterChanged(m.id) && <EditedMark text=" ●" />}</td>
                  <td className="num">{m.level}</td>
                  <td className="num">{m.hp[1]}</td>
                  <td className="num muted">{groups.get(m.id)?.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {monsters.some((m) => m.id === selected) && <MonsterDetail key={selected} session={session} row={selected} groups={groups.get(selected) ?? []} onEdit={onEdit} />}
      </div>
    </div>
  );
}

const STAT_INFO = '戦闘のたびに、下と上の間の乱数になります (FUN_004CCBE8)。上の値は固定のとき (ボスなど) の値です。';

function MonsterDetail({ session, row, groups, onEdit }: { session: OahuSession; row: number; groups: number[]; onEdit: () => void }): ReactNode {
  const { battle } = session;
  const rows = battle.monsters;
  const f = rowAccess(rows, row);
  const monster = oahuGroupMonster(battle);
  return (
    <>
      <div className="book-head">
        <h2 className="with-info">{battle.monsterName(row)}<InfoTip text="変更はマスター (21350000) の monsterParameter.bin とメッセージとして書き出されます。" /></h2>
        <span className="muted">{`#${row}  ミュージアム ${rows.get(row, 'museum')}`}</span>
        {battle.monsterChanged(row) && <button onClick={() => { battle.revertMonster(row); onEdit(); }}>このモンスターの変更を元に戻す</button>}
      </div>
      <MessageFields rows={rows} row={row} fields={OAHU_MONSTER_TEXTS} texts={battle.texts} message={(id) => battle.message(id)} onEdit={onEdit} />
      <StatFields f={f} edited={onEdit} stats={[
        { label: 'Lv', k: 'level' },
        { label: 'HP', range: ['hpMin', 'hpMax'], info: STAT_INFO },
        { label: 'AP', range: ['apMin', 'apMax'] },
        { label: 'こうげき', range: ['attackMin', 'attackMax'] },
        { label: 'ぼうぎょ', range: ['defenseMin', 'defenseMax'] },
        { label: 'すばやさ', range: ['speedMin', 'speedMax'] },
        { label: '回避', k: 'evasion' },
        { label: '経験値', k: 'exp' },
        { label: 'ゴールド', k: 'gold' },
        { label: 'こうげき倍増', k: 'attacks', info: '1 ターンにこうげきする回数を増やす状態 (効果 9、conditionData 52) の値。' },
        { label: 'ゴースト', k: 'ghost', info: 'ゴースト化の状態 (効果 0x10、conditionData 60) を持つ。' },
      ]} />
      <div className="book-cols monster-cols">
        <DropEditor battle={battle} row={row} f={f} onEdit={onEdit} />
        <SkillEditor battle={battle} row={row} f={f} onEdit={onEdit} />
        <StateActions battle={battle} row={row} onEdit={onEdit} />
      </div>
      <h3 className="with-info">たいせい<InfoTip text={RESIST_INFO} /></h3>
      <ResistEditor battle={battle} row={row} onEdit={onEdit} />
      <h3>{`いる群れ (${groups.length})`}</h3>
      <div className="book-where">
        {!groups.length && <div className="muted">どの群れにもいません</div>}
        {groups.map((g) => {
          const x = battle.group(g);
          return (
            <details key={g}>
              <summary><a href={oahuGroupHref(g)}>{`群れ #${g}`}</a>{!x.leads.some((s) => s.monster === row) && !x.fixed.includes(row) && <span className="muted"> 仲間としてのみ</span>}</summary>
              <div className="enc-group">
                <SlotTiles title="先頭・3 体目" slots={x.leads} monster={monster} count={String} />
                <SlotTiles title="2・4 体目" slots={x.mates} monster={monster} count={String} />
                {x.fixed.length > 0 && <SlotTiles title="決まった並び" slots={x.fixed.map((m) => ({ monster: m, weight: 0, count: 1 }))} monster={monster} count={String} />}
              </div>
            </details>
          );
        })}
      </div>
      <details className="row-fields-box">
        <summary>{`monsterParameter の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_MONSTER_PARAMETER} row={rows.row(row)} original={rows.originalRow(row)} context={battleContext(battle)} />
      </details>
    </>
  );
}

interface EditProps {
  battle: OahuBattle;
  row: number;
  f: FieldAccess;
  onEdit: () => void;
}

const DROP_INFO = '3 枠はそれぞれ別に抽選されます (FUN_004CD440)。率は 0〜15 の値で、RPG2 と同じく大きいほど出にくいと推定しています。';

function DropEditor({ battle, row, f, onEdit }: EditProps): ReactNode {
  const [, max] = f.range('drop1');
  return (
    <DropSlots
      info={DROP_INFO}
      slots={battle.drops(row).map((d) => ({
        item: d.item,
        original: f.original(`drop${d.slot}`),
        rate: <FieldChoice f={f} k={`rate${d.slot}`} edited={onEdit} labels={(v) => `率 ${v}`} />,
      }))}
      entry={(id) => oahuItemEntry(battle, id)}
      setItem={(k, id) => { f.set(`drop${k + 1}`, id); onEdit(); }}
      picker={(k, current, pick, close) => (
        <OahuItemPicker battle={battle} title={`ドロップ ${k + 1} のアイテムを選ぶ`} current={current}
          unavailable={(it) => (it.id > max ? `ドロップの欄に入らない番号です (${max} まで)` : null)} onPick={pick} onClose={close} />
      )}
    />
  );
}

const SKILL_INFO = [
  '最大 6 枠。ドラッグで並べ替え、× で外します。',
  '枠ごとの「条件」は、そのワザを使える条件の表 (マスター +0x818) の行です (下位 4 ビット)。中身はまだ分かりません。',
  '選び方 (+0x38 bit12-14) は、使えるワザからどう選ぶか。使えるワザがないときは「使えないとき」の枠のワザを使います (FUN_001BE560)。',
].join('\n');

function SkillEditor({ battle, row, f, onEdit }: EditProps): ReactNode {
  const skills = battle.usedSkills(row);
  const set = (next: { action: number; condition: number; from: number }[]): void => {
    battle.setSkills(row, next);
    onEdit();
  };
  const now = skills.map((s) => ({ action: s.action, condition: s.condition, from: s.slot }));
  const fallback = f.get('fallback');
  return (
    <section>
      <Heading title="ワザと行動" info={SKILL_INFO} />
      <SkillSlots
        slots={skills.map((s) => ({
          action: s.action,
          entry: oahuActionEntry(battle, s.action),
          edited: f.original(`skill${s.slot}`) !== s.action,
          extra: <span className="slot-cond" title="使える条件の表 (マスター +0x818) の行">条件 <FieldChoice f={f} k={`cond${s.slot}`} edited={onEdit} /></span>,
        }))}
        max={OAHU_SKILLS}
        move={(from, to) => set(moveTo(now, from, to))}
        pick={(i, a) => set(i < 0 ? [...now, { action: a, condition: 1, from: 0 }] : now.map((s, j) => (j === i ? { ...s, action: a } : s)))}
        remove={(i) => set(now.filter((_, j) => j !== i))}
        picker={(current, pick, close) => <OahuActionPicker battle={battle} current={current} onPick={pick} onClose={close} />}
        empty="ワザがありません。"
      />
      <table className="enc-table ai-fields">
        <tbody>
          <tr><td className="with-info">AI<InfoTip text="ワザの選び方 (+0x38 bit12-14)。FUN_001BE560 が 5 通りに分けていて、RPG2 の AI の型と同じと推定しています。" /></td>
            <td><FieldChoice f={f} k="ai" edited={onEdit} options={enumOptions(OAHU_AI_MODE, true)} /></td></tr>
          <tr><td>使えないとき</td>
            <td><FieldChoice f={f} k="fallback" edited={onEdit} options={skills.map((s, i): [number, string] => [i, `${i + 1}: ${battle.actionName(s.action)}`])} />
              {fallback >= skills.length && <span className="muted small">{` 枠 ${fallback + 1} (空)`}</span>}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

const STATE_ACTIONS: [string, string, string][] = [
  ['auto', '自動', '効果 0x2D。ターンごとに自動で使うアクション。'],
  ['body', 'ボディ', '効果 0x2F。攻撃を受けたときのアクション (どくボディなど)。'],
  ['body2', 'ボディ 2', '効果 0x2F の 2 つ目。'],
  ['act2B', '効果 0x2B', '効果 0x2B のアクション (意味は未確認)。'],
  ['act2C', '効果 0x2C', '効果 0x2C のアクション (意味は未確認)。'],
];

/** The actions the monster's states use, as boards picked from the action list. */
function StateActions({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const [picking, setPicking] = useState<string | null>(null);
  const rows = battle.monsters;
  const set = (k: string, v: number): void => {
    rows.set(row, k, v);
    onEdit();
  };
  return (
    <section>
      <Heading title="状態のアクション" info="モンスターが最初から持つ状態 (装備の効果と同じ番号) が使うアクション (FUN_004CCBE8)。" />
      <table className="enc-table ai-fields">
        <tbody>
          {STATE_ACTIONS.map(([k, label, info]) => {
            const v = rows.get(row, k);
            const e = v ? oahuActionEntry(battle, v) : null;
            return (
              <tr key={k}>
                <td className="with-info">{label}<InfoTip text={info} /></td>
                <td>
                  <div className="slot-row">
                    {e
                      ? <Board icon={e.icon} name={e.name} id={v} href={e.href} edited={v !== rows.original(row, k)} title="アクションを選び直す" onClick={() => setPicking(k)} />
                      : <EmptyBoard label="＋ アクション" onClick={() => setPicking(k)} />}
                    <button className="small slot-remove" title="なしにする" disabled={!v} onClick={() => set(k, 0)}>×</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {picking && (
        <OahuActionPicker battle={battle} title="アクションを選ぶ" current={rows.get(row, picking)} onClose={() => setPicking(null)}
          onPick={(a) => { setPicking(null); set(picking, a); }} />
      )}
    </section>
  );
}

const RESIST_INFO = [
  '値は −9〜+10 (正ほど強い)。RPG2 と同じく、属性は +10 で効かなくなると推定しています。',
  '戦闘のユニットの状態 1〜31 に読み込まれ、装備の効果 0x15 (属性) と 0x14 (状態異常) の対象の番号と同じ並びです (FUN_004CCBE8)。',
  '能力の増減は、状態の番号 16〜19 の位置にある値で、能力ダウンへのたいせいと推定しています。',
].join('\n');

const RESIST_CHARTS: [string, string[]][] = [
  ['属性', OAHU_MONSTER_RESISTS.slice(0, 8).map(([k]) => k)],
  ['状態異常・突然死', OAHU_MONSTER_RESISTS.slice(8).map(([k]) => k)],
  ['能力の増減', ['rAttack', 'rDefense', 'rSpeed', 'rEvasion']],
];

function ResistEditor({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const rows = battle.monsters;
  const charts: ResistChart[] = RESIST_CHARTS.map(([label, keys]) => ({
    label,
    axes: keys.map((k) => ({ name: rows.field(k).label.replace(/^たいせい /, '').replace(/の増減$/, ''), value: rows.get(row, k), original: rows.original(row, k) })),
  }));
  return (
    <ResistCharts charts={charts} min={-9} max={10} rings={[-9, -5, 0, 5, 10]} effect={() => ''}
      onChange={(c, j, v) => { rows.set(row, RESIST_CHARTS[c]![1][j]!, v); onEdit(); }} />
  );
}
