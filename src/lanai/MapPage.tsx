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
import { PlacedPickButton, type PlacedChoice } from '../editor/objectpick';
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
import { LANAI_ROT_CODEC, LETTER_DEFAULT, letterIndex, letterLabel, recCellPos, type Rec } from '../game/sections';
import { romfsHref } from '../romfs/RomfsPage';
import { NumberInput, useSticky } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import { LanaiMapPicker } from './MapPicker';
import { MessageEditor } from '../ui/message';
import { useAsync } from '../ui/useAsync';
import { Signal, useEditorState, useSignal } from '../ui/useEditorState';
import { hex8, u32, w32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { useLanaiContents } from './useContents';
import { EventScriptBinding } from './EventScriptBinding';
import { LANAI_ACTION_EXTERNAL_DOOR, LANAI_ACTION_SHOP, LANAI_SPEAKER_NPC } from './eventParts';
import { lanaiCenterOnAnchor, lanaiMapHref, lanaiShopHref, setLanaiCenterOnAnchor } from './hrefs';
import { lanaiArrivals } from './mapLinks';
import { encodeLanaiMessage, parseLanaiText } from './message';
import { TALK_SPEAKER } from './talk';
import { LookField } from './LookField';
import { LANAI_RANGE_PROP_KIND, lanaiRange } from './rangeShape';
import {
  lanaiButtonDoor,
  lanaiEditState,
  lanaiRecEventRow,
  lanaiRecLabel,
  lanaiValidate,
  type LanaiEditState,
} from './mapedit';
import {
  LANAI_EVENT_ACTIONS,
  LANAI_EVENT_APPEAR,
  LANAI_EVENT_ARGS,
  LANAI_EVENT_DISAPPEAR,
  LANAI_EVENT_LEVEL,
  LANAI_LEVEL_DOOR_KIND,
  lanaiExitKind,
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
import { lanaiItemName } from './monsterBook';
import { LanaiItemPicker } from './pickers';
import { LANAI_TREASURE_GOLD, LANAI_TREASURE_ITEM, type LanaiTreasureSlot } from './treasure';
import { LanaiMapView } from './mapview';
import { ScriptMovePanel } from './ScriptMovePanel';
import type { LanaiSession } from './session';
import { LanaiEventSelect } from './EventSelect';
import { EventConditionFields } from './EventConditionFields';
import { DestinationFields, lanaiDestinationPoints } from './DestinationFields';
import { LanaiTilesetField } from './TilesetField';

// The link to a map of a content (the stage page's list uses it too), with a record as the anchor (`@section.index`).
export { lanaiMapHref };

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
  const open = view && st.current?.hash === info.hash;
  // The anchor of a record (`@section.index`). A link that names one selects the record (the inspector shows it) and
  // brings it to the middle of the views (unless the display setting is off); selecting a record writes its anchor to
  // the address bar, so the address can be copied as a link to it. `ownAnchor` is the address the page wrote itself:
  // the route then names the selected record, which must not be centred as a link's is.
  const ownAnchor = useRef('');
  useEffect(() => {
    const own = ownAnchor.current === lanaiMapHref(content.index, info.name, rec);
    ownAnchor.current = '';
    if (own || !view || !rec || st.current?.hash !== info.hash || !st.current.recs[rec.section]?.[rec.index]) return;
    const sel = st.selection;
    if (!(sel.type === 'rec' && sel.section === rec.section && sel.index === rec.index))
      st.select({ type: 'rec', section: rec.section, index: rec.index });
    if (!lanaiCenterOnAnchor()) return;
    // after the view was fitted to the map (queued when it was made)
    const frame = requestAnimationFrame(() => view.centerOnRecord(rec.section, rec.index));
    return () => cancelAnimationFrame(frame);
  }, [view, st, info, rec?.section, rec?.index]);
  const selected = st.selection.type === 'rec' ? `${st.selection.section}.${st.selection.index}` : '';
  useEffect(() => {
    // the pages stay mounted while another one is shown: only the map page's address is written
    if (!open || !location.hash.startsWith('#/maps')) return;
    const sel = st.selection;
    const want = lanaiMapHref(content.index, info.name, sel.type === 'rec' ? sel : undefined);
    if (location.hash === want) return;
    ownAnchor.current = want;
    history.replaceState(history.state, '', want);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [open, selected, st, info.name, content.index]);
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
                <LayerBox
                  view={view}
                  label="つながり (ボタンと扉・ワープの行き先)"
                  checked={view.showLinks}
                  set={(v) => (view.showLinks = v)}
                  color="#e58cff"
                />
                <LayerBox
                  view={view}
                  label="スクリプトの move() の行き先 (ドラッグで編集)"
                  checked={view.showMoves}
                  set={(v) => (view.showMoves = v)}
                  color="#ffb347"
                />
                <label
                  className="layer"
                  title="オブジェクトへのリンク (URL の @区画.番号) を開いたとき、対象を 2D・3D の画面の中心に移します"
                >
                  <input
                    type="checkbox"
                    checked={lanaiCenterOnAnchor()}
                    onChange={(e) => {
                      setLanaiCenterOnAnchor(e.target.checked);
                      view.refresh();
                    }}
                  />{' '}
                  リンクで開いた対象を画面の中心にする
                </label>
                <h3>2D</h3>
                <div className="seg">
                  {(
                    [
                      ['symbols', '記号'],
                      ['minimap', 'ミニマップ風'],
                    ] as const
                  ).map(([style, label]) => (
                    <button
                      key={style}
                      type="button"
                      className={view.style2d === style ? 'active' : ''}
                      onClick={() => {
                        view.style2d = style;
                        view.refresh();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </MapLayers>
            </MapSettings>
          </>
        )
      }
      right={
        open && (
          <>
            <Inspector st={st} view={view} content={content} />
            {session.createdFiles.has(content.archive.toUpperCase()) && (
              <ScriptMovePanel view={view} stageHref={lanaiStageHref(content.index)} />
            )}
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

type ChestReward = { kind: 'gold' | 'item'; value: number; weight: number };

/** The reward is chosen before a chest becomes a stamp; each placement gets independent TreasureGroup rows. */
function ChestPlacement({
  st,
  template,
  onReady,
  onClose,
}: {
  st: LanaiEditState;
  template: NonNullable<Extract<NonNullable<LanaiEditState['stamp']>, { type: 'template' }>['t']>;
  onReady: (t: typeof template) => void;
  onClose: () => void;
}): ReactNode {
  const goal = template.event?.chest === 'goal';
  const [first, setFirst] = useState<ChestReward[]>([{ kind: 'gold', value: 0, weight: 1 }]);
  const [retry, setRetry] = useState<ChestReward[]>([{ kind: 'gold', value: 0, weight: 1 }]);
  const [clears, setClears] = useState(st.maps.content.index);
  const [pick, setPick] = useState<{ which: 'first' | 'retry'; index: number } | null>(null);
  const reward = (
    label: string,
    values: ChestReward[],
    set: (v: ChestReward[]) => void,
    which: 'first' | 'retry',
  ): ReactNode => {
    const change = (index: number, next: ChestReward): void =>
      set(values.map((value, i) => (i === index ? next : value)));
    return (
      <div className="treasure">
        <h3>{label}</h3>
        {values.map((value, index) => (
          <div className="row" key={index}>
            <select
              aria-label={`${label}の候補 ${index + 1}`}
              value={value.kind}
              onChange={(e) => change(index, { ...value, kind: e.target.value as ChestReward['kind'], value: 0 })}
            >
              <option value="gold">G</option>
              <option value="item">アイテム</option>
            </select>
            {value.kind === 'gold' ? (
              <NumberInput
                value={value.value}
                min={0}
                max={0x7fffffff}
                title="金額"
                onCommit={(n) => change(index, { ...value, value: n })}
              />
            ) : (
              <button onClick={() => setPick({ which, index })}>
                {value.value ? lanaiItemName(st.maps.session, value.value) : 'アイテムを選ぶ…'}
              </button>
            )}
            {values.length > 1 && (
              <NumberInput
                value={value.weight}
                min={1}
                max={0xffff}
                title="抽選の重み"
                onCommit={(n) => change(index, { ...value, weight: n })}
              />
            )}
            {values.length > 1 && (
              <button className="danger" title="候補を外す" onClick={() => set(values.filter((_, i) => i !== index))}>
                ×
              </button>
            )}
          </div>
        ))}
        {values.length < 10 && (
          <button onClick={() => set([...values, { kind: 'gold', value: 0, weight: 1 }])}>＋ 抽選候補を追加</button>
        )}
        {values.length > 1 && <p className="muted small">重みに比例して 1 つ選ばれます。</p>}
      </div>
    );
  };
  const slots = (values: ChestReward[]): LanaiTreasureSlot[] =>
    values.map((value) => ({
      kind: value.kind === 'gold' ? LANAI_TREASURE_GOLD : LANAI_TREASURE_ITEM,
      value: value.value,
      weight: value.weight,
    }));
  const valid = (values: ChestReward[]): boolean => values.every((value) => value.value > 0 && value.weight > 0);
  return (
    <Dialog title={goal ? 'クリア宝箱を置く' : '通常の宝箱を置く'} onClose={onClose}>
      <p className="muted small">報酬を決めてからマップ上に置きます。候補を増やすと抽選になります。</p>
      {reward('開けたとき', first, setFirst, 'first')}
      {goal && (
        <>
          {reward('再挑戦のとき', retry, setRetry, 'retry')}
          <label className="field">
            <span>クリア対象</span>
            <ContentSelect maps={st.maps} value={clears} onChange={setClears} />
          </label>
        </>
      )}
      <div className="row">
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={!valid(first) || (goal && (!valid(retry) || !clears))}
          onClick={() =>
            onReady({
              ...template,
              label: `${template.label} · ${first.length > 1 ? `${first.length} 候補から抽選` : first[0]!.kind === 'gold' ? `${first[0]!.value}G` : lanaiItemName(st.maps.session, first[0]!.value)}`,
              event: {
                ...template.event!,
                rewards: goal ? [slots(first), slots(retry), slots(retry)] : [slots(first)],
                clears,
              },
            })
          }
        >
          この設定で置く
        </button>
      </div>
      {pick && (
        <LanaiItemPicker
          session={st.maps.session}
          current={0}
          onClose={() => setPick(null)}
          onPick={(row) => {
            const value = st.maps.session.need('ItemData').rowId(row);
            const values = pick.which === 'first' ? first : retry;
            (pick.which === 'first' ? setFirst : setRetry)(
              values.map((reward, i) => (i === pick.index ? { ...reward, kind: 'item', value } : reward)),
            );
            setPick(null);
          }}
        />
      )}
    </Dialog>
  );
}

/** Choose the switch's script path before placement. */
function SwitchPlacement({
  st,
  template,
  onReady,
  onClose,
}: {
  st: LanaiEditState;
  template: ReturnType<LanaiEditState['templates']>[number];
  onReady: (t: typeof template) => void;
  onClose: () => void;
}): ReactNode {
  const persistent = template.event?.switchTrigger === 'switch';
  const [door, setDoor] = useState(0);
  const doc = st.current;
  const table = st.info ? st.maps.eventTable(st.info.dungeon) : undefined;
  const archive = st.maps.content.archive.toUpperCase();
  const enabled = st.maps.session.createdFiles.has(archive);
  const choices: PlacedChoice[] =
    doc && table
      ? (doc.recs[3] ?? []).flatMap((r, index) => {
          const event = lanaiRecEventRow(3, r.raw);
          if (!event || event >= table.rows || table.u32(event, LANAI_EVENT_ACTIONS[0]) !== LANAI_ACTION_EXTERNAL_DOOR)
            return [];
          const [x, y] = recCellPos(r, LANAI_LAYOUTS[3]!);
          return [
            {
              value: event,
              name: `通路をふさぐ扉 #${index}`,
              sub: `セル (${x.toFixed(1)}, ${y.toFixed(1)})`,
              where: { doc, x, y },
              model: null,
              badge: '扉',
            },
          ];
        })
      : [];
  return (
    <Dialog title={`${persistent ? '保持スイッチ' : 'プッシュスイッチ'}を置く`} onClose={onClose}>
      <p className="small">{persistent ? '一度踏むと押したままになります。' : '踏むと押され、離れると戻ります。'}</p>
      {persistent && (
        <label className="field">
          <span>自動で開く扉（任意）</span>
          <PlacedPickButton
            title="扉を選ぶ（選ばなくても配置できます）"
            value={door}
            choices={choices}
            extra={[{ value: 0, label: '指定しない', sub: '配置後にスクリプトを編集できます' }]}
            onChange={setDoor}
          />
        </label>
      )}
      <p className="muted small">
        {door
          ? '選んだ扉を開く関数とスイッチへの割当を作ります。'
          : '空の関数とスイッチへの割当を作ります。扉の配置前でも置けます。配置後にステージのスクリプトを編集してください。'}
      </p>
      {!enabled && <p className="error">スイッチのスクリプトは新しく追加したステージで使えます。</p>}
      <div className="row">
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={!enabled}
          onClick={() =>
            onReady({
              ...template,
              label: door ? `${template.label} → 扉 #${door}` : template.label,
              event: { ...template.event!, buttonDoor: door || undefined },
            })
          }
        >
          この設定で置く
        </button>
      </div>
    </Dialog>
  );
}

/** A destination can be connected now or after both ends have been placed. */
function ExitPlacement({
  st,
  template,
  onReady,
  onClose,
}: {
  st: LanaiEditState;
  template: ReturnType<LanaiEditState['templates']>[number];
  onReady: (t: typeof template) => void;
  onClose: () => void;
}): ReactNode {
  const [connectNow, setConnectNow] = useState(false);
  const [map, setMap] = useState(0);
  const [point, setPoint] = useState(0);
  const [direction, setDirection] = useState(0);
  const valid = !!st.maps.map(map) && lanaiDestinationPoints(st.maps, map).some((p) => p.value === point);
  return (
    <Dialog title={`${template.label}を置く`} onClose={onClose}>
      <label className="field">
        <span>行き先</span>
        <select value={connectNow ? 'now' : 'later'} onChange={(e) => setConnectNow(e.target.value === 'now')}>
          <option value="later">後で設定する</option>
          <option value="now">今選ぶ</option>
        </select>
      </label>
      {connectNow ? (
        <DestinationFields
          maps={st.maps}
          map={map}
          point={point}
          onChange={(nextMap, nextPoint) => {
            setMap(nextMap);
            setPoint(nextPoint);
          }}
        />
      ) : (
        <p className="muted small">先に配置して、相手の出入口を置いた後でインスペクタの「行き先」を設定できます。</p>
      )}
      <label className="field">
        <span>向き</span>
        <select value={direction} onChange={(e) => setDirection(Number(e.target.value))}>
          {FACING_LABELS.map((label, index) => (
            <option key={index} value={index}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={connectNow && !valid}
          onClick={() => {
            const raw = template.raw.slice();
            raw[0x14] = LANAI_ROT_CODEC.encode(direction);
            onReady({
              ...template,
              label: `${template.label} → ${st.maps.map(map)?.name ?? ''}`,
              raw,
              event: { ...template.event!, destination: connectNow ? { map, point } : { map: 0, point: 0 } },
            });
          }}
        >
          この設定で置く
        </button>
      </div>
    </Dialog>
  );
}

/** The line of a sign, an NPC or a clerk is written before it is placed; each placement adds a row to the group's talk table. */
function TalkPlacement({
  st,
  template,
  onReady,
  onClose,
}: {
  st: LanaiEditState;
  template: ReturnType<LanaiEditState['templates']>[number];
  onReady: (t: typeof template) => void;
  onClose: () => void;
}): ReactNode {
  const shop = !!template.event?.shop;
  const [text, setText] = useState(shop ? 'いらっしゃいませ。' : '');
  const talk = st.info ? st.maps.talkTable(st.info.dungeon) : undefined;
  let error = '';
  try {
    encodeLanaiMessage(parseLanaiText(text));
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Dialog title={`${template.label.replace(/（.*$/u, '')}を置く`} onClose={onClose}>
      <label className="field">
        <span>{shop ? '店を開く前の台詞' : 'メッセージ'}</span>
        <textarea
          aria-label="メッセージ"
          rows={4}
          autoFocus
          value={text}
          placeholder="ここに表示する文"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="muted small">
        {talk
          ? `台詞の表 ${talk.name} に新しい行を足します (今 ${talk.rows} 件)。ルビは {ruby:親字|よみ}、改ページは {page} と書けます。置いた後もインスペクタで書き換えられます。`
          : 'この MapGroup には台詞の表がありません。'}
      </p>
      {shop && (
        <p className="small">
          話しかけると台詞のあと、このステージのショップ (Shop の行 0、推定) が開きます。品揃えは{' '}
          <a href={lanaiShopHref(st.maps.content.index, 0)}>ショップのページ</a>で編集します。
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={!talk || !text.trim() || !!error}
          onClick={() =>
            onReady({
              ...template,
              label: `${template.label} · 「${text.trim().split('\n')[0]!.slice(0, 16)}」`,
              event: { ...template.event!, talk: { ...template.event!.talk!, text } },
            })
          }
        >
          この設定で置く
        </button>
      </div>
    </Dialog>
  );
}

/** Adding records: props (section 2) and copies of the group's records; copying and removing the selected one. */
function AddPanel({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  const [chest, setChest] = useState<{
    template: ReturnType<LanaiEditState['templates']>[number];
    choose: (ready: ReturnType<LanaiEditState['templates']>[number]) => void;
  } | null>(null);
  const [switchPart, setSwitchPart] = useState<{
    template: ReturnType<LanaiEditState['templates']>[number];
    choose: (ready: ReturnType<LanaiEditState['templates']>[number]) => void;
  } | null>(null);
  const [exitPart, setExitPart] = useState<{
    template: ReturnType<LanaiEditState['templates']>[number];
    choose: (ready: ReturnType<LanaiEditState['templates']>[number]) => void;
  } | null>(null);
  const [talkPart, setTalkPart] = useState<{
    template: ReturnType<LanaiEditState['templates']>[number];
    choose: (ready: ReturnType<LanaiEditState['templates']>[number]) => void;
  } | null>(null);
  const revision = useMaps(st.maps);
  const templates = useMemo(() => st.templates(), [st, st.info, revision]);
  const props = useMemo(() => st.props(), [st, st.info, revision]);
  const objects = st.maps.session.table('MapObject');
  const all = useMemo(
    () => Array.from({ length: objects?.rows ?? 0 }, (_, i) => i).filter((row) => !!lanaiObjectRef(objects, row)),
    [objects],
  );
  return (
    <>
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
        modelForTemplate={(t) => t.model ?? view.partLook(t.section, t.raw)?.model ?? null}
        help="目的からパーツを選び、マップをクリックして配置します。通常・クリア宝箱は独立した中身の表を作ります。配置後に報酬、移動先、スクリプトの接続を設定してください。「既存ギミック」はこのステージにあるものの複製です。装飾はゲーム中の動作を持ちません。Esc で選択に戻ります。"
        prepareTemplate={(template, choose) => {
          if (template.event?.chest) setChest({ template, choose });
          else if (template.event?.switchTrigger) setSwitchPart({ template, choose });
          else if (template.event?.destination) setExitPart({ template, choose });
          else if (template.event?.talk) setTalkPart({ template, choose });
          else choose(template);
        }}
      />
      {chest && (
        <ChestPlacement
          st={st}
          template={chest.template}
          onReady={(ready) => {
            chest.choose(ready);
            setChest(null);
          }}
          onClose={() => setChest(null)}
        />
      )}
      {switchPart && (
        <SwitchPlacement
          st={st}
          template={switchPart.template}
          onReady={(ready) => {
            switchPart.choose(ready);
            setSwitchPart(null);
          }}
          onClose={() => setSwitchPart(null)}
        />
      )}
      {talkPart && (
        <TalkPlacement
          st={st}
          template={talkPart.template}
          onReady={(ready) => {
            talkPart.choose(ready);
            setTalkPart(null);
          }}
          onClose={() => setTalkPart(null)}
        />
      )}
      {exitPart && (
        <ExitPlacement
          st={st}
          template={exitPart.template}
          onReady={(ready) => {
            exitPart.choose(ready);
            setExitPart(null);
          }}
          onClose={() => setExitPart(null)}
        />
      )}
    </>
  );
}

/** Fields of a section's records besides the position and the facing (map.md §5). */
const REC_FIELDS: Record<number, FieldDef[]> = {
  1: [{ key: 'kind', offset: 0x0d, type: 'u8', label: '種類 (+0x0D、1 = 毒床、3 = 凍った床)' }],
  2: [{ key: 'row', offset: 0, type: 'u32', label: 'MapObject 番号' }],
  3: [
    { key: 'ev', offset: 4, type: 'u32', label: 'イベント番号' },
    { key: 'kind', offset: 0x15, type: 'u8', label: '種類 (5 上り / 6 下り / 16 レベルの扉 / 100 壁の扉)' },
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
      {st.info && <PlacedEventIndex st={st} />}
      {st.info && <Facts maps={st.maps} info={st.info} view={view} />}
      {st.info && <LanaiTilesetField maps={st.maps} info={st.info} />}
      <Stages content={content} />
    </>
  );
}

/** IDs in scripts are EventObject row numbers, shared by all maps of this MapGroup. */
function PlacedEventIndex({ st }: { st: LanaiEditState }): ReactNode {
  const doc = st.current;
  if (!doc) return null;
  const entries = LANAI_EVENT_SECTIONS.flatMap((section) =>
    (doc.recs[section] ?? []).flatMap((rec, index) => {
      if (section === 8 && u32(rec.raw, 0) >= LANAI_RANGE_PROP_KIND) return [];
      const event = lanaiRecEventRow(section, rec.raw);
      return event ? [{ section, index, event, label: lanaiRecLabel(section, rec.raw) }] : [];
    }),
  );
  return (
    <details className="lanai-event-index">
      <summary>{`配置物のイベントID一覧（${entries.length}件）`}</summary>
      <p className="muted small">/stages の関数では、対象のイベント ID を十進数で指定します。</p>
      <div className="lanai-event-index-list">
        {entries.map(({ section, index, event, label }) => (
          <button key={`${section}/${index}`} type="button" onClick={() => st.select({ type: 'rec', section, index })}>
            <strong className="mono">{event}</strong> {label} #{index}
          </button>
        ))}
      </div>
    </details>
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const eventKey = `${st.info?.dungeon ?? 0}/${ev}`;
  const events = st.info ? st.maps.eventTable(st.info.dungeon) : undefined;
  const primaryAction = ev > 0 && events && ev < events.rows ? events.u32(ev, LANAI_EVENT_ACTIONS[0]) : 0;
  const switchBinding =
    section === 5 && st.info
      ? st.maps.session.stageScripts
          .get(st.maps.content.archive.toUpperCase())
          ?.doc.bindings.find(
            (b) => b.group === st.info!.dungeon && b.row === ev && (b.trigger === 'switch' || b.trigger === 'button'),
          )
      : undefined;
  const linkedDoor = section === 5 && st.info ? lanaiButtonDoor(st.maps, st.info.dungeon, ev) : null;
  const linkedButtons =
    section === 3 && st.info
      ? (st.current?.recs[5] ?? []).flatMap((button, i) => {
          const row = lanaiRecEventRow(5, button.raw);
          return lanaiButtonDoor(st.maps, st.info!.dungeon, row) === ev && ev ? [i] : [];
        })
      : [];
  const content = st.maps.content.index;
  const mapName = st.info?.name;
  /** The link to a record of the open map (its anchor). */
  const anchor = (s: number, i: number): string => lanaiMapHref(content, mapName, { section: s, index: i });
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const here = anchor(section, index);
  const linkedDoorIndex =
    linkedDoor === null ? -1 : (st.current?.recs[3] ?? []).findIndex((r) => lanaiRecEventRow(3, r.raw) === linkedDoor);
  const levelDoor = section === 3 && lanaiExitKind(rec.raw) === LANAI_LEVEL_DOOR_KIND;
  const hasRow = ev > 0 && !!events && ev < events.rows;
  const level = levelDoor && hasRow ? events!.u16(ev, LANAI_EVENT_LEVEL) : 0;
  // the exits (and the ranges that move the party) of the stage's maps that lead here
  const pointId = section === 3 && rec.raw[0x15] !== 100 ? u32(rec.raw, 0) : 0;
  const arrivals = useMemo(
    () => (pointId && st.info ? lanaiArrivals(st.maps, st.info.hash, pointId) : []),
    [st.maps, st.maps.revision, st.info, pointId],
  );
  return (
    <>
      <h3>
        {switchBinding?.trigger === 'switch'
          ? '保持スイッチ'
          : switchBinding?.trigger === 'button'
            ? 'プッシュスイッチ'
            : levelDoor && level
              ? `レベル ${level} の扉`
              : lanaiRecLabel(section, rec.raw)}
      </h3>
      <div className="row small lanai-anchor">
        <a href={here} title="このオブジェクトを選んだ状態でマップを開くリンク (URL のアンカー)">
          {`🔗 ${mapName ?? ''}@${section}.${index}`}
        </a>
        <button
          type="button"
          title="このオブジェクトへのリンクをコピーする"
          onClick={() =>
            void navigator.clipboard.writeText(`${location.origin}${location.pathname}${location.search}${here}`).then(
              () => setCopiedLink(here),
              () => setCopiedLink(null),
            )
          }
        >
          {copiedLink === here ? 'コピー済み' : 'リンクをコピー'}
        </button>
      </div>
      <div className="lanai-id-summary">
        {ev > 0 ? (
          <>
            <span>スクリプトで使うイベント ID</span>
            <div className="row">
              <strong className="mono lanai-id-value">{ev}</strong>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(String(ev)).then(
                    () => setCopiedKey(eventKey),
                    () => setCopiedKey(null),
                  )
                }
              >
                {copiedKey === eventKey ? 'コピー済み' : 'IDをコピー'}
              </button>
            </div>
            <span className="muted small">{`MapGroup ${st.info?.dungeon ?? '?'} の EventObject 行。openDoor(${ev}) などで使います。`}</span>
          </>
        ) : (
          <span className="muted small">この配置物にスクリプト用のイベント ID はありません。</span>
        )}
        {section === 3 && rec.raw[0x15] !== 100 && (
          <span className="small">{`到着地点 ID: ${hex8(u32(rec.raw, 0)).toUpperCase()}（イベント ID とは別）`}</span>
        )}
        {section === 2 && <span className="small">{`見た目のモデル ID: ${u32(rec.raw, 0)}`}</span>}
      </div>
      <h4>見た目</h4>
      <ModelLine view={view} look={view.look(section, index)} />
      {ev > 0 && events && ev < events.rows && <LookField st={st} view={view} section={section} rec={rec} row={ev} />}
      {(section === 3 || (section === 5 && [4, 5, 6].includes(u32(rec.raw, 0)))) && <h4>接続</h4>}
      {levelDoor && hasRow && (
        <>
          <label className="field">
            <span>必要レベル (LvX の X)</span>
            <NumberInput
              value={level}
              min={0}
              max={0x7fff}
              onCommit={(v) => st.setEventField(ev, (t) => t.setU16(ev, LANAI_EVENT_LEVEL, v))}
            />
          </label>
          <p className="muted small">
            イベントの +0x5C。扉 (MapObject #49 / #59 gimk_03_gate_06) の数字は下位 8 bit で決まり、5・10〜50 (5
            刻み)・60〜90 (10 刻み) はその数、6 は目の印、ほかの値は「99」と表示されます (3D に反映)。
          </p>
          {primaryAction === 0x80000016 ? (
            <p className="muted small">
              {level >= 10
                ? `参加メンバーの最低レベルが ${level} 以上なら開きます (6 は無条件で開き、7〜9 は開きません)。`
                : level === 6
                  ? '6 は無条件で開きます。'
                  : level >= 7
                    ? '7〜9 では開きません。'
                    : '1〜5 の扱いは未確認です (判定が比べるのは 10 以上の値)。'}
            </p>
          ) : (
            <p className="muted small">
              レベルで開くかを判定するのは動作「鍵つきの扉 (行き先あり)」(0x16)
              だけです。この扉の動作では数字は表示だけです (ROM のレベル 5 の扉は「外から開ける扉」、10 はスクリプト)。
            </p>
          )}
        </>
      )}
      {section === 3 && ev > 0 && events && LANAI_DESTINATION_ACTIONS.includes(primaryAction) && (
        <DestinationFields
          link
          maps={st.maps}
          map={events.u32(ev, LANAI_EVENT_ACTIONS[0] + 4)}
          point={events.u32(ev, LANAI_EVENT_ACTIONS[0] + 8)}
          onChange={(map, point) =>
            st.setEventField(ev, (table) => {
              table.setU32(ev, LANAI_EVENT_ACTIONS[0] + 4, map);
              table.setU32(ev, LANAI_EVENT_ACTIONS[0] + 8, point);
            })
          }
        />
      )}
      {section === 5 && [4, 5, 6].includes(u32(rec.raw, 0)) && (
        <p className="small">
          {linkedDoor === null ? (
            '扉への直接接続なし。動作はスクリプトで設定できます。'
          ) : linkedDoorIndex < 0 ? (
            `このボタンで開く: 扉のイベント #${linkedDoor} (このマップにはない)`
          ) : (
            <>
              このボタンで開く:{' '}
              <a href={anchor(3, linkedDoorIndex)}>{`→ 扉 #${linkedDoorIndex} (イベント #${linkedDoor})`}</a>
            </>
          )}
        </p>
      )}
      {linkedButtons.length > 0 && (
        <div className="row small">
          この扉を開くボタン:{' '}
          {linkedButtons.map((i) => (
            <a key={i} href={anchor(5, i)}>{`→ ボタン #${i}`}</a>
          ))}
        </div>
      )}
      {arrivals.length > 0 && (
        <div className="small">
          ここへ来る出入口:
          <ul className="lanai-arrivals">
            {arrivals.map((a) => (
              <li key={`${a.map}/${a.section}/${a.index}`}>
                <a href={lanaiMapHref(content, a.map, a)}>
                  {`→ ${a.map} の${a.section === 3 ? '出入口' : '範囲'} #${a.index}`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <h4>配置</h4>
      <RecPositionFields st={st} rec={rec} L={L} />
      {facing !== undefined && st.canRotate(section) && (
        <label className="field">
          <span>向き (R で回す)</span>
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
      <details>
        <summary className="small">区画・行番号などの詳細</summary>
        <p className="muted small">{`${L.label} #${index}${section === 3 ? `・地点 ID ${hex8(u32(rec.raw, 0)).toUpperCase()}` : ''}`}</p>
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
        <details>
          <summary className="small">{`レコードのバイト (${rec.raw.length})`}</summary>
          <code className="small mono" style={{ wordBreak: 'break-all' }}>
            {[...rec.raw].map((b) => b.toString(16).padStart(2, '0')).join(' ')}
          </code>
        </details>
      </details>
      {section === 8 && u32(rec.raw, 0) < LANAI_RANGE_PROP_KIND && <RangeFields st={st} rec={rec} events={events} />}
      {ev > 0 && events && ev < events.rows && <h4>動作・報酬</h4>}
      {hasRow && primaryAction === LANAI_ACTION_SHOP && (
        <p className="small">
          台詞のあと、このステージのショップ (Shop の行 0、推定) を開きます。{' '}
          <a href={lanaiShopHref(content, 0)}>→ 品揃えをショップのページで編集</a>
        </p>
      )}
      {ev > 0 && events && ev < events.rows && <TreasureEditor st={st} event={ev} />}
      {ev > 0 &&
        (events && ev < events.rows ? (
          <>
            <EventFields st={st} section={section} index={index} row={ev} />
          </>
        ) : (
          <p className="muted small">
            {events ? `イベント番号 ${ev} は表 (${events.rows} 件) の外です` : `イベント番号 ${ev} (表なし)`}
          </p>
        ))}
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
  const range = lanaiRange(rec, events);
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
      {hasRow && (
        <label className="field">
          <span>範囲イベントの起動</span>
          <select
            aria-label="範囲イベントの起動"
            value={range.pressToStart ? 'press' : 'walk'}
            onChange={(e) =>
              st.setEventField(ev, (t) =>
                t.setU16(ev, 0x5c, (t.u16(ev, 0x5c) & 0x7fff) | (e.target.value === 'walk' ? 0x8000 : 0)),
              )
            }
          >
            <option value="walk">歩いて入る</option>
            <option value="press">範囲内で A を押す</option>
          </select>
        </label>
      )}
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
  destinationInConnection,
}: {
  st: LanaiEditState;
  row: number;
  offset: number;
  index: number;
  /** The types the record's event takes (actions.ts lanaiActionTypesFor), when known. */
  allowed?: number[];
  destinationInConnection?: boolean;
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
    /** A new row of the talk table for this argument (the speaker kind of the line it had, else an NPC's). */
    const addLine = (): void =>
      st.editTables(() => {
        const speaker = inside && !none ? talk.u8(v, TALK_SPEAKER) : LANAI_SPEAKER_NPC;
        const line = st.maps.addTalkRow(info.dungeon, '新しいメッセージ', speaker);
        t.setU32(row, offset + 4 + a * 4, line);
      });
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
        <div className="row">
          <button
            type="button"
            title="台詞の表に新しい行を足し、この欄をその行に付け替えます (ほかの NPC と共有しない文になります)"
            onClick={addLine}
          >
            ＋ 新しいメッセージを作る
          </button>
        </div>
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
      {destination && !destinationInConnection && (
        <DestinationFields
          link
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
  const levelDoor = section === 3 && !!raw && lanaiExitKind(raw) === LANAI_LEVEL_DOOR_KIND;
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
      {users > 1 && (
        <div className="row">
          <span className="muted small">{`このイベントは ${users} 個のレコードが使っています (状態と動作を共有)。`}</span>
          <button onClick={() => st.separateEventRow(section, index)}>このレコード専用のイベントにする</button>
        </div>
      )}
      <h4>条件</h4>
      <EventConditionFields st={st} event={row} field={LANAI_EVENT_APPEAR} />
      <EventConditionFields st={st} event={row} field={LANAI_EVENT_DISAPPEAR} />
      <p className="muted small">
        出る条件が成り立ち、消える条件が成り立たないときに出現します。スクリプト (CRO)
        が条件を上書きする場合があります。マップ読込後にフラグを変えても、その場で出現条件が再判定されるとは限りません。
      </p>
      <EventScriptBinding st={st} section={section} index={index} row={row} />
      {LANAI_EVENT_ACTIONS.map((o, i) => (
        <ActionFields
          key={o}
          st={st}
          row={row}
          offset={o}
          index={i}
          allowed={allowed}
          destinationInConnection={section === 3 && i === 0}
        />
      ))}
      <p className="muted small">
        動作は「何回目の実行か」で切り替わります: 1 回目は動作 1、2 回目は動作 2、3 回目以降は動作 3
        (無ければ前の動作)。条件で選ばれるのでも、1 回で順に実行されるのでもありません。
      </p>
      <details>
        <summary className="small">イベント番号・状態の枠などの詳細</summary>
        <p className="muted small">{`イベント #${row} (${t.name})${row >= t.originalRows ? ' (追加したイベント)' : ''}`}</p>
        {u16f(LANAI_EVENT_SLOT, `状態の枠 (+0x58、${LANAI_SLOT_IS_ROW} = イベント番号)`)}
        <p className="muted small">
          {`使う枠 ${slot}・MapGroup の枠 ${group?.stateCount ?? '?'} 個 (先頭 ${group?.stateFirst ?? '?'})`}
          {group && slot >= group.stateCount ? '。枠の数以上なので状態は保存されません' : ''}
        </p>
        {u16f(
          LANAI_EVENT_LEVEL,
          levelDoor
            ? '+0x5C: 必要レベル (レベルの扉)'
            : section === 8
              ? '+0x5C (bit 15 = 歩いて入る。0 = 範囲内で A。下位 15 bit は未解析)'
              : '+0x5C (レベルの扉では必要レベル。ほかは未解析)',
        )}
        {u8f(0x5e, '+0x5E (未解析)')}
        <details>
          <summary className="small">{`イベントのバイト (${t.rowSize})`}</summary>
          <RawBytes bytes={t.row(row)} rows={4} onChange={(b) => st.setEventField(row, (x) => x.setRow(row, b))} />
        </details>
      </details>
    </>
  );
}
