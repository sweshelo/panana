// The ability editor of RPG FREE!'s monster book: the numbers of the monster's ability row (naauao lanai/monsters.md §3
// and the fields of §10) with the shared inputs of ui/FieldEdit, the drops, the skills and their targets, the automatic
// actions and their conditions, and the transformations. Ability rows and actions are shared between monsters: an edit
// says how many it touches and offers to copy the row (or the action) for this monster alone (monsterStats.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { FieldCheck, FieldChoice, FieldNumber, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { InfoTip } from '../ui/InfoTip';
import { RowFields } from '../ui/RowFields';
import { hex8 } from '../util/bytes';
import {
  ACTION_SLOT_KEYS, ACTION_SLOT_OFFSETS, isTransform, lanaiAction, lanaiActionMonsters, lanaiConditionLabel, lanaiCopyActionInto, lanaiCopyStats,
  LANAI_ACTION_COUNT_LABELS, LANAI_AI_LABELS, lanaiRevertMonster, lanaiSetTransformTarget, lanaiStatsOf, lanaiStatsSharers, type LanaiStatsRef,
} from './monsterStats';
import { lanaiMonsterHref, lanaiMonsters } from './monsters';
import type { LanaiSession } from './session';
import { LANAI_AUTO_SLOTS, LANAI_ELEMENTS, LANAI_RACES, LANAI_STATES } from './tables';

/** Redraws on every edit of the session. */
export function useLanaiRevision(session: LanaiSession): number {
  const [, set] = useState(0);
  useEffect(() => session.onEdit(() => set((x) => x + 1)), [session]);
  return session.revision;
}

const monsterName = (session: LanaiSession, row: number): string => lanaiMonsters(session)[row]?.name || `(行 ${row})`;

const DROP_DEN = [0, 3, 4, 8, 16, 32, 64, 128, 128, 256, 512, 1024, 512, 1024, 2048, 4096];
const rankLabel = (r: number): string => (r === 0 ? '0 必ず落とす' : `${r} 約 1/${DROP_DEN[r]} (${r <= 7 ? 'おたから' : r <= 11 ? 'レア' : '激レア'})`);
const CONDITIONS: [number, string][] = Array.from({ length: 0xc4 }, (_, v) => [v, lanaiConditionLabel(v)]);

const SHARE_INFO = [
  '能力の行 (MonsterParameterMain / Extra / RegularEvent / SpecialEvent の 0x9C の行) は、MonsterParameter +0x16 bit0-2 (表) と +0x14 (行) で引かれ、2 体目・3 体目の同じモンスターなどが同じ行を共有しています。',
  '「複製して付け替え」は、今の行を表の末尾に写して、このモンスターの +0x14 だけを新しい行に向けます。ゲームが表の行数の上限を持つかは確かめていません (naauao lanai/monsters.md §11)。',
].join('\n');

const TRANSFORM_INFO = [
  '変身は系統 29 / 30 のアクション (ActionData +0x14 bit4-11) で、アクションの +0x00 が変身先の MonsterParameter の行 ID です。発動はアクションを置いた枠 (戦闘開始・ターン開始/終了・被弾時・ワザ) と、その枠の発動条件で決まります。',
  'アクションは複数のモンスターで共有されるので、変身先を変えると同じアクションを使う全員が変わります。「アクションを複製して付け替え」で、この枠だけ新しいアクションにできます。系統 30 は能力の行 +0x50 (先読み) も合わせて変えます。',
].join('\n');

export function MonsterStatsEditor({ session, monster }: { session: LanaiSession; monster: number }): ReactNode {
  useLanaiRevision(session);
  const ref = lanaiStatsOf(session, monster);
  const params = session.need('MonsterParameter');
  if (!ref) return <div className="warn-box">{`能力の行がありません (MonsterParameter +0x16 = 0x${params.u16(monster, 0x16).toString(16)}, +0x14 = ${params.u16(monster, 0x14)})`}</div>;
  const rows = session.rows(ref.table);
  const edited = (): void => session.edited();
  const f = rows.access(ref.row, edited);
  const sharers = lanaiStatsSharers(session, ref);
  const others = sharers.filter((m) => m !== monster);
  const added = ref.row >= rows.table.originalRows;
  const changed = params.rowChanged(monster) || rows.changed(ref.row);
  const short = ref.table.replace('MonsterParameter', '');
  return (
    <div className="lanai-stats">
      <div className="book-head">
        <h3 className="with-info">{`能力 (${short} 行 ${ref.row}${added ? '、追加した行' : ''})`}<InfoTip text={SHARE_INFO} /></h3>
        {changed && <span className="edited-mark">● 変更あり</span>}
        {changed && <button onClick={() => { lanaiRevertMonster(session, monster); edited(); }}>このモンスターの変更を元に戻す</button>}
      </div>
      {others.length > 0 && (
        <div className="warn-box">
          {`この能力の行は ${sharers.length} 体が共有しています。ここでの編集は ${sharers.length} 体すべてに影響します: `}
          {others.slice(0, 12).map((m, i) => <span key={m}>{i ? '、' : ''}<a href={lanaiMonsterHref(m)}>{`#${m} ${monsterName(session, m)}`}</a></span>)}
          {others.length > 12 && ' ほか'}
          {' '}
          <button onClick={() => { lanaiCopyStats(session, monster); edited(); }}>複製して付け替え</button>
        </div>
      )}
      <StatFields f={f} edited={edited} stats={[
        { label: 'Lv', k: 'level' },
        { label: '経験値', k: 'exp' },
        { label: 'ゴールド', k: 'gold' },
        { label: '最大 HP', range: ['hpLo', 'hpHi'], info: '2 つの値の間の一様乱数 (左が下側 +0x78、右が上側 +0x76)。見積もりの表示は上側を使う' },
        { label: 'こうげき', range: ['atkLo', 'atkHi'] },
        { label: 'ぼうぎょ', range: ['defLo', 'defHi'] },
        { label: 'すばやさ', range: ['spdLo', 'spdHi'] },
        { label: '最大 AP', range: ['apLo', 'apHi'] },
        { label: 'かいひ率', node: <span><FieldNumber f={f} k="evade" edited={edited} max={100} />%</span> },
        { label: '狙われやすさ', k: 'weight', info: '対象を選ぶときの重み (標準 100、推定)' },
        { label: 'ワザのレベル', k: 'skillLevel', info: 'ワザ枠ごとのレベルと大きいほうを使う (推定)' },
        { label: '行動回数', node: <FieldChoice f={f} k="actions" edited={edited} options={LANAI_ACTION_COUNT_LABELS.map((l, i) => [i, l])} /> },
        { label: 'AI の方式', node: <FieldChoice f={f} k="ai" edited={edited} options={LANAI_AI_LABELS.map((l, i) => [i, `${i} ${l}`])} /> },
        { label: '使えるワザがないとき', node: <FieldChoice f={f} k="fallback" edited={edited} options={[0, 1, 2, 3, 4, 5].map((i) => [i, `ワザ ${i + 1}`])} /> },
        { label: 'ゆうわくのオーラ', node: <span><FieldNumber f={f} k="auraCharm" edited={edited} max={100} />%</span>, info: '毎ターン相手にゆうわくを付ける率 (推定)' },
        { label: 'きょうふのオーラ', node: <span><FieldNumber f={f} k="auraFear" edited={edited} max={100} />%</span>, info: '毎ターン相手にきょうふを付ける率 (推定)' },
      ]} />
      <h4>種族タイプ</h4>
      <div className="row">{LANAI_RACES.map(([k, l]) => <FieldCheck key={k} f={f} k={`race_${k}`} edited={edited} label={l} />)}</div>
      <h4 className="with-info">たいせい<InfoTip text={'−9〜+9 (正が強い)。属性だけ +10 = 無効。状態は 9 で効かない (naauao lanai/monsters.md §4)'} /></h4>
      <div className="stats stat-edit">
        {LANAI_ELEMENTS.map(([k, l]) => <div key={k} className="stat"><span className="muted">{l}</span><FieldNumber f={f} k={k} edited={edited} min={-9} max={10} /></div>)}
      </div>
      <div className="stats stat-edit">
        {LANAI_STATES.map(([k, l]) => <div key={k} className="stat"><span className="muted">{l}</span><FieldNumber f={f} k={k} edited={edited} min={-9} max={9} /></div>)}
      </div>
      <h4>ドロップ</h4>
      <table className="enc-table">
        <tbody>
          <tr><th>枠</th><th>アイテム (ItemData の行、−1 = なし)</th><th>ランク</th></tr>
          {[1, 2, 3, 4].map((i) => (
            <tr key={i}>
              <td>{i}</td>
              <td><RefInput session={session} table="ItemData" f={f} k={`drop${i}`} none={0} edited={edited} label={(id) => session.insert('ItemData', id, 'name') ?? ''} /></td>
              <td><FieldChoice f={f} k={`rank${i}`} edited={edited} labels={rankLabel} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="with-info">ワザ<InfoTip text={'AI が選ぶ 6 枠 (+0x54〜+0x68)。狙い方 (6 ビット) は対象を選ぶ規則で 1 が多い。レベル (3 ビット) は既定のワザのレベルと大きいほうを使う。枠 1 は空にしない'} /></h4>
      <table className="enc-table">
        <tbody>
          <tr><th>枠</th><th>アクション (ActionData の行)</th><th>狙い方</th><th>レベル</th></tr>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <tr key={i}>
              <td>{i}</td>
              <td><ActionInput session={session} f={f} k={`skill${i}`} edited={edited} /></td>
              <td><FieldNumber f={f} k={`target${i}`} edited={edited} /></td>
              <td><FieldNumber f={f} k={`slotLv${i}`} edited={edited} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="with-info">自動行動<InfoTip text={'戦闘開始・ターン開始/終了・被弾時に自動で行うアクションと、その発動条件 (+0x96〜+0x99、naauao lanai/monsters.md §7)。行動の「なし」は ActionData の行 0 (0x80000000)'} /></h4>
      <table className="enc-table">
        <tbody>
          <tr><th>いつ</th><th>アクション</th><th>発動条件</th></tr>
          {LANAI_AUTO_SLOTS.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td><ActionInput session={session} f={f} k={s.key} edited={edited} /></td>
              <td>{s.cond ? <FieldChoice f={f} k={s.cond} edited={edited} options={CONDITIONS} /> : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Transforms session={session} monster={monster} statsRef={ref} f={f} edited={edited} />
      <details className="row-fields-box">
        <summary>{`${ref.table} の行 ${ref.row} のすべての欄`}</summary>
        <RowFields def={rows.def} row={rows.row(ref.row)} original={rows.originalRow(ref.row)} context={rows.context(session, {
          rowName: (table, v) => {
            if (table === 'ItemData') return session.insert('ItemData', v, 'name');
            if (table === 'ActionData') return lanaiAction(session, v)?.message || undefined;
            if (table === 'MonsterParameter') { const r = session.need('MonsterParameter').find(v); return r < 0 ? undefined : monsterName(session, r); }
            return undefined;
          },
        })} />
      </details>
    </div>
  );
}

/** A reference by row number of another table, with what the row is; `none` is the value of "nothing" (row −1). */
function RefInput({ session, table, f, k, none, edited, label }: {
  session: LanaiSession;
  table: string;
  f: FieldAccess;
  k: string;
  none?: number;
  edited: () => void;
  label: (id: number) => string;
}): ReactNode {
  const t = session.need(table);
  const v = f.get(k);
  const row = none !== undefined && v === none ? -1 : t.find(v);
  const ch = !f.added && v !== f.original(k);
  return (
    <span className="row">
      <NumberInput value={row} min={none !== undefined ? -1 : 0} max={t.rows - 1} className={`num-input${ch ? ' edited' : ''}`}
        title={ch ? `元の値 0x${hex8(f.original(k))}` : `0x${hex8(v)}`}
        onCommit={(r) => { f.set(k, r < 0 ? none! : t.rowId(r)); edited(); }} />
      <span className={row < 0 && v !== none ? 'warn-mark' : 'muted'}>{row < 0 ? (v === none ? '(なし)' : `0x${hex8(v)} (表にない)`) : label(v) || `#${hex8(v)}`}</span>
    </span>
  );
}

/** An action slot: the ActionData row with its system and text. */
function ActionInput({ session, f, k, edited }: { session: LanaiSession; f: FieldAccess; k: string; edited: () => void }): ReactNode {
  return <RefInput session={session} table="ActionData" f={f} k={k} edited={edited} label={(id) => {
    const a = lanaiAction(session, id);
    if (!a) return '';
    if (a.row === 0) return '(なし)';
    return `系統 ${a.system}${isTransform(a) ? ` 変身 → ${monsterName(session, session.need('MonsterParameter').find(a.target))}` : ''} ${a.message}`;
  }} />;
}

/** The transformations of an ability row: each slot holding an action of system 29 / 30, with its target. */
function Transforms({ session, monster, statsRef, f, edited }: { session: LanaiSession; monster: number; statsRef: LanaiStatsRef; f: FieldAccess; edited: () => void }): ReactNode {
  const params = session.need('MonsterParameter');
  const actions = session.need('ActionData');
  const slots = ACTION_SLOT_KEYS.map((k, i) => ({ k, offset: ACTION_SLOT_OFFSETS[i]!, action: lanaiAction(session, f.get(k)) })).filter((s) => isTransform(s.action));
  return (
    <>
      <h4 className="with-info">変身<InfoTip text={TRANSFORM_INFO} /></h4>
      {!slots.length && <p className="muted small">この能力の行には変身のアクション (系統 29 / 30) がありません。ワザや自動行動の枠に変身のアクションを入れると、ここで変身先を変えられます。</p>}
      {slots.map((s) => {
        const a = s.action!;
        const target = params.find(a.target);
        const users = lanaiActionMonsters(session, a.id).filter((m) => m !== monster);
        const orig = actions.originalRow(a.row);
        const ch = !orig || actions.rowChanged(a.row);
        return (
          <div key={s.k} className="lanai-transform">
            <div>
              <b>{`${s.k.startsWith('skill') ? `ワザ ${s.k.slice(5)}` : LANAI_AUTO_SLOTS.find((x) => x.key === s.k)?.label ?? s.k}`}</b>
              {` アクション #${hex8(a.id)} (行 ${a.row}${orig ? '' : '、追加した行'}、系統 ${a.system}) ${a.message}`}
            </div>
            <div className="row">
              <span className="muted">変身先 (MonsterParameter の行)</span>
              <NumberInput value={target} min={0} max={params.rows - 1} className={`num-input${ch && orig ? ' edited' : ''}`}
                title={`0x${hex8(a.target)}`}
                onCommit={(r) => { lanaiSetTransformTarget(session, a.id, r, statsRef); edited(); }} />
              {target >= 0 ? <a href={lanaiMonsterHref(target)}>{monsterName(session, target)}</a> : <span className="warn-mark">{`0x${hex8(a.target)} (表にない)`}</span>}
            </div>
            {users.length > 0 && (
              <div className="warn-box">
                {`このアクションはほかに ${users.length} 体 (${users.slice(0, 8).map((m) => `#${m} ${monsterName(session, m)}`).join('、')}${users.length > 8 ? ' ほか' : ''}) が使っています。変身先の変更はすべてに影響します。 `}
                <button onClick={() => { lanaiCopyActionInto(session, a.id, statsRef, s.offset); edited(); }}>アクションを複製してこの枠に付け替え</button>
              </div>
            )}
          </div>
        );
      })}
      {(f.get('morph30') !== 0 || slots.some((s) => s.action!.system === 30)) && (
        <div className="row">
          <span className="muted with-info">系統 30 の変身先 (先読み +0x50)<InfoTip text={'系統 30 の変身先を戦闘開始時に読み込む欄。変身先と同じにしておく (0 = なし)'} /></span>
          <RefInput session={session} table="MonsterParameter" f={f} k="morph30" none={0} edited={edited} label={(id) => monsterName(session, params.find(id))} />
        </div>
      )}
    </>
  );
}
