// RPG FREE!'s monster book (#/monsters/<row>), laid out like RPG2's and RPG3's from the same parts (ui/MonsterList,
// ui/FieldEdit, ui/MonsterSlots, ui/ModelView): the list, the name and description with the stats, the model, the
// drops, skills and other actions, the transformations, the resistances, where it appears, and every field of its rows.
// The game's own parts are the shared ability rows (a warning with a copy) and the look (MonsterDesign); the numbers
// come from the ability row (MonsterEditor.tsx; naauao lanai/monsters.md).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ModelTextures } from '../ui/ModelTextures';
import { ModelView } from '../ui/ModelView';
import { PortLookButton } from '../ui/PortLook';
import { MonsterList } from '../ui/MonsterList';
import { RowFields } from '../ui/RowFields';
import { TextBox } from '../ui/book';
import { CopyRemoveButtons, NewRecordButton, type CopySpec } from '../ui/RecordButtons';
import { lanaiCanRemoveMonster, lanaiCopyMonster, lanaiRemoveMonster, lanaiTransformSources } from './monsterCopy';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import {
  LanaiDropEditor, LanaiOtherActions, LANAI_RESIST_INFO, LanaiResistEditor, LanaiSkillEditor, LanaiStatFields, LanaiTransforms, SharedStatsWarning, statsContext, useLanaiRevision,
} from './MonsterEditor';
import { lanaiActionName, lanaiFlavor, lanaiItemName, lanaiMonsterChanged, lanaiMonsterStats, lanaiTransforms } from './monsterBook';
import { lanaiMonsterModel, lanaiMonsterSet } from './monsterModels';
import { ACTION_SLOT_OFFSETS, lanaiRevertMonster, lanaiStatsOf } from './monsterStats';
import { forgetLanaiMonsters, lanaiModelIndex, lanaiMonsterDesign, lanaiMonsterHref, lanaiMonsters, lanaiVoice, monstersWithModel, type LanaiModelIndex, type LanaiMonster } from './monsters';
import { lanaiMonsterIcon, LanaiMonsterPicker } from './pickers';
import type { LanaiRows } from './rows';
import type { LanaiSession } from './session';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiGroupHref } from './MapParts';
import { loadedLanaiMaps } from './maps';

export { lanaiMonsterHref } from './monsters';

type Filter = 'all' | 'changed' | 'transform' | 'model' | 'none';

/** The model entry's name of a monster ("enemy_02"), '' when it has none or the index is not read yet. */
function modelName(session: LanaiSession, index: LanaiModelIndex | undefined, m: LanaiMonster): string {
  if (!index || m.designRow < 0) return '';
  return (index.name(session.rows('MonsterDesign').get(m.designRow, 'model')) ?? '').replace(/\.bch$/, '');
}

/** The texts a monster is found by: its names, its model, its skills and drops. */
function searchTexts(session: LanaiSession, m: LanaiMonster, model: string): string[] {
  const out = [m.name, m.group, model];
  const ref = lanaiStatsOf(session, m.row);
  if (ref) {
    const t = session.need(ref.table);
    for (const o of ACTION_SLOT_OFFSETS.slice(6)) out.push(lanaiActionName(session, t.u32(ref.row, o)));
    for (let i = 0; i < 4; i++) { const v = t.u32(ref.row, 0x0c + i * 4); if (v) out.push(lanaiItemName(session, v)); }
  }
  return out;
}

export function LanaiMonsterPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  // read again after a monster got another look (a port forgets them, #100)
  const monsters = useMemo(() => lanaiMonsters(session), [session, revision]);
  const loaded = useAsync(() => lanaiModelIndex(session), [session, revision]);
  const index = loaded instanceof Error ? undefined : loaded;
  const asRow = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined;
  const selected = useSticky(asRow, (r) => r >= 0 && r < monsters.length, () => Math.max(0, monsters.findIndex((m) => m.name)));
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const q = query.trim();
  const rows = useMemo(() => monsters.filter((m) => {
    const model = modelName(session, index, m);
    if (q && String(m.row) !== q && hex8(m.id) !== q.toUpperCase() && !searchTexts(session, m, model).some((t) => t.includes(q))) return false;
    const has = m.designRow >= 0 && (!index || (!!model && !model.startsWith('dummy')));
    if (filter === 'changed') return lanaiMonsterChanged(session, m.row);
    if (filter === 'transform') return lanaiTransforms(session, m.row);
    if (filter === 'model') return has;
    if (filter === 'none') return !has;
    return true;
  }), [monsters, session, index, q, filter, revision]);
  return (
    <div className="book">
      <MonsterList query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}
        options={[['all', 'すべて'], ['changed', '変更したもの'], ['transform', '変身する・変身先'], ['model', 'モデルあり'], ['none', 'モデルなし']]}
        rows={rows.map((m) => {
          const s = lanaiMonsterStats(session, m.row);
          return { row: m.row, icon: lanaiMonsterIcon(session, m.row), name: m.name, level: s?.level, hp: s?.hp, changed: lanaiMonsterChanged(session, m.row) };
        })}
        total={monsters.length} selected={selected} href={lanaiMonsterHref} listRef={list}
        top={<NewRecordButton copy={lanaiMonsterCopy(session)} current={selected} onEdit={() => session.edited()}
          picker={(p) => <LanaiMonsterPicker session={session} {...p} />} />} />
      <div className="book-detail" ref={detail}>
        {monsters[selected] && <MonsterDetail key={selected} session={session} monster={monsters[selected]} index={index} indexError={loaded instanceof Error ? loaded : null} />}
      </div>
    </div>
  );
}

const COPY_INFO = [
  'この行を MonsterParameter の最後に写して、新しいモンスターを作ります (行 ID は使われている最大 + 1)。能力の行も写すので、能力・ドロップ・ワザは元と別に変えられます。',
  '名前と群れの名前は、この行の文字列として書き換えられます。見た目は「見た目を選ぶ…」で、この作品やほかの作品のモンスターから選び直せます。',
  '図鑑番号 (+0x00 bit10-19) は種族の代表の行だけが持つので、写しでは 0 にします。群れ (ステージの MonsterGroup) に入れるとゲームに出ます。',
  'ゲームが表の後ろに足した行を受け付けるかは、まだゲームで確かめていません。',
].join('\n');

/** Copying a monster to a new row (the buttons of a monster and the list's "＋ 新しいモンスター"). */
function lanaiMonsterCopy(session: LanaiSession): CopySpec {
  const p = session.need('MonsterParameter');
  return {
    noun: 'モンスター', can: true, info: COPY_INFO, href: lanaiMonsterHref, copy: (row) => lanaiCopyMonster(session, row),
    cannot: (row) => (row > 0 && row < p.rows && p.u32(row, 0x04) ? null : '名前のない行は写せません'),
  };
}

/** What refers to a monster: the groups of the stages read so far and the transformations into it. */
function lanaiMonsterUsers(session: LanaiSession, row: number): string[] {
  return [
    ...lanaiMonsterGroups(session, row).map((f) => `${contentTitle(f.content)} の群れ #${f.group}`),
    ...lanaiTransformSources(session, row).map((m) => `${lanaiMonsters(session)[m]?.name || `#${m}`} の変身`),
  ];
}

const PARAM_INFO = [
  '変更はマスター (2135000A) の MonsterParameter と能力の表 (MonsterParameterMain / Extra / RegularEvent / SpecialEvent) として書き出されます。',
  '名前・群れの名前は表の文字列で、ここで書き換えられます。説明文はまだ編集できません。+0x00 の bit20-29 が見た目 (MonsterDesign の行番号) です (code.bin 0x306E84)。',
  '能力は +0x16 bit0-2 の表の +0x14 の行にあります (naauao lanai/monsters.md)。',
].join('\n');

const VOICE_INFO = 'voice の欄は、ほかの文字列 (UTF-16) と違い 1 バイトずつの文字列です。半角カナと記号 (\' / | など) で書かれた読みで、音声合成用と推定しています。ほとんどのモンスターは空です。';

const DESIGN_INFO = [
  'master の MonsterDesign (570 行 × 0xA0)。モデル・色のテクスチャ・戦闘のモーションは、ルートのアーカイブ 28480000 (Base) と 719F0000 (Update) の BCH のエントリです。',
  '色違いは、同じモデルにテクスチャを名前で差し替えて作ります。',
].join('\n');

function MonsterDetail({ session, monster: m, index, indexError }: {
  session: LanaiSession;
  monster: LanaiMonster;
  index: LanaiModelIndex | undefined;
  indexError: Error | null;
}): ReactNode {
  const params = session.rows('MonsterParameter');
  const designs = session.rows('MonsterDesign');
  const voice = lanaiVoice(params.table, m.row);
  const flavor = lanaiFlavor(session, m.design);
  const ref = lanaiStatsOf(session, m.row);
  const stats = ref ? session.rows(ref.table) : null;
  const f = ref && stats ? stats.access(ref.row) : null;
  const edited = (): void => session.edited();
  const context = (rows: LanaiRows) => rows.context(session, { hashName: (h) => index?.name(h) });
  const p = f ? { session, f, edited } : null;
  return (
    <>
      <div className="book-head">
        <h2 className="with-info">{m.name || '(名前なし)'}<InfoTip text={PARAM_INFO} /></h2>
        <span className="muted">{`#${m.row}  ID ${hex8(m.id)}  能力 ${ref ? `${ref.table.replace('MonsterParameter', '')} ${ref.row}${ref.row >= session.need(ref.table).originalRows ? ' (追加した行)' : ''}` : 'なし'}  デザイン ${m.designRow >= 0 ? m.designRow : 'なし'}`}</span>
        <CopyRemoveButtons copy={lanaiMonsterCopy(session)} from={m.row} onEdit={edited} remove={params.originalRow(m.row) ? undefined : {
          used: lanaiMonsterUsers(session, m.row),
          why: lanaiCanRemoveMonster(session, m.row) ? undefined : '消せるのは最後に追加したモンスターだけです',
          remove: () => lanaiRemoveMonster(session, m.row), next: lanaiMonsterHref(m.row - 1),
        }} />
        {lanaiMonsterChanged(session, m.row) && !!params.originalRow(m.row) && <button onClick={() => { lanaiRevertMonster(session, m.row); forgetLanaiMonsters(session); edited(); }}>このモンスターの変更を元に戻す</button>}
      </div>
      {ref && <SharedStatsWarning session={session} monster={m.row} statsRef={ref} edited={edited} />}
      <div className="book-top">
        <div>
          <table className="enc-table desc-table">
            <tbody>
              <NameRow session={session} row={m.row} offset={0x04} label="名前" edited={edited} />
              <NameRow session={session} row={m.row} offset={0x0c} label="群れの名前" edited={edited} />
              {flavor && <tr><th title={`MonsterParameter +0x10、MessageFlavor ${hex8(m.design)}`}>説明</th><td className="book-desc">{flavor}</td></tr>}
              {voice.bytes.length > 0 && (
                <tr>
                  <th className="with-info">voice<InfoTip text={VOICE_INFO} /></th>
                  <td className="book-desc">{voice.text} <span className="mono muted small">{voice.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</span></td>
                </tr>
              )}
            </tbody>
          </table>
          {f
            ? <LanaiStatFields f={f} edited={edited} />
            : <div className="warn-box">{`能力の行がありません (MonsterParameter +0x16 = 0x${params.table.u16(m.row, 0x16).toString(16)}, +0x14 = ${params.table.u16(m.row, 0x14)})`}</div>}
        </div>
        <MonsterModel session={session} monster={m} indexError={indexError} edited={edited} />
      </div>
      {p && ref && (
        <>
          <div className="book-cols monster-cols">
            <LanaiDropEditor {...p} />
            <LanaiSkillEditor {...p} />
            <LanaiOtherActions {...p} />
          </div>
          <LanaiTransforms {...p} monster={m.row} statsRef={ref} />
          <h3 className="with-info">たいせい<InfoTip text={LANAI_RESIST_INFO} /></h3>
          <LanaiResistEditor f={p.f} edited={edited} />
        </>
      )}
      <h3>出現する場所</h3>
      <MonsterGroupsOf session={session} row={m.row} />
      <SameModel session={session} monster={m} />
      <details className="row-fields-box">
        <summary>{`MonsterParameter の行 ${m.row} のすべての欄`}</summary>
        <RowFields def={params.def} row={params.row(m.row)} original={params.originalRow(m.row)} context={context(params)} />
      </details>
      {ref && stats && (
        <details className="row-fields-box">
          <summary>{`${ref.table} の行 ${ref.row} のすべての欄`}</summary>
          <RowFields def={stats.def} row={stats.row(ref.row)} original={stats.originalRow(ref.row)} context={statsContext(session, ref)} />
        </details>
      )}
      {m.designRow >= 0 && (
        <details className="row-fields-box">
          <summary><span className="with-info">{`見た目 (MonsterDesign 行 ${m.designRow}) のすべての欄`}<InfoTip text={DESIGN_INFO} /></span></summary>
          <RowFields def={designs.def} row={designs.row(m.designRow)} original={designs.originalRow(m.designRow)} context={context(designs)} />
        </details>
      )}
    </>
  );
}

/** A string field of the monster's MonsterParameter row (its name, its group's name), written on leaving the box. */
function NameRow({ session, row, offset, label, edited }: { session: LanaiSession; row: number; offset: number; label: string; edited: () => void }): ReactNode {
  const t = session.need('MonsterParameter');
  if (!t.isString(row, offset)) return null;
  const value = session.stringAt(t, t.u32(row, offset)).text;
  const was = session.originalField(t, row, offset);
  return (
    <tr>
      <th title={`MonsterParameter +0x${offset.toString(16).toUpperCase()}`}>{label}</th>
      <td className="book-desc">
        <TextBox key={`${row}:${offset}`} value={value} multi={false} edited={!!was && was.text !== value} onCommit={(v) => {
          session.setText(t, row, offset, v);
          forgetLanaiMonsters(session);
          edited();
        }} />
      </td>
    </tr>
  );
}

/** The other monsters of the same model (colour variants, other forms). */
function SameModel({ session, monster: m }: { session: LanaiSession; monster: LanaiMonster }): ReactNode {
  const designs = session.rows('MonsterDesign');
  const model = m.designRow >= 0 ? designs.get(m.designRow, 'model') : 0;
  const same = useMemo(() => (model ? monstersWithModel(session, model).filter((x) => x.row !== m.row) : []), [session, model, m.row]);
  if (!same.length) return null;
  const texture = designs.get(m.designRow, 'texture');
  return (
    <details className="row-fields-box">
      <summary>{`同じモデルのモンスター (${same.length})`}</summary>
      <table className="book-table">
        <tbody>
          {same.map((x) => (
            <tr key={x.row} onClick={() => (location.hash = lanaiMonsterHref(x.row))}>
              <td className="photo-cell">{lanaiMonsterIcon(session, x.row)}</td>
              <td className="num muted">{x.row}</td>
              <td>{x.name || <span className="muted">(名前なし)</span>}</td>
              <td className="muted small">{designs.get(x.designRow, 'texture') === texture ? '同じ色' : `デザイン ${x.designRow}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** The 3D view and its textures (made once the page is in the browser: the viewer needs the DOM), with why the model could not be read. */
function MonsterModel({ session, monster: m, indexError, edited }: { session: LanaiSession; monster: LanaiMonster; indexError: Error | null; edited: () => void }): ReactNode {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  const design = m.designRow < 0 ? null : lanaiMonsterDesign(session, m.designRow);
  const set = useAsync(() => (shown && design ? lanaiMonsterSet(session, design) : Promise.resolve(null)), [shown, session, m.designRow]);
  if (!design) return <div className="model-placeholder muted">MonsterDesign の行がないので、モデルはわかりません</div>;
  if (!shown) return <div className="model-placeholder" />;
  const model = lanaiMonsterModel(session, design);
  return (
    <div>
      <ModelView model={model} name={m.name || 'monster'} />
      <ModelTextures model={model} />
      <div className="row"><PortLookButton target="lanai" row={m.row} onDone={edited} /></div>
      {indexError && <div className="error">{`モデルのアーカイブを読めませんでした: ${indexError.message}`}</div>}
      {set instanceof Error && <div className="muted small">{`モデルを読めませんでした: ${set.message}`}</div>}
      {set && !(set instanceof Error) && set.errors.length > 0 && <div className="muted small">{set.errors.join('\n')}</div>}
    </div>
  );
}

/** The groups (MonsterGroup rows) of the contents read so far that have the monster. */
function lanaiMonsterGroups(session: LanaiSession, row: number): { content: LanaiContent; group: number; maps: number }[] {
  const id = session.need('MonsterParameter').rowId(row);
  const found: { content: LanaiContent; group: number; maps: number }[] = [];
  for (const c of lanaiContents(session)) {
    const maps = loadedLanaiMaps(session, c.index);
    if (!maps?.monsterGroup) continue;
    const uses = maps.monsterGroupUses();
    for (const g of maps.monsterGroups()) if (g.monsters.includes(id)) found.push({ content: c, group: g.row, maps: uses.get(g.row)?.length ?? 0 });
  }
  return found;
}

/** The groups of the contents read so far that have the monster, linked to the group page. */
function MonsterGroupsOf({ session, row }: { session: LanaiSession; row: number }): ReactNode {
  const found = lanaiMonsterGroups(session, row);
  return (
    <div className="book-where">
      {found.map((f) => (
        <div key={`${f.content.index}.${f.group}`}>
          <a href={lanaiGroupHref(f.content.index, f.group)}>{`${contentTitle(f.content)} の群れ #${f.group}`}</a>
          <span className="muted">{f.maps ? ` (マップ ${f.maps} 個)` : ' (どのマップも使わない)'}</span>
        </div>
      ))}
      <div className="muted small">{found.length ? '' : 'まだ開いたステージの群れにはいません。'}ステージの群れは、そのステージのマップか「群れ」のページを一度開くと読まれます。</div>
    </div>
  );
}
