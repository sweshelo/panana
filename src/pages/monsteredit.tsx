// Editors of a MonsterParameter row in the monster book: stats, drops, skills and AI, boss forms.
// Fields: src/game/monsters.ts PARAM (elpulse docs/battle.md §2〜§4).
import { useRef, useState, type ReactNode } from 'react';
import type { ActionBook } from '../game/actions';
import {
  AI_MODE, AI_MODE_NOTE, BOSS_CONDITION, dropClass, fieldMax, PARAM, SKILL_MOTION, SKILL_SLOTS, skillShares, TARGET_MODE,
  type Monster, type MonsterBook, type ParamKey,
} from '../game/monsters';
import type { Session } from '../session';
import { ActionPicker } from '../ui/ActionPicker';
import { NumberInput } from '../ui/book';
import { ItemPicker } from '../ui/ItemPicker';
import { MonsterPicker } from '../ui/MonsterPicker';
import { useAsync } from '../ui/useAsync';

interface EditProps {
  book: MonsterBook;
  m: Monster;
  edited: () => void;
}

/** A number box for a field, marked when it differs from the archive. */
function Field({ book, m, edited, k, min = 0 }: EditProps & { k: ParamKey; min?: number }): ReactNode {
  const orig = book.original(m.row, k);
  const v = book.get(m.row, k);
  return (
    <NumberInput
      value={v}
      min={min}
      max={fieldMax(PARAM[k])}
      className={`num-input${v !== orig ? ' edited' : ''}`}
      title={v !== orig ? `元の値 ${orig}` : `0〜${fieldMax(PARAM[k])}`}
      onCommit={(x) => { book.set(m.row, k, x); edited(); }}
    />
  );
}

/** A select of a field's values with labels. */
function FieldSelect({ book, m, edited, k, labels }: EditProps & { k: ParamKey; labels: (v: number) => string }): ReactNode {
  const orig = book.original(m.row, k);
  const v = book.get(m.row, k);
  return (
    <select className={v !== orig ? 'edited' : ''} title={v !== orig ? `元の値 ${labels(orig)}` : ''} value={v}
      onChange={(e) => { book.set(m.row, k, Number(e.target.value)); edited(); }}>
      {Array.from({ length: fieldMax(PARAM[k]) + 1 }, (_, i) => <option key={i} value={i}>{labels(i)}</option>)}
    </select>
  );
}

function FieldCheck({ book, m, edited, k, label }: EditProps & { k: ParamKey; label: string }): ReactNode {
  const v = book.get(m.row, k);
  return (
    <label className={v !== book.original(m.row, k) ? 'edited-label' : ''}>
      <input type="checkbox" checked={v === 1} onChange={(e) => { book.set(m.row, k, e.target.checked ? 1 : 0); edited(); }} />
      {label}
    </label>
  );
}

const RANGES: [string, ParamKey, ParamKey][] = [
  ['HP', 'hpMin', 'hpMax'], ['こうげき', 'attackMin', 'attackMax'], ['ぼうぎょ', 'defenseMin', 'defenseMax'], ['すばやさ', 'speedMin', 'speedMax'],
];

/** Level, the stat ranges (min 〜 max), evasion, rewards, HP regeneration and ghost. */
export function StatEditor(p: EditProps): ReactNode {
  const { m } = p;
  const one = (label: string, k: ParamKey, unit = ''): ReactNode => (
    <div className="stat"><span className="muted">{label}</span><span><Field {...p} k={k} />{unit}</span></div>
  );
  return (
    <>
      <div className="stats stat-edit">
        {one('Lv', 'level')}
        {RANGES.map(([label, lo, hi]) => (
          <div key={label} className="stat stat-range">
            <span className="muted">{label}</span>
            <span><Field {...p} k={lo} />〜<Field {...p} k={hi} /></span>
          </div>
        ))}
        {one('回避', 'evasion', '%')}
        {one('経験値', 'exp')}
        {one('ゴールド', 'gold')}
        {one('HP 自動回復', 'regen')}
        <div className="stat"><span className="muted">ゴースト</span><FieldCheck {...p} k="ghost" label="状態 21" /></div>
      </div>
      <p className="muted small">
        HP〜すばやさは出現ごとに「最小〜最大」の乱数。最小 0 の欄は元のデータでも多く、最大の値で固定と見られます。
        {RANGES.some(([, lo, hi]) => p.book.get(m.row, lo) > p.book.get(m.row, hi)) && <span className="warn">{' ⚠ 最小が最大より大きい欄があります (ゲームで確かめていません)。'}</span>}
      </p>
    </>
  );
}

/** "1/8 (12.5%)"; "必ず" for 1 in 1. */
const odds = (n: number): string => (n === 1 ? '必ず' : Number.isFinite(n) ? `1/${n} (${Math.round(1000 / n) / 10}%)` : '出ない');

const DROPS: [ParamKey, ParamKey][] = [['drop0', 'rate0'], ['drop1', 'rate1'], ['drop2', 'rate2']];

/** The 3 drop slots: item (picked from the photos) and the 4-bit rate value. */
export function DropEditor({ session, ...p }: EditProps & { session: Session }): ReactNode {
  const { book, m, edited } = p;
  const [picking, setPicking] = useState<number | null>(null);
  const rateLabel = (v: number): string => `${v} ${dropClass(v)[1]} ${odds(book.battle.dropOdds(v))}`;
  const data = useAsync(() => (picking === null ? Promise.resolve(null) : session.items()), [session, picking !== null]);
  const setItem = (k: number, id: number): void => {
    book.set(m.row, DROPS[k]![0], id);
    edited();
  };
  return (
    <section>
      <h3>ドロップ</h3>
      <table className="enc-table">
        <tbody>
          <tr><th>枠</th><th>アイテム</th><th title="4 ビットの値 (0〜15)">率</th><th></th></tr>
          {m.dropSlots.map((d, k) => {
            const [ik, rk] = DROPS[k]!;
            const changed = d.item !== book.original(m.row, ik);
            return (
              <tr key={k}>
                <td className="num muted">{k + 1}</td>
                <td>
                  <button className={changed ? 'edited' : ''} title={changed ? `元: ${session.game.master.itemName(book.original(m.row, ik)) || 'なし'}` : 'アイテムを選ぶ'}
                    onClick={() => setPicking(k)}>{d.item ? session.game.master.itemName(d.item) || `#${d.item}` : '(なし)'}</button>
                  {!!d.item && <a href={`#/items/${d.item}`} title="アイテム図鑑で開く"> ↗</a>}
                </td>
                <td><FieldSelect {...p} k={rk} labels={rateLabel} /></td>
                <td>{!!d.item && <button className="small" title="この枠を空にする" onClick={() => setItem(k, 0)}>×</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        率の値ごとに、BattleParameter の表 (+0x10C) で「何回に 1 回落とすか」が決まり、3 枠それぞれ別に抽選されます。
        値 0〜9 はおたから、10〜12 はレア、13〜15 は激レアで、パーティーの「ドロップ率アップ」(状態 80〜82、%) がそれぞれに効きます
        (確率 = 1 − (1 − 1/表の値)^(% / 100))。表示は補正なしのときです。
      </p>
      {picking !== null && data && !(data instanceof Error) && (
        <ItemPicker game={session.game} items={data.items} title={`ドロップ ${picking + 1} のアイテムを選ぶ`} current={m.dropSlots[picking]?.item}
          unavailable={(it) => (it.id > fieldMax(PARAM.drop0) ? 'ドロップの欄 (10 ビット) に入らない番号です' : null)}
          onClose={() => setPicking(null)} onPick={(id) => { setPicking(null); setItem(picking, id); }} />
      )}
      {data instanceof Error && <div className="error">{data.message}</div>}
    </section>
  );
}

/** "ワザ A (005_)" for an animation number; the number in hex for the others. */
function motionLabel(n: number): string {
  if (!n) return '';
  const m = SKILL_MOTION[n];
  return m ? `${m[0]} (${m[1]})` : `0x${n.toString(16).toUpperCase()}`;
}

/**
 * The 6 skill slots (drag to reorder, × to remove, ＋ to add) with each one's share under AI mode 0, and
 * the AI fields (mode, target, actions per turn, focus).
 */
export function SkillEditor({ actions, ...p }: EditProps & { actions: ActionBook }): ReactNode {
  const { book, m, edited } = p;
  const [picking, setPicking] = useState<{ current?: number; onPick: (a: number) => void } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const skills = m.skills.map((s) => s.action);
  const orig = book.originalSkills(m.row);
  const set = (next: number[]): void => {
    book.setSkills(m.row, next);
    edited();
  };
  const shares = skillShares(skills);
  const move = (from: number, to: number): void => {
    const next = [...skills];
    const [a] = next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, a!);
    set(next);
  };
  const endDrag = (): void => {
    dragFrom.current = null;
    setDragging(null);
    setDropAt(null);
  };
  return (
    <section>
      <h3>ワザと行動</h3>
      <table className="enc-table skill-slots editable">
        <tbody>
          <tr><th></th><th>枠</th><th>ワザ</th><th title="アクション +0x1E の演出の行 +0x0A (アニメ番号)">モーション</th><th title="AI が「均等」のときの出やすさ">均等での割合</th><th></th></tr>
          {m.skills.map((s, i) => {
            const a = actions.action(s.action);
            const cls = [orig[i] !== s.action ? 'edited-row' : '', i === dragging ? 'dragging' : '', i === dropAt ? 'drop-before' : '',
              dropAt === skills.length && i === skills.length - 1 ? 'drop-after' : ''].filter(Boolean).join(' ');
            return (
              <tr key={`${i}:${s.action}`} className={cls} draggable
                onDragStart={(e) => {
                  dragFrom.current = i;
                  e.dataTransfer.setData('text/plain', `skill ${i}`);
                  e.dataTransfer.effectAllowed = 'move';
                  requestAnimationFrame(() => setDragging(i));
                }}
                onDragOver={(e) => {
                  if (dragFrom.current === null) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt(e.clientY > r.top + r.height / 2 ? i + 1 : i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom.current !== null && dropAt !== null) move(dragFrom.current, dropAt);
                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                <td className="drag-handle" title="ドラッグで並べ替え">⠿</td>
                <td className="num muted">{i + 1}</td>
                <td>
                  <button title="ワザを選び直す" onClick={() => setPicking({ current: s.action, onPick: (x) => set(skills.map((y, j) => (j === i ? x : y))) })}>{s.name}</button>
                  {' '}<a className="muted" href={`#/actions/${s.action}`} draggable={false}>{`#${s.action}`}</a>
                  {!!a?.formChange && <span className="muted small">{` → #${a.formChange} に変身`}</span>}
                </td>
                <td className="muted">{motionLabel(actions.motion(s.action))}</td>
                <td className="num">{m.aiMode === 0 ? `${Math.round((shares.get(s.action) ?? 0) * 100)}%` : ''}</td>
                <td><button className="small" title="この枠を外す" onClick={() => set(skills.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            );
          })}
          {!m.skills.length && <tr><td colSpan={6} className="muted">なし (既定の行動だけになります)</td></tr>}
        </tbody>
      </table>
      <div className="row">
        <button disabled={skills.length >= SKILL_SLOTS} title={skills.length >= SKILL_SLOTS ? `ワザは ${SKILL_SLOTS} 枠まで` : ''}
          onClick={() => setPicking({ onPick: (x) => set([...skills, x]) })}>＋ 追加</button>
        <span className="muted small">同じワザを複数の枠に入れると、「均等」ではその数だけ出やすくなります。</span>
      </div>
      <table className="enc-table ai-fields">
        <tbody>
          <tr><td>AI</td><td><FieldSelect {...p} k="ai" labels={(v) => `${v} ${AI_MODE[v]}`} /></td></tr>
          <tr><td></td><td className="muted small">{AI_MODE_NOTE[m.aiMode]}</td></tr>
          <tr><td>狙い方</td><td><FieldSelect {...p} k="target" labels={(v) => TARGET_MODE[v] ?? String(v)} /></td></tr>
          <tr><td>行動回数</td><td><FieldSelect {...p} k="actions" labels={String} /> <span className="muted small">(状態 86)</span></td></tr>
          <tr><td>集中攻撃</td><td><FieldCheck {...p} k="focus" label="状態 85" /></td></tr>
        </tbody>
      </table>
      {picking && (
        <ActionPicker actions={actions} current={picking.current} onClose={() => setPicking(null)}
          onPick={(a) => { setPicking(null); picking.onPick(a); }} />
      )}
    </section>
  );
}

/** The forms of a boss: what the others turn into, and this row's condition, next form, line and start condition. */
export function BossEditor({ session, actions, ...p }: EditProps & { session: Session; actions: ActionBook }): ReactNode {
  const { book, m, edited } = p;
  const [picking, setPicking] = useState(false);
  const link = (row: number): ReactNode => <a href={`#/monsters/${row}`}>{`${book.monster(row)?.name ?? '?'} (#${row})`}</a>;
  const skillForms = m.skills.map((s) => ({ s, to: actions.action(s.action)?.formChange ?? 0 })).filter((x) => x.to);
  // Rows turning into this one: by a condition (+0x50) or by a skill (kind 3 type 5).
  const fromCond = book.monsters.filter((o) => o.nextForm === m.row);
  const fromSkill = book.monsters.flatMap((o) => o.skills.filter((s) => actions.action(s.action)?.formChange === m.row).map((s) => ({ o, s })));
  const nextChanged = m.nextForm !== book.original(m.row, 'nextForm');
  const cond = (v: number): string => (v ? `${v} ${book.conditions[v] ?? ''}` : '0 なし');
  return (
    <section>
      <h3>ボス・変身</h3>
      {(fromCond.length > 0 || fromSkill.length > 0) && (
        <div className="small">
          {fromCond.map((o) => <div key={`c${o.row}`}>{link(o.row)}{` が「${BOSS_CONDITION[o.boss] ?? `番号 ${o.boss}`}」にこの形態になる`}</div>)}
          {fromSkill.map(({ o, s }, i) => <div key={`s${i}`}>{link(o.row)}{` がワザ「${s.name}」でこの形態になる`}</div>)}
        </div>
      )}
      <table className="enc-table ai-fields">
        <tbody>
          <tr>
            <td>変身の条件</td>
            <td><FieldSelect {...p} k="boss" labels={(v) => `${v} ${BOSS_CONDITION[v] ?? '未確認'}`} /></td>
          </tr>
          <tr>
            <td>次の形態</td>
            <td>
              <button className={nextChanged ? 'edited' : ''} onClick={() => setPicking(true)}>{m.nextForm ? `${book.monster(m.nextForm)?.name ?? '?'} (#${m.nextForm})` : '(なし)'}</button>
              {!!m.nextForm && <>{' '}{link(m.nextForm)}{' '}<button className="small" title="次の形態をなくす" onClick={() => { book.set(m.row, 'nextForm', 0); edited(); }}>×</button></>}
            </td>
          </tr>
          <tr><td>変身のエフェクト</td><td><Field {...p} k="effect" /> <span className="muted small">(+0x36。例: まおう 840 = ふこうのオーラ)</span></td></tr>
          <tr><td>登場時のセリフ</td><td>{m.line ? `「${m.line.replace(/[Ąą]+/g, m.name)}」` : <span className="muted">なし</span>} <span className="muted small">{`(+0x38 = ${book.get(m.row, 'line')})`}</span></td></tr>
          <tr><td>開始時の状態</td><td><FieldSelect {...p} k="startCondition" labels={cond} /> 強さ <Field {...p} k="startPower" /> ターン <Field {...p} k="startTurns" /></td></tr>
        </tbody>
      </table>
      {m.boss > 0 && !m.nextForm && <div className="issue warn">⚠ 変身の条件がありますが、次の形態がありません。</div>}
      {m.nextForm > 0 && !m.boss && !skillForms.length && <div className="muted small">次の形態はありますが、変身の条件が 0 なので攻撃では変身しません。</div>}
      {skillForms.map(({ s, to }, i) => <div key={i} className="small">{`ワザ「${s.name}」で `}{link(to)}{' に変身する'}</div>)}
      <p className="muted small">
        変身の条件は code.bin に固定で書かれた 13 通り (FUN_0030fa18) から選びます。条件を満たすと「次の形態」の行で作り直し、エフェクトとその行のセリフを出します。
        ワザでの変身は、カテゴリ 3・種別 5 のアクションの +0x16 の行になります。
      </p>
      {picking && (
        <MonsterPicker session={session} book={book} current={m.nextForm} title="次の形態を選ぶ" onClose={() => setPicking(false)}
          onPick={(row) => { setPicking(false); book.set(m.row, 'nextForm', row); edited(); }} />
      )}
    </section>
  );
}
