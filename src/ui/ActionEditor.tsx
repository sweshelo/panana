// Editing an action (actionData row): its name, element, infliction level, amount and motion, copying it as a new
// action, and putting it back. Used by the action page and, in a dialog, by the skill slots of the monster editor.
import { useEffect, useState, type ReactNode } from 'react';
import { ACTION_KIND, ACTION_SIDE, ActionEdits, actionRangeLabel, actionTypeLabel, ELEMENT, type ActionBook, type ActionFields } from '../game/actions';
import { KAHARA_ACTION_DATA } from '../game/kaharatables';
import { fieldRange } from '../game/tabledef';
import { ACTION_DIRECTION } from '../game/performance';
import { u16 } from '../util/bytes';
import { animationKey } from '../cgfx/player';
import { loadComposite } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, SKILL_MOTION, type Monster, type MonsterBook } from '../game/monsters';
import type { Game } from '../game/game';
import type { Session } from '../session';
import { ActionTexts } from './ActionParts';
import { BattleMessagePicker } from './BattleMessagePicker';
import { FieldChoice, FieldNumber, Stat, type FieldAccess } from './FieldEdit';
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
  'w0 bit13-15。「付ける状態」を付ける率の段階です。実際の率は、さらに対象の耐性で変わります。',
  '攻撃では、ダメージのあとの追加効果の率になります (倒したときは付きません)。付ける状態がなしのときは使われません。',
  '段階 7 は表の外を読むので、耐性で効かないとき以外は必ず付きます。',
].join('\n');

/** "2 (50%)": the base rate of an infliction level (BattleParameter [0x60 + level] / 32). */
function levelLabel(book: MonsterBook | null, level: number): string {
  const v = level < 7 ? book?.battle.baseRate[level] ?? 0 : 200;
  return `${level} (${Math.round((v * 100) / 32)}%${level === 7 ? '、表の外' : ''})`;
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

const KIND_OPTIONS = [0, 1, 2, 3].map((k): [number, string] => [k, `${k}: ${ACTION_KIND[k]}`]);
const ELEMENT_OPTIONS = ELEMENT.map((e, i): [number, string] => [i, e || 'なし']);

/**
 * The fields of an action for the shared inputs (ui/FieldEdit, keyed as KAHARA_ACTION_DATA): read from the decoded
 * row, written through ActionEdits (which keeps the bits around them).
 */
function actionAccess(actions: ActionBook, edits: ActionEdits, row: number): FieldAccess {
  const a = actions.action(row)!;
  const o = actions.original(row);
  const get = (f: ActionFields, k: string): number => {
    switch (k) {
      case 'strengthMin': return f.strength[0];
      case 'strengthMax': return f.strength[1];
      case 'min': return f.amount[0];
      case 'max': return f.amount[1];
      default: return (f as unknown as Record<string, number>)[k] ?? 0;
    }
  };
  const set = (k: string, v: number): void => {
    switch (k) {
      case 'kind': return edits.setKind(row, v, a.type);
      case 'type': return edits.setKind(row, a.kind, v);
      case 'side': return edits.setTarget(row, v, a.range);
      case 'range': return edits.setTarget(row, a.side, v);
      case 'element': return edits.setElement(row, v);
      case 'level': return edits.setLevel(row, v);
      case 'state': return edits.setState(row, v);
      case 'strengthMin': return edits.setStrength(row, v, a.strength[1]);
      case 'strengthMax': return edits.setStrength(row, a.strength[0], v);
      case 'turns': return edits.setTurns(row, v);
      case 'min': return edits.setAmount(row, v, a.amount[1]);
      case 'max': return edits.setAmount(row, a.amount[0], v);
    }
  };
  return {
    get: (k) => get(a, k),
    original: (k) => (o ? get(o, k) : get(a, k)),
    set: (k, v) => {
      try {
        set(k, v);
      } catch (err) {
        alert((err as Error).message);
      }
    },
    range: (k) => fieldRange(KAHARA_ACTION_DATA.fields.find((f) => f.key === k)!),
    added: !o,
  };
}

/**
 * The editable fields of an action. `onChange` after every edit (the caller rebuilds its ActionBook and saves);
 * `monsters` = whose models to check the motion against (the users of the action, or the monster being edited).
 * The same layout as RPG3's (oahu/ActionPage): the message boxes, then a grid of the fields.
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
  const edited = (): void => {
    book?.reload();
    onChange();
  };
  const apply = (f: () => void): void => {
    try {
      f();
    } catch (err) {
      alert((err as Error).message);
      return;
    }
    edited();
  };
  const f = actionAccess(actions, edits, row);
  const p = { f, edited };
  const anim = actions.motion(row);
  const canMotion = edits.canSetMotion(row);
  const missing = anim && SKILL_MOTION[anim] ? monsters.filter((m) => motions.get(m.row) && !motions.get(m.row)!.has(SKILL_MOTION[anim]![1])) : [];
  const warnings = [kindWarning(actions, a), targetWarning(actions, a), a.strength[0] > a.strength[1] ? '状態の強さの最小が最大より大きい' : '', a.amount[0] > a.amount[1] ? '量の最小が最大より大きい' : ''].filter(Boolean);
  return (
    <>
      <ActionTexts texts={texts} message={(id) => texts.text(id)?.text ?? ''} onEdit={edited} href={(r) => `#/actions/${r}`} fields={[{
        key: 'name', label: '名前', id: a.nameId, place: 'actionData +0x04',
        shared: a.nameId ? actions.actions.filter((x) => x.row !== row && x.nameId === a.nameId).map((x) => x.row) : [],
        own: edits.canOwnName(row) ? () => { edits.ownName(row); } : undefined,
        extra: <>
          <button className="small" title="名前に使うメッセージを選び直します" onClick={() => setPickName(true)}>別のメッセージにする</button>
          <InfoTip text={NAME_INFO} />
        </>,
      }]} />
      {pickName && (
        <NamePicker session={session} actions={actions} current={a.nameId} onClose={() => setPickName(false)}
          onPick={(id) => { setPickName(false); apply(() => edits.setName(row, id)); }} />
      )}
      <div className="stats stat-edit action-stats">
        <Stat label="カテゴリ" info={KIND_INFO}><FieldChoice {...p} k="kind" options={KIND_OPTIONS} /></Stat>
        <Stat label="種別" info={KIND_INFO} wide><FieldChoice {...p} k="type" labels={(t) => actionTypeLabel(a.kind, t)} /></Stat>
        <Stat label="陣営" info={TARGET_INFO}><FieldChoice {...p} k="side" options={[0, 1, 2, 3].filter((v) => v <= 1 || v === a.side).map((v) => [v, `${v}: ${ACTION_SIDE[v] ?? '?'}`])} /></Stat>
        <Stat label="範囲" info={TARGET_INFO}>
          <FieldChoice {...p} k="range" options={Array.from({ length: 16 }, (_, v) => v).filter((v) => v <= 8 || v === a.range).map((v) => [v, actionRangeLabel(v)])} />
          {rangePower(book, a) && <span className="muted small">{rangePower(book, a)}</span>}
        </Stat>
        <Stat label="属性"><FieldChoice {...p} k="element" options={ELEMENT_OPTIONS} /></Stat>
        <Stat label="量" info="+0x18 / +0x1A (最小〜最大)。回復量やブレスのダメージなど。ふつうの攻撃は 0 のままです"><FieldNumber {...p} k="min" />〜<FieldNumber {...p} k="max" /></Stat>
        {a.raw.length > 0x32 && (
          <Stat label="付ける状態" info={STATE_INFO}>
            <FieldChoice {...p} k="state" options={[[0, 'なし'], ...stateOptions(book, a.state).map(([id, name]): [number, string] => [id, `${name} (${id})`])]} />
          </Stat>
        )}
        <Stat label="付与の段階" info={LEVEL_INFO}>
          <FieldChoice {...p} k="level" disabled={!a.state} title="付ける状態がないので使われません" labels={(l) => levelLabel(book, l)} />
        </Stat>
        <Stat label="状態の強さ" info={STRENGTH_INFO}><FieldNumber {...p} k="strengthMin" />〜<FieldNumber {...p} k="strengthMax" /></Stat>
        {!(a.kind === 3 && a.type === 5) && <Stat label="状態のターン" info="+0x16 (s16)。付けた状態が続くターン数です。"><FieldNumber {...p} k="turns" /></Stat>}
      </div>
      {warnings.map((w) => <div key={w} className="issue warn">{`⚠ ${w}`}</div>)}
      <h3 className="with-info">{'演出'}<InfoTip text={MOTION_INFO} /></h3>
      <PerformanceSlots session={session} actions={actions} edits={edits} row={row} onChange={onChange} />
      {!canMotion && actions.slot(row, 0x1e) === 0 && <div className="muted small">使用者の演出がありません。「演出を選ぶ」でほかのワザの演出を入れられます。</div>}
      {missing.length > 0 && <div className="issue warn">{`⚠ ${missing.map((m) => m.name).join('・')} のモデルには使用者のモーション (${SKILL_MOTION[anim]![1]}) がありません。`}</div>}
    </>
  );
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
  const users = new Map<number, string[]>();
  for (const x of actions.actions) if (x.nameId) users.set(x.nameId, [...(users.get(x.nameId) ?? []), `#${x.row}`]);
  return (
    <BattleMessagePicker session={session} title="名前のメッセージを選ぶ" current={current} users={users} freeLabel="アクションが使っていないものだけ"
      info="アクション以外 (戦闘の文章など) が使っているものもあるので、選んだあと本文を書き換えるときは、元の本文が何に使われていそうか確かめてください。"
      onPick={onPick} onClose={onClose} />
  );
}
