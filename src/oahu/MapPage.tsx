// RPG3's maps (#/maps/NAME; naauao oahu/map.md), edited with the parts of RPG2's map editor: the editing model and
// tools (editor/state.ts, editor/controller.ts), the views (editor/gridcanvas.ts, editor/mapscene.ts), the tool
// buttons, palette and checks (editor/panes.tsx, editor/palette.tsx). Left: tools, adding records, the tileset's
// palette and the layers; right: the inspector of the selected tile or record (and the EventObject row it names)
// and the checks.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readField, writeField, type FieldDef } from '../game/tabledef';
import { LETTER_DEFAULT, letterLabel, type Rec } from '../game/sections';
import { editorKey } from '../editor/controller';
import { kindName, SECTION_COLORS } from '../editor/legend';
import { Palette } from '../editor/palette';
import { IssueList, Tools } from '../editor/panes';
import { tileAt } from '../editor/state';
import type { Issue } from '../editor/validate';
import { NumberInput, useSticky } from '../ui/book';
import { useEditorState, useSignal } from '../ui/useEditorState';
import { hex8 } from '../util/bytes';
import { EventObjectEditor } from './EventObjectEditor';
import { OAHU_LAYOUTS, oahuFloorLabel, oahuRecEventRow, type OahuMapInfo, type OahuMaps } from './maps';
import { OAHU_POINT_SECTIONS, oahuEditState, oahuRecLabel, oahuStampLabel, oahuValidate, type OahuEditState, type OahuStamp } from './mapedit';
import { OahuMapView } from './mapview';
import type { OahuSession } from './session';

export const oahuMapHref = (m: OahuMapInfo): string => `#/maps/${encodeURIComponent(m.name)}`;

/** Re-render on every change of the maps (edits, loaded event tables). */
export function useMaps(maps: OahuMaps): number {
  return useSyncExternalStore((f) => maps.on(f), () => maps.revision);
}

/** "D10 ダンジョン名" for a mapGroup row. */
export function oahuDungeonLabel(session: OahuSession, row: number): string {
  const d = session.maps.dungeons[row];
  if (!d) return `ダンジョン ${row}`;
  const name = d.nameId ? session.messages.texts.preview(d.nameId, true) : '';
  return `${d.code || `#${row}`}${name ? ` ${name}` : ''}`;
}

export function OahuMapPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { maps } = session;
  useMaps(maps);
  const [query, setQuery] = useState('');
  const name = useSticky(arg ? decodeURIComponent(arg) : undefined, (n) => !!maps.mapByName(n), () => (maps.mapByName('D10B01001') ?? maps.maps[0]!).name);
  const info = maps.mapByName(name)!;
  // the dungeons' event codes (D10 …) come with their tables
  useEffect(() => {
    for (const d of maps.dungeons) if (d.archive && !d.code) void maps.eventTable(d).catch(() => null);
  }, [maps]);
  const groups = useMemo(() => {
    const q = query.trim().toUpperCase();
    const out = new Map<number, OahuMapInfo[]>();
    for (const m of maps.maps) if (!q || m.name.includes(q)) out.set(m.dungeon, [...(out.get(m.dungeon) ?? []), m]);
    return [...out].sort(([a], [b]) => a - b);
  }, [maps, query]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }, [name]);
  return (
    <div className="book">
      <div className="book-side">
        <div className="row"><input type="search" placeholder="マップ名で検索 (D10B01001)" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="book-list" ref={list}>
          <table className="book-table">
            <tbody>
              {groups.map(([d, ms]) => [
                <tr key={`d${d}`} className="group"><th colSpan={3}>{oahuDungeonLabel(session, d)}</th></tr>,
                ...ms.map((m) => (
                  <tr key={m.hash} className={m.name === name ? 'active' : ''} onClick={() => (location.hash = oahuMapHref(m))}>
                    <td>{m.name}{maps.isChanged(m) && <span className="edited-mark"> ●</span>}</td>
                    <td className="num muted">{oahuFloorLabel(m.floor)}</td>
                    <td className="num muted small">{m.world ? '' : `${maps.doc(m).tiles.length} マス`}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
      <div className="map-detail">
        <MapDetail key={info.hash} session={session} info={info} />
      </div>
    </div>
  );
}

type Mode = 'split' | '2d' | '3d';

function MapDetail({ session, info }: { session: OahuSession; info: OahuMapInfo }): ReactNode {
  const { maps } = session;
  const st = oahuEditState(maps);
  const [view, setView] = useState<OahuMapView | null>(null);
  const [mode, setMode] = useState<Mode>('split');
  const pane2d = useRef<HTMLDivElement>(null);
  const pane3d = useRef<HTMLDivElement>(null);
  useEditorState(st);
  useEffect(() => {
    if (info.world) return;
    st.open(info);
    const v = new OahuMapView(session.dump, st, info);
    pane2d.current!.append(v.grid.canvas);
    pane3d.current!.append(v.scene.canvas);
    setView(v);
    requestAnimationFrame(() => v.fit());
    // edits are saved (IndexedDB) as they happen
    const off = st.on((what) => what === 'doc' && session.scheduleSave());
    const onKey = (e: KeyboardEvent): void => {
      if (!location.hash.startsWith('#/maps') || document.querySelector('dialog[open], .modal')) return;
      if (editorKey(e, v.ctl, () => maps.palette(st.tileset).get(st.brush.kind) ?? [0])) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
      v.grid.canvas.remove();
      v.scene.canvas.remove();
      v.dispose();
    };
  }, [session, maps, st, info]);
  useEffect(() => {
    requestAnimationFrame(() => view?.refresh());
  }, [view, mode]);
  const open = view && st.current?.hash === info.hash;
  return (
    <div className="oahu-map" data-mode={mode}>
      <header>
        <b className="map-title">{info.name}</b>
        <span className="muted small">{`${oahuDungeonLabel(session, info.dungeon)}・${oahuFloorLabel(info.floor) || '地上'}・マップ表の行 ${info.index}・${hex8(info.hash).toUpperCase()}`}</span>
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
      </header>
      {info.world ? (
        <p className="book-desc" style={{ padding: 16 }}>ワールドマップ (W01) の区画は別の形 (naauao oahu/map.md §8) なので、まだ表示できません。</p>
      ) : (
        <>
          <aside className="left">
            {open && (
              <>
                <Tools st={st} />
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
                <Inspector session={session} st={st} view={view} />
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

function Status({ st, view }: { st: OahuEditState; view: OahuMapView }): ReactNode {
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

/** The tileset's tile kinds (mapParts: 67 rows × 16 tilesets) with thumbnails of their models. */
function TilePalette({ st, view }: { st: OahuEditState; view: OahuMapView }): ReactNode {
  useSignal(view.signal);
  useEditorState(st);
  const palette = useMemo(() => st.maps.palette(st.tileset), [st.maps, st.tileset]);
  return <Palette st={st} factory={view.factory} palette={palette} partModel={(k, l) => st.maps.partModel(k, st.tileset, l)} />;
}

/** What the views show. */
function Layers({ view }: { view: OahuMapView }): ReactNode {
  useSignal(view.signal);
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
      {OAHU_POINT_SECTIONS.map((k) => box(`${OAHU_LAYOUTS[k]!.label} ${doc.recs[k]?.length ?? 0}`, !!layers.sections[k], (v) => (layers.sections[k] = v), SECTION_COLORS[k]))}
    </div>
  );
}

/** The checks of the open map (only the problems the ROM's map does not already have). */
function Checks({ st, info }: { st: OahuEditState; info: OahuMapInfo }): ReactNode {
  const revision = useEditorState(st);
  useMaps(st.maps);
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const doc = st.current;
      if (doc?.hash === info.hash) setIssues(oahuValidate(st.maps, info, doc));
    }, 250);
    return () => clearTimeout(t);
  }, [st, info, revision]);
  return <IssueList st={st} issues={issues} />;
}

/** Adding records: props (section 2) and copies of the dungeon's records, each with its own EventObject row. */
function AddPanel({ st, view }: { st: OahuEditState; view: OahuMapView }): ReactNode {
  useEditorState(st);
  useMaps(st.maps);
  const [dir, setDir] = useState(0);
  const [propRow, setPropRow] = useState(1);
  const dungeon = st.dungeon;
  const table = dungeon ? st.maps.loadedEventTable(dungeon) : null;
  useEffect(() => {
    if (dungeon && !table) void st.maps.eventTable(dungeon).catch(() => null);
  }, [st, dungeon, table]);
  const templates = useMemo(() => (table ? st.templates() : []), [st, table, st.info]);
  const active = st.tool === 'place' && st.stamp ? st.stamp : null;
  const use = (stamp: OahuStamp): void => {
    st.stamp = stamp;
    st.setTool('place');
  };
  // props of the dungeon's maps, most used first
  const props = useMemo(() => {
    const n = new Map<number, number>();
    for (const m of st.maps.maps) if (m.dungeon === st.info?.dungeon && !m.world) for (const r of st.maps.doc(m).recs[2] ?? []) n.set(r.raw[0]! | (r.raw[1]! << 8), (n.get(r.raw[0]! | (r.raw[1]! << 8)) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([row]) => row).filter((row) => st.maps.objectModel(row));
  }, [st, st.info]);
  const sel = st.selection;
  const added = table && dungeon ? table.rows - st.maps.originalEventRows(dungeon) : 0;
  return (
    <div className="add-panel">
      <h3>追加</h3>
      <div className="muted small">{!dungeon?.archive ? 'このダンジョンにはイベントの表がありません' : table ? `EventObject: ${table.rows} 行${added ? ` (うち追加 ${added} 行)` : ''}` : 'イベントの表を読み込み中…'}</div>
      <h4>置物 (区画 2)</h4>
      <div className="row">
        <span className="muted small">向き</span>
        {['↑', '→', '↓', '←'].map((l, i) => (
          <button key={i} className={dir === i ? 'active' : ''} title={`${i * 90}°`} onClick={() => {
            setDir(i);
            if (active?.type === 'prop') use({ ...active, dir: i });
          }}>{l}</button>
        ))}
      </div>
      <div className="row">
        <label className="small">{'mapObject の行 '}<NumberInput value={propRow} min={1} max={st.maps.objectRows - 1} onCommit={setPropRow} /></label>
        <button className={active?.type === 'prop' && active.row === propRow ? 'active' : ''} disabled={!st.maps.objectModel(propRow)} onClick={() => use({ type: 'prop', row: propRow, dir })}>置く</button>
      </div>
      <details className="obj-group">
        <summary>{`このダンジョンの置物 (${props.length})`}</summary>
        <div className="pal-items obj-items">
          {props.map((row) => (
            <button key={row} className={'pal-item obj-item' + (active?.type === 'prop' && active.row === row ? ' active' : '')} title={`mapObject #${row}`} onClick={() => { setPropRow(row); use({ type: 'prop', row, dir }); }}>
              <span className="pal-label">{`#${row}`}</span>
            </button>
          ))}
        </div>
      </details>
      <h4>このダンジョンのレコードの写し</h4>
      {!table ? <div className="muted small">{dungeon?.archive ? '読み込み中…' : 'イベントの表がないので写せません'}</div>
        : ([[3, '出入口・扉 (区画 3)'], [4, '宝箱 (区画 4)'], [5, 'キャラ・オブジェクト (区画 5)'], [8, 'イベントの範囲 (区画 8)'], [1, '床のギミック (区画 1)'], [9, '地点 (区画 9)']] as const).map(([k, label]) => {
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
      {active && <div className="place-hint">{`置くもの: ${oahuStampLabel(active)}。マップをクリックして置く (Esc で終わる)`}</div>}
      {sel.type === 'rec' && (
        <div className="row">
          <button title="複製 (Ctrl+D)" onClick={() => view.ctl.duplicateRec()}>選んだレコードを複製</button>
          <button title="削除 (Delete)" onClick={() => view.ctl.deleteSelection()}>削除</button>
        </div>
      )}
      <p className="muted small">
        EventObject の行を持つレコード (出入口・宝箱・キャラ・範囲) を写すと、行も写して新しい行にします (状態の枠が 0xFFFF の行は、新しい行番号の枠を使います)。出入口には新しい地点 ID を付けます。
      </p>
    </div>
  );
}

/** Fields of a section's records besides the position (§3). */
const REC_FIELDS: Record<number, FieldDef[]> = {
  1: [{ key: 'c', offset: 0x0c, type: 'u8', label: '+0x0C' }, { key: 'kind', offset: 0x0d, type: 'u8', label: '種類 (+0x0D)' }],
  2: [{ key: 'row', offset: 0, type: 'u16', label: 'mapObject の行' }, { key: 'dir', offset: 0x10, type: 'u8', label: '向き (0〜3)' }],
  3: [{ key: 'id', offset: 0, type: 'u32', label: '地点 ID' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }, { key: 'dir', offset: 0x14, type: 'u8', label: '向き' }, { key: 'kind', offset: 0x15, type: 'u8', label: '種類 (0x64 = 壁の扉)' }],
  4: [{ key: 'a', offset: 0, type: 'u32', label: '+0x00' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }],
  5: [{ key: 'type', offset: 0, type: 'u32', label: '種類 (0〜2 = キャラクター)' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }],
  8: [{ key: 'type', offset: 0, type: 'u32', label: '種類 (100 以上 = 置物)' }, { key: 'ev', offset: 4, type: 'u32', label: 'EventObject の行' }],
  9: [{ key: 'type', offset: 0, type: 'u32', label: '種類' }, { key: 'v', offset: 8, type: 'u8', label: '+0x08' }],
};

function Inspector({ session, st, view }: { session: OahuSession; st: OahuEditState; view: OahuMapView }): ReactNode {
  useEditorState(st);
  useMaps(st.maps);
  const sel = st.selection;
  const doc = view.doc;
  if (sel.type === 'rec' && doc.recs[sel.section]?.[sel.index])
    return <RecFields session={session} st={st} section={sel.section} rec={doc.recs[sel.section]![sel.index]!} index={sel.index} />;
  if (sel.type === 'tiles' && sel.cells.length === 1) {
    const [x, y] = sel.cells[0]!;
    if (tileAt(doc, x, y)) return <TileFields st={st} x={x} y={y} />;
  }
  if (sel.type === 'tiles' && sel.cells.length > 1) return <p className="muted small">{`${sel.cells.length} マスを選択中 (R で回す、[ ] で文字を変える、Delete で消す)`}</p>;
  if (sel.type === 'rect') return <p className="muted small">範囲を選択中 (Ctrl+C でコピー、Ctrl+V で貼り付け、Shift+矢印で中身ごと動かす、Delete で消す)</p>;
  return <p className="muted small">タイルかレコードを選んでください。</p>;
}

function TileFields({ st, x, y }: { st: OahuEditState; x: number; y: number }): ReactNode {
  const doc = st.current!;
  const t = tileAt(doc, x, y)!;
  const src = st.maps.tileSource(st.info!, doc);
  const model = st.maps.partModel(t.kind, src.tileset, t.letter >= 0x61 && t.letter <= 0x67 ? t.letter - 0x60 : 0);
  const cell6 = doc.cells6.find((c) => c.x === x && c.y === y);
  return (
    <>
      <h3>{`タイル (${t.x}, ${t.y})`}</h3>
      <label className="field"><span>種類</span><NumberInput value={t.kind} min={0} max={65} onCommit={(v) => st.edit(() => { t.kind = v; })} /></label>
      <p className="muted small">{kindName(t.kind)}</p>
      <label className="field"><span>向き</span>
        <select value={t.rot} onChange={(e) => st.edit(() => { t.rot = Number(e.target.value); })}>
          {['↑ 0', '→ 1', '↓ 2', '← 3'].map((l, i) => <option key={i} value={i}>{l}</option>)}
        </select>
      </label>
      <label className="field"><span>文字 (部品の差分)</span>
        <select value={t.letter} onChange={(e) => st.edit(() => { t.letter = Number(e.target.value); })}>
          <option value={LETTER_DEFAULT}>なし (z)</option>
          {Array.from({ length: 7 }, (_, i) => 0x61 + i).map((c) => <option key={c} value={c}>{letterLabel(c)}</option>)}
          {t.letter !== LETTER_DEFAULT && !(t.letter >= 0x61 && t.letter <= 0x67) && <option value={t.letter}>{`0x${t.letter.toString(16)}`}</option>}
        </select>
      </label>
      <p className="muted small">{`タイルセット ${src.tileset} (mapData ${src.mapData})・モデル ${model ? hex8(model).toUpperCase() : 'なし'} (${src.modelArchive})`}</p>
      {cell6 && <p className="muted small">{`区画 6 のセル: 値 ${cell6.value ? hex8(cell6.value).toUpperCase() : '0 (敵が出ない)'}`}</p>}
    </>
  );
}

function RecFields({ session, st, section, rec, index }: {
  session: OahuSession;
  st: OahuEditState;
  section: number;
  rec: Rec;
  index: number;
}): ReactNode {
  const { maps } = session;
  const info = st.info!;
  const L = OAHU_LAYOUTS[section]!;
  const dungeon = maps.dungeonOf(info);
  const table = dungeon ? maps.loadedEventTable(dungeon) : null;
  useEffect(() => {
    if (dungeon && !table) void maps.eventTable(dungeon).catch(() => null);
  }, [maps, dungeon, table]);
  const evRow = oahuRecEventRow(section, rec.raw);
  const hasEvent = [3, 4, 5, 8].includes(section) && !(section === 8 && readField(rec.raw, REC_FIELDS[8]![0]!) >= 100);
  const max = L.unit === 'cell' ? 29 : 299;
  return (
    <>
      <h3>{`${L.label} #${index}`}</h3>
      <p className="muted small">{oahuRecLabel(section, rec.raw)}</p>
      <div className="row">
        <label className="field"><span>{`x (${L.unit === 'cell' ? 'マス' : L.unit === 'quarter' ? '1/4 マス' : '1/5 マス'})`}</span><NumberInput value={rec.x} min={0} max={max} onCommit={(v) => st.edit(() => { rec.x = v; })} /></label>
        <label className="field"><span>y</span><NumberInput value={rec.y} min={0} max={max} onCommit={(v) => st.edit(() => { rec.y = v; })} /></label>
      </div>
      {(REC_FIELDS[section] ?? []).map((f) => (
        <label key={f.key} className="field"><span>{f.label}</span>
          <NumberInput value={readField(rec.raw, f)} min={0} max={f.type === 'u8' ? 255 : f.type === 'u16' ? 0xffff : 0x7fffffff} onCommit={(v) => st.edit(() => writeField(rec.raw, f, v))} />
        </label>
      ))}
      <details>
        <summary className="small">{`レコードのバイト (${rec.raw.length})`}</summary>
        <code className="small mono" style={{ wordBreak: 'break-all' }}>{[...rec.raw].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</code>
      </details>
      {hasEvent && (
        <>
          <hr />
          <h3>
            {`EventObject の行 ${evRow}`}
            {' '}<a className="small" href={`#/events/${info.dungeon}.${evRow}`}>イベント一覧で見る</a>
          </h3>
          {!dungeon?.archive ? <p className="muted small">このダンジョンにはイベント表がありません。</p>
            : !table ? <p className="muted small">読み込み中…</p>
            : evRow >= table.rows ? <p className="warn-box">{`表は ${table.rows} 行です。`}</p>
            : <EventObjectEditor maps={maps} row={table.row(evRow)} original={maps.originalEventRow(dungeon, evRow)} edit={(f) => st.editTables(f)} onEdit={() => { maps.changed(); session.scheduleSave(); }} />}
        </>
      )}
    </>
  );
}
