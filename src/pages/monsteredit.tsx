// Editors of a MonsterParameter row in the monster book: stats, drops, skills and AI, boss forms.
// Fields: src/game/monsters.ts PARAM (elpulse docs/battle.md §2〜§4).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ACTION_KIND, ELEMENT, type ActionBook } from '../game/actions';
import {
  AI_MODE, AI_MODE_NOTE, BOSS_CONDITION, dropClass, fieldMax, PARAM, SKILL_MOTION, SKILL_SLOTS, skillShares, TARGET_MODE,
  type Monster, type MonsterBook, type ParamKey,
} from '../game/monsters';
import type { Session } from '../session';
import { ActionPicker } from '../ui/ActionPicker';
import { actionEdits, ActionEditor } from '../ui/ActionEditor';
import { Dialog } from '../ui/Dialog';
import { Board, EmptyBoard } from '../ui/Board';
import { NumberInput } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ItemPicker } from '../ui/ItemPicker';
import { MonsterPicker } from '../ui/MonsterPicker';
import { Photo } from '../ui/Photo';
import { useAsync } from '../ui/useAsync';
import { itemRef } from './items';
import { monsterRef } from './monsters';

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

const NAME_INFO = [
  '名前は MonsterDesign (+0x00) のメッセージです。同じデザインの行 (ボスの別の形態など) は同じ名前になります。',
  '「このモンスターだけの名前にする」はデザインの行と名前のメッセージを新しく足し、この行だけ名前を変えられるようにします。写して作ったモンスターは最初からそうなっています。',
  '説明文は元のモンスターと共通のままです。',
].join('\n');

/** The monster's name (its design's name message), and giving the row a design of its own when others share it. */
export function NameEditor({ session, book, m, edited }: EditProps & { session: Session }): ReactNode {
  const texts = session.game.master.texts;
  const id = book.nameId(m.row);
  const current = id ? texts.text(id)?.text ?? '' : '';
  const [text, setText] = useState(current);
  const [error, setError] = useState('');
  useEffect(() => { setText(current); setError(''); }, [current, m.row]);
  const sharers = book.nameSharers(m.row);
  const commit = (): void => {
    if (text === current) return;
    try {
      book.setName(m.row, text);
      setError('');
      edited();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!id) return null;
  return (
    <div className="stat name-edit">
      <span className="muted with-info">名前<InfoTip text={NAME_INFO} /></span>
      <span>
        <input type="text" className={`${texts.isEdited(id) ? 'edited' : ''}${error ? ' bad' : ''}`} value={text} title={error || `メッセージ ${id}`}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        {sharers.length > 0 && (
          <>
            <span className="muted small">{` 同じ名前: ${sharers.map((r) => `#${r}`).join(' ')}`}</span>
            <button className="small" disabled={!book.canOwnDesign()} title="デザインの行と名前のメッセージを足して、この行だけの名前にします"
              onClick={() => { book.ownDesign(m.row); edited(); }}>このモンスターだけの名前にする</button>
          </>
        )}
      </span>
    </div>
  );
}

const RANGES: [string, ParamKey, ParamKey][] = [
  ['HP', 'hpMin', 'hpMax'], ['こうげき', 'attackMin', 'attackMax'], ['ぼうぎょ', 'defenseMin', 'defenseMax'], ['すばやさ', 'speedMin', 'speedMax'],
];

/** A section heading with its explanation behind an info icon. */
function Heading({ title, info }: { title: string; info: string }): ReactNode {
  return <h3 className="with-info">{title}<InfoTip text={info} /></h3>;
}

/** Level, the stat ranges (min 〜 max), evasion, rewards, HP regeneration and ghost. */
export function StatEditor(p: EditProps): ReactNode {
  const { m } = p;
  const one = (label: string, k: ParamKey, unit = ''): ReactNode => (
    <div className="stat"><span className="muted">{label}</span><span><Field {...p} k={k} />{unit}</span></div>
  );
  const range = (label: string, lo: ParamKey, hi: ParamKey, info?: string): ReactNode => (
    <div key={label} className="stat stat-range">
      <span className="muted with-info">{label}{info && <InfoTip text={info} />}</span>
      <span><Field {...p} k={lo} />〜<Field {...p} k={hi} /></span>
    </div>
  );
  return (
    <>
      <div className="stats stat-edit">
        {one('Lv', 'level')}
        {RANGES.map(([label, lo, hi], i) =>
          range(label, lo, hi, i === 0 ? '出現ごとに「最小〜最大」の乱数になります。\n最小 0 の欄は元のデータにも多く、最大の値で固定と見られます。' : undefined))}
        {one('回避', 'evasion', '%')}
        {one('経験値', 'exp')}
        {one('ゴールド', 'gold')}
        {one('HP 自動回復', 'regen')}
        <div className="stat"><span className="muted">ゴースト</span><FieldCheck {...p} k="ghost" label="状態 21" /></div>
      </div>
      {RANGES.some(([, lo, hi]) => p.book.get(m.row, lo) > p.book.get(m.row, hi)) && (
        <div className="issue warn">⚠ 最小が最大より大きい欄があります (ゲームで確かめていません)。</div>
      )}
    </>
  );
}

/** "1/8" for 1 in 8; "必ず" for 1 in 1. */
export const oneIn = (n: number): string => (n === 1 ? '必ず' : Number.isFinite(n) ? `1/${n}` : '出ない');

/** "16.7%" of "1 in n"; two digits under 1% ("0.024%"). */
export const pct = (n: number): string => (!Number.isFinite(n) ? '0%' : n > 100 ? `${Number((100 / n).toPrecision(2))}%` : `${Math.round(1000 / n) / 10}%`);

const DROPS: [ParamKey, ParamKey][] = [['drop0', 'rate0'], ['drop1', 'rate1'], ['drop2', 'rate2']];

const DROP_INFO = [
  '率の値ごとに BattleParameter の表 (+0x10C) で「何回に 1 回落とすか」が決まり、3 枠はそれぞれ別に抽選されます。',
  '値 0〜9 はおたから、10〜12 はレア、13〜15 は激レア。パーティーの「ドロップ率アップ」(状態 80〜82、%) がそれぞれに効きます。',
  '確率 = 1 − (1 − 1/表の値)^(% / 100)。表示は補正なしのときです。',
].join('\n');

/** The 3 drop slots: item board (picked from the photos) and the rate. */
export function DropEditor({ session, ...p }: EditProps & { session: Session }): ReactNode {
  const { book, m, edited } = p;
  const { game } = session;
  const [picking, setPicking] = useState<number | null>(null);
  const data = useAsync(() => session.items(), [session]);
  const items = data && !(data instanceof Error) ? data.items : null;
  const setItem = (k: number, id: number): void => {
    book.set(m.row, DROPS[k]![0], id);
    edited();
  };
  return (
    <section>
      <Heading title="ドロップ" info={DROP_INFO} />
      <div className="slot-list drop-slots">
        {m.dropSlots.map((d, k) => {
          const [ik, rk] = DROPS[k]!;
          const orig = book.original(m.row, ik);
          const it = d.item ? items?.item(d.item) : undefined;
          return (
            <div key={k} className="slot-row">
              {d.item
                ? <Board
                    icon={<Photo model={it ? itemRef(game, it) : null} />}
                    name={game.master.itemName(d.item) || `#${d.item}`}
                    sub={`${dropClass(d.rate)[1]}・${pct(book.battle.dropOdds(d.rate))}`}
                    id={d.item}
                    href={`#/items/${d.item}`}
                    edited={d.item !== orig}
                    title={d.item !== orig ? `元: ${game.master.itemName(orig) || 'なし'}` : 'アイテムを選び直す'}
                    onClick={() => setPicking(k)}
                  />
                : <EmptyBoard label="＋ アイテム" title="この枠にアイテムを入れる" onClick={() => setPicking(k)} />}
              <FieldSelect {...p} k={rk} labels={(v) => `${v}: ${oneIn(book.battle.dropOdds(v))}`} />
              <button className="small slot-remove" title="この枠を空にする" disabled={!d.item} onClick={() => setItem(k, 0)}>×</button>
            </div>
          );
        })}
      </div>
      {picking !== null && items && (
        <ItemPicker game={game} items={items} title={`ドロップ ${picking + 1} のアイテムを選ぶ`} current={m.dropSlots[picking]?.item}
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
  return m ? `${m[0]} (${m[1]})` : `モーション 0x${n.toString(16).toUpperCase()}`;
}

/** Badge of an action (no model): its element, or its kind. */
function ActionBadge({ element, kind }: { element: number; kind: number }): ReactNode {
  const label = ELEMENT[element] || (ACTION_KIND[kind] ?? '?').slice(0, 1);
  return <span className={`badge-icon elem-${element}`}>{label}</span>;
}

const SKILL_INFO = [
  '最大 6 枠。ドラッグで並べ替え、× で外します。',
  '同じワザを複数の枠に入れると、AI が「均等」のときはその数だけ出やすくなります (右の % が出やすさ)。',
  '✎ でワザの名前・モーション・属性などを変えられます。ほかのモンスターも使うワザは、複製してこのモンスター専用のワザにできます。',
].join('\n');

/**
 * The 6 skill slots (drag to reorder, × to remove, ＋ to add) with each one's share under AI mode 0, and
 * the AI fields (mode, target, actions per turn, focus).
 */
export function SkillEditor({ session, actions, ...p }: EditProps & { session: Session; actions: ActionBook }): ReactNode {
  const { book, m, edited } = p;
  const [editing, setEditing] = useState<number | null>(null);
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
      <Heading title="ワザと行動" info={SKILL_INFO} />
      <div className="slot-list skill-slots">
        {m.skills.map((s, i) => {
          const a = actions.action(s.action);
          const sub = [motionLabel(actions.motion(s.action)), a?.formChange ? `→ #${a.formChange} に変身` : ''].filter(Boolean).join('・');
          const cls = ['slot-row', i === dragging ? 'dragging' : '', i === dropAt ? 'drop-before' : '',
            dropAt === skills.length && i === skills.length - 1 ? 'drop-after' : ''].filter(Boolean).join(' ');
          return (
            <div key={`${i}:${s.action}`} className={cls} draggable
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
              <span className="drag-handle" title="ドラッグで並べ替え">⠿</span>
              <Board
                icon={<ActionBadge element={a?.element ?? 0} kind={a?.kind ?? 0} />}
                name={s.name}
                sub={sub || undefined}
                id={s.action}
                href={`#/actions/${s.action}`}
                edited={orig[i] !== s.action}
                title="ワザを選び直す"
                onClick={() => setPicking({ current: s.action, onPick: (x) => set(skills.map((y, j) => (j === i ? x : y))) })}
              />
              <span className="num slot-share" title="AI が「均等」のときの出やすさ">{m.aiMode === 0 ? `${Math.round((shares.get(s.action) ?? 0) * 100)}%` : ''}</span>
              <button className="small" title="このワザを編集 (名前・モーションなど)" onClick={() => setEditing(i)}>✎</button>
              <button className="small slot-remove" title="この枠を外す" onClick={() => set(skills.filter((_, j) => j !== i))}>×</button>
            </div>
          );
        })}
        {skills.length < SKILL_SLOTS && (
          <div className="slot-row">
            <span className="drag-handle" />
            <EmptyBoard label="＋ ワザを追加" onClick={() => setPicking({ onPick: (x) => set([...skills, x]) })} />
          </div>
        )}
        {!m.skills.length && <div className="muted small">ワザがないと既定の行動だけになります。</div>}
      </div>
      <table className="enc-table ai-fields">
        <tbody>
          <tr>
            <td className="with-info">AI<InfoTip text={AI_MODE.slice(0, 5).map((n, v) => `${v} ${n}: ${AI_MODE_NOTE[v]}`).join('\n')} /></td>
            <td><FieldSelect {...p} k="ai" labels={(v) => `${v} ${AI_MODE[v]}`} /></td>
          </tr>
          <tr><td>狙い方</td><td><FieldSelect {...p} k="target" labels={(v) => TARGET_MODE[v] ?? String(v)} /></td></tr>
          <tr><td className="with-info">行動回数<InfoTip text="1 ターンに行動する回数 (状態 86)" /></td><td><FieldSelect {...p} k="actions" labels={String} /></td></tr>
          <tr><td className="with-info">集中攻撃<InfoTip text="状態 85。狙い方 2 のとき、HP が一番低い味方を狙います" /></td><td><FieldCheck {...p} k="focus" label="あり" /></td></tr>
        </tbody>
      </table>
      {editing !== null && skills[editing] !== undefined && (
        <SkillEditDialog session={session} actions={actions} m={m} action={skills[editing]!} edited={edited}
          onCopy={(n) => set(skills.map((y, j) => (j === editing ? n : y)))} onClose={() => setEditing(null)} />
      )}
      {picking && (
        <ActionPicker actions={actions} current={picking.current} onClose={() => setPicking(null)}
          onPick={(a) => { setPicking(null); picking.onPick(a); }} />
      )}
    </section>
  );
}

/**
 * Editing the action of a skill slot. When other monsters or items use it too, the edit changes them as well, so
 * the dialog offers a copy for this monster first (the slot then holds the copy).
 */
function SkillEditDialog({ session, actions, m, action, edited, onCopy, onClose }: {
  session: Session;
  actions: ActionBook;
  m: Monster;
  action: number;
  edited: () => void;
  onCopy: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const a = actions.action(action);
  const refs = actions.refsOf(action);
  const others = [...new Set(refs.monsters.filter((x) => x.row !== m.row).map((x) => x.name))];
  const shared = others.length + refs.items.length;
  const copy = (): void => {
    const n = actionEdits(session).copy(action);
    onCopy(n);
  };
  return (
    <Dialog title={`ワザ「${a?.name || `#${action}`}」を編集`} wide={false} onClose={onClose}>
      {shared > 0 && (
        <div className="warn-box">
          {`このワザは ${[...others.slice(0, 3), ...refs.items.slice(0, 2).map((i) => `アイテム ${i.name}`)].join('・')}${shared > 5 ? ' など' : ''} も使っています。ここで変えるとそちらも変わります。`}
          <div className="row"><button className="primary" onClick={copy}>{`複製して ${m.name} 専用にする`}</button></div>
        </div>
      )}
      <ActionEditor session={session} actions={actions} row={action} monsters={[m]} onChange={edited} />
      <div className="muted small"><a href={`#/actions/${action}`}>{`アクション #${action} を開く`}</a></div>
    </Dialog>
  );
}

const BOSS_INFO = [
  '変身の条件は code.bin に固定で書かれた 13 通り (FUN_0030fa18) から選びます。',
  '条件を満たすと「次の形態」の行で作り直し、変身のエフェクトと、その行の登場時のセリフ (+0x38) を出します。',
  'ワザでの変身は、カテゴリ 3・種別 5 のアクションの +0x16 の行になります。',
].join('\n');

/** The forms of a boss: what the others turn into, and this row's condition, next form, effect and start condition. */
export function BossEditor({ session, actions, ...p }: EditProps & { session: Session; actions: ActionBook }): ReactNode {
  const { book, m, edited } = p;
  const [picking, setPicking] = useState(false);
  const link = (row: number): ReactNode => <a href={`#/monsters/${row}`}>{`${book.monster(row)?.name ?? '?'} #${row}`}</a>;
  const skillForms = m.skills.map((s) => ({ s, to: actions.action(s.action)?.formChange ?? 0 })).filter((x) => x.to);
  // Rows turning into this one: by a condition (+0x50) or by a skill (kind 3 type 5).
  const fromCond = book.monsters.filter((o) => o.nextForm === m.row);
  const fromSkill = book.monsters.flatMap((o) => o.skills.filter((s) => actions.action(s.action)?.formChange === m.row).map((s) => ({ o, s })));
  const next = m.nextForm ? book.monster(m.nextForm) : undefined;
  const cond = (v: number): string => (v ? `${v} ${book.conditions[v] ?? ''}` : '0 なし');
  return (
    <section>
      <Heading title="ボス・変身" info={BOSS_INFO} />
      {(fromCond.length > 0 || fromSkill.length > 0) && (
        <div className="small form-from">
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
              <div className="slot-row">
                {m.nextForm
                  ? <Board
                      icon={<Photo model={next ? monsterRef(session.game, book, next) : null} />}
                      name={next?.name ?? '?'}
                      sub={next ? `Lv${next.level}` : undefined}
                      id={m.nextForm}
                      href={`#/monsters/${m.nextForm}`}
                      edited={m.nextForm !== book.original(m.row, 'nextForm')}
                      title="次の形態を選び直す"
                      onClick={() => setPicking(true)}
                    />
                  : <EmptyBoard label="＋ 次の形態" onClick={() => setPicking(true)} />}
                <button className="small slot-remove" title="次の形態をなくす" disabled={!m.nextForm} onClick={() => { book.set(m.row, 'nextForm', 0); edited(); }}>×</button>
              </div>
            </td>
          </tr>
          <tr><td className="with-info">変身のエフェクト<InfoTip text="+0x36。変身の条件を満たしたときに再生します。例: まおう 840 = ふこうのオーラ" /></td><td><Field {...p} k="effect" /></td></tr>
          <tr>
            <td className="with-info">開始時の状態<InfoTip text="戦闘の開始時にかかっている状態 (w10 bit12-16)、その強さ (bit17-20) とターン数 (+0x3A)" /></td>
            <td><FieldSelect {...p} k="startCondition" labels={cond} /></td>
          </tr>
          <tr><td>強さ・ターン</td><td className="inline-fields"><Field {...p} k="startPower" /><Field {...p} k="startTurns" /></td></tr>
        </tbody>
      </table>
      {m.boss > 0 && !m.nextForm && <div className="issue warn">⚠ 変身の条件がありますが、次の形態がありません。</div>}
      {m.nextForm > 0 && !m.boss && !skillForms.length && <div className="issue warn">⚠ 次の形態はありますが、変身の条件が 0 なので攻撃では変身しません。</div>}
      {skillForms.map(({ s, to }, i) => <div key={i} className="small">{`ワザ「${s.name}」で `}{link(to)}{' に変身する'}</div>)}
      {picking && (
        <MonsterPicker session={session} book={book} current={m.nextForm} title="次の形態を選ぶ" onClose={() => setPicking(false)}
          onPick={(row) => { setPicking(false); book.set(m.row, 'nextForm', row); edited(); }} />
      )}
    </section>
  );
}
