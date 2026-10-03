// RPG3's monster book (#/monsters/<row>), built from the same parts as RPG2's (ui/FieldEdit, ui/MonsterSlots,
// ui/GroupDetail): the model, the name and description, stats, drops, skills and their AI, the actions of its states,
// resistances and the groups it is in.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldContext } from '../game/tabledef';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { FieldChoice, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { SlotTiles } from '../ui/GroupDetail';
import { InfoTip } from '../ui/InfoTip';
import { Board, EmptyBoard } from '../ui/Board';
import { DropSlots, Heading, moveTo, ResistCharts, SkillSlots, type ResistChart } from '../ui/MonsterSlots';
import { ModelView } from '../ui/ModelView';
import { oneIn, pct } from '../pages/monsteredit';
import { RowFields } from '../ui/RowFields';
import { OAHU_MONSTER_TEXTS, type OahuBattle, type OahuFormChange } from './battle';
import { enumOptions, MessageFields, rowAccess } from './FieldInput';
import {
  oahuActionEntry, oahuActionHref, OahuActionPicker, oahuGroupHref, oahuGroupMonster, oahuItemEntry, OahuItemPicker, oahuMonsterHref, oahuMonsterIcon, OahuMonsterPicker,
} from './pickers';
import type { OahuSession } from './session';
import { OAHU_AI_MODE, OAHU_MONSTER_PARAMETER, OAHU_MONSTER_RESISTS, OAHU_SKILL_CONDITION, OAHU_SKILL_CONDITION_NOTE, OAHU_SKILLS, oahuTriggerLabel } from './tables';

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
            <thead><tr><th></th><th>#</th><th>名前</th><th>Lv</th><th>HP</th><th>群れ</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.id === selected ? 'active' : ''} onClick={() => (location.hash = oahuMonsterHref(m.id))}>
                  <td className="photo-cell">{oahuMonsterIcon(battle, m.id)}</td>
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
        <span className="muted">{`#${row}  図鑑 ${rows.get(row, 'book')}  ミュージアム ${rows.get(row, 'museum')}  デザイン ${rows.get(row, 'design')}`}</span>
        {battle.monsterChanged(row) && <button onClick={() => { battle.revertMonster(row); onEdit(); }}>このモンスターの変更を元に戻す</button>}
      </div>
      <div className="book-top">
        <div>
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
        </div>
        <MonsterModel battle={battle} row={row} />
      </div>
      <div className="book-cols monster-cols">
        <DropEditor battle={battle} row={row} f={f} onEdit={onEdit} />
        <SkillEditor battle={battle} row={row} f={f} onEdit={onEdit} />
        <StateActions battle={battle} row={row} onEdit={onEdit} />
      </div>
      <FormChanges battle={battle} row={row} onEdit={onEdit} />
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

const DROP_INFO = [
  '率の値ごとに battleParameter の表 (+0xE6) で「何回に 1 回落とすか」が決まり、3 枠はそれぞれ別に抽選されます (FUN_001C3994)。',
  '値 0 は抽選なしで必ず、1〜9 はおたから、10〜12 はレア、13〜15 は激レア (FUN_004CAB64)。パーティーの「ドロップ率」「レアドロップ率」「激レアドロップ率」(状態 37〜39、%) がそれぞれに効きます。',
  '確率 = 1 − (1 − 1/表の値)^(% / 100)。表示は補正なしのときです。',
].join('\n');

function DropEditor({ battle, row, f, onEdit }: EditProps): ReactNode {
  const [, max] = f.range('drop1');
  return (
    <DropSlots
      info={DROP_INFO}
      slots={battle.drops(row).map((d) => ({
        item: d.item,
        original: f.original(`drop${d.slot}`),
        sub: `${battle.dropClass(d.rate).label}・${pct(battle.dropOdds(d.rate))}`,
        rate: <FieldChoice f={f} k={`rate${d.slot}`} edited={onEdit} labels={(v) => `${v}: ${oneIn(battle.dropOdds(v))}`} />,
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

const CONDITION_OPTIONS = Object.entries(OAHU_SKILL_CONDITION).map(([k, n]): [number, string] => [Number(k), `${k} ${n}`]);

const SKILL_INFO = [
  '最大 6 枠。ドラッグで並べ替え、× で外します。',
  '枠ごとの「条件」は、402F0000 の monsterBrain.bin の行です (下位 4 ビット)。そのワザを使えるかどうか (AP・自分の HP・1 回だけ) と、どの相手を狙うかを決めます (FUN_0018F13C)。名前は開発用のモンスター「知能：…」から。',
  ...Object.entries(OAHU_SKILL_CONDITION).map(([k, n]) => `${k} ${n}: ${OAHU_SKILL_CONDITION_NOTE[Number(k)]}`),
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
          extra: <span className="slot-cond" title={OAHU_SKILL_CONDITION_NOTE[s.condition]}>条件 <FieldChoice f={f} k={`cond${s.slot}`} edited={onEdit} options={CONDITION_OPTIONS} /></span>,
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
  ['own', 'つかまえたとき', '+0x3C。アンテナ「つかまえる」でつかまえたこのモンスターを、戦闘で使ったときのアクション (actionData の種類 2 の行)。'],
  ['auto', '自動', '効果 0x2D。ターンごとに自動で使うアクション。'],
  ['body', 'ボディ', '効果 0x2F。攻撃を受けたときのアクション (どくボディなど)。種類 3 のアクションが、その「発動の条件」(+0x2A) を満たすと出ます。ボスの変身もここに入ります。'],
  ['body2', 'ボディ 2', '効果 0x2F の 2 つ目。'],
  ['act2B', '効果 0x2B', '効果 0x2B のアクション。ほかの形態からこの行に変わった直後に続けて出します (FUN_001B459C)。元のデータではどの行も 0 です。'],
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
      <Heading title="ほかのアクション" info="つかまえたときのアクションと、モンスターが最初から持つ状態 (装備の効果と同じ番号) が使うアクション (FUN_004CCBE8)。" />
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

const FORM_INFO = [
  'RPG3 の変身はアクションで起きます。系統 21・22 (形態を変える) のアクションが出ると、そのアクションの +0x1A の行の形態に作り直します (FUN_0029C93C)。',
  'ワザの枠に入れると、ほかのワザと同じように AI が選びます。ボディ (効果 0x2F) などの枠に入れた種類 3 のアクションは、アクションの「発動の条件」(+0x2A) を満たすと出ます (FUN_001B7D18)。',
  '条件 101 (倒される一撃を受けたとき) では倒れずに変身し、HP が戻ります。RPG2 のボス特殊番号と次の形態 (+0x50) に当たる欄はありません。',
  '見た目 (モデル) が変わるのは系統 22 だけです。系統 22 は、戦闘の始めに読んでおいた「変身の見た目」(+0x62) のモデルと入れ替えます (FUN_0029BAD0・FUN_0029C790)。系統 21 は能力と名前だけが変わり、見た目は元のままです。',
].join('\n');

const MODEL_INFO = [
  'monsterParameter +0x62。戦闘の始めに、この行のモンスターのモデルも読んでおきます (0 なら読みません、FUN_0029BAD0)。',
  '系統 22 のアクションで変身すると、このモデルと入れ替わります (FUN_0029C790)。能力と名前はアクションの +0x1A の行になるので、ふつうは同じ行にします。',
  '読んでおけるモデルは 1 つだけです。元のデータではドローンＺ (#160 → #161) だけが持っています。',
].join('\n');

function formVia(via: string): string {
  if (via.startsWith('skill')) return `ワザ ${via.slice(5)}`;
  return STATE_ACTIONS.find(([k]) => k === via)?.[1] ?? via;
}

/** The form changes from this row and into it (the actions of category 21 / 22 and the rows they point at). */
function FormChanges({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const [picking, setPicking] = useState(false);
  const rows = battle.monsters;
  const out = battle.formChanges(row);
  const into = battle.formSources(row);
  const model = rows.get(row, 'formModel');
  if (!out.length && !into.length && !model) return null;
  const set = (v: number): void => {
    rows.set(row, 'formModel', v);
    onEdit();
  };
  const looks = (c: OahuFormChange): string => {
    if (battle.actions.get(c.action, 'category') !== 22) return '系統 21 なので見た目は変わりません';
    if (!model) return '変身の見た目 (+0x62) がないので見た目は変わりません';
    return model === c.to ? '' : `見た目は ${battle.monsterName(model)} (#${model}) になります`;
  };
  const line = (c: OahuFormChange): ReactNode => (
    <>
      <a href={oahuActionHref(c.action)}>{battle.actionLabel(c.action)}</a>
      <span className="muted">{c.trigger === null ? '' : ` (${oahuTriggerLabel(c.trigger)})`}</span>
    </>
  );
  return (
    <section>
      <Heading title="変身" info={FORM_INFO} />
      <table className="enc-table ai-fields">
        <tbody>
          {out.map((c) => (
            <tr key={`o${c.via}`}>
              <td>{formVia(c.via)}</td>
              <td>
                {line(c)}{' → '}<a href={oahuMonsterHref(c.to)}>{`${battle.monsterName(c.to)} (#${c.to})`}</a>
                {looks(c) && <span className="muted small">{` ${looks(c)}`}</span>}
              </td>
            </tr>
          ))}
          <tr>
            <td className="with-info">変身の見た目<InfoTip text={MODEL_INFO} /></td>
            <td>
              <div className="slot-row">
                {model
                  ? <Board icon={oahuMonsterIcon(battle, model, true)} name={battle.monsterName(model)} id={model} href={oahuMonsterHref(model)} edited={model !== rows.original(row, 'formModel')} title="モンスターを選び直す" onClick={() => setPicking(true)} />
                  : <EmptyBoard label="＋ モンスター" onClick={() => setPicking(true)} />}
                <button className="small slot-remove" title="なしにする" disabled={!model} onClick={() => set(0)}>×</button>
              </div>
            </td>
          </tr>
          {into.map(({ monster, change }) => (
            <tr key={`i${monster}${change.via}`}>
              <td>この形態になる</td>
              <td><a href={oahuMonsterHref(monster)}>{`${battle.monsterName(monster)} (#${monster})`}</a>{` の${formVia(change.via)} `}{line(change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {picking && <OahuMonsterPicker battle={battle} title="変身の見た目を選ぶ" current={model} onClose={() => setPicking(false)} onPick={(m) => { setPicking(false); set(m); }} />}
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

/** The 3D view of the monster's model, made once the page is in the browser (the viewer needs the DOM). */
function MonsterModel({ battle, row }: { battle: OahuBattle; row: number }): ReactNode {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return shown ? <ModelView model={battle.monsterModel(row, true)} name={battle.monsterName(row)} /> : <div className="model-placeholder" />;
}
