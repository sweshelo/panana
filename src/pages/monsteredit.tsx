// Editors of a MonsterParameter row in the monster book: stats, drops, skills and AI, boss forms.
// Fields: src/game/monsters.ts PARAM (elpulse docs/battle.md §2〜§4).
import { useEffect, useState, type ReactNode } from 'react';
import { ACTION_KIND, ELEMENT, type ActionBook } from '../game/actions';
import {
  AI_MODE, AI_MODE_NOTE, BOSS_CONDITION, dropClass, fieldMax, PARAM, SKILL_MOTION, SKILL_SLOTS, skillShares, TARGET_MODE,
  type Monster, type MonsterBook, type ParamKey,
} from '../game/monsters';
import type { Session } from '../session';
import { ActionPicker } from '../ui/ActionPicker';
import { actionEdits, ActionEditor } from '../ui/ActionEditor';
import { BattleMessagePicker } from '../ui/BattleMessagePicker';
import { Dialog } from '../ui/Dialog';
import { Board, EmptyBoard } from '../ui/Board';
import { FieldCheck as SharedFieldCheck, FieldChoice, FieldNumber, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { InfoTip } from '../ui/InfoTip';
import { performancePhase, TransformPreview } from '../ui/PerformanceEditor';
import { ItemPicker } from '../ui/ItemPicker';
import { MonsterPicker } from '../ui/MonsterPicker';
import { ActionBadge, DropSlots, Heading, moveTo, SkillSlots, type BoardEntry } from '../ui/MonsterSlots';
import { Photo } from '../ui/Photo';
import { useAsync } from '../ui/useAsync';
import { itemRef } from './items';
import { monsterRef } from './monsters';

interface EditProps {
  book: MonsterBook;
  m: Monster;
  edited: () => void;
}

/** The fields of a monster's row. */
function paramAccess(book: MonsterBook, m: Monster): FieldAccess {
  return {
    get: (k) => book.get(m.row, k as ParamKey),
    original: (k) => book.original(m.row, k as ParamKey),
    set: (k, v) => book.set(m.row, k as ParamKey, v),
    range: (k) => [0, fieldMax(PARAM[k as ParamKey])],
  };
}

/** A number box for a field, marked when it differs from the archive. */
function Field({ book, m, edited, k }: EditProps & { k: ParamKey }): ReactNode {
  return <FieldNumber f={paramAccess(book, m)} k={k} edited={edited} />;
}

/** A select of a field's values with labels. */
function FieldSelect({ book, m, edited, k, labels }: EditProps & { k: ParamKey; labels: (v: number) => string }): ReactNode {
  return <FieldChoice f={paramAccess(book, m)} k={k} edited={edited} labels={labels} />;
}

function FieldCheck({ book, m, edited, k, label }: EditProps & { k: ParamKey; label: string }): ReactNode {
  return <SharedFieldCheck f={paramAccess(book, m)} k={k} edited={edited} label={label} />;
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

const RANGE_INFO = '出現ごとに「最小〜最大」の乱数になります。\n最小 0 の欄は元のデータにも多く、最大の値で固定と見られます。';

/** Level, the stat ranges (min 〜 max), evasion, rewards, HP regeneration and ghost. */
export function StatEditor(p: EditProps): ReactNode {
  const f = paramAccess(p.book, p.m);
  return (
    <StatFields f={f} edited={p.edited} stats={[
      { label: 'Lv', k: 'level' },
      { label: 'HP', range: ['hpMin', 'hpMax'], info: RANGE_INFO },
      { label: 'こうげき', range: ['attackMin', 'attackMax'] },
      { label: 'ぼうぎょ', range: ['defenseMin', 'defenseMax'] },
      { label: 'すばやさ', range: ['speedMin', 'speedMax'] },
      { label: '回避', k: 'evasion', unit: '%' },
      { label: '経験値', k: 'exp' },
      { label: 'ゴールド', k: 'gold' },
      { label: 'HP 自動回復', k: 'regen' },
      { label: 'ゴースト', node: <FieldCheck {...p} k="ghost" label="状態 21" /> },
    ]} />
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
  const data = useAsync(() => session.items(), [session]);
  const items = data && !(data instanceof Error) ? data.items : null;
  const entry = (id: number): BoardEntry => {
    const it = items?.item(id);
    return { icon: <Photo model={it ? itemRef(game, it) : null} />, name: game.master.itemName(id) || `#${id}`, href: `#/items/${id}` };
  };
  return (
    <>
      <DropSlots
        info={DROP_INFO}
        slots={m.dropSlots.map((d, k) => ({
          item: d.item,
          original: book.original(m.row, DROPS[k]![0]),
          sub: `${dropClass(d.rate)[1]}・${pct(book.battle.dropOdds(d.rate))}`,
          rate: <FieldSelect {...p} k={DROPS[k]![1]} labels={(v) => `${v}: ${oneIn(book.battle.dropOdds(v))}`} />,
        }))}
        entry={entry}
        setItem={(k, id) => { book.set(m.row, DROPS[k]![0], id); edited(); }}
        picker={(k, current, pick, close) => items && (
          <ItemPicker game={game} items={items} title={`ドロップ ${k + 1} のアイテムを選ぶ`} current={current}
            unavailable={(it) => (it.id > fieldMax(PARAM.drop0) ? 'ドロップの欄 (10 ビット) に入らない番号です' : null)}
            onClose={close} onPick={pick} />
        )}
      />
      {data instanceof Error && <div className="error">{data.message}</div>}
    </>
  );
}

/** "ワザ A (005_)" for an animation number; the number in hex for the others. */
function motionLabel(n: number): string {
  if (!n) return '';
  const m = SKILL_MOTION[n];
  return m ? `${m[0]} (${m[1]})` : `モーション 0x${n.toString(16).toUpperCase()}`;
}

/** Badge of an RPG2 action: its element, or its kind. */
const badge = (element: number, kind: number): ReactNode => <ActionBadge element={element} label={ELEMENT[element] || (ACTION_KIND[kind] ?? '?').slice(0, 1)} />;

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
  const skills = m.skills.map((s) => s.action);
  const orig = book.originalSkills(m.row);
  const set = (next: number[]): void => {
    book.setSkills(m.row, next);
    edited();
  };
  const shares = skillShares(skills);
  return (
    <section>
      <Heading title="ワザと行動" info={SKILL_INFO} />
      <SkillSlots
        slots={m.skills.map((s, i) => {
          const a = actions.action(s.action);
          const sub = [motionLabel(actions.motion(s.action)), a?.formChange ? `→ #${a.formChange} に変身` : ''].filter(Boolean).join('・');
          return {
            action: s.action,
            entry: { icon: badge(a?.element ?? 0, a?.kind ?? 0), name: s.name, href: `#/actions/${s.action}` },
            sub: sub || undefined,
            edited: orig[i] !== s.action,
            extra: (
              <>
                <span className="num slot-share" title="AI が「均等」のときの出やすさ">{m.aiMode === 0 ? `${Math.round((shares.get(s.action) ?? 0) * 100)}%` : ''}</span>
                <button className="small" title="このワザを編集 (名前・モーションなど)" onClick={() => setEditing(i)}>✎</button>
              </>
            ),
          };
        })}
        max={SKILL_SLOTS}
        move={(from, to) => set(moveTo(skills, from, to))}
        pick={(i, x) => set(i < 0 ? [...skills, x] : skills.map((y, j) => (j === i ? x : y)))}
        remove={(i) => set(skills.filter((_, j) => j !== i))}
        picker={(current, pick, close) => <ActionPicker actions={actions} current={current} onClose={close} onPick={pick} />}
        empty="ワザがないと既定の行動だけになります。"
      />
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
  '条件を満たすと「次の形態」の行で作り直し、変身のエフェクトと、次の形態の行のセリフ (+0x38) を出します。',
  'ワザでの変身は、カテゴリ 3・種別 5 のアクションの +0x16 の行になります。',
].join('\n');

const LINE_INFO = [
  '+0x38。ユニットがこの行の形態に変わったとき (変身の条件・変身のワザ) に出す戦闘のメッセージ (MessageBattle) です。0 = なし。',
  'アクションではありません。攻撃が当たって変身したあと、演出の進行が新しい行の +0x38 を読んで表示します (FUN_0022f430 など)。',
  'ほかの形態と同じメッセージのときは、書き換えると両方変わります。「この形態だけのセリフにする」で、同じ本文の新しいメッセージに分けられます。',
].join('\n');

/** The line of a form (+0x38): its text, sharing, picking another message, a new one, none. */
function LineEditor({ session, actions, book, m, edited }: EditProps & { session: Session; actions: ActionBook }): ReactNode {
  const [picking, setPicking] = useState(false);
  const texts = session.game.master.texts;
  const line = book.get(m.row, 'line');
  const orig = book.original(m.row, 'line');
  const sharers = book.lineSharers(m.row);
  const apply = (f: () => void): void => {
    try {
      f();
    } catch (err) {
      alert((err as Error).message);
      return;
    }
    edited();
  };
  const users = (): Map<number, string[]> => {
    const out = new Map<number, string[]>();
    const add = (id: number, who: string): void => void out.set(id, [...(out.get(id) ?? []), who]);
    for (const o of book.monsters) { const l = book.get(o.row, 'line'); if (l) add(l, `${o.name} #${o.row}`); }
    for (const a of actions.actions) if (a.nameId) add(a.nameId, `アクション #${a.row}`);
    return out;
  };
  return (
    <div>
      {line > 0 && texts.text(line) ? (
        texts.editable(line)
          ? <LineInput key={`${m.row}:${line}`} value={texts.text(line)!.text} edited={texts.isEdited(line) || line !== orig}
              onCommit={(t) => apply(() => { texts.setText(line, t); book.reload(); })} />
          : <span>{texts.preview(line, true)}</span>
      ) : <span className="muted">{line ? `メッセージ ${line} (見つかりません)` : 'なし'}</span>}
      <div className="small">
        {line > 0 && <span className="muted">{`${line} `}</span>}
        {sharers.length > 0 && <span className="muted">{`同じセリフ: ${sharers.slice(0, 3).map((r) => `${book.monster(r)?.name ?? '?'} #${r}`).join('、')}${sharers.length > 3 ? ` ほか ${sharers.length - 3}` : ''} `}</span>}
        {line > 0 && sharers.length > 0 && <button className="small" disabled={!texts.canAdd()} onClick={() => apply(() => book.ownLine(m.row))}>この形態だけのセリフにする</button>}
        {!line && <button className="small" disabled={!texts.canAdd()} title="新しいメッセージを作ってこの形態のセリフにします" onClick={() => apply(() => book.ownLine(m.row))}>セリフを作る</button>}
        <button className="small" onClick={() => setPicking(true)}>別のメッセージにする</button>
        {line > 0 && <button className="small" title="セリフを出さないようにします (+0x38 = 0)" onClick={() => apply(() => book.set(m.row, 'line', 0))}>なしにする</button>}
      </div>
      {picking && (
        <BattleMessagePicker session={session} title="セリフのメッセージを選ぶ" current={line} users={users()} freeLabel="使われていないものだけ"
          info="戦闘の文章などコードが直接使うものもあるので、選んだあと本文を書き換えるときは、元の本文が何に使われていそうか確かめてください。"
          onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); apply(() => book.set(m.row, 'line', id)); }} />
      )}
    </div>
  );
}

/** A one-line text box applied on Enter or when left. */
function LineInput({ value, edited, onCommit }: { value: string; edited: boolean; onCommit: (t: string) => void }): ReactNode {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (): void => {
    if (text !== value) onCommit(text);
  };
  return <input type="text" className={`name-input${edited ? ' edited' : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/** The forms of a boss: what the others turn into, and this row's condition, next form, effect and start condition. */
export function BossEditor({ session, actions, ...p }: EditProps & { session: Session; actions: ActionBook }): ReactNode {
  const { book, m, edited } = p;
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState(false);
  const effect = book.get(m.row, 'effect');
  const transformPhase = effect ? performancePhase(session, effect, m, '変身', null) : null;
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
          <tr>
            <td className="with-info">変身のエフェクト<InfoTip text="+0x36。変身の条件を満たしたときに再生する演出 (2713402F の directData の行)。0 = なし" /></td>
            <td>
              <div className="inline-fields">
                <Field {...p} k="effect" />
                <button className="small" disabled={!transformPhase} title="変身の演出をこのモンスターで再生します" onClick={() => setPreview(!preview)}>{preview ? '閉じる' : '▶ プレビュー'}</button>
              </div>
              {effect > 0 && <div className="muted small">{transformPhase ? transformPhase.title.replace(/^変身: [^—]*— /, '') : '(演出の表の外)'}</div>}
            </td>
          </tr>
          {preview && transformPhase && <tr><td colSpan={2}><TransformPreview session={session} monster={m} row={effect} /></td></tr>}
          <tr>
            <td className="with-info">変身時のセリフ<InfoTip text={LINE_INFO} /></td>
            <td><LineEditor session={session} actions={actions} {...p} /></td>
          </tr>
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
