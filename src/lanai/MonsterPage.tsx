// RPG FREE!'s monster book (#/monsters/<row>), read only: the rows of MonsterParameter with their names, the fields of
// the row, the MonsterDesign row it names with its model, colour textures and battle motions (naauao lanai/monsters.md),
// the model in the 3D viewer and the other monsters of the same model (colour variants).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TEX_FORMAT } from '../cgfx/texture';
import type { CgfxTexture } from '../cgfx/cgfx';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { ModelView } from '../ui/ModelView';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { lanaiDesignFiles, lanaiMonsterModel, lanaiMonsterSet, type LanaiDesignFiles } from './monsterModels';
import {
  DESIGN_SIZES, lanaiModelIndex, lanaiMonsterDesign, lanaiMonsterHref, lanaiMonsters, lanaiVoice, monstersWithModel, paramHalves, rowWords,
  type LanaiModelIndex, type LanaiMonster, type LanaiMonsterDesign,
} from './monsters';
import type { LanaiSession } from './session';

export { lanaiMonsterHref } from './monsters';

type Filter = 'all' | 'model' | 'none';

const hex = (v: number): string => `0x${hex8(v)}`;

/** The model entry's name of a monster ("enemy_02.bch"), '' when it has none or the index is not read yet. */
function modelName(session: LanaiSession, index: LanaiModelIndex | undefined, m: LanaiMonster): string {
  if (!index || m.designRow < 0) return '';
  return index.name(session.need('MonsterDesign').u32(m.designRow, 0x08)) ?? '';
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
    // before the archives are read, a design row is enough
    const has = m.designRow >= 0 && (!index || !!model);
    if (filter === 'model') return has && !model.startsWith('dummy');
    if (filter === 'none') return !has || model.startsWith('dummy');
    return true;
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・群れの名前・行・モデルで検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['model', 'モデルあり'], ['none', 'モデルなし']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={monsters.length} />
          <table className="book-table">
            <thead><tr><th>#</th><th>名前</th><th>群れの名前</th><th>モデル</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.row} className={m.row === selected ? 'active' : ''} onClick={() => (location.hash = lanaiMonsterHref(m.row))}>
                  <td className="num muted">{m.row}</td>
                  <td>{m.name || <span className="muted">(名前なし)</span>}</td>
                  <td className="muted">{m.group}</td>
                  <td className="mono small muted">{modelName(session, index, m).replace(/\.bch$/, '')}</td>
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
  'master (2135000A) の MonsterParameter (1231 行 × 0x24) の行。名前・voice・群れの名前は文字列の欄です。',
  '+0x10 が MonsterDesign の行 ID で、見た目 (モデル・色・モーション) が決まります。',
  '能力の表 (MonsterParameterMain / Extra / RegularEvent / SpecialEvent、0x9C) とのつながりはまだわかっていません。',
].join('\n');

const VOICE_INFO = 'voice の欄は、ほかの文字列 (UTF-16) と違い 1 バイトずつの文字列です。半角カナと記号 (\' / | など) で書かれた読みで、音声合成用と推定しています。ほとんどのモンスターは空です。';

function MonsterDetail({ session, monster: m, index, indexError }: {
  session: LanaiSession;
  monster: LanaiMonster;
  index: LanaiModelIndex | undefined;
  indexError: Error | null;
}): ReactNode {
  const t = session.need('MonsterParameter');
  const design = m.designRow >= 0 ? lanaiMonsterDesign(session, m.designRow) : null;
  const voice = lanaiVoice(t, m.row);
  const [h0, h1] = paramHalves(t, m.row);
  const words = rowWords(t, m.row);
  const meaning: Record<number, ReactNode> = {
    0x00: <span className="muted">ビット詰めの値 (未解析)</span>,
    0x04: <>名前「{m.name}」</>,
    0x08: <>voice {voice.bytes.length ? <>「{voice.text}」 <span className="mono muted small">{voice.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</span></> : <span className="muted">(空)</span>}</>,
    0x0c: <>群れの名前「{m.group}」</>,
    0x10: <>MonsterDesign の行 ID {m.designRow >= 0 ? `(行 ${m.designRow})` : <span className="error-text">(MonsterDesign にない ID)</span>}</>,
    0x14: <span className="muted">{`u16 × 2: ${h0}, ${h1} (未解析)`}</span>,
    0x18: <span className="muted">未解析 (0x10 が多い)</span>,
  };
  return (
    <>
      <div className="book-head">
        <h2 className="with-info">{m.name || '(名前なし)'}<InfoTip text={PARAM_INFO} /></h2>
        <span className="muted">{`#${m.row}  ID ${hex8(m.id)}  ${m.group}`}</span>
      </div>
      <div className="book-top">
        <div>
          <h3>MonsterParameter の欄</h3>
          <table className="enc-table row-fields">
            <tbody>
              <tr><th>場所</th><th>値</th><th>意味</th></tr>
              {words.map(([o, v]) => (
                <tr key={o}>
                  <td className="mono muted">{`+0x${o.toString(16).toUpperCase().padStart(2, '0')}`}</td>
                  <td className="mono">{t.isString(m.row, o) ? <span title="文字列の欄 (プールの位置)">{`→ ${hex(v)}`}</span> : hex(v)}</td>
                  <td>{o === 0x08 ? <span className="with-info">{meaning[o]}<InfoTip text={VOICE_INFO} /></span> : meaning[o] ?? <span className="muted">未解析</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {design ? <MonsterModel session={session} design={design} name={m.name} /> : <div className="model-placeholder muted">MonsterDesign の行がないので、モデルはわかりません</div>}
      </div>
      {indexError && <div className="error">{`モデルのアーカイブを読めませんでした: ${indexError.message}`}</div>}
      {design && <DesignDetail session={session} monster={m} design={design} index={index} />}
    </>
  );
}

const DESIGN_INFO = [
  'master の MonsterDesign (570 行 × 0xA0)。+0x08 がモデル、+0x0C が色違いのテクスチャ、+0x10 が戦闘用のモーションで、どれもルートアーカイブ 28480000 (Base) か 719F0000 (Update) のエントリのハッシュです。',
  '色違いは、同じモデルにテクスチャを名前で差し替えて作ります。+0x20〜 の f32 は大きさ・距離と推定しています。',
].join('\n');

function EntryCell({ index, hash }: { index: LanaiModelIndex | undefined; hash: number }): ReactNode {
  if (!hash) return <span className="muted">なし</span>;
  const e = index?.get(hash);
  return (
    <>
      <span className="mono muted">{hex8(hash)}</span>{' '}
      {!index ? <span className="muted">…</span> : e ? <><span className="mono">{e.name || '(名前なし)'}</span> <span className="muted small">{e.archive}</span></> : <span className="error-text">エントリがありません</span>}
    </>
  );
}

function DesignDetail({ session, monster: m, design: d, index }: { session: LanaiSession; monster: LanaiMonster; design: LanaiMonsterDesign; index: LanaiModelIndex | undefined }): ReactNode {
  const files = useAsync(() => lanaiDesignFiles(session, d), [session, d.row]);
  const same = useMemo(() => (d.model ? monstersWithModel(session, d.model) : []), [session, d.model]);
  const dt = session.need('MonsterDesign');
  const sizeEnd = DESIGN_SIZES[0] + DESIGN_SIZES[1] * 4;
  return (
    <>
      <h3 className="with-info">{`見た目 (MonsterDesign 行 ${d.row}、ID ${hex8(d.id)})`}<InfoTip text={DESIGN_INFO} /></h3>
      <table className="enc-table">
        <tbody>
          <tr><td>モデル (+0x08)</td><td><EntryCell index={index} hash={d.model} /></td></tr>
          <tr><td>色のテクスチャ (+0x0C)</td><td><EntryCell index={index} hash={d.texture} /></td></tr>
          <tr><td>戦闘のモーション (+0x10)</td><td><EntryCell index={index} hash={d.motion} /></td></tr>
          <tr><td>大きさ (推定)</td><td className="mono small">{d.sizes.map((v) => +v.toFixed(3)).join(', ')}</td></tr>
        </tbody>
      </table>
      {files instanceof Error && <div className="error">{files.message}</div>}
      {files && !(files instanceof Error) && <DesignFiles files={files} />}
      <h3>{`同じモデルのモンスター (${same.length})`}</h3>
      <table className="enc-table">
        <tbody>
          <tr><th>#</th><th>名前</th><th>色のテクスチャ</th><th>MonsterDesign</th></tr>
          {same.map((x) => {
            const tex = dt.u32(x.designRow, 0x0c);
            return (
              <tr key={x.row} className={x.row === m.row ? 'muted' : ''}>
                <td className="num muted">{x.row}</td>
                <td>{x.row === m.row ? `${x.name} (これ)` : <a href={lanaiMonsterHref(x.row)}>{x.name || '(名前なし)'}</a>}</td>
                <td className="mono small">{index?.name(tex) ?? hex8(tex)}{tex === d.texture && x.row !== m.row ? <span className="muted"> (同じ色)</span> : ''}</td>
                <td className="mono small muted">{`行 ${x.designRow}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details className="row-fields-box">
        <summary>{`MonsterDesign の行 ${d.row} のすべての値`}</summary>
        <table className="enc-table">
          <tbody>
            <tr><th>場所</th><th>u32</th><th>f32</th></tr>
            {rowWords(dt, d.row).map(([o, v]) => {
              const f = new DataView(new Uint32Array([v]).buffer).getFloat32(0, true);
              return (
                <tr key={o} className={o >= DESIGN_SIZES[0] && o < sizeEnd ? '' : 'muted'}>
                  <td className="mono muted">{`+0x${o.toString(16).toUpperCase().padStart(2, '0')}`}</td>
                  <td className="mono">{hex(v)}</td>
                  <td className="mono small">{o >= DESIGN_SIZES[0] && o < sizeEnd ? +f.toFixed(4) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </>
  );
}

function DesignFiles({ files: f }: { files: LanaiDesignFiles }): ReactNode {
  return (
    <>
      {f.errors.length > 0 && <div className="error">{f.errors.join('\n')}</div>}
      {f.textures.length > 0 && (
        <>
          <h3>色のテクスチャ</h3>
          <div className="bch-textures">{f.textures.map((t) => <TextureThumb key={t.name} t={t} />)}</div>
        </>
      )}
      <div className="book-cols">
        <section>
          <h3>{`戦闘のモーション (${f.motions.length + f.materialMotions.length})`}</h3>
          <ul className="mono small">
            {f.motions.map((n) => <li key={`s/${n}`}>{n}</li>)}
            {f.materialMotions.map((n) => <li key={`m/${n}`}>{n}<span className="muted"> (材質)</span></li>)}
          </ul>
        </section>
        <section>
          <h3>{`モデルのアニメーション (${f.modelAnimations.length})`}</h3>
          <ul className="mono small">{f.modelAnimations.map((n) => <li key={n}>{n}</li>)}</ul>
          <div className="muted small">
            {`H3D ${f.version === null ? '?' : `0x${f.version.toString(16)}`}、モデル ${f.models.join(', ') || 'なし'}、モデル自身のテクスチャ ${f.modelTextures.length}`}
          </div>
        </section>
      </div>
    </>
  );
}

function TextureThumb({ t }: { t: CgfxTexture }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = t.width;
    c.height = t.height;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
  }, [t]);
  return (
    <figure className="bch-texture">
      <canvas ref={canvas} title={`${t.width}×${t.height}`} />
      <figcaption>
        <span className="mono">{t.name}</span>
        <span className="muted small">{`${t.width}×${t.height} ${TEX_FORMAT[t.format] ?? t.format}`}</span>
      </figcaption>
    </figure>
  );
}

/** The 3D view (made once the page is in the browser: the viewer needs the DOM), with why the model could not be read. */
function MonsterModel({ session, design, name }: { session: LanaiSession; design: LanaiMonsterDesign; name: string }): ReactNode {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  const set = useAsync(() => (shown ? lanaiMonsterSet(session, design) : Promise.resolve(null)), [shown, session, design.row]);
  if (!shown) return <div className="model-placeholder" />;
  return (
    <div>
      <ModelView model={lanaiMonsterModel(session, design)} name={name || 'monster'} />
      {set instanceof Error && <div className="muted small">{`モデルを読めませんでした: ${set.message}`}</div>}
      {set && !(set instanceof Error) && set.errors.length > 0 && <div className="muted small">{set.errors.join('\n')}</div>}
    </div>
  );
}
