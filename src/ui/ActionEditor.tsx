// Editing an action (actionData row): its name, element, infliction level, amount and motion, copying it as a new
// action, and putting it back. Used by the action page and, in a dialog, by the skill slots of the monster editor.
import { useEffect, useState, type ReactNode } from 'react';
import { ACTION_KIND, ACTION_SIDE, ActionEdits, actionRangeLabel, actionTypeLabel, ELEMENT, type ActionBook } from '../game/actions';
import { ACTION_DIRECTION } from '../game/performance';
import { u16 } from '../util/bytes';
import { animationKey } from '../cgfx/player';
import { loadComposite } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, SKILL_MOTION, type Monster, type MonsterBook } from '../game/monsters';
import type { Game } from '../game/game';
import type { Session } from '../session';
import { NumberInput } from './book';
import { Dialog } from './Dialog';
import { InfoTip } from './InfoTip';
import { PerformanceSlots } from './PerformanceEditor';

/** The editor of the actions: actionData and, for the motions, directData of the monster book. */
export function actionEdits(session: Session): ActionEdits {
  const book = session.book;
  return new ActionEdits(session.game.master, book?.directData ?? null, book?.directOriginalRows ?? 0);
}

const MOTION_INFO = [
  'ワザの演出 (モーション・エフェクト・SE) は、演出の表 (2713402F の directData) の行で、枠 (使用者・対象・追加 …) ごとに指します。',
  'たとえば使用者のモーションを「ワザ D」にすると、まおうが変身のときに取るモーション (010_) で攻撃します。',
  'モーションはモンスターごとのモデルにあるものを使います。モデルにないモーションを選ぶと、ゲームでは動かないおそれがあります。',
  '同じ演出を使うほかのアクションは変わりません (演出の行を複製して書き換えます)。演出を変えたアクションは、2713402F の directData.bin も書き出します。',
].join('\n');

const LEVEL_INFO = [
  'w0 bit13-15。状態異常を付ける率の段階です: 率 = BattleParameter [0x60 + 段階] × 耐性の係数 / 32 (段階 0〜6 = 100 / 75 / 50 / 34 / 25 / 12 / 6 %)。',
  '攻撃 (物理・固定の威力) では、ダメージのあとに +0x32 の状態を追加効果として付ける率になります。+0x32 が 0 なら使われません。ダメージで倒したときも付きません。',
  '段階 7 は表の外 (BattleParameter +0x67 = 200) を読むので 625%: 耐性で効かないとき以外は必ず付きます (元のデータにはありません)。',
  '詳しくは naauao の docs/battle.md §6.5。',
].join('\n');

/** "2 (50%)": the base rate of an infliction level (BattleParameter [0x60 + level] / 32). */
function levelLabel(book: MonsterBook | null, level: number): string {
  const v = level < 7 ? book?.battle.baseRate[level] ?? 0 : 200;
  return `${level} (${Math.round((v * 100) / 32)}%${level === 7 ? '、表の外' : ''})`;
}

/** What the level applies to: the state of +0x32 (an attack's extra effect), or nothing. */
function levelNote(book: MonsterBook | null, a: { kind: number; raw: Uint8Array }): string {
  const state = a.raw.length > 0x32 ? a.raw[0x32]! : 0;
  const name = state ? book?.conditions[state] || `状態 ${state}` : '';
  if (a.kind === 1) return state ? `追加効果: ${name}` : '(+0x32 の状態がないので使われない)';
  if (a.kind === 0) return state ? `付ける状態: ${name}` : '';
  return '';
}

const KIND_INFO = [
  'w0 bit1-2 (カテゴリ) と bit3-6 (種別)。戦闘ではこの 2 つで計算を呼び分けます (naauao の docs/battle.md §6.1, §7)。',
  '0 状態: +0x32 の状態を付けるだけ。1 攻撃・とくぎ: ダメージ。2 アイテム: 回復など (種別が効果)。3 特殊: 種別ごとの処理 (なかまをよぶ・変身・ぬすむ …)。',
  '「攻撃」と「とくぎ」を分けるフラグはありません。カテゴリ 1 の中で種別が計算を決めます:',
  '  0 物理: こうげき・ぼうぎょで計算し、威力 (+0x33) を掛ける。モンスターのふつうの攻撃。',
  '  1 物理・会心あり: 0 と同じで、会心の一撃が出る (電波人間のこうげき・つらぬきなど)。',
  '  2 固定の威力: 量 (+0x18〜+0x1A) の乱数。こうげき・ぼうぎょは関係しない (ひのたまなどの呪文)。',
  '  3 ブレス: 2 と同じで、ブレス封じ (状態 0x5A) のあいだ使えない。カテゴリ 0 の種別 3 (ポイズンブレスなど) も同じ。',
  '演出は変わりません。見た目と合うように演出も選び直してください。',
].join('\n');

const TARGET_INFO = [
  'w0 bit7-8 (陣営) と bit9-12 (範囲)。アクションが当たるユニットを決めます (FUN_003188e0)。',
  '陣営は使う側から見た敵・味方ではなく、決まった側です: 0 = モンスターの側、1 = 電波人間の側。モンスターが電波人間を攻撃するワザは 1、モンスターが自分や仲間にかけるワザは 0 です。',
  '範囲: 0 / 1 = 自分、2 = 単体、3〜5 = 目標と、並びでその周り (距離 1〜3) のユニット、6 = 全体、7 = なし、8 = 陣営全体 (おたからチャンスなど場にかかる効果)。',
  '物理の攻撃で威力 (+0x33) が 10 のときは、範囲で威力が変わります (BattleParameter [0x58 + 範囲] = 100 / 100 / 100 / 80 / 70 / 60 / 60 %)。',
  'どれを狙うか (単体の目標) は、モンスターの AI (狙い方) が決めます。',
  '演出の進行 (+0x1C) の単体・全体は別の欄です。範囲を変えたら、演出の進行も合わせてください (モンスターなら単体 4 / 8、全体 5 / 9)。',
].join('\n');

/** Why the side and range may not work as they are, or ''. */
function targetWarning(actions: ActionBook, a: { row: number; side: number; range: number; raw: Uint8Array }): string {
  if (a.side > 1) return `陣営 ${a.side} は元のデータにありません`;
  if (a.range === 7 || a.range > 8) return 'この範囲ではだれにも当たりません';
  if (!actions.refsOf(a.row).monsters.length || a.raw.length < ACTION_DIRECTION + 2) return '';
  const d = u16(a.raw, ACTION_DIRECTION);
  if ((d === 4 || d === 8) && a.range === 6) return '全体の範囲ですが、演出の進行は単体 (4 / 8) のままです (カメラと動きは単体向け)';
  if ((d === 5 || d === 9) && a.range >= 2 && a.range <= 5) return '単体の範囲ですが、演出の進行は全体 (5 / 9) です';
  return '';
}

/** "80%": the power scale of a physical attack by its range (only when +0x33 = 10), or ''. */
function rangePower(book: MonsterBook | null, a: { kind: number; type: number; range: number; raw: Uint8Array }): string {
  if (a.kind !== 1 || a.type > 1 || a.raw.length <= 0x33 || a.raw[0x33] !== 10) return '';
  const v = book?.battle.rangePower[a.range];
  return v === undefined ? '' : `威力 ${v}% (範囲の補正)`;
}

/** Why the kind and type may not work as they are, or ''. */
function kindWarning(actions: ActionBook, a: { row: number; kind: number; type: number; amount: [number, number] }): string {
  if (a.kind !== 2 && actions.refsOf(a.row).items.length) return 'このアクションを使うアイテムがあります。アイテムの効果はカテゴリ 2 のときだけです';
  if (a.kind === 1 && a.type >= 4) return 'カテゴリ 1 の種別 4 以上は元のデータにありません (計算が呼ばれないおそれがあります)';
  if (a.kind === 1 && a.type >= 2 && !a.amount[0] && !a.amount[1]) return '固定の威力で量が 0 なので、ダメージは 0 (ミス) になります';
  return '';
}

const STATE_INFO = [
  '+0x32。このアクションが付ける状態 (conditionData の ID) です。',
  '攻撃 (物理・固定の威力) では、ダメージのあとに追加効果として付けます (率は「付与の段階」)。倒したときは付きません。',
  '状態のアクション (種類 0) では、これを付けるのがアクションの効果そのものです。',
].join('\n');

const STRENGTH_INFO = [
  'w0 bit16-19 / bit20-23 (0〜15)。付ける状態の強さで、最小〜最大の間の乱数になります (FUN_0030b2a8 に渡す値)。',
  '何に効くかは状態ごとに違います (たとえば能力の上げ下げの段階)。元のワザの値を目安にしてください。',
].join('\n');

/** Name of a state (conditionData +0x14), or its ID. */
function stateName(book: MonsterBook | null, id: number): string {
  return id ? book?.conditions[id] || `状態 ${id}` : 'なし';
}

/** States to pick: the named ones (and the current value). */
function stateOptions(book: MonsterBook | null, current: number): [number, string][] {
  const names = book?.conditions ?? [];
  const out: [number, string][] = [];
  for (let id = 1; id < Math.max(names.length, current + 1) && id < 256; id++) {
    if (names[id] || id === current) out.push([id, stateName(book, id)]);
  }
  return out;
}

const NAME_INFO = [
  '戦闘で「〈モンスター〉の　〇〇！」と出る名前のメッセージです。',
  'ほかのアクションと同じメッセージを使っているときは、書き換えると両方の名前が変わります。「このワザだけの名前にする」で、同じ本文の新しいメッセージを作ってこのワザだけに付けられます。',
  '新しいメッセージは、マスター (56562135) に足すメッセージのファイル (MessageMod_JP.gsmb、ID 0x2C00〜) に入ります。複製したワザには最初から自分の名前のメッセージが付きます。',
].join('\n');

/** Keys ("005_") of the motions a monster's model has; null while loading or when it has no model. */
export function useMotionKeys(game: Game, book: MonsterBook, monsters: Monster[]): Map<number, Set<string>> {
  const [out, setOut] = useState(() => new Map<number, Set<string>>());
  const key = monsters.map((m) => m.row).join(',');
  useEffect(() => {
    let live = true;
    Promise.all(monsters.map(async (m): Promise<[number, Set<string>] | null> => {
      const ref = book.modelOf(m);
      if (!ref) return null;
      try {
        const set = await loadComposite(game, MONSTER_MODEL_ARCHIVE, ref.model, ref.texture);
        const model = set.models.get(ref.model);
        return model ? [m.row, new Set(model.animations.map((a) => animationKey(a.name)))] : null;
      } catch {
        return null;
      }
    })).then((list) => live && setOut(new Map(list.filter((x): x is [number, Set<string>] => !!x))));
    return () => {
      live = false;
    };
  }, [game, book, key]);
  return out;
}

export function motionLabel(anim: number): string {
  const m = SKILL_MOTION[anim];
  return m ? `${m[0]} (${m[1]})` : anim ? `モーション 0x${anim.toString(16).toUpperCase()}` : 'なし';
}

/**
 * The editable fields of an action. `onChange` after every edit (the caller rebuilds its ActionBook and saves);
 * `monsters` = whose models to check the motion against (the users of the action, or the monster being edited).
 */
export function ActionEditor({ session, actions, row, monsters, onChange }: {
  session: Session;
  actions: ActionBook;
  row: number;
  monsters: Monster[];
  onChange: () => void;
}): ReactNode {
  const { game } = session;
  const book = session.book;
  const edits = actionEdits(session);
  const a = actions.action(row);
  const motions = useMotionKeys(game, book!, book ? monsters : []);
  const [pickName, setPickName] = useState(false);
  if (!a) return null;
  const texts = game.master.texts;
  const apply = (f: () => void): void => {
    try {
      f();
    } catch (err) {
      alert((err as Error).message);
      return;
    }
    book?.reload();
    onChange();
  };
  const sharedName = a.nameId ? actions.actions.filter((x) => x.row !== row && x.nameId === a.nameId) : [];
  const nameText = a.nameId ? texts.text(a.nameId)?.text ?? '' : '';
  const anim = actions.motion(row);
  const canMotion = edits.canSetMotion(row);
  const missing = anim && SKILL_MOTION[anim] ? monsters.filter((m) => motions.get(m.row) && !motions.get(m.row)!.has(SKILL_MOTION[anim]![1])) : [];
  const orig = edits.added(row) ? null : actions.original(row);
  const mark = (changed: boolean): string => (changed ? 'edited' : '');
  const [lo, hi] = a.amount;
  return (
    <>
    <table className="enc-table ai-fields action-edit">
      <tbody>
        <tr>
          <td className="with-info">名前<InfoTip text={NAME_INFO} /></td>
          <td>
            {a.nameId && texts.editable(a.nameId)
              ? <NameInput key={`${row}:${a.nameId}`} value={nameText} edited={texts.isEdited(a.nameId)} onCommit={(t) => apply(() => texts.setText(a.nameId, t))} />
              : <span className="muted">{a.nameId ? a.name : '(名前なし)'}</span>}
            {a.nameId > 0 && (
              <div className="small">
                {sharedName.length > 0 && <span className="muted">{`同じ名前: ${sharedName.slice(0, 4).map((x) => `#${x.row}`).join('、')}${sharedName.length > 4 ? ` ほか ${sharedName.length - 4}` : ''} `}</span>}
                {sharedName.length > 0 && edits.canOwnName(row) && (
                  <button className="small" title="同じ本文の新しいメッセージを作り、このワザの名前にします" onClick={() => apply(() => edits.ownName(row))}>このワザだけの名前にする</button>
                )}
                <button className="small" title="名前に使うメッセージを選び直します" onClick={() => setPickName(true)}>別のメッセージにする</button>
              </div>
            )}
            {pickName && (
              <NamePicker session={session} actions={actions} current={a.nameId} onClose={() => setPickName(false)}
                onPick={(id) => { setPickName(false); apply(() => edits.setName(row, id)); }} />
            )}
          </td>
        </tr>
        <tr>
          <td className="with-info">カテゴリ<InfoTip text={KIND_INFO} /></td>
          <td><div className="inline-fields">
            <select value={a.kind} className={mark(!!orig && a.kind !== orig.kind)} title={orig && a.kind !== orig.kind ? `元は ${ACTION_KIND[orig.kind]}` : ''}
              onChange={(e) => apply(() => edits.setKind(row, Number(e.target.value), a.type))}>
              {[0, 1, 2, 3].map((k) => <option key={k} value={k}>{`${k}: ${ACTION_KIND[k]}`}</option>)}
            </select>
            種別
            <select value={a.type} className={mark(!!orig && a.type !== orig.type)} title={orig && a.type !== orig.type ? `元は ${actionTypeLabel(orig.kind, orig.type)}` : ''}
              onChange={(e) => apply(() => edits.setKind(row, a.kind, Number(e.target.value)))}>
              {Array.from({ length: 16 }, (_, t) => <option key={t} value={t}>{actionTypeLabel(a.kind, t)}</option>)}
            </select>
          </div>
            {kindWarning(actions, a) && <div className="issue warn">{`⚠ ${kindWarning(actions, a)}`}</div>}
          </td>
        </tr>
        <tr>
          <td className="with-info">対象<InfoTip text={TARGET_INFO} /></td>
          <td>
            <div className="inline-fields">
              <select value={a.side} className={mark(!!orig && a.side !== orig.side)} title={orig && a.side !== orig.side ? `元は ${ACTION_SIDE[orig.side] ?? orig.side}` : ''}
                onChange={(e) => apply(() => edits.setTarget(row, Number(e.target.value), a.range))}>
                {[0, 1, 2, 3].filter((v) => v <= 1 || v === a.side).map((v) => <option key={v} value={v}>{`${v}: ${ACTION_SIDE[v] ?? '?'}`}</option>)}
              </select>
              の
              <select value={a.range} className={mark(!!orig && a.range !== orig.range)} title={orig && a.range !== orig.range ? `元は ${actionRangeLabel(orig.range)}` : ''}
                onChange={(e) => apply(() => edits.setTarget(row, a.side, Number(e.target.value)))}>
                {Array.from({ length: 16 }, (_, v) => v).filter((v) => v <= 8 || v === a.range).map((v) => <option key={v} value={v}>{actionRangeLabel(v)}</option>)}
              </select>
              {rangePower(book, a) && <span className="muted small">{rangePower(book, a)}</span>}
            </div>
            {targetWarning(actions, a) && <div className="issue warn">{`⚠ ${targetWarning(actions, a)}`}</div>}
          </td>
        </tr>
        <tr>
          <td>属性</td>
          <td>
            <select value={a.element} className={mark(!!orig && a.element !== orig.element)} onChange={(e) => apply(() => edits.setElement(row, Number(e.target.value)))}>
              {Array.from({ length: 16 }, (_, i) => i).filter((i) => i < ELEMENT.length || i === a.element).map((i) => <option key={i} value={i}>{ELEMENT[i] || (i ? `${i}` : 'なし')}</option>)}
            </select>
          </td>
        </tr>
        <tr>
          <td className="with-info">付与の段階<InfoTip text={LEVEL_INFO} /></td>
          <td>
            <select value={a.level} className={mark(!!orig && a.level !== orig.level)} onChange={(e) => apply(() => edits.setLevel(row, Number(e.target.value)))}>
              {Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>{levelLabel(book, i)}</option>)}
            </select>
            <span className="muted small">{` ${levelNote(book, a)}`}</span>
          </td>
        </tr>
        {a.raw.length > 0x32 && (
          <tr>
            <td className="with-info">付ける状態<InfoTip text={STATE_INFO} /></td>
            <td>
              <select value={a.state} className={mark(!!orig && a.state !== orig.state)} title={orig && a.state !== orig.state ? `元は ${stateName(book, orig.state)}` : ''}
                onChange={(e) => apply(() => edits.setState(row, Number(e.target.value)))}>
                <option value={0}>なし</option>
                {stateOptions(book, a.state).map(([id, name]) => <option key={id} value={id}>{`${name} (${id})`}</option>)}
              </select>
            </td>
          </tr>
        )}
        <tr>
          <td className="with-info">状態の強さ<InfoTip text={STRENGTH_INFO} /></td>
          <td><div className="inline-fields">
            <NumberInput value={a.strength[0]} min={0} max={15} className={`num-input ${mark(!!orig && a.strength[0] !== orig.strength[0])}`} onCommit={(v) => apply(() => edits.setStrength(row, v, a.strength[1]))} />
            〜
            <NumberInput value={a.strength[1]} min={0} max={15} className={`num-input ${mark(!!orig && a.strength[1] !== orig.strength[1])}`} onCommit={(v) => apply(() => edits.setStrength(row, a.strength[0], v))} />
            {a.strength[0] > a.strength[1] && <span className="issue warn">最小が最大より大きい</span>}
          </div></td>
        </tr>
        {a.raw.length >= 0x18 && !(a.kind === 3 && a.type === 5) && (
          <tr>
            <td className="with-info">状態のターン<InfoTip text="+0x16 (s16)。付けた状態が続くターン数です。" /></td>
            <td>
              <NumberInput value={a.turns} min={-32768} max={32767} className={`num-input ${mark(!!orig && a.turns !== orig.turns)}`} onCommit={(v) => apply(() => edits.setTurns(row, v))} />
            </td>
          </tr>
        )}
        {a.raw.length >= 0x1c && (
          <tr>
            <td className="with-info">量<InfoTip text="+0x18 / +0x1A (最小〜最大)。回復量やブレスのダメージなど。ふつうの攻撃は 0 のままです" /></td>
            <td><div className="inline-fields">
              <NumberInput value={lo} min={-32768} max={32767} className={`num-input ${mark(!!orig && lo !== orig.amount[0])}`} onCommit={(v) => apply(() => edits.setAmount(row, v, hi))} />
              〜
              <NumberInput value={hi} min={-32768} max={32767} className={`num-input ${mark(!!orig && hi !== orig.amount[1])}`} onCommit={(v) => apply(() => edits.setAmount(row, lo, v))} />
            </div></td>
          </tr>
        )}
      </tbody>
    </table>
    <h4 className="with-info">{'演出'}<InfoTip text={MOTION_INFO} /></h4>
    <PerformanceSlots session={session} actions={actions} edits={edits} row={row} onChange={onChange} />
    {!canMotion && actions.slot(row, 0x1e) === 0 && <div className="muted small">使用者の演出がありません。「演出を選ぶ」でほかのワザの演出を入れられます。</div>}
    {missing.length > 0 && <div className="issue warn">{`⚠ ${missing.map((m) => m.name).join('・')} のモデルには使用者のモーション (${SKILL_MOTION[anim]![1]}) がありません。`}</div>}
    </>
  );
}

/** A one-line text box applied on Enter or when left. */
function NameInput({ value, edited, onCommit }: { value: string; edited: boolean; onCommit: (t: string) => void }): ReactNode {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (): void => {
    if (text !== value) onCommit(text);
  };
  return <input type="text" className={`name-input${edited ? ' edited' : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/**
 * Picking the name message of an action among the messages of the same file (MessageBattle for the skills) and the
 * added ones; the list starts with the ones no action uses.
 */
function NamePicker({ session, actions, current, onPick, onClose }: {
  session: Session;
  actions: ActionBook;
  current: number;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const texts = session.game.master.texts;
  const [query, setQuery] = useState('');
  const [free, setFree] = useState(true);
  const file = texts.isAdded(current) ? undefined : texts.file(current);
  const users = new Map<number, number[]>();
  for (const x of actions.actions) if (x.nameId) users.set(x.nameId, [...(users.get(x.nameId) ?? []), x.row]);
  const q = query.trim();
  const ids: number[] = [];
  const range = [...(file ? Array.from({ length: file.gmsg.last - file.gmsg.first + 1 }, (_, i) => file.gmsg.first + i) : []), ...texts.addedIds()];
  for (const id of range) {
    if (free && users.has(id) && id !== current) continue;
    const t = texts.preview(id, true) ?? '';
    if (q && !t.includes(q) && String(id) !== q) continue;
    ids.push(id);
  }
  return (
    <Dialog title="名前のメッセージを選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" className="picker-search" placeholder="本文・番号で絞り込み" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <label><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />アクションが使っていないものだけ</label>
        <InfoTip text={`${file?.name ?? ''} と追加したメッセージです。アクション以外 (戦闘の文章など) が使っているものもあるので、選んだあと本文を書き換えるときは、元の本文が何に使われていそうか確かめてください。`} />
      </div>
      <div className="picker-list">
        <table className="book-table">
          <thead><tr><th>#</th><th>本文</th><th>使うアクション</th></tr></thead>
          <tbody>
            {ids.slice(0, 500).map((id) => (
              <tr key={id} className={id === current ? 'active current' : ''} onClick={() => onPick(id)}>
                <td className="num muted">{id}</td>
                <td>{texts.preview(id, true) || <span className="muted">(空)</span>}</td>
                <td className="muted small">{(users.get(id) ?? []).map((r) => `#${r}`).join('、')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ids.length > 500 && <div className="muted small">{`ほか ${ids.length - 500} 件 (絞り込んでください)`}</div>}
      </div>
    </Dialog>
  );
}
