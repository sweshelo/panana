// RPG FREE!'s action book (#/actions/<row>): every row of ActionData with its two texts and system, on the action page's
// parts shared with RPG2, RPG3 and 初代 (ui/ActionParts). The text (MessageAction) and the known fields are edited, a
// transformation's monster is picked, the monsters, tools and equipment using the action are linked, and a new action is
// made by copying a row (battleActions.ts).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionButtons, ActionHead, ActionListPane, ActionUsers } from '../ui/ActionParts';
import { BoardSlot } from '../ui/MonsterSlots';
import { InfoTip } from '../ui/InfoTip';
import { NewRecordButton, type CopySpec } from '../ui/RecordButtons';
import { RowFields } from '../ui/RowFields';
import { TextBox, useScrollTop, useSticky } from '../ui/book';
import { FieldChoice, FieldNumber, Stat } from '../ui/FieldEdit';
import { hex8 } from '../util/bytes';
import {
  ACTION_TEXTS, lanaiActionAdded, lanaiActionChanged, lanaiActionMessageRow, lanaiActionRefs, lanaiActionRemoveBlock, lanaiActionsWithText,
  lanaiActionUsedBy, lanaiBattleActions, lanaiCopyAction, lanaiOwnActionText, lanaiRemoveAction, lanaiRevertAction, type ActionTextKey, type LanaiBattleAction,
} from './battleActions';
import { lanaiActionHref, lanaiItemHref } from './hrefs';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiMonsterName } from './monsterBook';
import { isTransform, lanaiActionMessageText, lanaiSetTransformTarget } from './monsterStats';
import { lanaiMonsterHref } from './monsters';
import { lanaiMonsterEntry, LanaiActionPicker, LanaiMonsterPicker } from './pickers';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';
import { LANAI_ACTION_DATA, LANAI_ACTION_ELEMENTS } from './tables';
import { slotLabel } from './MonsterEditor';

export { lanaiActionHref };

type Filter = 'skill' | 'item' | 'equip' | 'transform' | 'text' | 'all' | 'changed';
const FILTERS: [Filter, string][] = [
  ['skill', 'モンスターが使うもの'], ['item', '道具の効果'], ['equip', '装備の自動のアクション'], ['transform', '変身 (系統 29 / 30)'], ['text', '文のあるもの'], ['all', 'すべて'], ['changed', '変更・追加したもの'],
];

export function LanaiActionPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('skill');
  const detail = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => lanaiBattleActions(session), [session, revision]);
  const refs = useMemo(() => lanaiActionRefs(session), [session, revision]);
  const selected = useSticky(arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined, (r) => r > 0 && r < actions.length,
    () => actions.find((a) => refs.monsters.has(a.row))?.row ?? 1);
  useScrollTop(detail, selected);
  const q = query.trim();
  const rows = useMemo(() => actions.filter((a) => {
    if (a.row === 0) return false;
    const monsters = refs.monsters.get(a.row) ?? [];
    const items = refs.items.get(a.row) ?? [];
    if (q && String(a.row) !== q && hex8(a.id) !== q.toUpperCase() && !a.name.includes(q) && !a.message.includes(q) && !a.result.includes(q)
      && !monsters.some((m) => lanaiMonsterName(session, m.monster).includes(q)) && !items.some((e) => e.name.includes(q))) return false;
    if (filter === 'skill') return monsters.length > 0;
    if (filter === 'item') return items.some((e) => e.how === '使う');
    if (filter === 'equip') return items.some((e) => e.how !== '使う');
    if (filter === 'transform') return isTransform(a);
    if (filter === 'text') return !!a.message;
    if (filter === 'changed') return lanaiActionChanged(session, a.row);
    return true;
  }), [actions, refs, q, filter, session, revision]);
  const edited = (): void => session.edited();
  return (
    <div className="book">
      <ActionListPane
        rows={rows.map((a) => {
          const n = new Set((refs.monsters.get(a.row) ?? []).map((u) => u.monster)).size + (refs.items.get(a.row)?.length ?? 0);
          return {
            row: a.row,
            name: a.named ? a.name : <span className="muted">{a.name}</span>,
            edited: lanaiActionChanged(session, a.row),
            cells: [isTransform(a) ? `系統 ${a.system} 変身` : `系統 ${a.system}`, n ? String(n) : ''],
          };
        })}
        total={actions.length - 1} columns={[['系統', 'ActionData +0x14 bit4-11'], ['参照', '使うモンスターとアイテムの数']]} selected={selected} href={lanaiActionHref}
        query={query} setQuery={setQuery} placeholder="文・行・ID・モンスター・アイテムで検索" filter={filter} setFilter={setFilter} filters={FILTERS}
        top={<NewRecordButton copy={actionCopy(session)} current={selected} onEdit={edited}
          picker={(p) => <LanaiActionPicker session={session} title="写すアクションを選ぶ" current={p.current} onPick={p.onPick} onClose={p.onClose} />} />} />
      <div className="book-detail" ref={detail}>
        {actions[selected] && <ActionDetail key={selected} session={session} action={actions[selected]!} onEdit={edited} />}
      </div>
    </div>
  );
}

const COPY_INFO = [
  'このアクションを ActionData の最後に新しい行 (新しい行 ID) として写します。文 (MessageAction) も同じ本文の新しい行になり、元と別に書き換えられます。',
  '写したアクションは、モンスターのワザ・自動の行動の枠や、装備の自動のアクションで選ぶと使われます。変身のアクションは、写してから変身先を選び直せます。',
  '演出 (モーション・エフェクト) がどの欄で決まるかは未解析なので、写す元のアクションの演出のままになります。ゲームでの確認はまだです。',
].join('\n');

/** Copying an action to a new row (the buttons of an action and the list's "＋ 新しいアクション"). */
function actionCopy(session: LanaiSession): CopySpec {
  return {
    noun: 'アクション', can: true, info: COPY_INFO, href: lanaiActionHref,
    cannot: (row) => (row > 0 ? null : '行 0 は「なし」です'), copy: (row) => lanaiCopyAction(session, row),
  };
}

const TEXT_INFO: Record<ActionTextKey, string> = {
  message: '使ったときに出る文 (ActionData +0x0C、MessageAction の行 ID)。〈name〉に使った者の名前が入ります。「〈name〉」だけの行 (396 行が共有) は、文を出さないアクションです。',
  result: '結果の文 (ActionData +0x10、MessageAction の行 ID)。〈name〉に受けた者、〈value〉に量が入ります。「〈name〉に　〈value〉ダメージ与えた」は 2657 行が共有しています。',
};
const SYSTEM_INFO = 'ActionData +0x14 bit4-11。戦闘の結果の種類 (ダメージ・回復・状態・変身 …) と推定しています。29 / 30 は変身、21 は『つかまえる』(naauao lanai/monsters.md §3)。番号ごとの意味はまだ一部しか分かっていません。';
const AMOUNT_INFO = '+0x16 (下側) と +0x04 (上側)。回復やダメージの量の幅と推定しています (ダメージの式での使われ方は未確認)。自動回復 (表示用の種類 0x56 / 0x57) では +0x16 が回復の値です。';
const KIND_INFO = 'ActionData +0x14 bit0-3。被弾時の枠では 5 / 8 のときに働きます。5 は倒される一撃のあと HP が戻る (naauao lanai/monsters.md §11)。';

function ActionDetail({ session, action: a, onEdit }: { session: LanaiSession; action: LanaiBattleAction; onEdit: () => void }): ReactNode {
  const [picking, setPicking] = useState(false);
  const t = session.need('ActionData');
  const rows = session.rows('ActionData');
  const f = rows.access(a.row, onEdit);
  const refs = lanaiActionRefs(session);
  const monsters = refs.monsters.get(a.row) ?? [];
  const items = refs.items.get(a.row) ?? [];
  const added = lanaiActionAdded(session, a.row);
  const params = session.need('MonsterParameter');
  const target = isTransform(a) ? params.find(a.target) : -1;
  const removeWhy = lanaiActionRemoveBlock(session, a.row);
  const context = rows.context(session, {
    rowName: (table, v) => {
      if (table === 'MessageAction') return lanaiActionMessageText(session, v) || undefined;
      if (table === 'MonsterParameter') { const r = params.find(v); return r < 0 ? undefined : lanaiMonsterName(session, r); }
      const other = session.table(table);
      const r = other?.find(v) ?? -1;
      return r < 0 ? undefined : `行 ${r}`;
    },
  });
  return (
    <>
      <ActionHead title={a.name} sub={`ActionData の行 ${a.row}  ID ${hex8(a.id)}  系統 ${a.system}${added ? '  (追加したアクション)' : ''}`} />
      <table className="enc-table desc-table">
        <tbody>
          {ACTION_TEXTS.map((x) => {
            const msg = lanaiActionMessageRow(session, a.row, x.key);
            const shared = lanaiActionsWithText(session, a.row, x.key);
            return (
              <tr key={x.key}>
                <th className="with-info">{x.label}<InfoTip text={TEXT_INFO[x.key]} /></th>
                <td className="book-desc">
                  {msg ? <ActionText session={session} table={msg.table} row={msg.row} onEdit={onEdit} /> : <span className="muted">なし</span>}
                  {msg && shared.length > 0 && (
                    <div className="small">
                      <span className="muted">
                        {`同じ文 (${shared.length}): `}
                        {shared.slice(0, 6).map((r, i) => <span key={r}>{i > 0 && '、'}<a href={lanaiActionHref(r)}>{`#${r}`}</a></span>)}
                        {shared.length > 6 && ' ほか'}
                      </span>
                      {' '}
                      <button className="small" title="同じ本文の新しい MessageAction の行を作り、この行に付けます。書き換えても、ほかのアクションの文は変わりません" onClick={() => { lanaiOwnActionText(session, a.row, x.key); onEdit(); }}>このアクションだけの文にする</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="stats stat-edit action-stats">
        <Stat label="系統" info={SYSTEM_INFO}><FieldNumber f={f} k="system" edited={onEdit} /></Stat>
        <Stat label="+0x14 bit0-3" info={KIND_INFO}><FieldNumber f={f} k="kind" edited={onEdit} /></Stat>
        <Stat label="量 (推定)" info={AMOUNT_INFO}><FieldNumber f={f} k="min" edited={onEdit} />〜<FieldNumber f={f} k="max" edited={onEdit} /></Stat>
        <Stat label="倍率 (推定)" info="+0x06。10 = 1 倍と推定しています (『つかまえる2ばい』が 20)。"><FieldNumber f={f} k="scale" edited={onEdit} /></Stat>
        <Stat label="属性 (推定)" info="+0x28。0 = なし、1〜8 = 火・氷・風・土・電気・水・光・闇 (ワザの名前とデータが合うことからの推定)。"><FieldChoice f={f} k="element" edited={onEdit} options={Object.entries(LANAI_ACTION_ELEMENTS).map(([v, l]) => [Number(v), l])} /></Stat>
      </div>
      {isTransform(a) && (
        <div className="model-line">
          <div className="with-info">変身先<InfoTip text="ActionData +0x00 (系統 29 / 30): 変身する MonsterParameter の行 ID。このアクションを使うすべてのモンスターが同じ先に変身します。" /></div>
          <BoardSlot entry={target >= 0 ? lanaiMonsterEntry(session, target) : null} id={target >= 0 ? target : undefined}
            edited={!added && rows.get(a.row, 'target') !== rows.original(a.row, 'target')}
            title="変身先を選び直す" emptyLabel={`＋ 変身先 (0x${a.target.toString(16).toUpperCase()} は表にない)`} onPick={() => setPicking(true)} />
        </div>
      )}
      <ActionButtons note="変更はマスターの ActionData と、文を変えたときは MessageAction として書き出されます。"
        copy={actionCopy(session)} from={a.row} onEdit={onEdit}
        remove={added ? { used: lanaiActionUsedBy(session, a.row), why: removeWhy || undefined, remove: () => lanaiRemoveAction(session, a.row), next: lanaiActionHref(a.row - 1) } : undefined}
        onRevert={!added && lanaiActionChanged(session, a.row) ? () => { lanaiRevertAction(session, a.row); onEdit(); } : undefined} />
      <ActionUsers
        monsters={monsters.map((u, i) => ({ key: `m${u.monster}-${u.offset}-${i}`, name: `${lanaiMonsterName(session, u.monster)} #${u.monster}`, href: lanaiMonsterHref(u.monster), note: slotLabel(u.offset) }))}
        items={items.map((e, i) => ({ key: `i${e.item}-${i}`, name: `${e.name} #${e.item}`, href: lanaiItemHref(e.item), note: e.how }))} />
      <details className="row-fields-box">
        <summary>{`ActionData の行 ${a.row} のすべての欄`}</summary>
        <RowFields def={LANAI_ACTION_DATA} row={t.row(a.row)} original={t.originalRow(a.row) ?? undefined} context={context} />
      </details>
      {picking && (
        <LanaiMonsterPicker session={session} title="変身先を選ぶ" current={target} onClose={() => setPicking(false)}
          onPick={(row) => { setPicking(false); lanaiSetTransformTarget(session, a.id, row); onEdit(); }} />
      )}
    </>
  );
}

/** The action's text (MessageAction `individual`), written on leaving the box. */
function ActionText({ session, table, row, onEdit }: { session: LanaiSession; table: LanaiTable; row: number; onEdit: () => void }): ReactNode {
  const off = table.fields.find((x) => x.name === 'individual')?.offset;
  if (off === undefined || !table.isString(row, off)) return <span className="muted">なし</span>;
  const value = session.field(table, row, off)?.text ?? '';
  const was = session.originalField(table, row, off);
  return <TextBox key={`${table.name}-${row}`} value={value} multi edited={!!was && was.text !== value} onCommit={(v) => { session.setText(table, row, off, v); onEdit(); }} />;
}
