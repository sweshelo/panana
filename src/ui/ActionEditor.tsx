// Editing an action (actionData row): its name, element, infliction level, amount and motion, copying it as a new
// action, and putting it back. Used by the action page and, in a dialog, by the skill slots of the monster editor.
import { useEffect, useState, type ReactNode } from 'react';
import { ActionEdits, ELEMENT, type ActionBook } from '../game/actions';
import { animationKey } from '../cgfx/player';
import { loadComposite } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, SKILL_MOTION, type Monster, type MonsterBook } from '../game/monsters';
import type { Game } from '../game/game';
import type { Session } from '../session';
import { NumberInput } from './book';
import { Dialog } from './Dialog';
import { InfoTip } from './InfoTip';

/** The editor of the actions: actionData and, for the motions, directData of the monster book. */
export function actionEdits(session: Session): ActionEdits {
  const book = session.book;
  return new ActionEdits(session.game.master, book?.directData ?? null, book?.directOriginalRows ?? 0);
}

/** Motions the edit offers: the skill motions A〜D first, then the others the game uses for actions. */
const MOTION_ORDER = [0x45, 0x46, 0x47, 0x48, 0x43, 0x44, 0x49, 0x4a];

const MOTION_INFO = [
  'ワザを使うモンスターが取るモーションです (演出の表 directData の +0x0A)。',
  'たとえば「ワザ D」にすると、まおうが変身のときに取るモーション (010_) で攻撃します。',
  'モーションはモンスターごとのモデルにあるものを使います。モデルにないモーションを選ぶと、ゲームでは動かないおそれがあります。',
  '同じ演出を使うほかのアクションは変わりません (演出の行を複製して書き換えます)。',
].join('\n');

const NAME_INFO = [
  '戦闘で「〈モンスター〉の　〇〇！」と出る名前のメッセージです。',
  'ほかのアクションと同じメッセージを使っているときは、書き換えると両方の名前が変わります。',
  '新しいメッセージ番号は作れないので、複製したワザに別の名前を付けるときは「別のメッセージにする」で、どのアクションも使っていないメッセージを選んでから書き換えてください。',
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
          <td className="with-info">モーション<InfoTip text={MOTION_INFO} /></td>
          <td>
            {canMotion
              ? (
                  <select value={anim} className={mark(!!orig && anim !== orig.motion)} title={orig && anim !== orig.motion ? `元は ${motionLabel(orig.motion)}` : ''}
                    onChange={(e) => apply(() => edits.setMotion(row, Number(e.target.value)))}>
                    {[...new Set([...MOTION_ORDER, anim])].map((n) => <option key={n} value={n}>{motionLabel(n)}</option>)}
                  </select>
                )
              : <span className="muted">{`${motionLabel(anim)} (演出の行がないので変えられません)`}</span>}
            {missing.length > 0 && <div className="issue warn">{`⚠ ${missing.map((m) => m.name).join('・')} のモデルにはこのモーション (${SKILL_MOTION[anim]![1]}) がありません。`}</div>}
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
          <td className="with-info">付与の段階<InfoTip text="ワザが状態異常をかける基本の率の段階 (w0 bit13-15、BattleParameter [0x60 + 段階])" /></td>
          <td>
            <select value={a.level} className={mark(!!orig && a.level !== orig.level)} onChange={(e) => apply(() => edits.setLevel(row, Number(e.target.value)))}>
              {Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </td>
        </tr>
        {a.raw.length >= 0x1c && (
          <tr>
            <td className="with-info">量<InfoTip text="+0x18 / +0x1A (最小〜最大)。回復量やブレスのダメージなど。ふつうの攻撃は 0 のままです" /></td>
            <td className="inline-fields">
              <NumberInput value={lo} min={-32768} max={32767} className={`num-input ${mark(!!orig && lo !== orig.amount[0])}`} onCommit={(v) => apply(() => edits.setAmount(row, v, hi))} />
              〜
              <NumberInput value={hi} min={-32768} max={32767} className={`num-input ${mark(!!orig && hi !== orig.amount[1])}`} onCommit={(v) => apply(() => edits.setAmount(row, lo, v))} />
            </td>
          </tr>
        )}
      </tbody>
    </table>
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
 * Picking the name message of an action among the messages of the same file (MessageBattle for the skills). New IDs
 * can't be made (the next file's range follows right after), so the list starts with the ones no action uses.
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
  const file = texts.file(current);
  const users = new Map<number, number[]>();
  for (const x of actions.actions) if (x.nameId) users.set(x.nameId, [...(users.get(x.nameId) ?? []), x.row]);
  const q = query.trim();
  const ids: number[] = [];
  if (file) for (let id = file.gmsg.first; id <= file.gmsg.last; id++) {
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
        <InfoTip text={`${file?.name ?? ''} のメッセージです。アクション以外 (戦闘の文章など) が使っているものもあるので、選んだあと本文を書き換えるときは、元の本文が何に使われていそうか確かめてください。`} />
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
