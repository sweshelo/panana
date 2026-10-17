// The editors of RPG FREE!'s monster book, one per section of the page shared with RPG2 / RPG3 (pages/monsteredit.tsx,
// oahu/MonsterPage.tsx), built from the same parts (ui/FieldEdit, ui/MonsterSlots): the stats, the drops, the skills
// with their targets and AI, the other actions (automatic ones with their conditions), the transformations and the
// resistances, over the numbers of the monster's ability row (naauao lanai/monsters.md §3 and the fields of §10).
// Ability rows and actions are shared between monsters: an edit says how many it touches and offers to copy the row
// (or the action) for this monster alone (monsterStats.ts).
import { useEffect, useState, type ReactNode } from 'react';
import type { FieldContext } from '../game/tabledef';
import { FieldCheck, FieldChoice, FieldNumber, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { InfoTip } from '../ui/InfoTip';
import { BoardSlot, DropSlots, Heading, moveTo, ResistCharts, SkillSlots, type ResistChart } from '../ui/MonsterSlots';
import { isNoAction, lanaiActionName, lanaiActionUsers, lanaiMonsterIndex, lanaiMonsterName, lanaiSetSkillSlots, lanaiSkillSlots, type LanaiSkillSlot } from './monsterBook';
import { ACTION_SLOT_KEYS, ACTION_SLOT_OFFSETS, isTransform, lanaiAction, lanaiConditionLabel, lanaiCopyActionInto, lanaiCopyStats, LANAI_ACTION_COUNT_LABELS, LANAI_AI_LABELS, lanaiSetTransformTarget, lanaiStatsSharers, type LanaiStatsRef } from './monsterStats';
import { lanaiMonsterHref } from './monsters';
import { lanaiActionEntry, lanaiActionSub, LanaiActionPicker, lanaiItemEntry, LanaiItemPicker, lanaiMonsterEntry, LanaiMonsterPicker } from './pickers';
import type { LanaiSession } from './session';
import { LANAI_AUTO_SLOTS, LANAI_ELEMENTS, LANAI_RACES, LANAI_STATES } from './tables';

/** Redraws on every edit of the session. */
export function useLanaiRevision(session: LanaiSession): number {
  const [, set] = useState(0);
  useEffect(() => session.onEdit(() => set((x) => x + 1)), [session]);
  return session.revision;
}

export interface LanaiEditProps {
  session: LanaiSession;
  /** The fields of the monster's ability row. */
  f: FieldAccess;
  edited: () => void;
}

/** The action of "nothing" in the slots of the automatic actions (row 0 of ActionData). */
const NO_ACTION = 0x80000000;

const SHARE_INFO = [
  '能力の行 (MonsterParameterMain / Extra / RegularEvent / SpecialEvent の 0x9C の行) は、MonsterParameter +0x16 bit0-2 (表) と +0x14 (行) で引かれ、2 体目・3 体目の同じモンスターなどが同じ行を共有しています。',
  '「複製して付け替え」は、今の行を表の末尾に写して、このモンスターの +0x14 だけを新しい行に向けます。ゲームが表の行数の上限を持つかは確かめていません (naauao lanai/monsters.md §11)。',
].join('\n');

/** The warning that the ability row is shared, with the copy for this monster alone. */
export function SharedStatsWarning({ session, monster, statsRef, edited }: { session: LanaiSession; monster: number; statsRef: LanaiStatsRef; edited: () => void }): ReactNode {
  const sharers = lanaiStatsSharers(session, statsRef);
  const others = sharers.filter((m) => m !== monster);
  if (!others.length) return null;
  return (
    <div className="warn-box">
      {`この能力の行は ${sharers.length} 体が共有しています。ここでの編集は ${sharers.length} 体すべてに影響します: `}
      {others.slice(0, 12).map((m, i) => <span key={m}>{i ? '、' : ''}<a href={lanaiMonsterHref(m)}>{`#${m} ${lanaiMonsterName(session, m)}`}</a></span>)}
      {others.length > 12 && ' ほか'}
      {' '}
      <button onClick={() => { lanaiCopyStats(session, monster); edited(); }}>複製して付け替え</button>
      <InfoTip text={SHARE_INFO} />
    </div>
  );
}

const RANGE_INFO = '戦闘のたびに、2 つの値の間の一様乱数になります (左が下側、右が上側。FUN_002B4928)。見積もりの表示は上側を使います。';

/** Level, the stat ranges, rewards, and the other numbers of the ability row (the races as check boxes). */
export function LanaiStatFields({ f, edited }: Omit<LanaiEditProps, 'session'>): ReactNode {
  return (
    <StatFields f={f} edited={edited} stats={[
      { label: 'Lv', k: 'level' },
      { label: 'HP', range: ['hpLo', 'hpHi'], info: RANGE_INFO },
      { label: 'AP', range: ['apLo', 'apHi'] },
      { label: 'こうげき', range: ['atkLo', 'atkHi'] },
      { label: 'ぼうぎょ', range: ['defLo', 'defHi'] },
      { label: 'すばやさ', range: ['spdLo', 'spdHi'] },
      { label: '回避', node: <span><FieldNumber f={f} k="evade" edited={edited} max={100} />%</span> },
      { label: '経験値', k: 'exp' },
      { label: 'ゴールド', k: 'gold' },
      { label: '狙われやすさ', k: 'weight', info: '対象を選ぶときの重み (標準 100、推定)' },
      { label: 'ワザのレベル', k: 'skillLevel', info: 'ワザ枠ごとのレベルと大きいほうを使う (推定)' },
      { label: 'ゆうわくのオーラ', node: <span><FieldNumber f={f} k="auraCharm" edited={edited} max={100} />%</span>, info: '毎ターン相手にゆうわくを付ける率 (推定)' },
      { label: 'きょうふのオーラ', node: <span><FieldNumber f={f} k="auraFear" edited={edited} max={100} />%</span>, info: '毎ターン相手にきょうふを付ける率 (推定)' },
      { label: '種族タイプ', wide: true, info: '+0x8D bit0-7、+0x8E bit0。1 体に複数立てられます (図鑑は 2 つまで表示)', node: <span className="inline-fields">{LANAI_RACES.map(([k, l]) => <FieldCheck key={k} f={f} k={`race_${k}`} edited={edited} label={l} />)}</span> },
    ]} />
  );
}

const DROP_DEN = [1, 3, 4, 8, 16, 32, 64, 128, 128, 256, 512, 1024, 512, 1024, 2048, 4096];
const dropClass = (r: number): string => (r === 0 ? '必ず' : r <= 7 ? 'おたから' : r <= 11 ? 'レア' : '激レア');
const rankLabel = (r: number): string => (r === 0 ? '0: 必ず' : `${r}: 約 1/${DROP_DEN[r]}`);

const DROP_INFO = [
  '4 枠。枠ごとのランクで BattleParameter +0x104 の表の「約何回に 1 回落とすか」が決まります (naauao lanai/monsters.md §6)。',
  'ランク 0 は必ず、1〜7 はおたから、8〜11 はレア、12〜15 は激レア。おたから・レア・激レア+ の状態 (93〜95) がそれぞれに効きます。',
  '枠 1 だけ、戦闘側の判定で落とさなくなることがあります (一度きりの品と推定)。',
].join('\n');

/** The 4 drop slots: the item's board (ItemData; the value is its row ID, 0 = none) and the rank. */
export function LanaiDropEditor({ session, f, edited }: LanaiEditProps): ReactNode {
  const items = session.need('ItemData');
  const rowOf = (v: number): number => (v ? Math.max(0, items.find(v)) : 0);
  return (
    <DropSlots
      info={DROP_INFO}
      slots={[1, 2, 3, 4].map((i) => {
        const rank = f.get(`rank${i}`);
        return {
          item: rowOf(f.get(`drop${i}`)),
          original: f.added ? rowOf(f.get(`drop${i}`)) : rowOf(f.original(`drop${i}`)),
          sub: `${dropClass(rank)}・${rank ? `約 1/${DROP_DEN[rank]}` : '100%'}`,
          rate: <FieldChoice f={f} k={`rank${i}`} edited={edited} labels={rankLabel} />,
        };
      })}
      entry={(row) => lanaiItemEntry(session, items.rowId(row))}
      setItem={(k, row) => { f.set(`drop${k + 1}`, row ? items.rowId(row) : 0); edited(); }}
      picker={(k, current, pick, close) => <LanaiItemPicker session={session} title={`ドロップ ${k + 1} のアイテムを選ぶ`} current={current} onPick={pick} onClose={close} />}
    />
  );
}

const SKILL_INFO = [
  '最大 6 枠 (+0x54〜+0x68)。ドラッグで並べ替え、× で外します (後ろの枠が詰まります)。枠 1 は空にしないでください。',
  '枠ごとの「狙い」(6 ビット) は対象を選ぶ規則で、1 が多い。「Lv」(3 ビット) は既定のワザのレベルと大きいほうを使います。並べ替えると枠の値も一緒に動きます。',
  '系統 29 / 30 のアクションを入れると、AI が選んだときに変身します。',
].join('\n');

const AI_INFO = LANAI_AI_LABELS.map((l, i) => `${i} ${l}`).join('\n') + '\n(+0x9A bit0-2、naauao lanai/monsters.md §8)';

/** The 6 skill slots (drag to reorder, × to remove, ＋ to add) with each slot's target and level, and the AI fields. */
export function LanaiSkillEditor({ session, f, edited }: LanaiEditProps): ReactNode {
  const actions = session.need('ActionData');
  const now = lanaiSkillSlots(session, f);
  const set = (next: LanaiSkillSlot[]): void => {
    lanaiSetSkillSlots(f, next);
    edited();
  };
  const fallback = f.get('fallback');
  return (
    <section>
      <Heading title="ワザと行動" info={SKILL_INFO} />
      <SkillSlots
        slots={now.map((s, i) => ({
          action: actions.find(s.id),
          entry: lanaiActionEntry(session, s.id),
          sub: lanaiActionSub(session, s.id),
          edited: !f.added && f.original(`skill${i + 1}`) !== s.id,
          extra: (
            <span className="slot-cond">
              {'狙い '}<FieldNumber f={f} k={`target${i + 1}`} edited={edited} />
              {' Lv '}<FieldNumber f={f} k={`slotLv${i + 1}`} edited={edited} />
            </span>
          ),
        }))}
        max={6}
        move={(from, to) => set(moveTo(now, from, to))}
        pick={(i, row) => {
          const id = actions.rowId(row);
          set(i < 0 ? [...now, { id, target: 1, lv: 0, from: -1 }] : now.map((s, j) => (j === i ? { ...s, id } : s)));
        }}
        remove={(i) => set(now.filter((_, j) => j !== i))}
        picker={(current, pick, close) => <LanaiActionPicker session={session} current={current} onPick={pick} onClose={close} />}
        empty="ワザがありません。"
      />
      <table className="enc-table ai-fields">
        <tbody>
          <tr><td className="with-info">AI<InfoTip text={AI_INFO} /></td>
            <td><FieldChoice f={f} k="ai" edited={edited} options={LANAI_AI_LABELS.map((l, i) => [i, `${i}: ${l}`])} /></td></tr>
          <tr><td className="with-info">使えないとき<InfoTip text="どのワザも狙いの対象がいないときに使う枠 (+0x9A bit3-5)" /></td>
            <td><FieldChoice f={f} k="fallback" edited={edited} options={[0, 1, 2, 3, 4, 5].map((i) => [i, `${i + 1}: ${i < now.length ? lanaiActionName(session, now[i]!.id) : '(空)'}`])} />
              {fallback >= now.length && <span className="muted small">{` 枠 ${fallback + 1} (空)`}</span>}</td></tr>
          <tr><td className="with-info">行動回数<InfoTip text="1 ターンに行動する回数 (+0x90 bit0-2、能力 0x08)" /></td>
            <td><FieldChoice f={f} k="actions" edited={edited} options={LANAI_ACTION_COUNT_LABELS.map((l, i) => [i, l])} /></td></tr>
        </tbody>
      </table>
    </section>
  );
}

const CONDITIONS: [number, string][] = Array.from({ length: 0xc4 }, (_, v) => [v, lanaiConditionLabel(v)]);

/** The slots of the other actions: key, label, the condition's key, and the explanation. */
const OTHER_ACTIONS: { key: string; label: string; cond?: string; info: string }[] = [
  { key: 'actBattle', label: '戦闘開始時', info: '+0x38 (能力 0x40)。戦闘の始めに使うアクション。状態を付けるもの (系統 9 / 10) が多い。' },
  { key: 'actDefault', label: '既定の行動', info: '+0x3C。『つかまえる』で捕まえたこのモンスターを連れたユニットの既定の行動 (同じ種族の行のものを使います)。敵として出るときは使わず、「使えるワザがないときの枠」を使います (naauao lanai/monsters.md §3.2)。' },
  ...LANAI_AUTO_SLOTS.filter((s) => s.cond).map((s) => ({
    key: s.key, label: s.label, cond: s.cond,
    info: s.key.startsWith('actHit')
      ? `${s.key === 'actHit1' ? '+0x44 / 条件 +0x97' : '+0x48 / 条件 +0x98'} (能力 0x44)。攻撃を受けたときに条件を満たすと出るアクション。+0x14 下位 4 ビットが 5 か 8 のものだけ動きます。条件 0x65 (倒される一撃) で変身させるのが多い。`
      : `${s.key === 'actTurnStart' ? '+0x40 / 条件 +0x96 (能力 0x41)' : '+0x4C / 条件 +0x99 (能力 0x42)'}。ターンの${s.key === 'actTurnStart' ? '始め' : '終わり'}に条件を満たすと自動で使うアクション。`,
  })),
];

/** The automatic actions and their conditions, as boards picked from the action table (like RPG3's actions of the states). */
export function LanaiOtherActions({ session, f, edited }: LanaiEditProps): ReactNode {
  const [picking, setPicking] = useState<string | null>(null);
  const actions = session.need('ActionData');
  return (
    <section>
      <Heading title="ほかのアクション" info={'AI が選ぶワザのほかに、戦闘開始・ターン開始/終了・被弾時に使うアクションと、その発動条件 (+0x96〜+0x99、naauao lanai/monsters.md §7)。\n「なし」は ActionData の行 0 (0x80000000)。'} />
      <table className="enc-table ai-fields">
        <tbody>
          {OTHER_ACTIONS.map(({ key, label, cond, info }) => {
            const v = f.get(key);
            const none = isNoAction(session, v);
            return (
              <tr key={key}>
                <td className="with-info">{label}<InfoTip text={info} /></td>
                <td>
                  <BoardSlot entry={none ? null : lanaiActionEntry(session, v)} id={actions.find(v)} sub={lanaiActionSub(session, v)}
                    edited={!f.added && v !== f.original(key)} title="アクションを選び直す" emptyLabel="＋ アクション"
                    onPick={() => setPicking(key)} onClear={() => { f.set(key, NO_ACTION); edited(); }} />
                  {cond && <div className="slot-cond">条件 <FieldChoice f={f} k={cond} edited={edited} options={CONDITIONS} /></div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {picking && (
        <LanaiActionPicker session={session} title="アクションを選ぶ" current={actions.find(f.get(picking))} onClose={() => setPicking(null)}
          onPick={(row) => { const k = picking; setPicking(null); f.set(k, actions.rowId(row)); edited(); }} />
      )}
    </section>
  );
}

const TRANSFORM_INFO = [
  '変身は系統 29 / 30 のアクション (ActionData +0x14 bit4-11) で、アクションの +0x00 が変身先の MonsterParameter の行 ID です。発動はアクションを置いた枠 (戦闘開始・ターン開始/終了・被弾時・ワザ) と、その枠の発動条件で決まります。',
  'RPG2 のボス特殊番号と次の形態の欄はなく、RPG3 の「ボディ + 発動の条件」に近い形です (naauao lanai/monsters.md §9)。',
  'アクションは複数のモンスターで共有されるので、変身先を変えると同じアクションを使う全員が変わります。「アクションを複製してこの枠に付け替え」で、この枠だけ新しいアクションにできます。系統 30 は能力の行 +0x50 (先読み) も合わせて変えます。',
].join('\n');

/** "ワザ 2", "被弾時 1": the slot at an offset of an ability row. */
function slotLabel(offset: number): string {
  const k = ACTION_SLOT_KEYS[ACTION_SLOT_OFFSETS.indexOf(offset)] ?? '';
  if (k.startsWith('skill')) return `ワザ ${k.slice(5)}`;
  return OTHER_ACTIONS.find((x) => x.key === k)?.label ?? k;
}

/** When a slot's action is used: its condition, or how the slot is used. */
function slotWhen(f: FieldAccess, offset: number): string {
  const k = ACTION_SLOT_KEYS[ACTION_SLOT_OFFSETS.indexOf(offset)] ?? '';
  if (k.startsWith('skill')) return 'AI が選んだとき';
  const cond = LANAI_AUTO_SLOTS.find((s) => s.key === k)?.cond;
  return cond ? lanaiConditionLabel(f.get(cond)) : '';
}

/** The transformations from this monster (the slots with an action of system 29 / 30) and into it. */
export function LanaiTransforms({ session, monster, statsRef, f, edited }: LanaiEditProps & { monster: number; statsRef: LanaiStatsRef }): ReactNode {
  const [picking, setPicking] = useState<number | 'morph30' | null>(null);
  const params = session.need('MonsterParameter');
  const actions = session.need('ActionData');
  const slots = ACTION_SLOT_KEYS.map((k, i) => ({ k, offset: ACTION_SLOT_OFFSETS[i]!, action: lanaiAction(session, f.get(k)) })).filter((s) => isTransform(s.action));
  const into = (lanaiMonsterIndex(session).into.get(monster) ?? []).filter((x) => x.use.monster !== monster);
  const morph = f.get('morph30');
  const morphRow = morph ? params.find(morph) : -1;
  if (!slots.length && !into.length && !morph) return null;
  return (
    <section>
      <Heading title="変身" info={TRANSFORM_INFO} />
      <table className="enc-table ai-fields">
        <tbody>
          {slots.map((s) => {
            const a = s.action!;
            const target = params.find(a.target);
            const users = lanaiActionUsers(session, a.id).filter((m) => m !== monster);
            const orig = actions.originalRow(a.row);
            return (
              <tr key={s.k}>
                <td>{slotLabel(s.offset)}</td>
                <td>
                  <div>
                    {`#${a.row} ${lanaiActionName(session, a.id)}`}
                    <span className="muted">{` (系統 ${a.system}・${slotWhen(f, s.offset)})${orig ? '' : ' 追加したアクション'} → `}</span>
                  </div>
                  <BoardSlot entry={target >= 0 ? lanaiMonsterEntry(session, target) : null} id={target >= 0 ? target : undefined}
                    edited={!!orig && actions.rowChanged(a.row)} title="変身先を選び直す" emptyLabel={`＋ 変身先 (0x${a.target.toString(16).toUpperCase()} は表にない)`}
                    onPick={() => setPicking(a.id)} />
                  {users.length > 0 && (
                    <div className="warn-box">
                      {`このアクションはほかに ${users.length} 体 (${users.slice(0, 8).map((m) => `#${m} ${lanaiMonsterName(session, m)}`).join('、')}${users.length > 8 ? ' ほか' : ''}) が使っています。変身先の変更はすべてに影響します。 `}
                      <button onClick={() => { lanaiCopyActionInto(session, a.id, statsRef, s.offset); edited(); }}>アクションを複製してこの枠に付け替え</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {(morph !== 0 || slots.some((s) => s.action!.system === 30)) && (
            <tr>
              <td className="with-info">変身の先読み<InfoTip text={'能力の行 +0x50。系統 30 の変身先を戦闘開始時に読み込みます (モデルの入れ替えと推定、RPG3 の「変身の見た目」に当たる)。変身先と同じにしておきます (0 = なし)。'} /></td>
              <td>
                <BoardSlot entry={morphRow >= 0 ? lanaiMonsterEntry(session, morphRow) : null} id={morphRow >= 0 ? morphRow : undefined}
                  edited={!f.added && morph !== f.original('morph30')} title="モンスターを選び直す" emptyLabel="＋ モンスター"
                  onPick={() => setPicking('morph30')} onClear={() => { f.set('morph30', 0); edited(); }} />
              </td>
            </tr>
          )}
          {into.map(({ action, use }, i) => (
            <tr key={`i${i}`}>
              <td>この形態になる</td>
              <td><a href={lanaiMonsterHref(use.monster)}>{`${lanaiMonsterName(session, use.monster)} (#${use.monster})`}</a>{` の${slotLabel(use.offset)} #${action.row} ${lanaiActionName(session, action.id)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {picking !== null && (
        <LanaiMonsterPicker session={session} title={picking === 'morph30' ? '先読みするモンスターを選ぶ' : '変身先を選ぶ'}
          current={picking === 'morph30' ? morphRow : params.find(lanaiAction(session, picking)?.target ?? -1)}
          onClose={() => setPicking(null)}
          onPick={(row) => {
            const p = picking;
            setPicking(null);
            if (p === 'morph30') f.set('morph30', params.rowId(row));
            else lanaiSetTransformTarget(session, p, row, statsRef);
            edited();
          }} />
      )}
    </section>
  );
}

export const LANAI_RESIST_INFO = [
  '値は −9〜+9 (正ほど強い)。属性だけ +10 で無効になります (FUN_003062E0)。状態は +9 で効きません (FUN_002F8ED8、naauao lanai/monsters.md §4)。',
  '状態異常 (毒〜ブラインド・突然死) には、全状態異常たいせいの能力も足されます。きょうふと能力ダウンには足されません。',
].join('\n');

const keys = (list: [string, string][], from: number, to?: number): [string, string][] => list.slice(from, to);
const RESIST_CHARTS: { label: string; axes: [string, string][]; max: number }[] = [
  { label: '属性', axes: LANAI_ELEMENTS, max: 10 },
  { label: '状態異常・突然死', axes: [...keys(LANAI_STATES, 0, 11), ...keys(LANAI_STATES, 15)], max: 9 },
  { label: '能力ダウン', axes: keys(LANAI_STATES, 11, 15).map(([k, l]) => [k, l.replace(/ダウン$/, '')]), max: 9 },
];

/** The resistances as the shared charts: elements, the ailments with instant death, and the stat downs. */
export function LanaiResistEditor({ f, edited }: Omit<LanaiEditProps, 'session'>): ReactNode {
  const charts: ResistChart[] = RESIST_CHARTS.map((c) => ({
    label: c.label,
    max: c.max,
    axes: c.axes.map(([k, name]) => ({ name, value: f.get(k), original: f.added ? f.get(k) : f.original(k) })),
  }));
  return (
    <ResistCharts charts={charts} min={-9} max={10} rings={[-9, -5, 0, 5, 10]} effect={() => ''}
      onChange={(c, j, v) => { f.set(RESIST_CHARTS[c]!.axes[j]![0], v); edited(); }} />
  );
}

/** Names of the values of an ability row for ui/RowFields (items, actions and monsters by row ID). */
export function statsContext(session: LanaiSession, statsRef: LanaiStatsRef): FieldContext {
  return session.rows(statsRef.table).context(session, {
    rowName: (table, v) => {
      if (table === 'ItemData') return session.insert('ItemData', v, 'name');
      if (table === 'ActionData') return lanaiAction(session, v) ? lanaiActionName(session, v) : undefined;
      if (table === 'MonsterParameter') { const r = session.need('MonsterParameter').find(v); return r < 0 ? undefined : lanaiMonsterName(session, r); }
      return undefined;
    },
  });
}
