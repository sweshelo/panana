// RPG FREE!'s monster book (#/monsters/<row>), built like RPG2's and RPG3's from the shared parts: the list with the
// photos, the name, the model with its textures (ui/ModelView, ui/ModelTextures), the look (MonsterDesign) and every
// field of the rows (ui/RowFields through the field definitions of tables.ts, so the fields that become known can be
// given the shared inputs of ui/FieldEdit). Read only for now (naauao lanai/monsters.md).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ModelTextures } from '../ui/ModelTextures';
import { ModelView } from '../ui/ModelView';
import { Photo } from '../ui/Photo';
import { RowFields } from '../ui/RowFields';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { lanaiMonsterModel, lanaiMonsterSet } from './monsterModels';
import { lanaiModelIndex, lanaiMonsterDesign, lanaiMonsterHref, lanaiMonsters, lanaiVoice, monstersWithModel, type LanaiModelIndex, type LanaiMonster } from './monsters';
import type { LanaiRows } from './rows';
import type { LanaiSession } from './session';

export { lanaiMonsterHref } from './monsters';

type Filter = 'all' | 'model' | 'none';

/** The photo of a monster's model (none without a MonsterDesign row). */
function monsterIcon(session: LanaiSession, m: LanaiMonster): ReactNode {
  const d = m.designRow < 0 ? null : lanaiMonsterDesign(session, m.designRow);
  return <Photo model={d ? lanaiMonsterModel(session, d, false) : null} title={m.name} />;
}

/** The model entry's name of a monster ("enemy_02"), '' when it has none or the index is not read yet. */
function modelName(session: LanaiSession, index: LanaiModelIndex | undefined, m: LanaiMonster): string {
  if (!index || m.designRow < 0) return '';
  return (index.name(session.rows('MonsterDesign').get(m.designRow, 'model')) ?? '').replace(/\.bch$/, '');
}

export function LanaiMonsterPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const monsters = useMemo(() => lanaiMonsters(session), [session]);
  const loaded = useAsync(() => lanaiModelIndex(session), [session]);
  const index = loaded instanceof Error ? undefined : loaded;
  const asRow = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined;
  const selected = useSticky(asRow, (r) => r >= 0 && r < monsters.length, () => Math.max(0, monsters.findIndex((m) => m.name)));
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const q = query.trim();
  const rows = monsters.filter((m) => {
    const model = modelName(session, index, m);
    if (q && String(m.row) !== q && hex8(m.id) !== q.toUpperCase() && ![m.name, m.group, model].some((t) => t.includes(q))) return false;
    const has = m.designRow >= 0 && (!index || (!!model && !model.startsWith('dummy')));
    if (filter === 'model') return has;
    if (filter === 'none') return !has;
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・群れの名前・モデルで検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['model', 'モデルあり'], ['none', 'モデルなし']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={monsters.length} />
          <table className="book-table">
            <thead><tr><th></th><th>#</th><th>名前</th><th>群れの名前</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.row} className={m.row === selected ? 'active' : ''} onClick={() => (location.hash = lanaiMonsterHref(m.row))}>
                  <td className="photo-cell">{monsterIcon(session, m)}</td>
                  <td className="num muted">{m.row}</td>
                  <td>{m.name || <span className="muted">(名前なし)</span>}</td>
                  <td className="muted">{m.group}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {monsters[selected] && <MonsterDetail key={selected} session={session} monster={monsters[selected]} index={index} indexError={loaded instanceof Error ? loaded : null} />}
      </div>
    </div>
  );
}

const PARAM_INFO = [
  'master (2135000A) の MonsterParameter (1231 行 × 0x24)。名前・群れの名前は表の文字列、+0x00 の bit20-29 が見た目 (MonsterDesign の行番号) です (code.bin 0x306E84)。',
  '能力の表 (MonsterParameterMain / Extra / RegularEvent / SpecialEvent、0x9C) とのつながりはまだわかっていません。',
  '今は読むだけです。わかった欄は、RPG2・RPG3 と同じ入力で編集できるようにします。',
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
  const context = (rows: LanaiRows) => rows.context(session, { hashName: (h) => index?.name(h) });
  return (
    <>
      <div className="book-head">
        <h2 className="with-info">{m.name || '(名前なし)'}<InfoTip text={PARAM_INFO} /></h2>
        <span className="muted">{`#${m.row}  ID ${hex8(m.id)}  デザイン ${m.designRow >= 0 ? m.designRow : '(MonsterDesign にない行)'}`}</span>
      </div>
      <div className="book-top">
        <div>
          <table className="enc-table desc-table">
            <tbody>
              <tr><th>名前</th><td className="book-desc">{m.name}</td></tr>
              <tr><th>群れの名前</th><td className="book-desc">{m.group}</td></tr>
              <tr>
                <th className="with-info">voice<InfoTip text={VOICE_INFO} /></th>
                <td className="book-desc">{voice.bytes.length ? <>{voice.text} <span className="mono muted small">{voice.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</span></> : <span className="muted">(空)</span>}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">能力・ワザ・ドロップ・たいせいの表はまだつながっていません。</p>
        </div>
        <MonsterModel session={session} monster={m} />
      </div>
      {indexError && <div className="error">{`モデルのアーカイブを読めませんでした: ${indexError.message}`}</div>}
      {m.designRow >= 0 && (
        <>
          <h3 className="with-info">{`見た目 (MonsterDesign 行 ${m.designRow})`}<InfoTip text={DESIGN_INFO} /></h3>
          <RowFields def={designs.def} row={designs.row(m.designRow)} original={designs.originalRow(m.designRow)} context={context(designs)} />
          <SameModel session={session} monster={m} />
        </>
      )}
      <details className="row-fields-box">
        <summary>{`MonsterParameter の行 ${m.row} のすべての欄`}</summary>
        <RowFields def={params.def} row={params.row(m.row)} original={params.originalRow(m.row)} context={context(params)} />
      </details>
    </>
  );
}

/** The other monsters of the same model (colour variants, other forms). */
function SameModel({ session, monster: m }: { session: LanaiSession; monster: LanaiMonster }): ReactNode {
  const designs = session.rows('MonsterDesign');
  const model = designs.get(m.designRow, 'model');
  const same = useMemo(() => (model ? monstersWithModel(session, model).filter((x) => x.row !== m.row) : []), [session, model, m.row]);
  if (!same.length) return null;
  const texture = designs.get(m.designRow, 'texture');
  return (
    <>
      <h3>{`同じモデルのモンスター (${same.length})`}</h3>
      <table className="book-table">
        <tbody>
          {same.map((x) => (
            <tr key={x.row} onClick={() => (location.hash = lanaiMonsterHref(x.row))}>
              <td className="photo-cell">{monsterIcon(session, x)}</td>
              <td className="num muted">{x.row}</td>
              <td>{x.name || <span className="muted">(名前なし)</span>}</td>
              <td className="muted small">{designs.get(x.designRow, 'texture') === texture ? '同じ色' : `デザイン ${x.designRow}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The 3D view and its textures (made once the page is in the browser: the viewer needs the DOM), with why the model could not be read. */
function MonsterModel({ session, monster: m }: { session: LanaiSession; monster: LanaiMonster }): ReactNode {
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
      {set instanceof Error && <div className="muted small">{`モデルを読めませんでした: ${set.message}`}</div>}
      {set && !(set instanceof Error) && set.errors.length > 0 && <div className="muted small">{set.errors.join('\n')}</div>}
    </div>
  );
}
