// The maps of 電波人間のRPG FREE! (#/maps/<content>.<name>; naauao lanai/map.md), the same page as RPG3's map page
// (oahu/MapPage.tsx) on the shared parts: the frame, header controls, layers, checks and status bar
// (editor/mappage.tsx), the editing model and tools (editor/model.ts, editor/controller.ts; lanai: mapedit.ts
// LanaiEditState), the views (mapview.ts), the tool buttons and palette (editor/panes.tsx, editor/palette.tsx) and the
// map picker (ui/MapPicker.tsx; the maps of every stage, grouped by stage and MapGroup).
// Header: the map, view mode and undo. Left: tools, adding records, the tileset's palette and the layers; right: the
// selected tile or record (the map's facts and the stages that use it when nothing is selected), and the checks.
// Every edit goes to the content's map database and is saved with the session's edits (session.ts).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { editorKey } from '../editor/controller';
import { kindName, ROT_ARROW } from '../editor/legend';
import { LayerBox, MapChecks, MapFrame, MapHeaderControls, MapLayers, MapStatus, type MapViewMode } from '../editor/mappage';
import { tileAt } from '../editor/model';
import { Palette } from '../editor/palette';
import { Tools, TOOLS } from '../editor/panes';
import { readField, writeField, type FieldDef } from '../game/tabledef';
import { LANAI_ROT_CODEC, LETTER_DEFAULT, letterIndex, letterLabel, recCellPos, type Rec } from '../game/sections';
import { romfsHref } from '../romfs/RomfsPage';
import { NumberInput, useSticky } from '../ui/book';
import { MapPickerButton, type MapPickerGroups, type MapPickerRow } from '../ui/MapPicker';
import { useAsync } from '../ui/useAsync';
import { Signal, useEditorState, useSignal } from '../ui/useEditorState';
import { hex8, u32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiEditState, lanaiRecEventRow, lanaiRecLabel, lanaiStampLabel, lanaiValidate, type LanaiEditState, type LanaiStamp } from './mapedit';
import { LANAI_FACING_OFFSET, LANAI_LAYOUTS, LANAI_ROT_DIR, LANAI_POINT_SECTIONS, lanaiFloorLabel, lanaiMaps, loadedLanaiMaps, type LanaiMapInfo, type LanaiMaps } from './maps';
import type { LanaiRecordLook } from './mapObjects';
import { LanaiMapView } from './mapview';
import type { LanaiSession } from './session';

/** The link to a map of a content (the stage page's list uses it too). */
export const lanaiMapHref = (content: number, name?: string): string => `#/maps/${content}${name ? `.${encodeURIComponent(name)}` : ''}`;

/** The link to a content's stages (the stage page lists its maps: this is the way back). */
export const lanaiStageHref = (content: number): string => `#/stages/${content}`;

/** The tools of RPG FREE!'s map page: section 6 holds MonsterGroup row IDs here, so its cells are not toggled. */
const LANAI_TOOLS = TOOLS.filter(([t]) => t !== 'room');

const noop = (): void => {};

/** Re-render on every change of the content's maps (edits, reverts, sections put back). */
function useMaps(maps: LanaiMaps | null): number {
  return useSyncExternalStore((f) => (maps ? maps.on(f) : noop), () => maps?.revision ?? 0, () => maps?.revision ?? 0);
}

export function LanaiMapPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const m = arg ? /^(\d+)(?:\.(.*))?$/.exec(arg) : null;
  const content = useSticky<number>(m ? Number(m[1]) : undefined, (i) => i < contents.length, () => (contents.length > 1 ? 1 : 0));
  const c = contents[content]!;
  const loaded = useAsync(() => lanaiMaps(session, c), [session, c]);
  return (
    <div className="map-detail">
      {!loaded ? <p className="muted" style={{ padding: 16 }}>マップを読み込み中…</p>
        : loaded instanceof Error ? <NoMaps session={session} contents={contents} content={c} error={loaded.message} />
        : <MapDetail key={c.index} session={session} contents={contents} content={c} maps={loaded} name={m?.[2] ? decodeURIComponent(m[2]) : undefined} />}
    </div>
  );
}

/** Rows of the map picker are a content and a map table row (map hashes are only unique within a content). */
const pickId = (content: number, row: number): number => content * 0x1000 + row;
/** The row of a content whose maps are not read yet: picking it opens the content's first map. */
const CONTENT_ROW = 0xfff;

/** "甘口のどうくつ" (the MapGroup's name) or "MapGroup 3". */
const groupLabel = (maps: LanaiMaps, g: number): string => maps.groupName(g) || `MapGroup ${g}`;

/**
 * The maps of every stage for the map picker (the same dialog as RPG2's and RPG3's): the maps of the contents read so
 * far by stage and MapGroup, and a row for each other content that opens it.
 */
function useMapGroups(session: LanaiSession, contents: LanaiContent[], current: LanaiMaps | null): MapPickerGroups {
  const revision = useMaps(current);
  return useMemo(() => contents.flatMap((c): MapPickerGroups => {
    const head = `${c.index}: ${contentTitle(c)}`;
    const maps = current?.content.index === c.index ? current : loadedLanaiMaps(session, c.index);
    if (!maps) return [[head, [{ hash: pickId(c.index, CONTENT_ROW), title: 'このステージのマップを開く', code: c.archive }]]];
    const byGroup = new Map<number, MapPickerRow[]>();
    for (const m of maps.maps) {
      const title = m.world ? 'ワールドマップ (表示のみ)' : `${lanaiFloorLabel(m.floor) || '地上'}・${maps.doc(m).tiles.length} マス`;
      byGroup.set(m.dungeon, [...(byGroup.get(m.dungeon) ?? []), { hash: pickId(c.index, m.index), title, code: m.name }]);
    }
    return [...byGroup].sort(([a], [b]) => a - b).map(([g, rows]): [string, MapPickerRow[]] => [`${head} — ${groupLabel(maps, g)}  (MapGroup ${g})`, rows]);
  }), [session, contents, current, revision]);
}

/** The maps with edits, as picker rows. */
function modifiedIds(session: LanaiSession, contents: LanaiContent[]): Set<number> {
  const out = new Set<number>();
  for (const c of contents) {
    const maps = loadedLanaiMaps(session, c.index);
    for (const m of maps?.maps ?? []) if (maps!.isChanged(m)) out.add(pickId(c.index, m.index));
  }
  return out;
}

/** The header's map picker. */
function Picker({ session, contents, maps, content, info }: {
  session: LanaiSession;
  contents: LanaiContent[];
  maps: LanaiMaps | null;
  content: LanaiContent;
  info: LanaiMapInfo | null;
}): ReactNode {
  const groups = useMapGroups(session, contents, maps);
  const label = maps && info ? `${contentTitle(content)} — ${groupLabel(maps, info.dungeon)}・${lanaiFloorLabel(info.floor) || '地上'}  ${info.name}` : `${content.index}: ${contentTitle(content)} (マップなし)`;
  return (
    <MapPickerButton groups={groups} value={pickId(content.index, info ? info.index : CONTENT_ROW)} className="map-select" modified={modifiedIds(session, contents)} label={label}
      onChange={(id) => {
        const c = contents[Math.floor(id / 0x1000)];
        if (!c) return;
        const row = id % 0x1000;
        const m = row === CONTENT_ROW ? undefined : (c.index === content.index ? maps : loadedLanaiMaps(session, c.index))?.maps[row];
        location.hash = lanaiMapHref(c.index, m?.name);
      }} />
  );
}

/** Shown while a content has no maps (or they did not load): another map can still be picked. */
function NoMaps({ session, contents, content, error }: { session: LanaiSession; contents: LanaiContent[]; content: LanaiContent; error: string }): ReactNode {
  const pane = useRef<HTMLDivElement>(null);
  return (
    <MapFrame mode="split" pane2d={pane} pane3d={pane} left={null} right={null} status={null}
      header={<Picker session={session} contents={contents} maps={null} content={content} info={null} />}
      placeholder={
        <div style={{ padding: 16 }}>
          <div className="error">{error}</div>
          <Stages content={content} />
        </div>
      } />
  );
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
  useMaps(maps);
  const st = lanaiEditState(maps);
  useEditorState(st);
  const [mode, setMode] = useState<MapViewMode>('split');
  const [view, setView] = useState<LanaiMapView | null>(null);
  const pane2d = useRef<HTMLDivElement>(null);
  const pane3d = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (info.world) return;
    st.open(info);
    const v = new LanaiMapView(st, info);
    pane2d.current!.append(v.grid.canvas);
    pane3d.current!.append(v.scene.canvas);
    setView(v);
    requestAnimationFrame(() => v.fit());
    const onKey = (e: KeyboardEvent): void => {
      if (!location.hash.startsWith('#/maps') || document.querySelector('dialog[open], .modal')) return;
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey) return; // no section 6 tool here
      if (editorKey(e, v.ctl, () => maps.palette(st.tileset).get(st.brush.kind) ?? [0])) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      v.grid.canvas.remove();
      v.scene.canvas.remove();
      v.dispose();
      setView(null);
    };
  }, [maps, st, info]);
  useEffect(() => {
    requestAnimationFrame(() => view?.refresh());
  }, [view, mode]);
  const open = view && st.current?.hash === info.hash;
  return (
    <MapFrame mode={mode} pane2d={pane2d} pane3d={pane3d}
      header={
        <>
          <Picker session={session} contents={contents} maps={maps} content={content} info={info} />
          <span className="muted small">{`マップ表の行 ${info.index}・${hex8(info.hash).toUpperCase()}`}</span>
          <MapHeaderControls st={st} view={view} open={!!open} mode={mode} setMode={setMode} showModes={!info.world}
            onRevert={maps.isChanged(info) ? () => st.revert() : undefined} />
        </>
      }
      placeholder={info.world ? (
        <div style={{ padding: 16 }}>
          <p className="book-desc">ワールドマップ (W01) の区画は別の形 (naauao lanai/map.md §13) なので、まだ表示・編集できません。</p>
          <Facts maps={maps} info={info} view={null} />
          <Stages content={content} />
        </div>
      ) : undefined}
      left={open && (
        <>
          <Tools st={st} tools={LANAI_TOOLS} />
          <AddPanel st={st} view={view} />
          <TilePalette st={st} view={view} />
          <MapLayers st={st} view={view} sections={LANAI_POINT_SECTIONS} layouts={LANAI_LAYOUTS}>
            <LayerBox view={view} label="モデル (置物・宝箱・キャラ)" checked={view.showModels} set={(v) => (view.showModels = v)} />
          </MapLayers>
        </>
      )}
      right={open && (
        <>
          <Inspector st={st} view={view} content={content} />
          <h3>検証</h3>
          <MapChecks st={st} hash={info.hash} validate={(doc) => lanaiValidate(maps, info, doc)} />
        </>
      )}
      status={view ? <MapStatus st={st} view={view} /> : null} />
  );
}

/** The stages (MapStageIntegration rows) of the map's content, with links back to the stage page. */
function Stages({ content }: { content: LanaiContent }): ReactNode {
  return (
    <>
      <h3>このマップを使うステージ</h3>
      {!content.stages.length ? (
        <p className="muted small">
          {'このコンテンツを指すステージの行はありません ('}
          <a href={lanaiStageHref(content.index)}>{`コンテンツ ${content.index}: ${contentTitle(content)}`}</a>
          {')。'}
        </p>
      ) : (
        <ul className="small">
          {content.stages.map((s) => (
            <li key={s.row}>
              <a href={lanaiStageHref(content.index)}>{s.name || `ステージの行 ${s.row}`}</a>
              {s.mission && <span className="muted">{` ${s.mission}`}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        {`マップはコンテンツ ${content.index} (`}
        <a className="mono" href={romfsHref(content.archive)} title="RomFS ビューでアーカイブを開く">{content.archive}</a>
        {') のマップ表にあり、そのステージで使われます。'}
      </p>
    </>
  );
}

/** The tileset's tile kinds (MapParts<name>: kind + 1 -> 8 letters) with thumbnails of their models. */
function TilePalette({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  useEditorState(st);
  const palette = useMemo(() => st.maps.palette(st.tileset), [st.maps, st.tileset]);
  return <Palette st={st} factory={view.factory} palette={palette} partModel={(k, l) => st.maps.partModel(st.tileset, k, l)} rotDir={LANAI_ROT_DIR} />;
}

const NO_SIGNAL = new Signal();

/** One map with the same name in another content. */
interface SameNameHit {
  content: LanaiContent;
  info: LanaiMapInfo;
}

/**
 * The maps of the other contents with this map's name (a map's name is only unique within its content, and a stage
 * can reuse another's). Reading every content's maps takes a while, so it waits for the button.
 */
function SameName({ maps, info }: { maps: LanaiMaps; info: LanaiMapInfo }): ReactNode {
  const { session, content } = maps;
  const [hits, setHits] = useState<SameNameHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setHits(null), [content.index, info.name]);
  const search = async (): Promise<void> => {
    setBusy(true);
    const found: SameNameHit[] = [];
    for (const c of lanaiContents(session)) {
      if (c.index === content.index) continue;
      const other = await lanaiMaps(session, c).catch(() => null);
      const m = other?.mapByName(info.name);
      if (m) found.push({ content: c, info: m });
    }
    setHits(found);
    setBusy(false);
  };
  return (
    <>
      <h4>同じマップ名の別ステージ</h4>
      {hits === null ? (
        <button disabled={busy} onClick={() => void search()}>{busy ? '探しています…' : `「${info.name}」を他のコンテンツから探す`}</button>
      ) : !hits.length ? <p className="muted small">ほかのコンテンツに同じ名前のマップはありません。</p> : (
        <ul className="small">
          {hits.map((h) => (
            <li key={h.content.index}>
              <a href={lanaiMapHref(h.content.index, h.info.name)}>{`${h.content.index}: ${contentTitle(h.content)}`}</a>
              <span className="muted">{` ${lanaiFloorLabel(h.info.floor) || '地上'}・MapGroup ${h.info.dungeon}`}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The map's facts: group, floor, MapData and tileset (they follow the edits: indoor tiles switch the MapData). */
function Facts({ maps, info, view }: { maps: LanaiMaps; info: LanaiMapInfo; view: LanaiMapView | null }): ReactNode {
  useSignal(view?.signal ?? NO_SIGNAL);
  const src = view?.source;
  const group = maps.group(info);
  const events = maps.eventTable(info.dungeon);
  return (
    <>
      <h3>マップ</h3>
      <p className="small">
        {`MapGroup ${info.dungeon}${maps.groupName(info.dungeon) ? ` 「${maps.groupName(info.dungeon)}」` : ''}`}
        <br />{`階 ${info.floor}・敵の出方 ${info.encounterLevel}`}
        {src && <><br />{src.mapData < 0 ? 'MapData が見つかりません' : `MapData 行 ${src.mapData}・タイルセット ${src.tileset} (${src.partsName || 'MapParts なし'})・MapResource 行 ${src.resource}`}</>}
        {group && <><br />{`最初のマップ ${hex8(group.firstMap).toUpperCase()}`}</>}
        <br />{events ? `EventObject: ${events.name} (${events.rows} 行)` : 'EventObject の表なし'}
      </p>
      <SameName maps={maps} info={info} />
    </>
  );
}

const FACING_LABELS = ['↓ 南 (4)', '← 西 (2)', '↑ 北 (1)', '→ 東 (8)'];

/** Adding records: props (section 2) and copies of the group's records; copying and removing the selected one. */
function AddPanel({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  useEditorState(st);
  const [dir, setDir] = useState(0);
  const props = useMemo(() => st.props(), [st, st.info]);
  const [propRow, setPropRow] = useState(() => props[0] ?? 0);
  const templates = useMemo(() => st.templates(), [st, st.info]);
  const active = st.tool === 'place' && st.stamp ? st.stamp : null;
  const use = (stamp: LanaiStamp): void => {
    st.stamp = stamp;
    st.setTool('place');
  };
  const sel = st.selection;
  return (
    <div className="add-panel">
      <h3>追加</h3>
      <h4>置物 (区画 2)</h4>
      <div className="row">
        <span className="muted small">向き</span>
        {FACING_LABELS.map((l, i) => (
          <button key={i} className={dir === i ? 'active' : ''} title={l} onClick={() => {
            setDir(i);
            if (active?.type === 'prop') use({ ...active, dir: i });
          }}>{l.slice(0, 1)}</button>
        ))}
      </div>
      <div className="row">
        <label className="small">{'MapObject の行 '}<NumberInput value={propRow} min={0} max={0xffff} onCommit={setPropRow} /></label>
        <button className={active?.type === 'prop' && active.row === propRow ? 'active' : ''} onClick={() => use({ type: 'prop', row: propRow, dir })}>置く</button>
      </div>
      <details className="obj-group">
        <summary>{`このコンテンツの置物 (${props.length})`}</summary>
        <div className="pal-items obj-items">
          {props.map((row) => (
            <button key={row} className={'pal-item obj-item' + (active?.type === 'prop' && active.row === row ? ' active' : '')} title={`MapObject #${row}`} onClick={() => { setPropRow(row); use({ type: 'prop', row, dir }); }}>
              <span className="pal-label">{`#${row}`}</span>
            </button>
          ))}
        </div>
      </details>
      <h4>この MapGroup のレコードの写し</h4>
      {([[3, '出入口・扉 (区画 3)'], [4, '宝箱 (区画 4)'], [5, 'キャラ・オブジェクト (区画 5)'], [8, 'イベントの範囲 (区画 8)'], [1, '床のギミック (区画 1)'], [9, '地点 (区画 9)']] as const).map(([k, label]) => {
        const ts = templates.filter((t) => t.section === k);
        if (!ts.length) return null;
        return (
          <details key={k} className="obj-group" open={active?.type === 'template' && active.t.section === k}>
            <summary>{`${label} (${ts.length})`}</summary>
            <div className="template-list">
              {ts.map((t, i) => (
                <button key={i} className={active?.type === 'template' && active.t === t ? 'active' : ''} title={`${t.source} のレコードの写し`} onClick={() => use({ type: 'template', t })}>{t.label}</button>
              ))}
            </div>
          </details>
        );
      })}
      {active && <div className="place-hint">{`置くもの: ${lanaiStampLabel(active)}。マップをクリックして置く (Esc で終わる)`}</div>}
      {sel.type === 'rec' && (
        <div className="row">
          <button title="複製 (Ctrl+D)" onClick={() => view.ctl.duplicateRec()}>選んだレコードを複製</button>
          <button title="削除 (Delete)" onClick={() => view.ctl.deleteSelection()}>削除</button>
        </div>
      )}
      <p className="muted small">
        写したレコードは元と同じ EventObject の行を指します (コンテンツの EventObject の表はまだ編集できません。宝箱の中身や「開けた」状態を共有します)。出入口には新しい地点 ID を付けます。
      </p>
    </div>
  );
}

/** Fields of a section's records besides the position and the facing (map.md §5). */
const REC_FIELDS: Record<number, FieldDef[]> = {
  1: [{ key: 'kind', offset: 0x0d, type: 'u8', label: '種類 (+0x0D)' }],
  2: [{ key: 'row', offset: 0, type: 'u32', label: 'MapObject の行' }],
  3: [{ key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }, { key: 'kind', offset: 0x15, type: 'u8', label: '種類 (5 上り / 6 下り / 100 壁の扉)' }],
  4: [{ key: 'look', offset: 0, type: 'u32', label: '見た目 (0〜3)' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }],
  5: [{ key: 'type', offset: 0, type: 'u32', label: '種類' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }],
  8: [{ key: 'type', offset: 0, type: 'u32', label: '種類 (100 以上 = 置物)' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }, { key: 'shape', offset: 0x1d, type: 'u8', label: '形 (0 円 / 1 矩形)' }],
  9: [{ key: 'type', offset: 0, type: 'u32', label: '種類' }, { key: 'v', offset: 8, type: 'u8', label: '+0x08' }],
};

function Inspector({ st, view, content }: { st: LanaiEditState; view: LanaiMapView; content: LanaiContent }): ReactNode {
  useEditorState(st);
  const sel = st.selection;
  const doc = view.doc;
  if (sel.type === 'rec' && doc.recs[sel.section]?.[sel.index])
    return <RecFields st={st} view={view} section={sel.section} rec={doc.recs[sel.section]![sel.index]!} index={sel.index} />;
  if (sel.type === 'tiles' && sel.cells.length === 1) {
    const [x, y] = sel.cells[0]!;
    if (tileAt(doc, x, y)) return <TileFields st={st} view={view} x={x} y={y} />;
  }
  if (sel.type === 'tiles' && sel.cells.length > 1) return <p className="muted small">{`${sel.cells.length} マスを選択中 (R で回す、[ ] で文字を変える、Delete で消す)`}</p>;
  if (sel.type === 'rect') return <p className="muted small">範囲を選択中 (Ctrl+C でコピー、Ctrl+V で貼り付け、Shift+矢印で中身ごと動かす、Delete で消す)</p>;
  return (
    <>
      <p className="muted small">タイルかレコードを選んでください。</p>
      {st.info && <Facts maps={st.maps} info={st.info} view={view} />}
      <Stages content={content} />
    </>
  );
}

function TileFields({ st, view, x, y }: { st: LanaiEditState; view: LanaiMapView; x: number; y: number }): ReactNode {
  const doc = st.current!;
  const t = tileAt(doc, x, y)!;
  const ref = view.modelOf(t.kind, t.letter);
  const cell6 = doc.cells6.find((c) => c.x === x && c.y === y);
  return (
    <>
      <h3>{`タイル (${t.x}, ${t.y})`}</h3>
      <label className="field"><span>種類</span><NumberInput value={t.kind} min={0} max={65} onCommit={(v) => st.edit(() => { t.kind = v; })} /></label>
      <p className="muted small">{kindName(t.kind)}</p>
      <label className="field"><span>向き</span>
        <select value={t.rot} onChange={(e) => st.edit(() => { t.rot = Number(e.target.value); t.rotHi = 0; })}>
          {[0, 1, 2, 3].map((r) => <option key={r} value={r}>{`${ROT_ARROW[LANAI_ROT_DIR[r]!]} ${r} (バイト ${LANAI_ROT_CODEC.encode(r)})`}</option>)}
        </select>
      </label>
      <label className="field"><span>文字 (部品の差分)</span>
        <select value={t.letter} onChange={(e) => st.edit(() => { t.letter = Number(e.target.value); })}>
          <option value={LETTER_DEFAULT}>なし (z)</option>
          {Array.from({ length: 7 }, (_, i) => 0x61 + i).map((c) => <option key={c} value={c}>{letterLabel(c)}</option>)}
          {t.letter !== LETTER_DEFAULT && !(t.letter >= 0x61 && t.letter <= 0x67) && <option value={t.letter}>{`0x${t.letter.toString(16)}`}</option>}
        </select>
      </label>
      <p className="muted small">
        {ref ? `モデル ${hex8(ref.entry).toUpperCase()} (${hex8(ref.archive).toUpperCase()})` : t.kind === 33 ? 'モデルなし (種類 33 = 空)' : 'モデルなし'}
        {letterIndex(t.letter) > 0 && !ref && ' (この文字のモデルがない)'}
      </p>
      {t.kind + 1 >= 0x10 && t.kind + 1 <= 0x1c && <p className="muted small">屋内の部品 (種類 15〜27): このマップは MapGroup の屋内用の MapData を使います。</p>}
      {cell6 && <p className="muted small">{`区画 6 のセル: MonsterGroup ${cell6.value === 0x80000000 ? '(マップの既定)' : hex8(cell6.value).toUpperCase()}`}</p>}
    </>
  );
}

/** "MapObject #120 obj_box_01" for the model line of the inspector. */
function ModelLine({ view, look }: { view: LanaiMapView; look: LanaiRecordLook | null }): ReactNode {
  useSignal(view.signal);
  if (!look) return null;
  const m = look.model;
  const name = view.modelName(m);
  return <p className="muted small">{`モデル: ${!m ? 'モデルなし' : `MapObject #${m.row}${name ? ` ${name}` : ''}`}`}</p>;
}

function RecFields({ st, view, section, rec, index }: { st: LanaiEditState; view: LanaiMapView; section: number; rec: Rec; index: number }): ReactNode {
  const L = LANAI_LAYOUTS[section]!;
  const [cx, cy] = recCellPos(rec, L);
  const max = L.unit === 'cell' ? 29 : 299;
  const facing = LANAI_FACING_OFFSET[section];
  const ev = lanaiRecEventRow(section, rec.raw);
  const events = st.info ? st.maps.eventTable(st.info.dungeon) : undefined;
  return (
    <>
      <h3>{`${L.label} #${index}`}</h3>
      <p className="muted small">{lanaiRecLabel(section, rec.raw)}</p>
      <ModelLine view={view} look={view.look(section, index)} />
      <div className="row">
        <label className="field"><span>{`x (${L.unit === 'cell' ? 'マス' : '1/5 マス'})`}</span><NumberInput value={rec.x} min={0} max={max} onCommit={(v) => st.edit(() => { rec.x = v; })} /></label>
        <label className="field"><span>y</span><NumberInput value={rec.y} min={0} max={max} onCommit={(v) => st.edit(() => { rec.y = v; })} /></label>
      </div>
      <p className="muted small">{`セル (${cx.toFixed(2)}, ${cy.toFixed(2)})`}</p>
      {section === 3 && <p className="small">{`地点 ID ${hex8(u32(rec.raw, 0)).toUpperCase()}`}</p>}
      {facing !== undefined && st.canRotate(section) && (
        <label className="field"><span>{`向き (+0x${facing.toString(16).toUpperCase()}、R で回す)`}</span>
          <select value={LANAI_ROT_CODEC.decode(rec.raw[facing]!)} onChange={(e) => st.edit(() => { rec.raw[facing] = LANAI_ROT_CODEC.encode(Number(e.target.value)); })}>
            {LANAI_ROT_CODEC.decode(rec.raw[facing]!) < 0 && <option value={-1}>{`バイト ${rec.raw[facing]}`}</option>}
            {FACING_LABELS.map((l, r) => <option key={r} value={r}>{l}</option>)}
          </select>
        </label>
      )}
      {(REC_FIELDS[section] ?? []).map((f) => (
        <label key={f.key} className="field"><span>{f.label}</span>
          <NumberInput value={readField(rec.raw, f)} min={0} max={f.type === 'u8' ? 255 : f.type === 'u16' ? 0xffff : 0x7fffffff} onCommit={(v) => st.edit(() => writeField(rec.raw, f, v))} />
        </label>
      ))}
      {ev > 0 && (
        <p className="muted small">
          {events ? (ev < events.rows ? `EventObject ${events.name} の行 ${ev} (動作の型 ${hex8(events.u32(ev, 0x10)).toUpperCase()})` : `EventObject の行 ${ev} は表 (${events.rows} 行) の外です`) : `EventObject の行 ${ev}`}
          {'。欄の細かい意味は未解析です (naauao lanai/map.md §13)。'}
        </p>
      )}
      <details>
        <summary className="small">{`レコードのバイト (${rec.raw.length})`}</summary>
        <code className="small mono" style={{ wordBreak: 'break-all' }}>{[...rec.raw].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</code>
      </details>
    </>
  );
}
