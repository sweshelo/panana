// 初代's monster book (#/monsters/<monsterBattleParameter の行>): the 110 monsters with their photos, stats, drops,
// skills, forms and the groups that hold them (naauao honolulu/monsters.md). The look (name and model) is monsterData's
// row in 2713402F, shared by the forms of a monster. The fields whose meaning is known are edited; the others (the
// resistances, the flags) are shown by their definitions. Where the groups appear is not known yet (naauao#47).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fieldRange } from '../game/tabledef';
import type { TableRows } from '../game/tablerows';
import type { ModelRef } from '../pages/modelview';
import { useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { FieldChoice, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { InfoTip } from '../ui/InfoTip';
import { MessageEditor } from '../ui/message';
import { ModelTextures } from '../ui/ModelTextures';
import { ModelView } from '../ui/ModelView';
import { MonsterList } from '../ui/MonsterList';
import { Photo } from '../ui/Photo';
import { RowFields } from '../ui/RowFields';
import { honoluluItemHref, useHonoluluRevision } from './ItemPage';
import { honoluluItems } from './items';
import {
  attackName, battleRows, designName, designRows, DROP_SLOTS, FIX_GROUP_FILE, GROUP_FILE, groupMembers, honoluluMonsterModel, honoluluMonsters,
  monsterChanged, monsterGroups, previousForms, revertMonster, sameDesign, SKILL_SLOTS, skillRows, type HonoluluMonster, type MonsterGroups,
} from './monsters';
import type { HonoluluSession } from './session';

export const honoluluMonsterHref = (row: number): string => `#/monsters/${row}`;

/** The fields of one row of a table, for the shared inputs (ui/FieldEdit). */
const access = (rows: TableRows, row: number): FieldAccess => ({
  get: (k) => rows.get(row, k),
  original: (k) => rows.original(row, k),
  set: (k, v) => rows.set(row, k, v),
  range: (k) => fieldRange(rows.field(k)),
});

type Filter = 'all' | 'forms' | 'grouped' | 'alone' | 'changed';

export function HonoluluMonsterPage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const revision = useHonoluluRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const monsters = useMemo(() => honoluluMonsters(session), [session, revision]);
  const byRow = useMemo(() => new Map(monsters.map((m) => [m.row, m])), [monsters]);
  const groups = useMemo(() => monsterGroups(session), [session, revision]);
  const selected = useSticky(arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined, (r) => byRow.has(r), () => monsters[0]?.row ?? 1);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const q = query.trim();
  const groupCount = (row: number): number => (groups.get(row)?.groups.length ?? 0) + (groups.get(row)?.fixed.length ?? 0);
  const rows = monsters.filter((m) => {
    if (q && !m.name.includes(q) && String(m.row) !== q && !SKILL_SLOTS.some((k) => attackName(session, battleRows(session).get(m.row, k)).includes(q))) return false;
    if (filter === 'forms') return !!m.next || monsters.some((o) => o.next === m.row);
    if (filter === 'grouped') return groupCount(m.row) > 0;
    if (filter === 'alone') return !groupCount(m.row);
    if (filter === 'changed') return monsterChanged(session, m.row);
    return true;
  });
  const m = byRow.get(selected);
  return (
    <div className="book">
      <MonsterList query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}
        options={[['all', 'すべて'], ['forms', '変身する・変身後'], ['grouped', '群れにいる'], ['alone', '群れにいない'], ['changed', '変更したもの']]}
        rows={rows.map((x) => ({ row: x.row, icon: <Photo model={honoluluMonsterModel(session, x.design)} />, name: x.name, level: x.level, hp: x.hp.max, count: groupCount(x.row), changed: monsterChanged(session, x.row) }))}
        total={monsters.length} selected={selected} href={honoluluMonsterHref} countHead="群れ" listRef={list} />
      <div className="book-detail" ref={detail}>
        {m && <MonsterDetail key={m.row} session={session} m={m} groups={groups.get(m.row)} />}
      </div>
    </div>
  );
}

/** The 3D view and its textures, made once the page is in the browser (the viewer needs the DOM). */
function MonsterModel({ model, name }: { model: ModelRef | null; name: string }): ReactNode {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  if (!model) return <div className="model-placeholder muted">見た目の行にモデルがありません</div>;
  if (!shown) return <div className="model-placeholder" />;
  return (
    <div>
      <ModelView model={model} name={name || 'monster'} />
      <ModelTextures model={model} />
    </div>
  );
}

const STAT_INFO = 'ゲームは 2 つの値の小さい方から大きい方までの乱数にします (FUN_00205BE8)。HP 以外は全行で 2 つの値が同じです。';
const DROP_INFO = 'ドロップは 2 枠。率の段階 (0〜7) から確率への換算は未確認です。ボスの「あかし」は段階 5。変身する敵は最後の形態の行がドロップ・経験値・お金を持ちます。';
const NAME_INFO = '名前とモデルは見た目の行 (2713402F の monsterData) にあり、同じ見た目のほかの行 (変身の前後など) と共通です。';

function MonsterDetail({ session, m, groups }: { session: HonoluluSession; m: HonoluluMonster; groups: MonsterGroups | undefined }): ReactNode {
  const t = battleRows(session);
  const d = designRows(session);
  const f = access(t, m.row);
  const edited = (): void => session.edited();
  const model = honoluluMonsterModel(session, m.design);
  const context = session.master.context();
  const nameId = d.get(m.design, 'name');
  const texts = session.messages.texts;
  const sharers = sameDesign(session, m.row);
  const items = useMemo(() => honoluluItems(session), [session]);
  const itemOptions: [number, string][] = [[0, 'なし'], ...items.map((it): [number, string] => [it.row, `${it.row}: ${it.name}`])];
  const skillOptions: [number, string][] = [[0, '空き'], ...Array.from({ length: skillRows(session).rows - 1 }, (_, i): [number, string] => [i + 1, `${i + 1}: ${attackName(session, i + 1)}`])];
  const designOptions: [number, string][] = Array.from({ length: d.rows - 1 }, (_, i): [number, string] => [i + 1, `${i + 1}: ${designName(session, i + 1)}`]);
  const monsterOptions: [number, string][] = [[0, 'なし'], ...Array.from({ length: t.rows - 1 }, (_, i): [number, string] => [i + 1, `${i + 1}: ${designName(session, t.get(i + 1, 'design'))}`])];
  const prev = previousForms(session, m.row);
  const skills = [...new Set(SKILL_SLOTS.map((k) => t.get(m.row, k)).filter((s) => s))];
  return (
    <>
      <div className="book-head">
        <h2 className="with-info">{m.name || '(名前なし)'}<InfoTip text="変更はマスター (56562135) の monsterBattleParameter.bin と、2713402F の monsterData.bin・名前のメッセージとして書き出されます。" /></h2>
        <span className="muted">{`monsterBattleParameter 行 ${m.row}  見た目 ${m.design}`}</span>
        {monsterChanged(session, m.row) && <button onClick={() => { revertMonster(session, m.row); edited(); }}>このモンスターの変更を元に戻す</button>}
      </div>
      <div className="book-top">
        <div>
          <table className="enc-table desc-table">
            <tbody>
              <tr>
                <th className="with-info" title={`monsterData +0x00、メッセージ ${nameId}`}>名前<InfoTip text={NAME_INFO} /></th>
                <td className="book-desc">
                  {!nameId ? <span className="muted">なし</span>
                    : texts.editable(nameId) ? <MessageEditor texts={texts} id={nameId} compact apply={(fn) => { fn(); edited(); }} />
                    : <span>{texts.preview(nameId)}</span>}
                  {sharers.length > 0 && <div className="muted small">{'同じ見た目: '}{sharers.map((r, i) => <span key={r}>{i ? ' ' : ''}<a href={honoluluMonsterHref(r)}>{`#${r}`}</a></span>)}</div>}
                </td>
              </tr>
            </tbody>
          </table>
          <StatFields f={f} edited={edited} stats={[
            { label: 'Lv', k: 'level' },
            { label: 'HP', range: ['hpMin', 'hpMax'], info: STAT_INFO },
            { label: 'こうげき', range: ['atk2', 'atk1'], info: '名前は推定 (戦闘の物体 +0x5C)' },
            { label: 'ぼうぎょ', range: ['def2', 'def1'], info: '名前は推定 (+0x5E)' },
            { label: 'すばやさ', range: ['spd2', 'spd1'], info: '名前は推定 (+0x60)' },
            { label: '経験値', k: 'exp' },
            { label: 'お金', k: 'gold', unit: ' G' },
            { label: '見た目', node: <FieldChoice f={f} k="design" edited={edited} options={designOptions} title="monsterData (2713402F) の行: 名前とモデル" />, wide: true },
          ]} />
        </div>
        <MonsterModel model={model} name={m.name} />
      </div>
      <div className="book-cols monster-cols honolulu-monster-cols">
        <section>
          <h3 className="with-info">ドロップ<InfoTip text={DROP_INFO} /></h3>
          <table className="enc-table">
            <tbody>
              {DROP_SLOTS.map(([item, rate], k) => (
                <tr key={item}>
                  <th>{`枠 ${k + 1}`}</th>
                  <td><FieldChoice f={f} k={item} edited={edited} options={itemOptions} /></td>
                  <td style={{ width: '6em' }}><FieldChoice f={f} k={rate} edited={edited} labels={(v) => `段階 ${v}`} /></td>
                  <td style={{ width: '3em' }}>{t.get(m.row, item) > 0 && <a href={honoluluItemHref(t.get(m.row, item))}>図鑑</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3 className="with-info">ワザ<InfoTip text="monsterAttackSkill の行。名前は戦闘メッセージから「〈モンスター〉の」「〈モンスター〉は」を除いたものです。" /></h3>
          <table className="enc-table">
            <tbody>
              {SKILL_SLOTS.map((k, i) => (
                <tr key={k}><th>{`${i + 1}`}</th><td><FieldChoice f={f} k={k} edited={edited} options={skillOptions} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>変身</h3>
          <table className="enc-table">
            <tbody>
              <tr><th>次の形態</th><td><FieldChoice f={f} k="next" edited={edited} options={monsterOptions} /></td>
                <td style={{ width: '3em' }}>{m.next > 0 && <a href={honoluluMonsterHref(m.next)}>{`#${m.next}`}</a>}</td></tr>
              <tr><th>前の形態</th><td colSpan={2}>{prev.length ? prev.map((r, i) => <span key={r}>{i ? ' ' : ''}<a href={honoluluMonsterHref(r)}>{`#${r} ${designName(session, t.get(r, 'design'))}`}</a></span>) : <span className="muted">なし</span>}</td></tr>
              {t.get(m.row, 'line') > 0 && <tr><th>セリフ</th><td colSpan={2} className="book-desc">{texts.preview(t.get(m.row, 'line'))}</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
      <h3 className="with-info">{`群れ (${(groups?.groups.length ?? 0) + (groups?.fixed.length ?? 0)})`}<InfoTip text="群れがどのダンジョンの階に出るかは、階の定義ファイルの解析 (naauao#47) のあとで足します。" /></h3>
      <div className="book-where">
        {!groups && <div className="muted">どの群れにもいません (イベント戦など)</div>}
        {groups?.groups.map((g) => <div key={`g${g}`}>{`monsterGroup #${g}: `}<span className="muted">{groupMembers(session, GROUP_FILE, g).join('、')}</span></div>)}
        {groups?.fixed.map((g) => <div key={`f${g}`}>{`monsterFixGroup #${g} (固定の組): `}<span className="muted">{groupMembers(session, FIX_GROUP_FILE, g).join('、')}</span></div>)}
      </div>
      <details className="row-fields-box">
        <summary>{`monsterBattleParameter の行 ${m.row} のすべての欄 (耐性など)`}</summary>
        <RowFields def={t.def} row={t.row(m.row)} original={t.originalRow(m.row)} context={context} />
      </details>
      <details className="row-fields-box">
        <summary>{`monsterData (2713402F) の行 ${m.design} のすべての欄`}</summary>
        <RowFields def={d.def} row={d.row(m.design)} original={d.originalRow(m.design)} context={session.design.context()} />
      </details>
      {skills.map((s) => (
        <details key={s} className="row-fields-box">
          <summary>{`ワザ ${attackName(session, s)} (monsterAttackSkill の行 ${s}) のすべての欄`}</summary>
          <RowFields def={skillRows(session).def} row={skillRows(session).row(s)} original={skillRows(session).originalRow(s)} context={context} />
        </details>
      ))}
    </>
  );
}
