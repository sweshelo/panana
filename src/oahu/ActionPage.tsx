// RPG3's actions (#/actions/<row>): the skills of the monsters, the items' actions and the antennas of actionData, with
// their category, element, range, power and the state they give; the messages and the known fields are edited, and
// the monsters and items that use an action are listed.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACTION_RANGE } from '../game/actions';
import { useEdits, useScrollTop, useSticky } from '../ui/book';
import { RowFields } from '../ui/RowFields';
import { OAHU_ACTION_TEXTS, type OahuBattle } from './battle';
import { InfoTip } from '../ui/InfoTip';
import { Board, EmptyBoard } from '../ui/Board';
import { ActionButtons, ActionHead, ActionListPane, ActionTexts, ActionUsers } from '../ui/ActionParts';
import { FieldCheck } from '../ui/FieldEdit';
import { enumOptions, FieldNumber, FieldSelect, rowAccess, Stat } from './FieldInput';
import { OahuActionPreview } from './ActionPreview';
import { battleContext, oahuActionHref, oahuMonsterHref } from './MonsterPage';
import { oahuActionEntry, OahuActionPicker, oahuGroupHref, oahuMonsterIcon, OahuMonsterPicker } from './pickers';
import type { OahuSession } from './session';
import {
  OAHU_ACTION_CATEGORY, OAHU_ACTION_DATA, OAHU_ACTION_KIND, OAHU_ACTION_SIDE, OAHU_BODY_COLOR_RESET, OAHU_ELEMENT_NAMES, OAHU_MULTIPLIER_CATEGORIES,
  OAHU_RATE_CATEGORIES, OAHU_SKILL_CONDITION, OAHU_STATE_CATEGORIES, OAHU_STATE_CODE, oahuCategoryValues, oahuTriggerLabel,
} from './tables';

export function OahuActionPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { battle } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const detail = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => battle.actionList(), [battle, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => r > 0 && r < battle.actions.rows, () => actions[0]?.row ?? 1);
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
      <ActionListPane
        rows={rows.map((a) => ({
          row: a.row,
          name: a.name,
          edited: battle.actionChanged(a.row),
          nameClass: a.kind === 2 ? 'action-monster' : '',
          cells: [
            a.kind === 2 ? OAHU_ACTION_KIND[2] : shortCategory(a.category),
            a.element ? OAHU_ELEMENT_NAMES[a.element] ?? a.element : '',
            a.power[0] || a.power[1] ? `${a.power[0]}〜${a.power[1]}` : '',
          ],
        }))}
        total={actions.length} columns={[['系統'], ['属性'], ['威力']]} selected={selected} href={oahuActionHref}
        query={query} setQuery={setQuery} placeholder="名前・行で検索" filter={filter} setFilter={setFilter}
        filters={[['all', 'すべて'], ...Object.entries(OAHU_ACTION_KIND).map(([k, v]): [string, string] => [`k${k}`, `種類: ${v}`]),
          ...Object.entries(OAHU_ACTION_CATEGORY).map(([k, v]): [string, string] => [`c${k}`, `系統: ${v}`]), ['changed', '変更したもの']]} />
      <div className="book-detail" ref={detail}>
        <ActionDetail key={selected} session={session} row={selected} onEdit={onEdit} />
      </div>
    </div>
  );
}

const COPY_INFO = [
  'このアクションを actionData の最後に新しい行として写します。ゲームは表の頭にある行数まで読むので、行を足せます (FUN_0029D5D8)。',
  '名前と結果のメッセージは同じ本文の新しいメッセージ (MessageSystemCommon の 8658 番から) になり、元と別に書き換えられます。',
  '写したアクションは、モンスターのワザやアイテムの「使うアクション」で選ぶと使われます。',
].join('\n');

function ActionDetail({ session, row, onEdit }: { session: OahuSession; row: number; onEdit: () => void }): ReactNode {
  const { battle } = session;
  const rows = battle.actions;
  const p = { rows, row, onEdit };
  const users = useMemo(() => battle.actionUsers(row), [battle, row]);
  const category = rows.get(row, 'category');
  const values = oahuCategoryValues(category);
  const access = rowAccess(rows, row, rows.added(row));
  const multiplier = OAHU_MULTIPLIER_CATEGORIES.includes(category) || rows.get(row, 'multiplier') !== 10;
  const stateFields = OAHU_STATE_CATEGORIES.includes(category) || category === 2 || rows.get(row, 'state') !== 0;
  const rateFields = OAHU_RATE_CATEGORIES.includes(category);
  const trigger = triggerField(rows.get(row, 'kind'), category, rows.get(row, 'trigger'));
  const texts = OAHU_ACTION_TEXTS.map(([key, label]) => ({
    key, label, id: rows.get(row, key), place: `actionData +0x${rows.field(key).offset.toString(16).toUpperCase()}`,
    shared: battle.actionsWithText(row, key),
    own: battle.canOwnActionText(row, key) ? () => { battle.ownActionText(row, key); } : undefined,
  }));
  const kind = rows.get(row, 'kind');
  return (
    <>
      <ActionHead title={battle.actionName(row) || `アクション ${row}`}
        sub={`actionData の行 ${row}  ${OAHU_ACTION_KIND[kind] ?? `種類 ${kind}`} / ${OAHU_ACTION_CATEGORY[category] ?? `系統 ${category}`}`} />
      {kind === 2 && <MonsterRowNote battle={battle} row={row} />}
      <ActionTexts texts={battle.texts} fields={texts} message={(id) => battle.message(id)} onEdit={onEdit} href={oahuActionHref} />
      <div className="stats stat-edit action-stats">
        <Stat label="種類" info="w0 bit0-2。3 (自動・特殊) はボディ・自動の枠から「発動の条件」で出ます。2 はつかまえたモンスターの行、4 は道具。"><FieldSelect {...p} k="kind" options={enumOptions(OAHU_ACTION_KIND, true)} /></Stat>
        <Stat label="系統" info={CATEGORY_INFO} wide><FieldSelect {...p} k="category" options={CATEGORY_OPTIONS} /></Stat>
        <Stat label="狙う側" info="w0 bit19-20。1 なら自分の側 (回復・能力アップ)。"><FieldSelect {...p} k="side" options={enumOptions(OAHU_ACTION_SIDE)} /></Stat>
        <Stat label="範囲" info="w0 bit21-24。番号の意味は RPG2 と同じと推定しています。"><FieldSelect {...p} k="range" options={enumOptions(ACTION_RANGE, true)} /></Stat>
        <Stat label="属性" info={ELEMENT_INFO}><FieldSelect {...p} k="element" options={enumOptions(OAHU_ELEMENT_NAMES)} /></Stat>
        <Stat label="消費 AP" info="+0x2B。呪文・アンテナ・つかまえたモンスターのアクションにあります。モンスターのワザでは、条件 (monsterBrain.bin) が AP を見るときに、今の AP より多ければ使いません (FUN_0018F13C)。"><FieldNumber {...p} k="ap" /></Stat>
        {values.kind === 'range' && <Stat label={values.labels![0] === '最小' ? '量' : values.labels!.join('〜')} info={values.info}><FieldNumber {...p} k="min" />〜<FieldNumber {...p} k="max" /></Stat>}
        {values.kind === 'percent' && <>
          <Stat label={values.labels![0]} info={values.info}><FieldNumber {...p} k="min" /></Stat>
          <Stat label={values.labels![1]} info={values.info}><FieldNumber {...p} k="max" /></Stat>
        </>}
        {values.kind === 'monster' && <Stat label="+0x18" info={values.info}><FieldNumber {...p} k="min" /></Stat>}
        {multiplier && <Stat label={category === 4 ? '返す割合' : '打撃の倍率'} info={MULTIPLIER_INFO}><FieldNumber {...p} k="multiplier" /><span className="muted small">{`×${(rows.get(row, 'multiplier') / 10).toFixed(1)}`}</span></Stat>}
        {stateFields && <Stat label="付ける状態" info="+0x2E。付ける (治す) 状態の番号で、装備の効果 0x14 の対象と同じ並び。"><FieldSelect {...p} k="state" options={[[0, 'なし'], ...enumOptions(OAHU_STATE_CODE, true)]} /></Stat>}
        {stateFields && <Stat label="状態の強さ" info={STRENGTH_INFO}><FieldNumber {...p} k="strength" /></Stat>}
        {rateFields && <Stat label="成功率の段階" info={RATE_INFO}><FieldNumber {...p} k="rate" /></Stat>}
        {rateFields && category !== 23 && <Stat label="状態のターン" info={TURNS_INFO}><FieldNumber {...p} k="turnsMin" />〜<FieldNumber {...p} k="turnsMax" /></Stat>}
        {trigger && <Stat label={trigger.label} info={trigger.info} wide={trigger.select}>{trigger.select ? <FieldSelect {...p} k="trigger" options={TRIGGER_OPTIONS} /> : <FieldNumber {...p} k="trigger" />}</Stat>}
      </div>
      {values.kind === 'range' && rows.get(row, 'min') > rows.get(row, 'max') && <div className="issue warn">⚠ 最小が最大より大きい</div>}
      <div className="row">
        <FieldCheck f={access} k="breath" edited={onEdit} label="ブレス (ブレス封じで使えない)" />
        <FieldCheck f={access} k="noFloat" edited={onEdit} label="浮遊の相手に当たらない" />
      </div>
      <ActionValues battle={battle} row={row} onEdit={onEdit} />
      <ActionButtons note="変更はマスター (21350000) の actionData.bin とメッセージとして書き出されます。" copyInfo={COPY_INFO}
        canCopy={battle.canCopyAction(row)} cannotCopy="メッセージの空きがありません"
        onCopy={() => { const n = battle.copyAction(row); onEdit(); location.hash = oahuActionHref(n); }}
        onRemove={battle.canRemoveAction(row) ? () => { battle.removeAction(row); onEdit(); location.hash = oahuActionHref(row - 1); } : undefined}
        onRevert={battle.actionChanged(row) && !rows.added(row) ? () => { battle.revertAction(row); onEdit(); } : undefined} />
      <OahuActionPreview session={session} row={row} users={users.monsters} />
      <ActionUsers
        monsters={users.monsters.map((m) => ({
          key: `m${m}`, name: battle.monsterName(m), href: oahuMonsterHref(m),
          note: [...new Set(battle.usedSkills(m).filter((s) => s.action === row).map((s) => OAHU_SKILL_CONDITION[s.condition]))].join('・'),
        }))}
        items={users.items.map((i) => ({ key: `i${i}`, name: battle.itemName(i), href: `#/items/${i}` }))} />
      <details className="row-fields-box">
        <summary>{`actionData の行 ${row} のすべての欄`}</summary>
        <RowFields def={OAHU_ACTION_DATA} row={rows.row(row)} original={rows.added(row) ? undefined : rows.originalRow(row)} context={battleContext(battle)} />
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
  const looks = category === 21 || category === 22 ? battle.actionUsers(row).monsters.filter((m) => category === 21 || battle.monsters.get(m, 'formModel') !== monster) : [];
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
      {looks.length > 0 && (
        <div className="muted small">
          {category === 21
            ? `系統 21 では見た目は変わりません (${looks.map((m) => battle.monsterName(m)).join('・')} の見た目のまま)。見た目も変えるには系統 22 にして、使うモンスターの「変身の見た目」(+0x62) を新しい形態にします。`
            : `${looks.map((m) => `${battle.monsterName(m)} (変身の見た目: ${battle.monsters.get(m, 'formModel') ? battle.monsterName(battle.monsters.get(m, 'formModel')) : 'なし'})`).join('・')} は、変身の見た目 (+0x62) が新しい形態と違うので、見た目が新しい形態になりません。モンスターのページの「変身」で直せます。`}
        </div>
      )}
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
