// The maps of 電波人間のRPG FREE! (#/maps/<content>.<name>; naauao lanai/map.md), edited with the parts of the other
// map editors: the editing model and tools (editor/model.ts, editor/controller.ts; lanai: mapedit.ts LanaiEditState),
// the views (mapview.ts), the tool buttons, palette and checks (editor/panes.tsx, editor/palette.tsx), the map picker.
// Header: the content and the map, view mode, undo, the MOD export. Left: tools, adding records, the tileset's palette
// and the layers; right: the map's facts, the selected tile or record, the checks and the stages that use the content.
// Every edit goes to the content's map database and is saved with the session's edits (session.ts).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { editorKey } from '../editor/controller';
import { kindName, SECTION_COLORS } from '../editor/legend';
import { tileAt, type Issue } from '../editor/model';
import { Palette } from '../editor/palette';
import { IssueList, Tools, TOOLS } from '../editor/panes';
import { readField, writeField, type FieldDef } from '../game/tabledef';
import { LANAI_ROT_CODEC, LETTER_DEFAULT, letterIndex, letterLabel, recCellPos, type Rec } from '../game/sections';
import { romfsHref } from '../romfs/RomfsPage';
import { NumberInput, useSticky } from '../ui/book';
import { MapPickerButton, type MapPickerGroups } from '../ui/MapPicker';
import { useAsync } from '../ui/useAsync';
import { useEditorState, useSignal } from '../ui/useEditorState';
import { hex8, u32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { LanaiExportDialog } from './ExportDialog';
import { lanaiEditState, lanaiRecEventRow, lanaiRecLabel, lanaiStampLabel, lanaiValidate, type LanaiEditState, type LanaiStamp } from './mapedit';
import { LANAI_FACING_OFFSET, LANAI_LAYOUTS, LANAI_POINT_SECTIONS, lanaiFloorLabel, lanaiMaps, type LanaiMapInfo, type LanaiMaps } from './maps';
import { LanaiMapView } from './mapview';
import type { LanaiSession } from './session';

/** The link to a map of a content (the stage page's list uses it too). */
export const lanaiMapHref = (content: number, name?: string): string => `#/maps/${content}${name ? `.${encodeURIComponent(name)}` : ''}`;

type Mode = 'split' | '2d' | '3d';

/** The tools of RPG FREE!'s map page: section 6 holds MonsterGroup row IDs here, so its cells are not toggled. */
const LANAI_TOOLS = TOOLS.filter(([t]) => t !== 'room');

/** Re-render on every change of the content's maps (edits, reverts, sections put back). */
function useMaps(maps: LanaiMaps): number {
  return useSyncExternalStore((f) => maps.on(f), () => maps.revision, () => maps.revision);
}

/** Re-render on every edit of the session (the export button counts them). */
function useSession(session: LanaiSession): number {
  return useSyncExternalStore((f) => session.onEdit(f), () => session.revision, () => session.revision);
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
  const revision = useMaps(maps);
  useSession(session);
  const groups = useMemo(() => mapGroups(maps), [maps, revision]);
  const st = lanaiEditState(maps);
  useEditorState(st);
  const [mode, setMode] = useState<Mode>('split');
  const [view, setView] = useState<LanaiMapView | null>(null);
  const [exporting, setExporting] = useState(false);
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
  const modified = new Set(maps.maps.filter((m) => maps.isChanged(m)).map((m) => m.hash));
  const edits = session.changedMapDbs().reduce((n, x) => n + x.sections, 0) + session.changedTables().length;
  return (
    <div className="oahu-map" data-mode={mode}>
      <header>
        <ContentSelect contents={contents} value={content.index} />
        <MapPickerButton groups={groups} value={info.hash} className="map-select" modified={modified}
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
        {open && (
          <span className="seg">
            <button title="元に戻す (Ctrl+Z)" disabled={!st.canUndo()} onClick={() => st.undo()}>↶ 戻す</button>
            <button title="やり直す (Ctrl+Y)" disabled={!st.canRedo()} onClick={() => st.redo()}>↷ やり直し</button>
          </span>
        )}
        {view && <button onClick={() => view.fit()}>全体を表示</button>}
        {view && <button onClick={() => view.scene.topView()}>真上から</button>}
        {open && maps.isChanged(info) && <button onClick={() => st.revert()}>このマップの変更を元に戻す</button>}
        <button title="変更した表・マップを LayeredFS の MOD にする" onClick={() => setExporting(true)}>{`MOD を書き出す${edits ? ` (${edits})` : ''}`}</button>
        {exporting && <LanaiExportDialog session={session} onClose={() => setExporting(false)} />}
      </header>
      {info.world ? (
        <p className="book-desc" style={{ padding: 16 }}>ワールドマップ (W01) の区画は別の形 (naauao lanai/map.md §13) なので、まだ表示・編集できません。</p>
      ) : (
        <>
          <aside className="left">
            {open && (
              <>
                <Tools st={st} tools={LANAI_TOOLS} />
                <AddPanel st={st} view={view} />
                <TilePalette st={st} view={view} />
                <Layers view={view} />
              </>
            )}
          </aside>
          <div className="views">
            <div className="pane pane2d" ref={pane2d} />
            <div className="pane pane3d" ref={pane3d} />
          </div>
          <aside className="right">
            {open && (
              <>
                <Facts maps={maps} info={info} view={view} />
                <Inspector st={st} view={view} />
                <h3>検証</h3>
                <Checks st={st} info={info} />
              </>
            )}
          </aside>
          <div className="status">{view ? <Status st={st} view={view} /> : null}</div>
        </>
      )}
    </div>
  );
}

function Status({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  useSignal(view.hover);
  useEditorState(st);
  const hv = view.ctl.hover;
  const parts: string[] = [];
  if (hv) parts.push(`セル (${hv[0]}, ${hv[1]})`);
  parts.push(`ツール: ${st.tool}`);
  if (st.clip) parts.push(`コピー ${st.clip.w}×${st.clip.h}`);
  if (view.status) parts.push(view.status);
  if (view.errorMsg) parts.push(`⚠ ${view.errorMsg}`);
  if (!view.status && !view.errorMsg) parts.push('右ドラッグ: 2D は移動、3D は回転 / 中ドラッグ: 3D の移動 / ホイール: 拡大');
  return <>{parts.join('   ')}</>;
}

/** The tileset's tile kinds (MapParts<name>: kind + 1 -> 8 letters) with thumbnails of their models. */
function TilePalette({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  useEditorState(st);
  const palette = useMemo(() => st.maps.palette(st.tileset), [st.maps, st.tileset]);
  return <Palette st={st} factory={view.factory} palette={palette} partModel={(k, l) => st.maps.partModel(st.tileset, k, l)} />;
}

/** What the views show. */
function Layers({ view }: { view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  useEditorState(view.st);
  const layers = view.ctl.layers;
  const doc = view.doc;
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

/** The map's facts: group, floor, MapData and tileset (they follow the edits: indoor tiles switch the MapData). */
function Facts({ maps, info, view }: { maps: LanaiMaps; info: LanaiMapInfo; view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  useEditorState(view.st);
  const src = view.source;
  const group = maps.group(info);
  const events = maps.eventTable(info.dungeon);
  return (
    <>
      <h3>マップ</h3>
      <p className="small">
        {`MapGroup ${info.dungeon}${maps.groupName(info.dungeon) ? ` 「${maps.groupName(info.dungeon)}」` : ''}`}
        <br />{`階 ${info.floor}・敵の出方 ${info.encounterLevel}`}
        <br />{src.mapData < 0 ? 'MapData が見つかりません' : `MapData 行 ${src.mapData}・タイルセット ${src.tileset} (${src.partsName || 'MapParts なし'})・MapResource 行 ${src.resource}`}
        {group && <><br />{`最初のマップ ${hex8(group.firstMap).toUpperCase()}`}</>}
        <br />{events ? `EventObject: ${events.name} (${events.rows} 行)` : 'EventObject の表なし'}
      </p>
    </>
  );
}

/** Checks of the open map (only the problems the ROM's map does not already have). */
function Checks({ st, info }: { st: LanaiEditState; info: LanaiMapInfo }): ReactNode {
  const revision = useEditorState(st);
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const doc = st.current;
      if (doc?.hash === info.hash) setIssues(lanaiValidate(st.maps, info, doc));
    }, 250);
    return () => clearTimeout(t);
  }, [st, info, revision]);
  return <IssueList st={st} issues={issues} />;
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

function Inspector({ st, view }: { st: LanaiEditState; view: LanaiMapView }): ReactNode {
  useEditorState(st);
  const sel = st.selection;
  const doc = view.doc;
  if (sel.type === 'rec' && doc.recs[sel.section]?.[sel.index])
    return <RecFields st={st} section={sel.section} rec={doc.recs[sel.section]![sel.index]!} index={sel.index} />;
  if (sel.type === 'tiles' && sel.cells.length === 1) {
    const [x, y] = sel.cells[0]!;
    if (tileAt(doc, x, y)) return <TileFields st={st} view={view} x={x} y={y} />;
  }
  if (sel.type === 'tiles' && sel.cells.length > 1) return <p className="muted small">{`${sel.cells.length} マスを選択中 (R で回す、[ ] で文字を変える、Delete で消す)`}</p>;
  if (sel.type === 'rect') return <p className="muted small">範囲を選択中 (Ctrl+C でコピー、Ctrl+V で貼り付け、Shift+矢印で中身ごと動かす、Delete で消す)</p>;
  return <p className="muted small">タイルかレコードを選んでください。B でタイルを置く、E で消す、M で範囲選択。</p>;
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
          {[0, 1, 2, 3].map((r) => <option key={r} value={r}>{`${['↑', '→', '↓', '←'][r]} ${r} (バイト ${LANAI_ROT_CODEC.encode(r)})`}</option>)}
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

function RecFields({ st, section, rec, index }: { st: LanaiEditState; section: number; rec: Rec; index: number }): ReactNode {
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
