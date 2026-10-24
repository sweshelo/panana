// 初代's monster book (#/monsters/<monsterBattleParameter の行>): the 110 monsters with their photos, stats, drops,
// skills, forms and the groups that hold them (naauao honolulu/monsters.md). The look (name and model) is monsterData's
// row in 2713402F, shared by the forms of a monster. The drops, skills, forms and resistances use the parts of the other
// games' books (ui/MonsterSlots); the flags are shown by their definitions. The floors where a group appears come from
// the dungeons' floor definitions (maps.ts, naauao honolulu/map.md §4).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fieldRange } from '../game/tabledef';
import type { TableRows } from '../game/tablerows';
import type { ModelRef } from '../pages/modelview';
import { useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { useAsync } from '../ui/useAsync';
import { honoluluMapHref } from './MapPage';
import { dungeonLabel, floorLabel, type HonoluluMapInfo } from './maps';
import { FieldChoice, StatFields, type FieldAccess } from '../ui/FieldEdit';
import { InfoTip } from '../ui/InfoTip';
import { MessageEditor } from '../ui/message';
import { ModelTextures } from '../ui/ModelTextures';
import { ModelView } from '../ui/ModelView';
import { MonsterList } from '../ui/MonsterList';
import { BoardSlot, DropSlots, Heading, moveTo, ResistCharts, SkillSlots } from '../ui/MonsterSlots';
import { RowFields } from '../ui/RowFields';
import { useHonoluluRevision } from './ItemPage';
import {
  attackName, battleRows, designName, designRows, DROP_SLOTS, FIX_GROUP_FILE, GROUP_FILE, groupMembers, honoluluMonsterHref, honoluluMonsterModel,
  honoluluMonsters, monsterChanged, monsterGroups, monsterName, previousForms, revertMonster, sameDesign, SKILL_SLOTS, skillRows, type HonoluluMonster,
  type MonsterGroups,
} from './monsters';
import {
  honoluluItemEntry, HonoluluItemPicker, honoluluMonsterEntry, honoluluMonsterIcon, HonoluluMonsterPicker, honoluluSkillEntry, HonoluluSkillPicker,
  honoluluSkillSub,
} from './pickers';
import type { HonoluluSession } from './session';

export { honoluluMonsterHref };

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
        rows={rows.map((x) => ({ row: x.row, icon: honoluluMonsterIcon(session, x.row), name: x.name, level: x.level, hp: x.hp.max, count: groupCount(x.row), changed: monsterChanged(session, x.row) }))}
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
  const designOptions: [number, string][] = Array.from({ length: d.rows - 1 }, (_, i): [number, string] => [i + 1, `${i + 1}: ${designName(session, i + 1)}`]);
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
      <div className="book-cols monster-cols">
        <DropEditor session={session} f={f} edited={edited} />
        <SkillEditor session={session} f={f} edited={edited} />
        <FormEditor session={session} row={m.row} f={f} edited={edited} />
      </div>
      <Heading title="耐性" info={RESIST_INFO} />
      <ResistEditor f={f} edited={edited} />
      <h3 className="with-info">{`群れ (${(groups?.groups.length ?? 0) + (groups?.fixed.length ?? 0)})`}<InfoTip text="群れが出る階は、ダンジョンの階の定義 (階の敵、または置かれた群れ) から引いています。" /></h3>
      <div className="book-where">
        {!groups && <div className="muted">どの群れにもいません (イベント戦など)</div>}
        {groups?.groups.map((g) => <div key={`g${g}`}>{`monsterGroup #${g}: `}<span className="muted">{groupMembers(session, GROUP_FILE, g).join('、')}</span><GroupFloors session={session} row={g} /></div>)}
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

interface EditProps {
  session: HonoluluSession;
  f: FieldAccess;
  edited: () => void;
}

/** The 2 drop slots: the item's board (itemData's row, 0 = none) and the rate's step. */
function DropEditor({ session, f, edited }: EditProps): ReactNode {
  return (
    <DropSlots
      info={DROP_INFO}
      slots={DROP_SLOTS.map(([item, rate]) => ({
        item: f.get(item),
        original: f.original(item),
        sub: `率の段階 ${f.get(rate)}`,
        rate: <FieldChoice f={f} k={rate} edited={edited} labels={(v) => `段階 ${v}`} />,
      }))}
      entry={(row) => honoluluItemEntry(session, row)}
      setItem={(k, row) => { f.set(DROP_SLOTS[k]![0], row); edited(); }}
      picker={(k, current, pick, close) => <HonoluluItemPicker session={session} title={`ドロップ ${k + 1} のアイテムを選ぶ`} current={current} onPick={pick} onClose={close} />}
    />
  );
}

const SKILL_INFO = [
  '5 枠 (+0x20〜+0x29、monsterAttackSkill の行)。ドラッグで並べ替え、× で外します (後ろの枠が詰まります)。',
  '名前は戦闘メッセージから「〈モンスター〉の」「〈モンスター〉は」を除いたもの。どの枠を選ぶか (AI) は未解析です。',
].join('\n');

/** The 5 skill slots, packed to the front (0 = empty). */
function SkillEditor({ session, f, edited }: EditProps): ReactNode {
  const now = SKILL_SLOTS.map((k) => f.get(k)).filter((s) => s);
  const set = (next: number[]): void => {
    SKILL_SLOTS.forEach((k, i) => f.set(k, next[i] ?? 0));
    edited();
  };
  return (
    <section>
      <Heading title="ワザ" info={SKILL_INFO} />
      <SkillSlots
        slots={now.map((s, i) => ({ action: s, entry: honoluluSkillEntry(session, s), sub: honoluluSkillSub(session, s), edited: f.original(SKILL_SLOTS[i]!) !== s }))}
        max={SKILL_SLOTS.length}
        move={(from, to) => set(moveTo(now, from, to))}
        pick={(i, row) => set(i < 0 ? [...now, row] : now.map((s, j) => (j === i ? row : s)))}
        remove={(i) => set(now.filter((_, j) => j !== i))}
        picker={(current, pick, close) => <HonoluluSkillPicker session={session} current={current} onPick={pick} onClose={close} />}
        empty="ワザがありません。"
      />
    </section>
  );
}

const FORM_INFO = [
  '次の形態 (+0x33、monsterBattleParameter の行、0 = なし)。この行の敵を倒すと次の形態の行になります (例: まおう 22 → 23)。',
  '最初の形態の経験値・お金・ドロップは 0 で、最後の形態の行が持ちます。セリフ (+0x1E) はこの行の形態になったときに出ます。',
].join('\n');

/** The next form as a board picked from the monsters, the forms before this one and the line said on changing. */
function FormEditor({ session, row, f, edited }: EditProps & { row: number }): ReactNode {
  const [picking, setPicking] = useState(false);
  const next = f.get('next');
  const prev = previousForms(session, row);
  const line = f.get('line');
  return (
    <section>
      <Heading title="変身" info={FORM_INFO} />
      <table className="enc-table ai-fields">
        <tbody>
          <tr>
            <td>次の形態</td>
            <td>
              <BoardSlot entry={next ? honoluluMonsterEntry(session, next) : null} id={next || undefined} edited={next !== f.original('next')}
                title="次の形態を選び直す" emptyLabel="＋ 次の形態" onPick={() => setPicking(true)} onClear={() => { f.set('next', 0); edited(); }} />
            </td>
          </tr>
          {prev.map((r) => (
            <tr key={r}><td>前の形態</td><td><a href={honoluluMonsterHref(r)}>{`${monsterName(session, r)} (#${r})`}</a></td></tr>
          ))}
          {line > 0 && <tr><td>セリフ</td><td className="book-desc">{session.messages.texts.preview(line)}</td></tr>}
        </tbody>
      </table>
      {picking && (
        <HonoluluMonsterPicker session={session} title="次の形態を選ぶ" current={next} onClose={() => setPicking(false)}
          onPick={(r) => { setPicking(false); f.set('next', r); edited(); }} />
      )}
    </section>
  );
}

const RESIST_INFO = [
  '読み方はコードで確かめていますが、どの軸が何の耐性かは未確認です (naauao honolulu/monsters.md §2)。',
  '4 bit × 6 (+0x2D〜+0x2F、−8〜+7): 属性の耐性と推定。戦闘の物体 +0xD8〜 に入ります。',
  '2 bit × 11 (+0x30〜+0x32、0〜3): 状態異常の耐性と推定。値で 4 段階の表 (*0x31F644 +0x4C) を引きます。',
].join('\n');

const RESIST4 = Array.from({ length: 6 }, (_, k) => `resist${k}`);
const RESIST2 = Array.from({ length: 11 }, (_, k) => `ailment${k}`);

/** The resistances as the shared charts (one per kind: their ranges differ), with generic axis names. */
function ResistEditor({ f, edited }: Omit<EditProps, 'session'>): ReactNode {
  const chart = (label: string, keys: string[]) => [{ label, axes: keys.map((k, i) => ({ name: `${i + 1}`, value: f.get(k), original: f.original(k), title: k })) }];
  return (
    <div className="resist-pair">
      <ResistCharts charts={chart('耐性 A (4 bit、属性と推定)', RESIST4)} min={-8} max={7} rings={[-8, -4, 0, 4, 7]} effect={() => ''}
        onChange={(_, j, v) => { f.set(RESIST4[j]!, v); edited(); }} />
      <ResistCharts charts={chart('耐性 B (2 bit、状態異常と推定)', RESIST2)} min={0} max={3} rings={[0, 1, 2, 3]} effect={() => ''}
        onChange={(_, j, v) => { f.set(RESIST2[j]!, v); edited(); }} />
    </div>
  );
}

/** The floors where a monsterGroup row appears, linked to the map page. */
function GroupFloors({ session, row }: { session: HonoluluSession; row: number }): ReactNode {
  const maps = useAsync(() => session.maps(), [session]);
  if (!maps || maps instanceof Error) return null;
  const floors = maps.groupFloors(row);
  if (!floors.length) return <div className="muted small">どの階にも出ません</div>;
  // records of one floor number (areas of a floor) are named once
  const seen = new Map<string, HonoluluMapInfo | undefined>();
  for (const { floor, placed } of floors) {
    const d = maps.dungeon(floor.dungeon);
    const label = `${d ? dungeonLabel(d) : `ダンジョン ${floor.dungeon}`} ${floorLabel(floor.floor)}${placed ? ' (置かれた群れ)' : ''}`;
    if (!seen.has(label)) seen.set(label, maps.map(floor.map));
  }
  return (
    <div className="small">
      {'出る階: '}
      {[...seen].map(([label, m], i) => <span key={label}>{i ? '、' : ''}{m ? <a href={honoluluMapHref(m)}>{label}</a> : label}</span>)}
    </div>
  );
}
