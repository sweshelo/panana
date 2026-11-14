import { RecordPartPanel } from '../editor/recordparts';
import { RecPositionFields } from '../editor/recposition';
import { MapSettings } from '../editor/partpalette';
import { InfoTip } from '../ui/InfoTip';
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
import {
  LayerBox,
  MapChecks,
  MapFrame,
  MapHeaderControls,
  MapLayers,
  MapStatus,
  type MapViewMode,
} from '../editor/mappage';
import { tileAt } from '../editor/model';
import { Palette } from '../editor/palette';
import { MapToolbox, TOOLS } from '../editor/tools';
import { readField, writeField, type FieldDef } from '../game/tabledef';
import { LANAI_ROT_CODEC, LETTER_DEFAULT, letterIndex, letterLabel, type Rec } from '../game/sections';
import { romfsHref } from '../romfs/RomfsPage';
import { NumberInput, useSticky } from '../ui/book';
import { LanaiMapPicker } from './MapPicker';
import { MessageEditor } from '../ui/message';
import { useAsync } from '../ui/useAsync';
import { Signal, useEditorState, useSignal } from '../ui/useEditorState';
import { hex8, u32, w32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { useLanaiContents } from './useContents';
import { EventScriptBinding } from './EventScriptBinding';
import { LookField } from './LookField';
import { LANAI_RANGE_PROP_KIND, lanaiRange } from './rangeShape';
import { lanaiEditState, lanaiRecEventRow, lanaiRecLabel, lanaiValidate, type LanaiEditState } from './mapedit';
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
  type LanaiMapInfo,
  type LanaiMaps,
} from './maps';
import {
  LANAI_ACTION_GOAL_CHEST,
  LANAI_ACTION_NONE,
  LANAI_ACTION_SCRIPT,
  LANAI_ACTION_RUNS,
  LANAI_ACTION_TYPES,
  LANAI_ACTIONS,
  LANAI_DESTINATION_ACTIONS,
  lanaiActionTypesFor,
  lanaiActionName,
  talkMessageOffset,
} from './actions';
import { LanaiMapBattlePanel } from './BattleParts';
import { ContentSelect, MonsterGroupLine, MonsterGroupRowSelect, MonsterGroupSelect, TreasureEditor } from './MapParts';
import { LanaiNamesDialog, LanaiNewGroupDialog, LanaiNewMapDialog } from './MapEditDialogs';
import { lanaiMessageSource } from './MessageSource';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiTable } from './table';
import { LANAI_CHARA_KIND, lanaiCharaKind, lanaiObjectRef, type LanaiRecordLook } from './mapObjects';
import { lanaiMonsters } from './monsters';
import { LanaiMapView } from './mapview';
import type { LanaiSession } from './session';
import { LanaiEventSelect } from './EventSelect';
import { EventConditionFields } from './EventConditionFields';
import { DestinationFields } from './DestinationFields';
import { LanaiTilesetField } from './TilesetField';

/** The link to a map of a content (the stage page's list uses it too), with a record selected (`@section.index`). */
export const lanaiMapHref = (content: number, name?: string, rec?: { section: number; index: number }): string =>
  `#/maps/${content}${name ? `.${encodeURIComponent(name)}` : ''}${name && rec ? `@${rec.section}.${rec.index}` : ''}`;

/** The link to a content's stages (the stage page lists its maps: this is the way back). */
export const lanaiStageHref = (content: number): string => `#/stages/${content}`;

/** The tools of RPG FREE!'s map page: the section 6 tool adds cells of the MonsterGroup picked in its panel. */
const LANAI_TOOLS = TOOLS.map((t): (typeof TOOLS)[number] =>
  t[0] === 'room' ? ['room', '敵の群れのセル (区画 6)', t[2]] : t,
);

const noop = (): void => {};

/** Re-render on every change of the content's maps (edits, reverts, sections put back). */
function useMaps(maps: LanaiMaps | null): number {
  return useSyncExternalStore(
    (f) => (maps ? maps.on(f) : noop),
    () => maps?.revision ?? 0,
    () => maps?.revision ?? 0,
  );
}

export function LanaiMapPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useLanaiContents(session);
  const m = arg ? /^(\d+)(?:\.([^@]*))?(?:@(\d+)\.(\d+))?$/.exec(arg) : null;
  const content = useSticky<number>(
    m ? Number(m[1]) : undefined,
    (i) => i < contents.length,
    () => (contents.length > 1 ? 1 : 0),
  );
  const c = contents[content]!;
  const loaded = useAsync(() => lanaiMaps(session, c), [session, c]);
  return (
    <div className="map-detail">
      {!loaded ? (
        <p className="muted" style={{ padding: 16 }}>
          マップを読み込み中…
        </p>
      ) : loaded instanceof Error ? (
        <NoMaps session={session} content={c} error={loaded.message} />
      ) : (
        <MapDetail
          key={c.index}
          session={session}

          content={c}
          maps={loaded}
          name={m?.[2] ? decodeURIComponent(m[2]) : undefined}
          rec={m?.[3] ? { section: Number(m[3]), index: Number(m[4]) } : undefined}
        />
      )}
    </div>
  );
}

/** The MapGroup name shown alongside the current map. */
const groupLabel = (maps: LanaiMaps, group: number): string => maps.groupName(group) || 'MapGroup ' + group;

/** The header's map picker. */
function Picker({
  session,
  maps,
  content,
  info,
}: {
  session: LanaiSession;
  maps: LanaiMaps | null;
  content: LanaiContent;
  info: LanaiMapInfo | null;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  const label =
    maps && info
      ? `${contentTitle(content)} — ${groupLabel(maps, info.dungeon)}・${lanaiFloorLabel(info.floor) || '地上'}  ${info.name}`
      : `${content.index}: ${contentTitle(content)} (マップなし)`;
  return (
    <>
      <button className="map-select" onClick={() => setPicking(true)}>
        {label}
      </button>
      {picking && (
        <LanaiMapPicker
          session={session}
          currentContent={content.index}
          currentMap={info?.name}
          onPick={(index, name) => {
            location.hash = lanaiMapHref(index, name);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** Shown while a content has no maps (or they did not load): another map can still be picked. */
function NoMaps({
  session,
  content,
  error,
}: {
  session: LanaiSession;
  content: LanaiContent;
  error: string;
}): ReactNode {
  const pane = useRef<HTMLDivElement>(null);
  return (
    <MapFrame
      mode="split"
      pane2d={pane}
      pane3d={pane}
      left={null}
      right={null}
      status={null}
      header={<Picker session={session} maps={null} content={content} info={null} />}
      placeholder={
        <div style={{ padding: 16 }}>
          <div className="error">{error}</div>
          <Stages content={content} />
        </div>
      }
    />
  );
}

function MapDetail({
  session,
  content,
  maps,
  name,
  rec,
}: {
  session: LanaiSession;
  content: LanaiContent;
  maps: LanaiMaps;
  name: string | undefined;
  /** A record to select (a link from the shop page). */
  rec?: { section: number; index: number };
}): ReactNode {
  // not memoized: maps can be added and taken out (mapadd.ts)
  const first =
    maps.maps.find((m) => !m.world && m.hash === maps.groups[1]?.firstMap) ??
    maps.maps.find((m) => !m.world) ??
    maps.maps[0]!;
  const picked = useSticky<string>(
    name,
    (n) => !!maps.mapByName(n),
    () => first.name,
  );
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
  // the record a link names (after the map was opened above)
  useEffect(() => {
    if (view && rec && st.current?.hash === info.hash && st.current.recs[rec.section]?.[rec.index])
      st.select({ type: 'rec', section: rec.section, index: rec.index });
  }, [view, st, info, rec?.section, rec?.index]);
  const open = view && st.current?.hash === info.hash;
  const [dialog, setDialog] = useState<'map' | 'group' | 'names' | null>(null);
  const goto = (n: string): void => {
    setDialog(null);
    location.hash = lanaiMapHref(content.index, n);
  };
  return (
    <MapFrame
      mode={mode}
      pane2d={pane2d}
      pane3d={pane3d}
      header={
        <>
          <Picker session={session} maps={maps} content={content} info={info} />
          <span className="muted small">{`マップ番号 ${info.index}・${hex8(info.hash).toUpperCase()}${info.added ? '・追加したマップ' : ''}`}</span>
          <button
            title="このステージのダンジョンに新しいマップ (階) を足す、またはマップを複製する"
            onClick={() => setDialog('map')}
          >
            ＋ マップを追加・複製
          </button>
          <button
            title="今開いているステージ内に新しいダンジョンを作るか、マップごと複製する"
            onClick={() => setDialog('group')}
          >
            ＋ このステージにダンジョンを追加
          </button>
          <button
            title="マップのコード、ダンジョンの名前・コードを変える (追加したものは消せる)"
            onClick={() => setDialog('names')}
          >
            名前・コード…
          </button>
          <MapHeaderControls
            st={st}
            view={view}
            open={!!open}
            mode={mode}
            setMode={setMode}
            showModes={!info.world}
            onRevert={maps.isChanged(info) ? () => st.revert() : undefined}
          />
          {dialog === 'map' && (
            <LanaiNewMapDialog
              maps={maps}
              current={info}
              onClose={() => setDialog(null)}
              onCreated={(m) => goto(m.name)}
            />
          )}
          {dialog === 'group' && (
            <LanaiNewGroupDialog
              maps={maps}
              current={info}
              onClose={() => setDialog(null)}
              onCreated={(m) => goto(m.name)}
            />
          )}
          {dialog === 'names' && (
            <LanaiNamesDialog
              maps={maps}
              current={info}
              onClose={() => setDialog(null)}
              onRenamed={(n) => {
                location.hash = lanaiMapHref(content.index, n);
              }}
              onRemoved={() => goto((maps.maps.find((m) => !m.world) ?? maps.maps[0]!).name)}
            />
          )}
        </>
      }
      placeholder={
        info.world ? (
          <div style={{ padding: 16 }}>
            <p className="book-desc">
              ワールドマップの区画は別の形なので、ワールドマップのページで編集します。{' '}
              <a href={`#/world/${content.index}.${info.name}`}>{`${info.name} をワールドマップのページで開く`}</a>
            </p>
            <Facts maps={maps} info={info} view={null} />
            <Stages content={content} />
          </div>
        ) : undefined
      }
      left={
        open && (
          <>
            <MapToolbox
              st={st}
              tileTools={LANAI_TOOLS}
              tiles={st.tool === 'room' ? <EnemyPanel st={st} /> : <TilePalette st={st} view={view} />}
              parts={<AddPanel st={st} view={view} />}
              onDelete={() => view.ctl.deleteSelection()}
              onDuplicate={() => view.ctl.duplicateRec()}
            />
            {st.tool !== 'room' && (
              <MapSettings title="敵の設定">
                <EnemyPanel st={st} />
              </MapSettings>
            )}
            <MapSettings title="音・戦闘背景">
              <BattlePanel st={st} />
            </MapSettings>
            <MapSettings>
              <MapLayers st={st} view={view} sections={LANAI_POINT_SECTIONS} layouts={LANAI_LAYOUTS}>
                <LayerBox
                  view={view}
                  label="モデル (置物・宝箱・キャラ)"
                  checked={view.showModels}
                  set={(v) => (view.showModels = v)}
                />
              </MapLayers>
            </MapSettings>
          </>
        )
      }
      right={
        open && (
          <>
            <Inspector st={st} view={view} content={content} />
            <h3>検証</h3>
            <MapChecks st={st} hash={info.hash} validate={(doc) => lanaiValidate(maps, info, doc)} />
          </>
        )
      }
      status={view ? <MapStatus st={st} view={view} /> : null}
    />
  );
}

/** The stages (MapStageIntegration rows) of the map's content, with links back to the stage page. */
function Stages({ content }: { content: LanaiContent }): ReactNode {
  return (
    <>
      <h3>このマップを使うステージ</h3>
      {!content.stages.length ? (
        <p className="muted small">
          {'このコンテンツを指すステージはありません ('}
          <a href={lanaiStageHref(content.index)}>{`コンテンツ ${content.index}: ${contentTitle(content)}`}</a>
          {')。'}
        </p>
      ) : (
        <ul className="small">
          {content.stages.map((s) => (
            <li key={s.row}>
              <a href={lanaiStageHref(content.index)}>{s.name || `ステージ ${s.row}`}</a>
              {s.mission && <span className="muted">{` ${s.mission}`}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        {`マップはコンテンツ ${content.index} (`}
        <a className="mono" href={romfsHref(content.archive)} title="RomFS ビューでアーカイブを開く">
          {content.archive}
        </a>
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
  return (
    <Palette
      st={st}
      factory={view.factory}
      palette={palette}
      partModel={(k, l) => st.maps.partModel(st.tileset, k, l)}
      rotDir={LANAI_ROT_DIR}
    />
  );
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
        <button disabled={busy} onClick={() => void search()}>
          {busy ? '探しています…' : `「${info.name}」を他のコンテンツから探す`}
        </button>
      ) : !hits.length ? (
        <p className="muted small">ほかのコンテンツに同じ名前のマップはありません。</p>
      ) : (
        <ul className="small">
          {hits.map((h) => (
            <li key={h.content.index}>
              <a
                href={lanaiMapHref(h.content.index, h.info.name)}
              >{`${h.content.index}: ${contentTitle(h.content)}`}</a>
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
        <br />
        {`階 ${info.floor}・敵の出方 ${info.encounterLevel}`}
        {src && (
          <>
            <br />
            {src.mapData < 0
              ? 'MapData が見つかりません'
              : `MapData #${src.mapData}・タイルセット ${src.tileset} (${src.partsName || 'MapParts なし'})・MapResource #${src.resource}`}
          </>
        )}
        {group && (
          <>
            <br />
            {`最初のマップ ${hex8(group.firstMap).toUpperCase()}`}
          </>
        )}
        <br />
        {events ? `EventObject: ${events.name} (${events.rows} 件)` : 'EventObject の表なし'}
      </p>
      <SameName maps={maps} info={info} />
    </>
  );
}

const FACING_LABELS = ['↓ 南 (4)', '← 西 (2)', '↑ 北 (1)', '→ 東 (8)'];

/** Adding records: props (section 2) and copies of the group's records; copying and removing the selected one. */
function AddPanel({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  const revision = useMaps(st.maps);
  const templates = useMemo(() => st.templates(), [st, st.info, revision]);
  const props = useMemo(() => st.props(), [st, st.info, revision]);
  const objects = st.maps.session.table('MapObject');
  const all = useMemo(
    () => Array.from({ length: objects?.rows ?? 0 }, (_, i) => i).filter((row) => !!lanaiObjectRef(objects, row)),
    [objects],
  );
  return (
    <RecordPartPanel
      st={st}
      source={view}
      templates={templates}
      rows={all}
      usedRows={props}
      maxRow={0xffff}
      validRow={(row) => !!lanaiObjectRef(objects, row)}
      directions={FACING_LABELS}
      modelForProp={(row) => ({ type: 'object' as const, row })}
      modelForTemplate={(t) => (t.event ? (t.model ?? null) : (view.partLook(t.section, t.raw)?.model ?? null))}
      help="マップをクリックして配置、Esc で選択に戻ります。「イベント (新しく置く)」は起きかた (踏む・話しかける・範囲に入る・扉) で選び、新しいイベント付きで置きます。見た目は置いてからインスペクタで全モデル・任意の NPC・モンスターから選べます。レコードの写しには独立したイベントと状態を付けます。出入口には新しい地点 ID を付けます。"
    />
  );
}

/** Fields of a section's records besides the position and the facing (map.md §5). */
const REC_FIELDS: Record<number, FieldDef[]> = {
  1: [{ key: 'kind', offset: 0x0d, type: 'u8', label: '種類 (+0x0D)' }],
  2: [{ key: 'row', offset: 0, type: 'u32', label: 'MapObject 番号' }],
  3: [
    { key: 'ev', offset: 4, type: 'u32', label: 'イベント番号' },
    { key: 'kind', offset: 0x15, type: 'u8', label: '種類 (5 上り / 6 下り / 100 壁の扉)' },
  ],
  4: [
    { key: 'look', offset: 0, type: 'u32', label: '見た目 (0〜3)' },
    { key: 'ev', offset: 4, type: 'u32', label: 'イベント番号' },
  ],
  5: [
    { key: 'type', offset: 0, type: 'u32', label: '種類' },
    { key: 'ev', offset: 4, type: 'u32', label: 'イベント番号' },
  ],
  8: [
    { key: 'type', offset: 0, type: 'u32', label: '種類 (0 円・1 / 2 矩形、100 以上 = 置物)' },
    { key: 'ev', offset: 4, type: 'u32', label: 'イベント番号' },
  ],
  9: [
    { key: 'type', offset: 0, type: 'u32', label: '種類' },
    { key: 'v', offset: 8, type: 'u8', label: '+0x08' },
  ],
};

function Inspector({
  st,
  view,
  content,
}: {
  st: LanaiEditState;
  view: LanaiMapView;
  content: LanaiContent;
}): ReactNode {
  useEditorState(st);
  const sel = st.selection;
  const doc = view.doc;
  if (sel.type === 'rec' && doc.recs[sel.section]?.[sel.index])
    return (
      <RecFields st={st} view={view} section={sel.section} rec={doc.recs[sel.section]![sel.index]!} index={sel.index} />
    );
  if (sel.type === 'tiles' && sel.cells.length === 1) {
    const [x, y] = sel.cells[0]!;
    if (tileAt(doc, x, y)) return <TileFields st={st} view={view} x={x} y={y} />;
  }
  if (sel.type === 'tiles' && sel.cells.length > 1)
    return (
      <p className="muted small">{`${sel.cells.length} マスを選択中 (R で回す、[ ] で文字を変える、Delete で消す)`}</p>
    );
  if (sel.type === 'rect')
    return (
      <p className="muted small">
        範囲を選択中 (Ctrl+C でコピー、Ctrl+V で貼り付け、Shift+矢印で中身ごと動かす、Delete で消す)
      </p>
    );
  return (
    <>
      <p className="muted small">タイルかレコードを選んでください。</p>
      {st.info && <Facts maps={st.maps} info={st.info} view={view} />}
      {st.info && <LanaiTilesetField maps={st.maps} info={st.info} />}
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
      <label className="field">
        <span>種類</span>
        <NumberInput
          value={t.kind}
          min={0}
          max={65}
          onCommit={(v) =>
            st.edit(() => {
              t.kind = v;
            })
          }
        />
      </label>
      <p className="muted small">{kindName(t.kind)}</p>
      <label className="field">
        <span>向き</span>
        <select
          value={t.rot}
          onChange={(e) =>
            st.edit(() => {
              t.rot = Number(e.target.value);
              t.rotHi = 0;
            })
          }
        >
          {[0, 1, 2, 3].map((r) => (
            <option
              key={r}
              value={r}
            >{`${ROT_ARROW[LANAI_ROT_DIR[r]!]} ${r} (バイト ${LANAI_ROT_CODEC.encode(r)})`}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>文字 (部品の差分)</span>
        <select
          value={t.letter}
          onChange={(e) =>
            st.edit(() => {
              t.letter = Number(e.target.value);
            })
          }
        >
          <option value={LETTER_DEFAULT}>なし (z)</option>
          {Array.from({ length: 7 }, (_, i) => 0x61 + i).map((c) => (
            <option key={c} value={c}>
              {letterLabel(c)}
            </option>
          ))}
          {t.letter !== LETTER_DEFAULT && !(t.letter >= 0x61 && t.letter <= 0x67) && (
            <option value={t.letter}>{`0x${t.letter.toString(16)}`}</option>
          )}
        </select>
      </label>
      <p className="muted small">
        {ref
          ? `モデル ${hex8(ref.entry).toUpperCase()} (${hex8(ref.archive).toUpperCase()})`
          : t.kind === 33
            ? 'モデルなし (種類 33 = 空)'
            : 'モデルなし'}
        {letterIndex(t.letter) > 0 && !ref && ' (この文字のモデルがない)'}
      </p>
      {t.kind + 1 >= 0x10 && t.kind + 1 <= 0x1c && (
        <p className="muted small">屋内の部品 (種類 15〜27): このマップは MapGroup の屋内用の MapData を使います。</p>
      )}
      {cell6 && (
        <label className="field">
          <span>区画 6 のセル (MonsterGroup)</span>
          <MonsterGroupSelect
            maps={st.maps}
            value={cell6.value}
            onChange={(v) =>
              st.edit(() => {
                cell6.value = v;
              })
            }
          />
        </label>
      )}
    </>
  );
}

/** "MapObject #64 gimk_05_trebox_1" / "MonsterDesign #193 (まおう)" / "エフェクト …" (and the MapChara row of a character) for the model line of the inspector. */
function ModelLine({ view, look }: { view: LanaiMapView; look: LanaiRecordLook | null }): ReactNode {
  useSignal(view.signal);
  if (!look) return null;
  const m = look.model;
  const name = view.modelName(m);
  const kind =
    look.chara !== undefined
      ? LANAI_CHARA_KIND[lanaiCharaKind(view.maps.contentTable('MapChara'), look.chara)]
      : undefined;
  const what = !m
    ? 'モデルなし'
    : m.type === 'object'
      ? `MapObject #${m.row}${name ? ` ${name}` : ''}`
      : m.type === 'monster'
        ? `MonsterDesign #${m.design}${designNames(view.maps.session, m.design)}${name ? ` ${name}` : ''}`
        : `なし (エフェクト EffectData #0x${m.row.toString(16).toUpperCase()}${name ? ` ${name}` : ''} を置く)`;
  return (
    <p className="muted small">
      {look.chara !== undefined && `MapChara #${look.chara}${kind ? ` (${kind})` : ''}・`}
      {`モデル: ${what}`}
    </p>
  );
}

/** " (まおう・…)": the monsters that look like a MonsterDesign row, '' when none does. */
function designNames(session: LanaiSession, design: number): string {
  const names = [
    ...new Set(
      lanaiMonsters(session)
        .filter((x) => x.designRow === design && x.name)
        .map((x) => x.name),
    ),
  ];
  return names.length ? ` (${names.slice(0, 3).join('・')}${names.length > 3 ? ' …' : ''})` : '';
}

function RecFields({
  st,
  view,
  section,
  rec,
  index,
}: {
  st: LanaiEditState;
  view: LanaiMapView;
  section: number;
  rec: Rec;
  index: number;
}): ReactNode {
  const L = LANAI_LAYOUTS[section]!;
  const facing = LANAI_FACING_OFFSET[section];
  const hasEvent =
    LANAI_EVENT_SECTIONS.includes(section as 3 | 4 | 5 | 8) && !(section === 8 && u32(rec.raw, 0) >= 100);
  const ev = hasEvent ? lanaiRecEventRow(section, rec.raw) : 0;
  const events = st.info ? st.maps.eventTable(st.info.dungeon) : undefined;
  return (
    <>
      <h3>{`${L.label} #${index}`}</h3>
      <p className="muted small">{lanaiRecLabel(section, rec.raw)}</p>
      <ModelLine view={view} look={view.look(section, index)} />
      <RecPositionFields st={st} rec={rec} L={L} />
      {section === 3 && <p className="small">{`地点 ID ${hex8(u32(rec.raw, 0)).toUpperCase()}`}</p>}
      {facing !== undefined && st.canRotate(section) && (
        <label className="field">
          <span>{`向き (+0x${facing.toString(16).toUpperCase()}、R で回す)`}</span>
          <select
            value={LANAI_ROT_CODEC.decode(rec.raw[facing]!)}
            onChange={(e) =>
              st.edit(() => {
                rec.raw[facing] = LANAI_ROT_CODEC.encode(Number(e.target.value));
              })
            }
          >
            {LANAI_ROT_CODEC.decode(rec.raw[facing]!) < 0 && <option value={-1}>{`バイト ${rec.raw[facing]}`}</option>}
            {FACING_LABELS.map((l, r) => (
              <option key={r} value={r}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {(REC_FIELDS[section] ?? [])
        .filter((f) => f.key !== 'ev' || hasEvent)
        .map((f) =>
          f.key === 'ev' ? (
            <div key={f.key} className="field">
              <span>イベント</span>
              {events ? (
                <LanaiEventSelect
                  st={st}
                  value={ev}
                  allowNone={section === 3 || section === 8}
                  onChange={(v) => st.edit(() => w32(rec.raw, 4, v))}
                />
              ) : (
                <span className="muted small">イベントの表がありません</span>
              )}
            </div>
          ) : (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <NumberInput
                value={readField(rec.raw, f)}
                min={0}
                max={f.type === 'u8' ? 255 : f.type === 'u16' ? 0xffff : 0x7fffffff}
                onCommit={(v) => st.edit(() => writeField(rec.raw, f, v))}
              />
            </label>
          ),
        )}
      {section === 8 && u32(rec.raw, 0) < LANAI_RANGE_PROP_KIND && <RangeFields st={st} rec={rec} events={events} />}
      {ev > 0 && events && ev < events.rows && <TreasureEditor st={st} event={ev} />}
      {ev > 0 &&
        (events && ev < events.rows ? (
          <>
            <LookField st={st} view={view} section={section} rec={rec} row={ev} />
            <EventFields st={st} section={section} index={index} row={ev} />
          </>
        ) : (
          <p className="muted small">
            {events ? `イベント番号 ${ev} は表 (${events.rows} 件) の外です` : `イベント番号 ${ev} (表なし)`}
          </p>
        ))}
      <details>
        <summary className="small">{`レコードのバイト (${rec.raw.length})`}</summary>
        <code className="small mono" style={{ wordBreak: 'break-all' }}>
          {[...rec.raw].map((b) => b.toString(16).padStart(2, '0')).join(' ')}
        </code>
      </details>
    </>
  );
}

/**
 * A range's hit shape as the game makes it (rangeShape.ts): the shape (+0x1D: 0 a circle, else a rectangle), the
 * rectangle's full width and depth (+0x14 / +0x18, 1 = 100 world units = 1/5 of a cell) or the circle's radius (the
 * event's +0x5A, same unit). The map draws the shape.
 */
function RangeFields({
  st,
  rec,
  events,
}: {
  st: LanaiEditState;
  rec: Rec;
  events: ReturnType<LanaiEditState['maps']['eventTable']>;
}): ReactNode {
  const range = lanaiRange(rec.raw, events);
  const circle = rec.raw[0x1d] === 0;
  const ev = u32(rec.raw, 4);
  const hasRow = !!events && ev > 0 && ev < events.rows;
  const f = (o: number): number => {
    const v = new DataView(rec.raw.buffer, rec.raw.byteOffset).getFloat32(o, true);
    return Number.isFinite(v) ? v : 0;
  };
  const setF = (o: number, v: number): void =>
    st.edit(() => new DataView(rec.raw.buffer, rec.raw.byteOffset).setFloat32(o, v, true));
  return (
    <>
      <label className="field">
        <span>当たり判定の形 (+0x1D)</span>
        <select
          aria-label="範囲の形"
          value={circle ? 0 : 1}
          onChange={(e) =>
            st.edit(() => {
              const c = e.target.value === '0';
              rec.raw[0x1d] = c ? 0 : 1;
              // the data keeps the kind equal to the shape (kind 0 = circle, 1 = rectangle)
              if (u32(rec.raw, 0) <= 2) w32(rec.raw, 0, c ? 0 : 1);
              if (!c && f(0x14) <= 0 && f(0x18) <= 0) {
                new DataView(rec.raw.buffer, rec.raw.byteOffset).setFloat32(0x14, 3, true);
                new DataView(rec.raw.buffer, rec.raw.byteOffset).setFloat32(0x18, 1, true);
              }
            })
          }
        >
          <option value={0}>円 (中心と半径)</option>
          <option value={1}>矩形 (北西の角と幅・奥行き)</option>
        </select>
      </label>
      {circle ? (
        <label className="field">
          <span>半径 (イベントの +0x5A、1 = 1/5 マス)</span>
          {hasRow ? (
            <NumberInput
              value={events!.u16(ev, 0x5a)}
              min={0}
              max={0xffff}
              onCommit={(v) => st.setEventField(ev, (t) => t.setU16(ev, 0x5a, v))}
            />
          ) : (
            <span className="muted small">イベントがないので決まりません</span>
          )}
        </label>
      ) : (
        <>
          <label className="field">
            <span>幅 (東西、+0x14、1 = 1/5 マス)</span>
            <NumberInput value={f(0x14)} min={0} max={10000} step={0.1} onCommit={(v) => setF(0x14, v)} />
          </label>
          <label className="field">
            <span>奥行き (南北、+0x18、1 = 1/5 マス)</span>
            <NumberInput value={f(0x18)} min={0} max={10000} step={0.1} onCommit={(v) => setF(0x18, v)} />
          </label>
        </>
      )}
      <p className="muted small">
        {`${range.note} 判定はパーティの位置 1 点が形の中にあるかどうかで、判定そのものには「入った・出た」の区別がありません (続けて起きるかはイベントの状態と disable() で決まります)。`}
      </p>
    </>
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
      {header === null ? (
        <p className="muted small">このマップには区画 6 がありません (セルを足せません)。</p>
      ) : (
        <>
          <label className="field">
            <span>マップの群れ (ヘッダー)</span>
            <MonsterGroupSelect
              maps={maps}
              value={header}
              onChange={(v) =>
                st.edit((d) => {
                  const h = d.sec6Header.slice();
                  w32(h, 0, v);
                  d.sec6Header = h;
                })
              }
            />
          </label>
          <label className="field">
            <span>足すセルの群れ</span>
            <MonsterGroupSelect
              maps={maps}
              value={st.cell6Value}
              onChange={(v) => {
                st.cell6Value = v;
                st.setTool('room');
              }}
            />
          </label>
          <InfoTip
            text={
              'G でクリックすると選んだ群れのセルを足す／消す。セル ' +
              doc.cells6.length +
              ' 個。群れはこのコンテンツから選びます。'
            }
          />
          {[...counts].map(([v, n]) => (
            <div key={v} className="row small">
              <span className="muted">{`セル ${n} 個:`}</span>
              <MonsterGroupLine maps={maps} value={v} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** The map's sounds and battle field (BattleParts.tsx), edited with undo points of the map. */
function BattlePanel({ st }: { st: LanaiEditState }): ReactNode {
  useEditorState(st);
  const src = st.source;
  if (!st.current || !src) return null;
  const maps = st.maps;
  return (
    <LanaiMapBattlePanel
      session={maps.session}
      maps={maps}
      mapData={src.mapData}
      resource={src.resource}
      edit={(f) =>
        st.editTables(() => {
          f();
          maps.changed();
          maps.session.edited();
        })
      }
    />
  );
}

/** "13: むふふふ、むふふふ！笑いが止…" for a row of a talk table. */
function talkRowLabel(session: LanaiSession, t: LanaiTable, offset: number, row: number): string {
  const text = t.isString(row, offset) ? session.plainAt(t, t.u32(row, offset)).replace(/\s+/g, ' ').trim() : '';
  return `${row}: ${text.length > 32 ? `${text.slice(0, 32)}…` : text || '(空)'}`;
}

/**
 * One action of an EventObject row (map.md §7.1, §7.3): its type by name (actions.ts LANAI_ACTIONS), the lines it says
 * (rows of the group's talk table, MapGroup +0x24: picked from the table and edited in the message editor), the
 * arguments whose meaning is known and the raw ones.
 */
function ActionFields({
  st,
  row,
  offset,
  index,
  allowed,
}: {
  st: LanaiEditState;
  row: number;
  offset: number;
  index: number;
  /** The types the record's event takes (actions.ts lanaiActionTypesFor), when known. */
  allowed?: number[];
}): ReactNode {
  const info = st.info!;
  const session = st.maps.session;
  useLanaiRevision(session);
  const t = st.maps.eventTable(info.dungeon)!;
  const type = t.u32(row, offset);
  const action = LANAI_ACTIONS[type];
  const talk = st.maps.talkTable(info.dungeon);
  const group = st.maps.group(info);
  const message = talk ? talkMessageOffset(talk) : undefined;
  const arg = (a: number): number => t.u32(row, offset + 4 + a * 4);
  const setArg = (a: number, v: number): void =>
    st.setEventField(row, (x) => x.setU32(row, offset + 4 + a * 4, v >>> 0));
  const apply = (f: () => void): void => {
    f();
    session.edited();
  };
  const offered = allowed ?? LANAI_ACTION_TYPES;
  const types = offered.includes(type) ? offered : [type, ...offered];
  const ignored = !!allowed && type !== 0 && !allowed.includes(type);
  const talkArgs = action?.talk ?? [];
  const lines = talkArgs.map((a, k): ReactNode => {
    const v = arg(a);
    const head = `${talkArgs.length > 1 ? `台詞 ${k + 1}` : '台詞'} (引数 ${a + 1})`;
    if (!talk || message === undefined)
      return (
        <p
          key={a}
          className="muted small"
        >{`${head}: 番号 ${v}。このマップの群れの台詞の表 (MapGroup +0x24 / MessageContents) が見つからないため表示できません。`}</p>
      );
    const none = action!.zeroIsNone && v === 0;
    const inside = v < talk.rows;
    return (
      <div key={a}>
        <label className="field">
          <span>{head}</span>
          <select value={inside ? v : -1} onChange={(e) => setArg(a, Number(e.target.value))}>
            {!inside && <option value={-1}>{`番号 ${v} (表は ${talk.rows} 件: 表の外)`}</option>}
            {Array.from({ length: talk.rows }, (_, r) => (
              <option key={r} value={r}>
                {action!.zeroIsNone && r === 0 ? '0: なし' : talkRowLabel(session, talk, message, r)}
              </option>
            ))}
          </select>
        </label>
        {inside && !none && <MessageEditor texts={lanaiMessageSource(session, talk, message)} id={v} apply={apply} />}
      </div>
    );
  });
  const destination = LANAI_DESTINATION_ACTIONS.includes(type);
  const known = Object.entries(action?.args ?? {}).filter(([a]) => !destination || Number(a) > 1);
  return (
    <details open={index === 0 || (type !== 0 && type !== LANAI_ACTION_NONE)}>
      <summary className="small">{`動作 ${index + 1} (${LANAI_ACTION_RUNS[index]}): ${lanaiActionName(type)}`}</summary>
      <label className="field">
        <span>動作の型</span>
        <select
          value={type}
          onChange={(e) => st.setEventField(row, (x) => x.setU32(row, offset, Number(e.target.value) >>> 0))}
        >
          {types.map((v) => (
            <option key={v} value={v}>{`${hex8(v).toUpperCase().slice(6)}: ${lanaiActionName(v)}`}</option>
          ))}
        </select>
      </label>
      {ignored && (
        <p className="muted small">
          この型は、このレコードの区画・種類では働きません
          (ゲームはレコードの区画と種類でイベントの種類を決め、合わない型は何もしない)。
        </p>
      )}
      {action?.note && <p className="muted small">{action.note}</p>}
      {type === LANAI_ACTION_SCRIPT && talk && (
        <p className="muted small">
          {
            '台詞を変えるには: 型を「一言」などに変えて、台詞を選ぶ (CRO はそのまま。スクリプトだった NPC がゲームで同じように話すかは実機で未確認)。'
          }
        </p>
      )}
      {talk && talkArgs.length > 0 && (
        <p className="muted small">{`台詞の表: ${talk.name} (${talk.rows} 件、${group?.talkEntry ? 'MapGroup +0x24' : 'MapGroup +0x24 が 0 なのでコンテンツの MessageContents'})。文を書き換えると、同じ番号を使うほかの NPC の台詞も変わる。`}</p>
      )}
      {lines}
      {destination && (
        <DestinationFields
          maps={st.maps}
          map={arg(0)}
          point={arg(1)}
          onChange={(map, point) =>
            st.setEventField(row, (x) => {
              x.setU32(row, offset + 4, map);
              x.setU32(row, offset + 8, point);
            })
          }
        />
      )}
      {known.map(([a, label]) => {
        const i = Number(a),
          pick = action?.pick?.[i];
        return (
          <label key={a} className="field">
            <span>{`引数 ${i + 1}: ${label}`}</span>
            {pick === 'monsterGroupRow' && st.maps.monsterGroup ? (
              <MonsterGroupRowSelect maps={st.maps} value={arg(i)} onChange={(v) => setArg(i, v)} />
            ) : pick === 'content' ? (
              <ContentSelect
                maps={st.maps}
                value={arg(i)}
                allowNone={type === LANAI_ACTION_GOAL_CHEST}
                onChange={(v) => setArg(i, v)}
              />
            ) : (
              <HexInput value={arg(i)} onChange={(v) => setArg(i, v)} />
            )}
          </label>
        );
      })}
      <details>
        <summary className="small">型と引数 (16 進)</summary>
        <label className="field">
          <span>{`型 (+0x${offset.toString(16).toUpperCase()}、0x80000000 = なし)`}</span>
          <HexInput value={type} onChange={(v) => st.setEventField(row, (x) => x.setU32(row, offset, v >>> 0))} />
        </label>
        {Array.from({ length: LANAI_EVENT_ARGS }, (_, a) => (
          <label key={a} className="field">
            <span>{`引数 ${a + 1} (+0x${(offset + 4 + a * 4).toString(16).toUpperCase()})`}</span>
            <HexInput value={arg(a)} onChange={(v) => setArg(a, v)} />
          </label>
        ))}
      </details>
    </details>
  );
}

/** How many records of a group's maps name an EventObject row. */
function eventUsers(maps: LanaiMaps, info: LanaiMapInfo, row: number): number {
  let n = 0;
  for (const m of maps.maps)
    if (m.dungeon === info.dungeon && !m.world)
      for (const k of LANAI_EVENT_SECTIONS)
        for (const r of maps.doc(m).recs[k] ?? [])
          if (!(k === 8 && u32(r.raw, 0) >= 100) && lanaiRecEventRow(k, r.raw) === row) n++;
  return n;
}

/** The EventObject row of a record (map.md §7.1): conditions, the three actions, the state slot; edited in the group's table. */
function EventFields({
  st,
  section,
  index,
  row,
}: {
  st: LanaiEditState;
  section: number;
  index: number;
  row: number;
}): ReactNode {
  const info = st.info!;
  const t = st.maps.eventTable(info.dungeon)!;
  const group = st.maps.group(info);
  const users = eventUsers(st.maps, info, row);
  const slot = lanaiEventSlot(t, row);
  const raw = st.current?.recs[section]?.[index]?.raw;
  const allowed = raw ? lanaiActionTypesFor(section, section === 5 ? u32(raw, 0) : undefined) : undefined;
  const u8f = (o: number, label: string): ReactNode => (
    <label key={o} className="field">
      <span>{label}</span>
      <NumberInput
        value={t.u8(row, o)}
        min={0}
        max={255}
        onCommit={(v) => st.setEventField(row, (x) => x.setU8(row, o, v))}
      />
    </label>
  );
  const u16f = (o: number, label: string): ReactNode => (
    <label key={o} className="field">
      <span>{label}</span>
      <NumberInput
        value={t.u16(row, o)}
        min={0}
        max={0xffff}
        onCommit={(v) => st.setEventField(row, (x) => x.setU16(row, o, v))}
      />
    </label>
  );
  return (
    <>
      <h4>{`イベント #${row} (${t.name})${row >= t.originalRows ? ' (追加したイベント)' : ''}`}</h4>
      {users > 1 && (
        <div className="row">
          <span className="muted small">{`このイベントは ${users} 個のレコードが使っています (状態と動作を共有)。`}</span>
          <button onClick={() => st.separateEventRow(section, index)}>このレコード専用のイベントにする</button>
        </div>
      )}
      <EventConditionFields st={st} event={row} field={LANAI_EVENT_APPEAR} />
      <EventConditionFields st={st} event={row} field={LANAI_EVENT_DISAPPEAR} />
      <p className="muted small">
        出る条件が成り立ち、消える条件が成り立たないときに出現します。スクリプト (CRO)
        が条件を上書きする場合があります。
      </p>
      <EventScriptBinding st={st} section={section} index={index} row={row} />
      {LANAI_EVENT_ACTIONS.map((o, i) => (
        <ActionFields key={o} st={st} row={row} offset={o} index={i} allowed={allowed} />
      ))}
      <p className="muted small">
        動作は「何回目の実行か」で切り替わります: 1 回目は動作 1、2 回目は動作 2、3 回目以降は動作 3
        (無ければ前の動作)。条件で選ばれるのでも、1 回で順に実行されるのでもありません。
      </p>
      {u16f(LANAI_EVENT_SLOT, `状態の枠 (+0x58、${LANAI_SLOT_IS_ROW} = イベント番号)`)}
      <p className="muted small">
        {`使う枠 ${slot}・MapGroup の枠 ${group?.stateCount ?? '?'} 個 (先頭 ${group?.stateFirst ?? '?'})`}
        {group && slot >= group.stateCount ? '。枠の数以上なので状態は保存されません' : ''}
      </p>
      {u16f(0x5c, '+0x5C (未解析)')}
      {u8f(0x5e, '+0x5E (未解析)')}
      <details>
        <summary className="small">{`イベントのバイト (${t.rowSize})`}</summary>
        <RawBytes bytes={t.row(row)} rows={4} onChange={(b) => st.setEventField(row, (x) => x.setRow(row, b))} />
      </details>
    </>
  );
}
