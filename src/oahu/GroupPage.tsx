// RPG3's encounter groups (#/groups/<row>), built from the same parts as RPG2's group page (ui/GroupDetail): the list of
// groups with their monsters, the candidates of the lead and the mates (monster, weight, count) and the fixed formation.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { GROUP_SLOTS } from '../game/monsters';
import { useEdits, useScrollTop, useSticky } from '../ui/book';
import { Board, EmptyBoard } from '../ui/Board';
import { GroupListView, GroupSlotEditor } from '../ui/GroupDetail';
import { InfoTip } from '../ui/InfoTip';
import { Dialog } from '../ui/Dialog';
import { CopyRemoveButtons, NewRecordButton, type CopySpec } from '../ui/RecordButtons';
import { RowFields } from '../ui/RowFields';
import type { OahuBattle, OahuGroup } from './battle';
import { battleContext } from './MonsterPage';
import { oahuGroupHref, oahuGroupMonster, oahuMonsterHref, oahuMonsterIcon, OahuMonsterPicker } from './pickers';
import type { OahuSession } from './session';
import { OAHU_BATTLE_BGM, OAHU_BOSS_BGM_BIT } from './sound';
import { OAHU_MONSTER_GROUP } from './tables';

/** Monster rows of a group: candidates (leads first), then the fixed formation, each once. */
const groupMonsters = (g: OahuGroup): number[] => [...new Set([...g.leads, ...g.mates].map((s) => s.monster).concat(g.fixed))];

export function OahuGroupPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const detail = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => battle.groupList(), [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => r > 0 && r < battle.groups.rows, () => 1);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const used = (g: OahuGroup): boolean => g.leads.length + g.mates.length + g.fixed.length > 0;
  return (
    <div className="book">
      <div className="book-side">
        <NewRecordButton copy={oahuGroupCopy(battle)} current={selected} onEdit={onEdit} picker={(p) => (
          <Dialog title={p.title} onClose={p.onClose}>
            <div className="group-picker">
              <GroupListView groups={groups} monsters={groupMonsters} name={(r) => battle.monsterName(r)}
                icon={(r, i) => <Fragment key={i}>{oahuMonsterIcon(battle, r)}</Fragment>} changed={(g) => battle.groups.changed(g.row)}
                filters={[['used', 'モンスターのいる群れ', used], ['all', 'すべて', () => true]]} selected={p.current} onSelect={(g) => p.onPick(g.row)} />
            </div>
          </Dialog>
        )} />
        <GroupListView
          groups={groups}
          monsters={groupMonsters}
          name={(r) => battle.monsterName(r)}
          icon={(r, i) => <Fragment key={i}>{oahuMonsterIcon(battle, r)}</Fragment>}
          changed={(g) => battle.groups.changed(g.row)}
          filters={[
            ['used', 'モンスターのいる群れ', used],
            ['fixed', '決まった並びだけ (ボスなど)', (g) => !g.leads.length && g.fixed.length > 0],
            ['all', 'すべて', () => true],
            ['changed', '変更した', (g) => battle.groups.changed(g.row)],
          ]}
          selected={selected}
          onSelect={(g) => (location.hash = oahuGroupHref(g.row))}
        />
      </div>
      <div className="book-detail" ref={detail}>
        <GroupDetail key={selected} battle={battle} row={selected} onEdit={onEdit} />
      </div>
    </div>
  );
}

/** Copying a group to a new row (the buttons of a group and the list's "＋ 新しい群れ"). */
function oahuGroupCopy(battle: OahuBattle): CopySpec {
  return {
    noun: '群れ', can: true, href: oahuGroupHref, copy: (row) => battle.copyGroup(row),
    info: 'この群れを monsterGroup の最後に新しい行として写します (索引のハッシュは新しく付けます)。マップや宝箱の戦闘から使うには、その欄で選び直してください。',
  };
}

const SLOT_INFO = [
  '戦闘の 1 体目 (マップで見える敵) と 3 体目は「先頭」から、2・4 体目は「仲間」から、重みに比例して選ばれると推定しています (RPG2 と同じ並び)。',
  '数は候補ごとの数のコード (+0x03) です。RPG2 (0〜7) にない 10・11・14 なども使われていて、意味はまだ分かりません。',
].join('\n');

function GroupDetail({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const g = battle.group(row);
  const rows = battle.groups;
  const monster = oahuGroupMonster(battle);
  const codes = useMemo(() => {
    const seen = new Set<number>();
    for (const x of battle.groupList()) for (const s of [...x.leads, ...x.mates]) seen.add(s.count);
    return [...seen].sort((a, b) => a - b);
  }, [battle]);
  const set = (side: 'leads' | 'mates') => (next: OahuGroup['leads']): void => {
    battle.setGroupSlots(row, side === 'leads' ? next : g.leads, side === 'mates' ? next : g.mates);
    onEdit();
  };
  const picker = (current: number, pick: (r: number) => void, close: () => void): ReactNode => <OahuMonsterPicker battle={battle} current={current} onPick={pick} onClose={close} />;
  return (
    <>
      <div className="book-head">
        <h2>{`群れ #${row}`}</h2>
        <span className="muted">{`monsterGroup の行${rows.added(row) ? '  (追加した行)' : ''}`}</span>
        <CopyRemoveButtons copy={oahuGroupCopy(battle)} from={row} onEdit={onEdit} remove={rows.added(row) ? {
          used: battle.groupUsers(row),
          why: battle.canRemoveGroup(row) ? undefined : '消せるのは最後に追加した群れだけです',
          remove: () => battle.removeGroup(row), next: oahuGroupHref(row - 1),
        } : undefined} />
        {rows.changed(row) && !rows.added(row) && <button onClick={() => { rows.revert(row); onEdit(); }}>この群れの変更を元に戻す</button>}
      </div>
      <p className="muted small book-desc">候補は 5 個まで。変更はマスター (21350000) の monsterGroup.bin として書き出されます。</p>
      <div className="book-cols group-cols">
        {(['leads', 'mates'] as const).map((side) => (
          <GroupSlotEditor key={side} title={side === 'leads' ? '先頭 (マップで見える敵)・3 体目' : '仲間 (2・4 体目)'} info={side === 'leads' ? SLOT_INFO : undefined}
            slots={g[side]} max={GROUP_SLOTS} monster={monster} counts={() => codes.map((c): [number, string] => [c, String(c)])} set={set(side)} picker={picker} />
        ))}
        <FixedEditor battle={battle} g={g} onEdit={onEdit} />
      </div>
      <BattleSettings battle={battle} row={row} onEdit={onEdit} />
      <details className="row-fields-box">
        <summary>{`monsterGroup の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_MONSTER_GROUP} row={rows.row(row)} original={rows.originalRow(row)} context={battleContext(battle)} />
      </details>
    </>
  );
}

const BOSS_BGM_INFO = [
  `決まった戦闘 (ボス戦・宝箱の戦闘など) を BGM の指定なしで始めると、この印があれば ${OAHU_BATTLE_BGM.boss} BGM_BATTLE_2、なければ ${OAHU_BATTLE_BGM.normal} BGM_BATTLE_1 が鳴ります (+0x32 bit2、@0x2111C0)。`,
  'BGM を指定して始める戦闘 (イベントの一部、コードの呼び出し) には効きません。マップを歩く敵との戦闘は、ダンジョンの「戦闘の BGM」(マップのページ) が鳴ります。',
  'この印は、戦闘の初期化で戦闘のフラグ (+0x2D662 bit0) も立てます (逃げられない等と推定)。',
  'RPG3 の群れには戦闘の背景の欄がありません。背景はいるダンジョンのもの (マップのページ) です。',
].join('\n');

/** The battle BGM of the group's fixed battles (+0x32 bit2) and where the rest of a battle's look comes from. */
function BattleSettings({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const flags = battle.groups.get(row, 'flags');
  const on = !!(flags & OAHU_BOSS_BGM_BIT);
  const edited = !!(battle.groups.original(row, 'flags') & OAHU_BOSS_BGM_BIT) !== on;
  return (
    <section>
      <h3 className="with-info">戦闘の BGM<InfoTip text={BOSS_BGM_INFO} /></h3>
      <label className={`layer${edited ? ' edited' : ''}`}>
        <input type="checkbox" checked={on} onChange={(e) => { battle.groups.set(row, 'flags', e.target.checked ? flags | OAHU_BOSS_BGM_BIT : flags & ~OAHU_BOSS_BGM_BIT); onEdit(); }} />
        {` ボスの曲 (+0x32 bit2): BGM 指定なしの決まった戦闘で ${on ? 'BGM_BATTLE_2' : 'BGM_BATTLE_1'} が鳴る`}
      </label>
    </section>
  );
}

/** The fixed formation (+0x28): up to 5 monsters in order, as boards. */
function FixedEditor({ battle, g, onEdit }: { battle: OahuBattle; g: OahuGroup; onEdit: () => void }): ReactNode {
  const [picking, setPicking] = useState<number | null>(null);
  const set = (next: number[]): void => {
    battle.setFixed(g.row, next);
    onEdit();
  };
  return (
    <section>
      <h3 className="with-info">決まった並び<InfoTip text="+0x28 から 5 体。ボス・宝箱の群れはこれだけを持ちます。ふつうの群れにある並びがいつ使われるかは未確認です。" /></h3>
      <div className="slot-list">
        {g.fixed.map((m, i) => {
          const name = battle.monsterName(m);
          return (
            <div key={i} className="slot-row">
              <Board icon={oahuMonsterIcon(battle, m)} name={name} sub={`Lv${battle.monsters.get(m, 'level')}`} id={m} href={oahuMonsterHref(m)}
                edited={battle.groups.original(g.row, `fixed${i + 1}`) !== m} title="モンスターを選び直す" onClick={() => setPicking(i)} />
              <button className="small slot-remove" title="外す" onClick={() => set(g.fixed.filter((_, j) => j !== i))}>×</button>
            </div>
          );
        })}
        {g.fixed.length < 5 && <div className="slot-row"><EmptyBoard label="＋ 追加" onClick={() => setPicking(-1)} /></div>}
      </div>
      {picking !== null && (
        <OahuMonsterPicker battle={battle} current={picking < 0 ? 0 : g.fixed[picking]!} onClose={() => setPicking(null)}
          onPick={(m) => { const i = picking; setPicking(null); set(i < 0 ? [...g.fixed, m] : g.fixed.map((x, j) => (j === i ? m : x))); }} />
      )}
    </section>
  );
}
