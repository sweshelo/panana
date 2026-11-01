// 初代's actions (#/actions/s<skillData の行> / w<monsterAttackSkill の行>): the antennas' skills and the monsters' skills
// in one list, on the action page's parts shared with RPG2 and RPG3 (ui/ActionParts). The messages, the amounts and the
// state are edited through the field definitions (tables.ts); the fields whose meaning is a guess are shown only
// (naauao honolulu/monsters.md §3・§4, the rest is naauao#56). The monsters with a skill in a slot are listed.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { fieldRange, fieldText } from '../game/tabledef';
import type { TableRows } from '../game/tablerows';
import { ActionButtons, ActionHead, ActionListPane, ActionTexts, ActionUsers } from '../ui/ActionParts';
import { useScrollTop, useSticky } from '../ui/book';
import { FieldNumber, Stat, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { RowFields } from '../ui/RowFields';
import {
  ACTION_FILE, ACTION_KIND_LABEL, ACTION_TEXTS, actionChanged, actionName, actionRows, attackUsers, honoluluActionHref, honoluluActions,
  parseActionKey, revertAction, rowsWithText, type HonoluluAction, type HonoluluActionKind,
} from './actions';
import { useHonoluluRevision } from './ItemPage';
import { honoluluMonsterHref, monsterName } from './monsters';
import type { HonoluluSession } from './session';

export { honoluluActionHref };

/** The list's ids: skillData's rows as they are, monsterAttackSkill's after this. */
const ATTACK_BASE = 0x10000;
const listId = (a: { kind: HonoluluActionKind; row: number }): number => (a.kind === 's' ? a.row : ATTACK_BASE + a.row);
const fromId = (id: number): [HonoluluActionKind, number] => (id >= ATTACK_BASE ? ['w', id - ATTACK_BASE] : ['s', id]);
const listHref = (id: number): string => honoluluActionHref(...fromId(id));

type Filter = 'all' | 's' | 'w' | 'used' | 'unused' | 'changed';
const FILTERS: [Filter, string][] = [
  ['all', 'すべて'], ['s', 'アンテナの特技 (skillData)'], ['w', 'モンスターのワザ (monsterAttackSkill)'], ['used', 'モンスターが持つワザ'], ['unused', 'どのモンスターも持たないワザ'], ['changed', '変更したもの'],
];

const amount = (a: HonoluluAction): string => (a.min || a.max ? `${a.min}${a.max !== a.min ? `〜${a.max}` : ''}` : '');

export function HonoluluActionPage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const revision = useHonoluluRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const detail = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => honoluluActions(session), [session, revision]);
  const ids = useMemo(() => new Set(actions.map(listId)), [actions]);
  const key = parseActionKey(arg);
  const selected = useSticky(key && listId({ kind: key[0], row: key[1] }), (id) => ids.has(id), () => listId(actions.find((a) => a.kind === 'w') ?? { kind: 's', row: 1 }));
  useScrollTop(detail, selected);
  const q = query.trim();
  const rows = actions.filter((a) => {
    if (q && !a.name.includes(q) && String(a.row) !== q && !a.users.some((m) => monsterName(session, m).includes(q))) return false;
    if (filter === 's' || filter === 'w') return a.kind === filter;
    if (filter === 'used') return a.users.length > 0;
    if (filter === 'unused') return a.kind === 'w' && !a.users.length;
    if (filter === 'changed') return actionChanged(session, a.kind, a.row);
    return true;
  });
  const [kind, row] = fromId(selected);
  return (
    <div className="book">
      <ActionListPane
        rows={rows.map((a) => ({
          row: listId(a), rowLabel: a.row,
          name: a.name || <span className="muted">(名前なし)</span>,
          edited: actionChanged(session, a.kind, a.row),
          cells: [a.kind === 's' ? '特技' : 'ワザ', amount(a), a.users.length ? String(a.users.length) : ''],
        }))}
        total={actions.length} columns={[['種類', '特技 = アンテナの特技 (skillData)、ワザ = モンスターのワザ (monsterAttackSkill)'], ['量'], ['持つ', 'ワザとして持つモンスターの数']]}
        selected={selected} href={listHref} query={query} setQuery={setQuery} placeholder="名前・行・モンスターで検索" filter={filter} setFilter={setFilter} filters={FILTERS} />
      <div className="book-detail" ref={detail}>
        <ActionDetail key={selected} session={session} kind={kind} row={row} />
      </div>
    </div>
  );
}

/** The fields of one row, for the shared inputs (ui/FieldEdit). */
const access = (rows: TableRows, row: number): FieldAccess => ({
  get: (k) => rows.get(row, k),
  original: (k) => rows.original(row, k),
  set: (k, v) => rows.set(row, k, v),
  range: (k) => fieldRange(rows.field(k)),
});

const AMOUNT_INFO = '戦闘の行動 +0x0C / +0x0E に写されます。回復では最小〜最大の乱数を HP に足し、最大 HP で止めます (FUN_00205104 付近)。ダメージでの使われ方は未確認です。';
const STATUS_INFO = '付ける (治す) 状態。conditionData (22 行) の行で、0 = なし。行動 w4 bit18-22 に写されます。どの行が何の状態かは未解析です。';
const ATTACK_STATUS_INFO = `${STATUS_INFO} ワザでは +0x1D bit2 が 1 の行だけ +0x04 bit4-8 が状態になります (FUN_00204A40)。`;
const NO_COPY = '初代で表の行を足してゲームが読むかは確かめていません';

function ActionDetail({ session, kind, row }: { session: HonoluluSession; kind: HonoluluActionKind; row: number }): ReactNode {
  const t = actionRows(session, kind);
  const f = access(t, row);
  const edited = (): void => session.edited();
  const file = ACTION_FILE[kind];
  const context = session.master.context();
  const users = useMemo(() => (kind === 'w' ? attackUsers(session).get(row) ?? [] : []), [session, kind, row, session.revision]);
  const texts = ACTION_TEXTS[kind].map(([key, label]) => ({
    key, label, id: t.get(row, key), place: `${file.replace('.bin', '')} +0x${t.field(key).offset.toString(16).toUpperCase().padStart(2, '0')}`,
    shared: rowsWithText(session, kind, row, key),
  }));
  const shown = (k: string): string => fieldText(t.field(k), t.get(row, k), context);
  const statusEditable = kind === 's' || (t.get(row, 'form') & 4) !== 0;
  return (
    <>
      <ActionHead title={actionName(session, kind, row) || `${ACTION_KIND_LABEL[kind]} ${row}`} sub={`${file.replace('.bin', '')} の行 ${row}  ${ACTION_KIND_LABEL[kind]}`} />
      <ActionTexts texts={session.messages.texts} fields={texts} message={(id) => session.messages.texts.preview(id, true) ?? ''} onEdit={edited}
        href={(r) => honoluluActionHref(kind, r)} />
      <StatFields f={f} edited={edited} stats={[
        { label: '量', range: ['min', 'max'], info: AMOUNT_INFO },
        statusEditable
          ? { label: '状態', node: <FieldNumber f={f} k="status" edited={edited} />, info: kind === 's' ? STATUS_INFO : ATTACK_STATUS_INFO }
          : { label: '状態', node: <span className="muted">—</span>, info: `${ATTACK_STATUS_INFO} この行は +0x1D bit2 が 0 なので、+0x04 は別の写し方をします。` },
      ]} />
      <div className="stats action-stats">
        {kind === 'w' ? <>
          <Stat label="威力の倍率" info="+0x08 (f32)。100 / 130 / 150 などで、倍率と推定しています。ダメージ計算での使われ方は未確認なので、表示だけです。">{shown('power')}</Stat>
          <Stat label="命中率" info="+0x1E ×10 % と推定しています (実データは 10 = 100%)。表示だけです。">{`${t.get(row, 'accuracy') * 10}%`}</Stat>
          <Stat label="行動のビット" info="+0x1D。bit2 で +0x04 の写し方が変わります。表示だけです。">{shown('form')}</Stat>
          <Stat label="ビット詰め" info="+0x04。行動 w4 のビットに写されます (naauao monsters.md §3)。表示だけです。">{shown('bits')}</Stat>
        </> : <>
          <Stat label="+0x10" info="3 / 4 / 0x0D〜0x10。範囲か消費と推定しています。表示だけです。">{shown('v10')}</Stat>
          <Stat label="+0x12" info="かいふく系で 3〜25。表示だけです。">{shown('v12')}</Stat>
        </>}
      </div>
      <ActionButtons note={`変更はマスター (56562135) の ${file} とメッセージとして書き出されます。`}
        copy={{ noun: 'アクション', can: false, why: NO_COPY, copy: () => row, href: (r) => honoluluActionHref(kind, r) }} from={row} onEdit={edited}
        onRevert={actionChanged(session, kind, row) ? () => { revertAction(session, kind, row); edited(); } : undefined} />
      {kind === 'w'
        ? <ActionUsers monsters={users.map((m) => ({ key: `m${m}`, name: monsterName(session, m) || `#${m}`, href: honoluluMonsterHref(m) }))} items={[]} />
        : <div className="row muted small">どのアンテナ (headData・skillGroup) がこの特技を持つかは未解析です。</div>}
      <details className="row-fields-box">
        <summary>{`${file.replace('.bin', '')} の行 ${row} のすべての欄`}</summary>
        <RowFields def={t.def} row={t.row(row)} original={t.originalRow(row)} context={context} />
      </details>
    </>
  );
}
