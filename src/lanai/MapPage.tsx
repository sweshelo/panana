// The maps of 電波人間のRPG FREE! (#/maps/<content>.<name>; naauao lanai/map.md), the same page as RPG3's map page
// (oahu/MapPage.tsx) on the shared parts: the frame, header controls, layers, checks and status bar
// (editor/mappage.tsx), the editing model and tools (editor/model.ts, editor/controller.ts; lanai: mapedit.ts
// LanaiEditState), the views (mapview.ts), the tool buttons and palette (editor/panes.tsx, editor/palette.tsx) and the
// map picker (ui/MapPicker.tsx; the maps of every stage, grouped by stage and MapGroup).
// Header: the map, view mode and undo. Left: tools, adding records, the tileset's palette and the layers; right: the
// selected tile or record (the map's facts and the stages that use it when nothing is selected; a record's
// EventObject row, editable), and the checks. Every edit goes to the content's map database (and the group's
// EventObject table) and is saved with the session's edits (session.ts).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { editorKey } from '../editor/controller';
import { HexInput, RawBytes } from '../editor/fields';
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
import { hex8, u32, w32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiEditState, lanaiRecEventRow, lanaiRecLabel, lanaiStampLabel, lanaiValidate, type LanaiEditState, type LanaiStamp } from './mapedit';
import {
  LANAI_EVENT_ACTIONS,
  LANAI_EVENT_APPEAR,
  LANAI_EVENT_ARGS,
  LANAI_EVENT_DISAPPEAR,
  LANAI_EVENT_SECTIONS,
  LANAI_EVENT_SLOT,
  LANAI_FACING_OFFSET,
  LANAI_LAYOUTS,
  LANAI_POINT_SECTIONS,
  LANAI_ROT_DIR,
  LANAI_SLOT_IS_ROW,
  lanaiEventSlot,
  lanaiFloorLabel,
  lanaiMaps,
  loadedLanaiMaps,
  type LanaiMapInfo,
  type LanaiMaps,
} from './maps';
import { lanaiMonsters } from './monsters';
import { LANAI_CHARA_KIND, type LanaiRecordLook } from './mapObjects';
import { LanaiMapView } from './mapview';
import type { LanaiSession } from './session';

/** The link to a map of a content (the stage page's list uses it too). */
export const lanaiMapHref = (content: number, name?: string): string => `#/maps/${content}${name ? `.${encodeURIComponent(name)}` : ''}`;

/** The link to a content's stages (the stage page lists its maps: this is the way back). */
export const lanaiStageHref = (content: number): string => `#/stages/${content}`;

/** The tools of RPG FREE!'s map page: the section 6 tool adds cells of the MonsterGroup picked in its panel. */
const LANAI_TOOLS = TOOLS.map((t): (typeof TOOLS)[number] => (t[0] === 'room' ? ['room', '敵の群れのセル (区画 6)', t[2]] : t));

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
          <EnemyPanel st={st} />
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
        写したレコードには EventObject の行の写し (表の末尾に足し、空いている状態の枠を付ける) を付けるので、宝箱の中身や「開けた」状態は元と別になります。出入口には新しい地点 ID を付けます。
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
      {cell6 && (
        <label className="field"><span>区画 6 のセル (MonsterGroup)</span>
          <MonsterGroupSelect maps={st.maps} value={cell6.value} onChange={(v) => st.edit(() => { cell6.value = v; })} />
        </label>
      )}
    </>
  );
}

/** "MapObject #64 gimk_05_trebox_1" (and the MapChara row of a character) for the model line of the inspector. */
function ModelLine({ view, look }: { view: LanaiMapView; look: LanaiRecordLook | null }): ReactNode {
  useSignal(view.signal);
  if (!look) return null;
  const m = look.model;
  const name = view.modelName(m);
  const chara = look.chara !== undefined ? view.maps.contentTable('MapChara') : undefined;
  const kind = chara && look.chara! > 0 && look.chara! < chara.rows ? LANAI_CHARA_KIND[chara.u32(look.chara!, 0) & 7] : undefined;
  return (
    <p className="muted small">
      {look.chara !== undefined && `MapChara #${look.chara}${kind ? ` (${kind})` : ''}・`}
      {`モデル: ${!m ? 'モデルなし' : `MapObject #${m.row}${name ? ` ${name}` : ''}`}`}
    </p>
  );
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
      {ev > 0 && (events && ev < events.rows ? <EventFields st={st} section={section} index={index} row={ev} /> : (
        <p className="muted small">{events ? `EventObject の行 ${ev} は表 (${events.rows} 行) の外です` : `EventObject の行 ${ev} (表なし)`}</p>
      ))}
      <details>
        <summary className="small">{`レコードのバイト (${rec.raw.length})`}</summary>
        <code className="small mono" style={{ wordBreak: 'break-all' }}>{[...rec.raw].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</code>
      </details>
    </>
  );
}

/** "#1 80000040: いちごおばけ・おおくちばし" for a MonsterGroup row. */
function monsterGroupLabel(maps: LanaiMaps, row: number): string {
  const g = maps.monsterGroups()[row];
  if (!g) return `行 ${row}`;
  const mp = maps.session.table('MonsterParameter');
  const list = lanaiMonsters(maps.session);
  const names = [...new Set(g.monsters.map((id) => (mp ? list[mp.find(id)]?.name : undefined) ?? hex8(id).toUpperCase()))];
  return `#${row} ${hex8(g.id).toUpperCase()}: ${row === 0 ? '既定 (行 0)' : names.join('・') || '(モンスターなし)'}`;
}

/** A MonsterGroup row ID of the content (section 6 values); a value the table does not have is shown as such. */
function MonsterGroupSelect({ maps, value, onChange }: { maps: LanaiMaps; value: number; onChange: (v: number) => void }): ReactNode {
  const groups = maps.monsterGroups();
  const known = groups.some((g) => g.id === value);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
      {!known && <option value={value}>{`${hex8(value).toUpperCase()} (${maps.monsterGroupRow(value) >= 0 ? `行番号 ${value}` : '表にない: 行 0 になる'})`}</option>}
      {groups.map((g) => <option key={g.row} value={g.id}>{monsterGroupLabel(maps, g.row)}</option>)}
    </select>
  );
}

/**
 * Section 6 (map.md §5.7): the map's group (the header) and the cells where another group comes, by MonsterGroup row
 * ID of the content. The section 6 tool (G) adds cells of the group picked here, or removes them.
 */
function EnemyPanel({ st }: { st: LanaiEditState }): ReactNode {
  useEditorState(st);
  const doc = st.current;
  const maps = st.maps;
  if (!doc || !maps.monsterGroup) return null;
  const groups = maps.monsterGroups();
  if (!groups.some((g) => g.id === st.cell6Value)) st.cell6Value = groups[1]?.id ?? groups[0]?.id ?? 0;
  const header = doc.sec6Header.length >= 8 ? u32(doc.sec6Header, 0) : null;
  const counts = new Map<number, number>();
  for (const c of doc.cells6) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
  return (
    <div className="add-panel">
      <h3>敵 (区画 6)</h3>
      {header === null ? <p className="muted small">このマップには区画 6 がありません (セルを足せません)。</p> : (
        <>
          <label className="field"><span>マップの群れ (ヘッダー)</span>
            <MonsterGroupSelect maps={maps} value={header} onChange={(v) => st.edit((d) => {
              const h = d.sec6Header.slice();
              w32(h, 0, v);
              d.sec6Header = h;
            })} />
          </label>
          <label className="field"><span>足すセルの群れ</span>
            <MonsterGroupSelect maps={maps} value={st.cell6Value} onChange={(v) => {
              st.cell6Value = v;
              st.setTool('room');
            }} />
          </label>
          <p className="muted small">
            {`G (敵の群れのセル) でマスをクリックすると、その群れのセルを足す / 消す。セル ${doc.cells6.length} 個`}
            {[...counts].map(([v, n]) => ` ・ ${hex8(v).toUpperCase()} × ${n}`).join('')}
            {'。群れはこのコンテンツの MonsterGroup の行 ID から選ぶ (表にない値はゲームで行 0 の群れになる)。'}
          </p>
        </>
      )}
    </div>
  );
}

/** Labels of an action's arguments where their meaning is known (map.md §5.1, §5.2). */
const ACTION_ARGS: Record<number, string[]> = {
  0x8000000e: ['TreasureGroup の行'],
  0x80000010: ['TreasureGroup の行'],
  0x80000011: ['行き先のマップ (ハッシュ)', '行き先の地点 ID'],
  0x80000013: ['行き先のマップ (ハッシュ)', '行き先の地点 ID'],
};
const ACTION_STATES = ['状態 0', '状態 1', '状態 2〜3'];

/** How many records of a group's maps name an EventObject row. */
function eventUsers(maps: LanaiMaps, info: LanaiMapInfo, row: number): number {
  let n = 0;
  for (const m of maps.maps)
    if (m.dungeon === info.dungeon && !m.world)
      for (const k of LANAI_EVENT_SECTIONS) for (const r of maps.doc(m).recs[k] ?? []) if (lanaiRecEventRow(k, r.raw) === row) n++;
  return n;
}

/** The EventObject row of a record (map.md §7.1): conditions, the three actions, the state slot; edited in the group's table. */
function EventFields({ st, section, index, row }: { st: LanaiEditState; section: number; index: number; row: number }): ReactNode {
  const info = st.info!;
  const t = st.maps.eventTable(info.dungeon)!;
  const group = st.maps.group(info);
  const users = eventUsers(st.maps, info, row);
  const slot = lanaiEventSlot(t, row);
  const u32f = (o: number, label: string): ReactNode => (
    <label key={o} className="field"><span>{label}</span><HexInput value={t.u32(row, o)} onChange={(v) => st.setEventField(row, (x) => x.setU32(row, o, v >>> 0))} /></label>
  );
  const u8f = (o: number, label: string): ReactNode => (
    <label key={o} className="field"><span>{label}</span><NumberInput value={t.u8(row, o)} min={0} max={255} onCommit={(v) => st.setEventField(row, (x) => x.setU8(row, o, v))} /></label>
  );
  const u16f = (o: number, label: string): ReactNode => (
    <label key={o} className="field"><span>{label}</span><NumberInput value={t.u16(row, o)} min={0} max={0xffff} onCommit={(v) => st.setEventField(row, (x) => x.setU16(row, o, v))} /></label>
  );
  return (
    <>
      <h4>{`EventObject ${t.name} の行 ${row}${row >= t.originalRows ? ' (追加した行)' : ''}`}</h4>
      {users > 1 && (
        <div className="row">
          <span className="muted small">{`この行は ${users} 個のレコードが使っています (状態と動作を共有)。`}</span>
          <button onClick={() => st.separateEventRow(section, index)}>このレコード専用の行にする</button>
        </div>
      )}
      <p className="small">出る条件 (+0x5F の種類、0 = なし)</p>
      {u8f(LANAI_EVENT_APPEAR, '種類')}{u32f(0x00, '値 1 (+0x00)')}{u32f(0x04, '値 2 (+0x04)')}
      <p className="small">消える条件 (+0x60 の種類、0 = なし)</p>
      {u8f(LANAI_EVENT_DISAPPEAR, '種類')}{u32f(0x08, '値 1 (+0x08)')}{u32f(0x0c, '値 2 (+0x0C)')}
      {LANAI_EVENT_ACTIONS.map((o, i) => {
        const type = t.u32(row, o);
        const labels = ACTION_ARGS[type] ?? [];
        return (
          <details key={o} open={i === 0 || (type !== 0 && type !== 0x80000000)}>
            <summary className="small">{`動作 ${i + 1} (${ACTION_STATES[i]}): 型 ${hex8(type).toUpperCase()}`}</summary>
            {u32f(o, `型 (+0x${o.toString(16).toUpperCase()}、0x80000000 = なし)`)}
            {Array.from({ length: LANAI_EVENT_ARGS }, (_, a) => u32f(o + 4 + a * 4, `引数 ${a + 1}${labels[a] ? ` ${labels[a]}` : ''}`))}
          </details>
        );
      })}
      {u16f(LANAI_EVENT_SLOT, `状態の枠 (+0x58、${LANAI_SLOT_IS_ROW} = 行番号)`)}
      <p className="muted small">
        {`使う枠 ${slot}・MapGroup の枠 ${group?.stateCount ?? '?'} 個 (先頭 ${group?.stateFirst ?? '?'})`}
        {group && slot >= group.stateCount ? '。枠の数以上なので状態は保存されません' : ''}
      </p>
      {u16f(0x5a, '+0x5A (範囲の半径・モデルと推定)')}
      {u16f(0x5c, '+0x5C (未解析)')}
      {u8f(0x5e, '+0x5E (未解析)')}
      <details>
        <summary className="small">{`行のバイト (${t.rowSize})`}</summary>
        <RawBytes bytes={t.row(row)} rows={4} onChange={(b) => st.setEventField(row, (x) => x.setRow(row, b))} />
      </details>
    </>
  );
}
