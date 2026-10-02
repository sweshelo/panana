// RPG3's encounter groups (#/groups/<row>), built from the same parts as RPG2's group page (ui/GroupDetail): the list of
// groups with their monsters, the candidates of the lead and the mates (monster, weight, count) and the fixed formation.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { GROUP_SLOTS } from '../game/monsters';
import { useEdits, useScrollTop, useSticky } from '../ui/book';
import { Board, EmptyBoard } from '../ui/Board';
import { GroupListView, GroupSlotEditor } from '../ui/GroupDetail';
import { InfoTip } from '../ui/InfoTip';
import { RowFields } from '../ui/RowFields';
import type { OahuBattle, OahuGroup } from './battle';
import { battleContext } from './MonsterPage';
import { oahuGroupHref, oahuGroupMonster, oahuMonsterHref, oahuMonsterIcon, OahuMonsterPicker } from './pickers';
import type { OahuSession } from './session';
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
        <GroupListView
          groups={groups}
          monsters={groupMonsters}
          name={(r) => battle.monsterName(r)}
          icon={(r, i) => <Fragment key={i}>{oahuMonsterIcon(battle.monsterName(r))}</Fragment>}
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
        <span className="muted">monsterGroup の行</span>
        {rows.changed(row) && <button onClick={() => { rows.revert(row); onEdit(); }}>この群れの変更を元に戻す</button>}
      </div>
      <p className="muted small book-desc">候補は 5 個まで。変更はマスター (21350000) の monsterGroup.bin として書き出されます。</p>
      <div className="book-cols group-cols">
        {(['leads', 'mates'] as const).map((side) => (
          <GroupSlotEditor key={side} title={side === 'leads' ? '先頭 (マップで見える敵)・3 体目' : '仲間 (2・4 体目)'} info={side === 'leads' ? SLOT_INFO : undefined}
            slots={g[side]} max={GROUP_SLOTS} monster={monster} counts={() => codes.map((c): [number, string] => [c, String(c)])} set={set(side)} picker={picker} />
        ))}
        <FixedEditor battle={battle} g={g} onEdit={onEdit} />
      </div>
      <details className="row-fields-box">
        <summary>{`monsterGroup の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_MONSTER_GROUP} row={rows.row(row)} original={rows.originalRow(row)} context={battleContext(battle)} />
      </details>
    </>
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
              <Board icon={oahuMonsterIcon(name)} name={name} sub={`Lv${battle.monsters.get(m, 'level')}`} id={m} href={oahuMonsterHref(m)}
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
