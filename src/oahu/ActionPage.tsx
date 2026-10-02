// RPG3's actions (#/actions/<row>): the skills of the monsters, the items' actions and the antennas of actionData, with
// their category, element, range, power and the state they give; the messages and the known fields are edited, and
// the monsters and items that use an action are listed.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACTION_RANGE } from '../game/actions';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from '../ui/book';
import { RowFields } from '../ui/RowFields';
import { OAHU_ACTION_TEXTS, type OahuBattle } from './battle';
import { InfoTip } from '../ui/InfoTip';
import { Board, EmptyBoard } from '../ui/Board';
import { FieldCheck } from '../ui/FieldEdit';
import { enumOptions, FieldNumber, FieldSelect, MessageFields, rowAccess, Stat } from './FieldInput';
import { battleContext, oahuActionHref, oahuMonsterHref } from './MonsterPage';
import { oahuActionEntry, OahuActionPicker, oahuGroupHref, oahuMonsterIcon, OahuMonsterPicker } from './pickers';
import type { OahuSession } from './session';
import {
  OAHU_ACTION_CATEGORY, OAHU_ACTION_DATA, OAHU_ACTION_KIND, OAHU_ACTION_SIDE, OAHU_BODY_COLOR_RESET, OAHU_ELEMENT_NAMES, OAHU_MULTIPLIER_CATEGORIES,
  OAHU_RATE_CATEGORIES, OAHU_SKILL_CONDITION, OAHU_STATE_CATEGORIES, OAHU_STATE_CODE, oahuCategoryValues, oahuTriggerLabel,
} from './tables';

const PAGE = 300;

export function OahuActionPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => battle.actionList(), [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => r > 0 && r < battle.actions.rows, () => actions[0]?.row ?? 1);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const onEdit = (): void => {
    edited();
    session.scheduleSave();
  };
  const q = query.trim();
  const rows = actions.filter((a) => {
    if (q && !a.name.includes(q) && String(a.row) !== q) return false;
    if (filter.startsWith('c')) return a.category === Number(filter.slice(1));
    if (filter.startsWith('k')) return a.kind === Number(filter.slice(1));
    if (filter === 'changed') return battle.actionChanged(a.row);
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="名前・行で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべて'], ...Object.entries(OAHU_ACTION_KIND).map(([k, v]): [string, string] => [`k${k}`, `種類: ${v}`]),
            ...Object.entries(OAHU_ACTION_CATEGORY).map(([k, v]): [string, string] => [`c${k}`, `系統: ${v}`]), ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={actions.length} />
          <table className="book-table">
            <thead><tr><th>行</th><th>名前</th><th>系統</th><th>属性</th><th>威力</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((a) => (
                <tr key={a.row} className={a.row === selected ? 'active' : ''} onClick={() => (location.hash = oahuActionHref(a.row))}>
                  <td className="num muted">{a.row}</td>
                  <td className={a.kind === 2 ? 'action-monster' : ''}>{a.name}{battle.actionChanged(a.row) && <EditedMark text=" ●" />}</td>
                  <td className="muted nowrap">{a.kind === 2 ? OAHU_ACTION_KIND[2] : shortCategory(a.category)}</td>
                  <td className="nowrap">{a.element ? OAHU_ELEMENT_NAMES[a.element] ?? a.element : ''}</td>
                  <td className="num nowrap">{a.power[0] || a.power[1] ? `${a.power[0]}〜${a.power[1]}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${rows.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        <ActionDetail key={selected} battle={battle} row={selected} onEdit={onEdit} />
      </div>
    </div>
  );
}

function ActionDetail({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const rows = battle.actions;
  const p = { rows, row, onEdit };
  const users = useMemo(() => battle.actionUsers(row), [battle, row]);
  const category = rows.get(row, 'category');
  const values = oahuCategoryValues(category);
  const access = rowAccess(rows, row);
  const multiplier = OAHU_MULTIPLIER_CATEGORIES.includes(category) || rows.get(row, 'multiplier') !== 10;
  const stateFields = OAHU_STATE_CATEGORIES.includes(category) || category === 2 || rows.get(row, 'state') !== 0;
  const rateFields = OAHU_RATE_CATEGORIES.includes(category);
  const trigger = triggerField(rows.get(row, 'kind'), category, rows.get(row, 'trigger'));
  const shared = useMemo(() => OAHU_ACTION_TEXTS.filter(([k]) => battle.actionsSharing(row, k) > 1).map(([, label]) => label), [battle, row]);
  return (
    <>
      <div className="book-head">
        <h2>{battle.actionName(row) || `アクション ${row}`}</h2>
        <span className="muted">{`actionData の行 ${row}  ${OAHU_ACTION_KIND[rows.get(row, 'kind')] ?? `種類 ${rows.get(row, 'kind')}`} / ${OAHU_ACTION_CATEGORY[rows.get(row, 'category')] ?? `系統 ${rows.get(row, 'category')}`}`}</span>
      </div>
      {rows.get(row, 'kind') === 2 && <MonsterRowNote battle={battle} row={row} />}
      <MessageFields rows={rows} row={row} fields={OAHU_ACTION_TEXTS} texts={battle.texts} message={(id) => battle.message(id)} onEdit={onEdit} />
      {shared.length > 0 && <div className="muted small">{`${shared.join('・')}のメッセージはほかのアクションと共通です。書き換えると、同じメッセージを使うすべてのアクションで変わります。`}</div>}
      <div className="stats stat-edit oahu-stats">
        <Stat label="系統" info={CATEGORY_INFO}><FieldSelect {...p} k="category" options={CATEGORY_OPTIONS} /></Stat>
        <Stat label="消費 AP" info="+0x2B。呪文・アンテナ・つかまえたモンスターのアクションにあります。モンスターのワザでは、条件 (monsterBrain.bin) が AP を見るときに、今の AP より多ければ使いません (FUN_0018F13C)。"><FieldNumber {...p} k="ap" /></Stat>
        <Stat label="属性" info={ELEMENT_INFO}><FieldSelect {...p} k="element" options={enumOptions(OAHU_ELEMENT_NAMES)} /></Stat>
        <Stat label="範囲" info="w0 bit21-24。番号の意味は RPG2 と同じと推定しています。"><FieldSelect {...p} k="range" options={enumOptions(ACTION_RANGE, true)} /></Stat>
        <Stat label="狙う側" info="w0 bit19-20。1 なら自分の側 (回復・能力アップ)。"><FieldSelect {...p} k="side" options={enumOptions(OAHU_ACTION_SIDE)} /></Stat>
        {values.kind === 'range' || values.kind === 'percent'
          ? <>
            <Stat label={values.labels![0]} info={values.info}><FieldNumber {...p} k="min" /></Stat>
            <Stat label={values.labels![1]} info={values.info}><FieldNumber {...p} k="max" /></Stat>
          </>
          : values.kind === 'monster' && <Stat label="+0x18" info={values.info}><FieldNumber {...p} k="min" /></Stat>}
        {multiplier && <Stat label={category === 4 ? '返す割合' : '打撃の倍率'} info={MULTIPLIER_INFO}><FieldNumber {...p} k="multiplier" /><span className="muted small">{`×${(rows.get(row, 'multiplier') / 10).toFixed(1)}`}</span></Stat>}
        {stateFields && <Stat label="状態" info="+0x2E。付ける (治す) 状態の番号で、装備の効果 0x14 の対象と同じ並び。"><FieldSelect {...p} k="state" options={[[0, 'なし'], ...enumOptions(OAHU_STATE_CODE, true)]} /></Stat>}
        {stateFields && <Stat label="状態の強さ" info={STRENGTH_INFO}><FieldNumber {...p} k="strength" /></Stat>}
        {rateFields && <Stat label="成功率の段階" info={RATE_INFO}><FieldNumber {...p} k="rate" /></Stat>}
        {rateFields && category !== 23 && <Stat label="持続ターン" info={TURNS_INFO}><FieldNumber {...p} k="turnsMin" />〜<FieldNumber {...p} k="turnsMax" /></Stat>}
        {trigger && <Stat label={trigger.label} info={trigger.info}>{trigger.select ? <FieldSelect {...p} k="trigger" options={TRIGGER_OPTIONS} /> : <FieldNumber {...p} k="trigger" />}</Stat>}
      </div>
      <div className="row">
        <FieldCheck f={access} k="breath" edited={onEdit} label="ブレス (ブレス封じで使えない)" />
        <FieldCheck f={access} k="noFloat" edited={onEdit} label="浮遊の相手に当たらない" />
      </div>
      <ActionValues battle={battle} row={row} onEdit={onEdit} />
      {(users.monsters.length > 0 || users.items.length > 0) && (
        <div className="row">
          {'使うもの: '}
          {users.monsters.map((m) => {
            const conds = [...new Set(battle.usedSkills(m).filter((s) => s.action === row).map((s) => OAHU_SKILL_CONDITION[s.condition]))];
            return <a key={`m${m}`} href={oahuMonsterHref(m)}>{battle.monsterName(m)}{conds.length > 0 && <span className="muted small">{` (${conds.join('・')})`}</span>}</a>;
          })}
          {users.items.map((i) => <a key={`i${i}`} href={`#/items/${i}`}>{battle.itemName(i)}</a>)}
        </div>
      )}
      <div className="row">
        <span className="muted small">変更はマスター (21350000) の actionData.bin とメッセージとして書き出されます。</span>
        {battle.actionChanged(row) && <button onClick={() => { battle.revertAction(row); onEdit(); }}>このアクションの変更を元に戻す</button>}
      </div>
      <details className="row-fields-box" open>
        <summary>{`actionData の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_ACTION_DATA} row={rows.row(row)} original={rows.originalRow(row)} context={battleContext(battle)} />
      </details>
    </>
  );
}

const SLOT_LABEL: Record<string, string> = { auto: '自動', body: 'ボディ', body2: 'ボディ 2' };

/**
 * +0x18 / +0x1A when the category makes them rows (OAHU_CATEGORY_VALUES): the new form or the called monster picked
 * from the monsters, the group of a call, the range of actions of category 35; values a category does not read are
 * pointed out.
 */
function ActionValues({ battle, row, onEdit }: { battle: OahuBattle; row: number; onEdit: () => void }): ReactNode {
  const [picking, setPicking] = useState<'monster' | 'min' | 'max' | null>(null);
  const rows = battle.actions;
  const category = rows.get(row, 'category');
  const values = oahuCategoryValues(category);
  const set = (k: string, v: number): void => {
    rows.set(row, k, v);
    onEdit();
  };
  const min = rows.get(row, 'min');
  const max = rows.get(row, 'max');
  const kind = rows.get(row, 'kind');
  if (values.kind === 'none') {
    if (!min && !max) return null;
    return <div className="row muted small">{`+0x18 (${min})・+0x1A (${max}) は、この系統 (${OAHU_ACTION_CATEGORY[category] ?? category}) では使われません。`}</div>;
  }
  if (values.kind === 'range' || values.kind === 'percent') return null;
  const monster = max & 0xff;
  const monsterBoard = (label: string, info: string, clearable: boolean): ReactNode => {
    const e = monster > 0 && monster < battle.monsters.rows ? { name: battle.monsterName(monster) || `#${monster}`, href: oahuMonsterHref(monster) } : null;
    return (
      <tr>
        <td className="with-info">{label}<InfoTip text={info} /></td>
        <td>
          <div className="slot-row">
            {e
              ? <Board icon={oahuMonsterIcon(battle, monster)} name={e.name} id={monster} href={e.href} edited={max !== rows.original(row, 'max')} title="モンスターを選び直す" onClick={() => setPicking('monster')} />
              : <EmptyBoard label="＋ モンスター" onClick={() => setPicking('monster')} />}
            {clearable && <button className="small slot-remove" title="なしにする" disabled={!max} onClick={() => set('max', 0)}>×</button>}
          </div>
        </td>
      </tr>
    );
  };
  const actionBoard = (k: 'min' | 'max', label: string): ReactNode => {
    const v = rows.get(row, k);
    const e = v > 0 && v < rows.rows ? oahuActionEntry(battle, v) : null;
    return (
      <tr key={k}>
        <td>{label}</td>
        <td>
          {e
            ? <Board icon={e.icon} name={e.name} id={v} href={e.href} edited={v !== rows.original(row, k)} title="アクションを選び直す" onClick={() => setPicking(k)} />
            : <EmptyBoard label="＋ アクション" onClick={() => setPicking(k)} />}
        </td>
      </tr>
    );
  };
  const bodyUsers = values.kind === 'monster' && kind !== 3 ? battle.stateSlotUsers(row).filter((u) => SLOT_LABEL[u.via]) : [];
  return (
    <section>
      <table className="enc-table ai-fields">
        <tbody>
          {values.kind === 'monster' && monsterBoard(values.labels![1], values.info!, false)}
          {values.kind === 'summon' && monsterBoard('呼ぶモンスター', values.info!, true)}
          {values.kind === 'summon' && (
            <tr>
              <td className="with-info">群れ<InfoTip text="+0x18。呼ぶモンスター (+0x1A) が 0 のとき、この monsterGroup の行から選びます。" /></td>
              <td>
                <FieldNumber rows={rows} row={row} k="min" onEdit={onEdit} min={0} max={battle.groups.rows - 1} />
                {min > 0 && min < battle.groups.rows && <a className="small" href={oahuGroupHref(min)}>{` 群れ #${min} を開く`}</a>}
                {monster > 0 && min > 0 && <span className="muted small"> (モンスターがあるので使われません)</span>}
              </td>
            </tr>
          )}
          {values.kind === 'actions' && [actionBoard('min', values.labels![0]), actionBoard('max', values.labels![1])]}
        </tbody>
      </table>
      {values.kind === 'actions' && min > max && <div className="muted small">最初の行が最後の行より後ろにあります。</div>}
      {bodyUsers.length > 0 && (
        <div className="muted small">
          {`${bodyUsers.map((u) => `${battle.monsterName(u.monster)} (${SLOT_LABEL[u.via]})`).join('・')} の枠に入っていますが、種類が 3 (自動・特殊) ではないので、この枠からは出ません。`}
        </div>
      )}
      {picking === 'monster' && (
        <OahuMonsterPicker battle={battle} current={monster} title={values.kind === 'summon' ? '呼ぶモンスターを選ぶ' : '新しい形態を選ぶ'} onClose={() => setPicking(null)}
          onPick={(m) => { setPicking(null); set('max', m); }} />
      )}
      {(picking === 'min' || picking === 'max') && (
        <OahuActionPicker battle={battle} title="アクションを選ぶ" current={rows.get(row, picking)} onClose={() => setPicking(null)}
          onPick={(a) => { setPicking(null); set(picking, a); }} />
      )}
    </section>
  );
}

/** The category in the list, without the part in brackets. */
function shortCategory(category: number): string {
  return OAHU_ACTION_CATEGORY[category]?.replace(/ \(.+\)$/, '') ?? String(category);
}

/**
 * What +0x2A is for the kind and the category: the trigger of kind 3, else a number with its meaning (the stage of
 * the antennas and spells); left out when nothing reads it.
 */
function triggerField(kind: number, category: number, value: number): { label: string; info: string; select: boolean } | null {
  if (kind === 3) return { label: '発動の条件', info: TRIGGER_INFO, select: true };
  if (category === 15) return { label: 'つかまえる倍率', info: '+0x2A。つかまえる率に掛ける倍率です (@0x1B73FC)。つかまえる 1・2ばい 2・3ばい 3。', select: false };
  if (category === 31) return { label: '体の色', info: `+0x2A。変える色の番号です。${OAHU_BODY_COLOR_RESET} で元の色に戻します (@0x1B6268)。`, select: false };
  if (kind !== 1 && !value) return null;
  return { label: '段階 (+0x2A)', info: '+0x2A。アンテナ・呪文では 1〜3 の段階で、演出の行を選ぶのに使います (@0x219958)。種類 3 のときは「発動の条件」になります。', select: false };
}

const CATEGORY_INFO = [
  '+0x2C。戦闘の結果の種類になり、FUN_001B5A80 (結果を作る) と FUN_001B51E8 (当てる) が系統で分岐します。39 以上は何もしません。',
  '系統を変えると +0x18・+0x1A の意味が変わります (変身ではモンスターの行、仲間を呼ぶでは呼ぶモンスター、など)。',
].join('\n');
const CATEGORY_OPTIONS = enumOptions(OAHU_ACTION_CATEGORY, true);
const MULTIPLIER_INFO = '+0x2D。1/10 単位で、10 ならそのまま。打撃のダメージに掛けます (@0x1B6930)。系統 4 (反撃) では受けたダメージを返す割合です (@0x1B770C)。';
const STRENGTH_INFO = '+0x1C。どく 1 / もうどく 2、能力の増減は ±1〜3、おたから・ゴールドは倍率 % (200 など)、ステルスは段階。相手の今の強さ以下なら効きません (FUN_001B786C)。';
const RATE_INFO = 'w1 bit9-11 (0〜7)。状態を付けるとき・にげるときの成功率の段階で、戦闘の設定の表から率を引き、たいせいの補正を掛けます (FUN_001B786C)。';
const TURNS_INFO = 'w1 bit12-15 / bit16-19 (0〜15)。最小〜最大の乱数で続きます。両方 0 ならずっと続きます。突然死 (状態 22) で最大が 0 なら即死です。';

const TRIGGER_INFO = [
  '+0x2A。種類 3 (自動・特殊) のアクションを、モンスターのボディ (効果 0x2F) や自動 (効果 0x2D) の枠からいつ出すか (FUN_001B7D18)。',
  'ワザの枠から AI が選ぶときは使われません。1〜100 は確率 (%) です。116〜119 は味方の数による条件と推定しています。',
].join('\n');
const TRIGGER_OPTIONS = Array.from({ length: 120 }, (_, v): [number, string] => [v, `${v}: ${oahuTriggerLabel(v)}`]);

const ELEMENT_INFO = 'w0 bit27-31。10〜25 は 2 つの属性 (火・氷 など) で、ダメージを半分ずつそれぞれの属性のたいせいで計算して足します (FUN_001B82B0)。';

/**
 * The action of a caught monster (kind 2): named after the monster (monsterParameter +0x3C points here) and followed
 * by its skills. A 電波人間 holding a monster caught with the antenna つかまえる (+0x6A) uses it (FUN_004CB7C0).
 */
function MonsterRowNote({ battle, row }: { battle: OahuBattle; row: number }): ReactNode {
  const monsters = useMemo(() => {
    const out: number[] = [];
    for (let m = 1; m < battle.monsters.rows; m++) if (battle.monsters.get(m, 'name') && battle.monsters.get(m, 'own') === row) out.push(m);
    return out;
  }, [battle, row]);
  const skills = useMemo(() => [...new Set(monsters.flatMap((m) => battle.usedSkills(m).map((s) => s.action)))].sort((a, b) => a - b), [battle, monsters]);
  return (
    <div className="muted small book-desc">
      {'アンテナ「つかまえる」でつかまえたモンスターを、戦闘で使ったときのアクションです。'}
      {monsters.length > 0 && <>{'この行を持つモンスター: '}{monsters.map((m, i) => <Fragment key={m}>{i > 0 && '・'}<a href={oahuMonsterHref(m)}>{`${battle.monsterName(m)} (#${m})`}</a></Fragment>)}{'。'}</>}
      {skills.length > 0 && <>{'ワザ: '}{skills.map((a, i) => <Fragment key={a}>{i > 0 && '・'}<a href={oahuActionHref(a)}>{`#${a}`}</a></Fragment>)}{'。'}</>}
      {'つかまえたモンスターは電波人間の +0x6A に入り、使うとこの行が実行されます (FUN_004CB7C0)。威力・属性・演出もこの行のものが使われます。'}
    </div>
  );
}
