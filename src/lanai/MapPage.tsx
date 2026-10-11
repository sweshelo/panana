// The maps of 電波人間のRPG FREE! (#/maps/<content>.<name>; naauao lanai/map.md), read only for now: a content's map
// table, each map as the 2D grid and the 3D scene of the other map pages (mapview.ts). Header: the content and the map
// (picked in the dialog of the other map pages), view mode. Left: the layers; right: the map's facts and the selected tile
// or record. The editing state (LanaiEditState: tools, undo, saving) comes on top of this later.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { kindName, SECTION_COLORS } from '../editor/legend';
import { LETTER_DEFAULT, letterIndex, letterLabel, recCellPos } from '../game/sections';
import { romfsHref } from '../romfs/RomfsPage';
import { useSticky } from '../ui/book';
import { MapPickerButton, type MapPickerGroups } from '../ui/MapPicker';
import { useAsync } from '../ui/useAsync';
import { useSignal } from '../ui/useEditorState';
import { hex8, u32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { LANAI_LAYOUTS, LANAI_POINT_SECTIONS, lanaiExitKind, lanaiExitLabel, lanaiFloorLabel, lanaiMaps, lanaiRecFacing, type LanaiMapInfo, type LanaiMaps } from './maps';
import { LanaiMapView } from './mapview';
import type { LanaiSession } from './session';

/** The link to a map of a content (the stage page's list uses it too). */
export const lanaiMapHref = (content: number, name?: string): string => `#/maps/${content}${name ? `.${encodeURIComponent(name)}` : ''}`;

type Mode = 'split' | '2d' | '3d';

export function LanaiMapPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const m = arg ? /^(\d+)(?:\.(.*))?$/.exec(arg) : null;
  const content = useSticky<number>(m ? Number(m[1]) : undefined, (i) => i < contents.length, () => (contents.length > 1 ? 1 : 0));
  const c = contents[content]!;
  const loaded = useAsync(() => lanaiMaps(session, c), [session, c]);
  return (
    <div className="map-detail">
      {!loaded ? <p className="muted" style={{ padding: 16 }}>マップを読み込み中…</p>
        : loaded instanceof Error ? <ContentPicker contents={contents} content={c} error={loaded.message} />
        : <MapDetail key={c.index} session={session} contents={contents} content={c} maps={loaded} name={m?.[2] ? decodeURIComponent(m[2]) : undefined} />}
    </div>
  );
}

/** Shown while a content has no maps (or they did not load): the content can still be changed. */
function ContentPicker({ contents, content, error }: { contents: LanaiContent[]; content: LanaiContent; error: string }): ReactNode {
  return (
    <div style={{ padding: 16 }}>
      <ContentSelect contents={contents} value={content.index} />
      <div className="error">{error}</div>
    </div>
  );
}

function ContentSelect({ contents, value }: { contents: LanaiContent[]; value: number }): ReactNode {
  return (
    <select value={value} title="コンテンツ (ステージ)" onChange={(e) => { location.hash = lanaiMapHref(Number(e.target.value)); }}>
      {contents.map((c) => <option key={c.index} value={c.index}>{`${c.index}: ${contentTitle(c)}`}</option>)}
    </select>
  );
}

/** The maps by MapGroup for the map picker. */
function mapGroups(maps: LanaiMaps): MapPickerGroups {
  const out = new Map<number, { hash: number; title: string; code: string }[]>();
  for (const m of maps.maps) {
    const title = m.world ? 'ワールドマップ (表示のみ)' : `${lanaiFloorLabel(m.floor) || '地上'}・${maps.doc(m).tiles.length} マス`;
    out.set(m.dungeon, [...(out.get(m.dungeon) ?? []), { hash: m.hash, title, code: m.name }]);
  }
  return [...out].sort(([a], [b]) => a - b).map(([g, rows]): [string, typeof rows] => [`${maps.groupName(g) || `MapGroup ${g}`}  (MapGroup ${g})`, rows]);
}

function MapDetail({ session, contents, content, maps, name }: {
  session: LanaiSession;
  contents: LanaiContent[];
  content: LanaiContent;
  maps: LanaiMaps;
  name: string | undefined;
}): ReactNode {
  const first = useMemo(() => maps.maps.find((m) => !m.world && m.hash === maps.groups[1]?.firstMap) ?? maps.maps.find((m) => !m.world) ?? maps.maps[0]!, [maps]);
  const picked = useSticky<string>(name, (n) => !!maps.mapByName(n), () => first.name);
  const info = maps.mapByName(picked)!;
  const groups = useMemo(() => mapGroups(maps), [maps]);
  const [mode, setMode] = useState<Mode>('split');
  const [view, setView] = useState<LanaiMapView | null>(null);
  const pane2d = useRef<HTMLDivElement>(null);
  const pane3d = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (info.world) return;
    const v = new LanaiMapView(maps, info);
    pane2d.current!.append(v.grid.canvas);
    pane3d.current!.append(v.scene.canvas);
    setView(v);
    requestAnimationFrame(() => v.fit());
    return () => {
      v.grid.canvas.remove();
      v.scene.canvas.remove();
      v.dispose();
      setView(null);
    };
  }, [maps, info]);
  useEffect(() => {
    requestAnimationFrame(() => view?.refresh());
  }, [view, mode]);
  return (
    <div className="oahu-map" data-mode={mode}>
      <header>
        <ContentSelect contents={contents} value={content.index} />
        <MapPickerButton groups={groups} value={info.hash} className="map-select"
          label={`${maps.groupName(info.dungeon) || `MapGroup ${info.dungeon}`}・${lanaiFloorLabel(info.floor) || '地上'}  ${info.name}`}
          onChange={(h) => { const m = maps.map(h); if (m) location.hash = lanaiMapHref(content.index, m.name); }} />
        <span className="muted small">{`マップ表の行 ${info.index}・${hex8(info.hash).toUpperCase()}`}</span>
        <a className="mono muted small" href={romfsHref(content.archive)} title="RomFS ビューでアーカイブを開く">{content.archive}</a>
        <span className="grow" />
        {!info.world && (
          <span className="seg">
            {(['2d', 'split', '3d'] as const).map((m) => <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>{m === 'split' ? '両方' : m.toUpperCase()}</button>)}
          </span>
        )}
        {view && <button onClick={() => view.fit()}>全体を表示</button>}
        {view && <button onClick={() => view.scene.topView()}>真上から</button>}
      </header>
      {info.world ? (
        <p className="book-desc" style={{ padding: 16 }}>ワールドマップ (W01) の区画は別の形 (naauao lanai/map.md §13) なので、まだ表示できません。</p>
      ) : (
        <>
          <aside className="left">{view && <Layers view={view} />}</aside>
          <div className="views">
            <div className="pane pane2d" ref={pane2d} />
            <div className="pane pane3d" ref={pane3d} />
          </div>
          <aside className="right">{view && <Facts maps={maps} info={info} view={view} />}</aside>
          <div className="status">{view ? <Status view={view} /> : null}</div>
        </>
      )}
    </div>
  );
}

function Status({ view }: { view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  const parts: string[] = [];
  if (view.hover) parts.push(`セル (${view.hover[0]}, ${view.hover[1]})`);
  if (view.status) parts.push(view.status);
  else parts.push('クリック: タイル・レコードを選ぶ / 右ドラッグ: 2D は移動、3D は回転 / 中ドラッグ: 3D の移動 / ホイール: 拡大');
  return <>{parts.join('   ')}</>;
}

/** What the views show. */
function Layers({ view }: { view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  const { layers, doc } = view;
  const box = (label: string, checked: boolean, set: (v: boolean) => void, color?: string): ReactNode => (
    <label key={label} className="layer">
      <input type="checkbox" checked={checked} onChange={(e) => { set(e.target.checked); view.refresh(); }} />
      {color && <span style={{ color }}>● </span>}
      {label}
    </label>
  );
  return (
    <div className="layers">
      <h3>表示</h3>
      {box(`タイル ${doc.tiles.length}`, layers.tiles, (v) => (layers.tiles = v))}
      {box(`区画 6 のセル ${doc.cells6.length}`, layers.room, (v) => (layers.room = v), 'rgba(80,200,255,0.8)')}
      {LANAI_POINT_SECTIONS.map((k) => box(`${LANAI_LAYOUTS[k]!.label} ${doc.recs[k]?.length ?? 0}`, !!layers.sections[k], (v) => (layers.sections[k] = v), SECTION_COLORS[k]))}
    </div>
  );
}

/** The map's facts, then the selected tile or record. */
function Facts({ maps, info, view }: { maps: LanaiMaps; info: LanaiMapInfo; view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  const src = view.source;
  const group = maps.group(info);
  return (
    <>
      <h3>マップ</h3>
      <p className="small">
        {`MapGroup ${info.dungeon}${maps.groupName(info.dungeon) ? ` 「${maps.groupName(info.dungeon)}」` : ''}`}
        <br />{`階 ${info.floor}・敵の出方 ${info.encounterLevel}`}
        <br />{src.mapData < 0 ? 'MapData が見つかりません' : `MapData 行 ${src.mapData}・タイルセット ${src.tileset} (${src.partsName || 'MapParts なし'})・MapResource 行 ${src.resource}`}
        {group && <><br />{`最初のマップ ${hex8(group.firstMap).toUpperCase()}`}</>}
      </p>
      <Selected maps={maps} view={view} />
    </>
  );
}

function Selected({ maps, view }: { maps: LanaiMaps; view: LanaiMapView }): ReactNode {
  const sel = view.selection;
  const doc = view.doc;
  if (sel.type === 'tile') {
    const t = doc.tiles.findLast((x) => x.x === sel.x && x.y === sel.y);
    if (!t) return null;
    const ref = view.modelOf(t.kind, t.letter);
    return (
      <>
        <h3>{`タイル (${t.x}, ${t.y})`}</h3>
        <p className="small">
          {`種類 ${t.kind} ${kindName(t.kind)}`}
          <br />{`向き ${t.rot} (${t.rot * 90}°)・文字 ${t.letter === LETTER_DEFAULT ? 'なし (z)' : letterLabel(t.letter) || `0x${t.letter.toString(16)}`}`}
          <br />{ref ? `モデル ${hex8(ref.entry).toUpperCase()} (${hex8(ref.archive).toUpperCase()})` : 'モデルなし'}
          {letterIndex(t.letter) > 0 && !ref && ' (この文字のモデルがない)'}
        </p>
        {doc.cells6.some((c) => c.x === t.x && c.y === t.y) && <p className="muted small">区画 6 のセル (敵の出る範囲)</p>}
      </>
    );
  }
  if (sel.type === 'rec') {
    const rec = doc.recs[sel.section]?.[sel.index];
    if (!rec) return null;
    const L = LANAI_LAYOUTS[sel.section]!;
    const [cx, cy] = recCellPos(rec, L);
    const ev = [3, 4, 5, 8].includes(sel.section) ? u32(rec.raw, 4) : 0;
    return (
      <>
        <h3>{`${L.label} #${sel.index}`}</h3>
        <p className="small">
          {`座標 (${rec.x}, ${rec.y}) = セル (${cx.toFixed(2)}, ${cy.toFixed(2)})`}
          {sel.section === 3 && <><br />{lanaiExitLabel(lanaiExitKind(rec.raw))}</>}
          {[2, 3, 4, 5].includes(sel.section) && <><br />{`向き ${lanaiRecFacing(sel.section, rec.raw)}`}</>}
          {ev > 0 && <><br />{`EventObject の行 ${ev}`}</>}
        </p>
        <details open>
          <summary className="small">{`レコードのバイト (${rec.raw.length})`}</summary>
          <code className="small mono" style={{ wordBreak: 'break-all' }}>{[...rec.raw].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</code>
        </details>
        {ev > 0 && <p className="muted small">EventObject の欄は未解析です (naauao lanai/map.md §13)。</p>}
      </>
    );
  }
  return <p className="muted small">タイルかレコードをクリックしてください。</p>;
}
