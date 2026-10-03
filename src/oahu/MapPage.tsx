// RPG3's maps (#/maps/NAME; naauao oahu/map.md), built from the parts of RPG2's map editor (editor/gridcanvas.ts,
// editor/mapscene.ts): the maps by dungeon, the top-down and 3D views, and an inspector for the selected tile or
// record and the EventObject row it names. Records move by dragging; fields are edited in the inspector.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readField, writeField, type FieldDef } from '../game/tabledef';
import { LETTER_DEFAULT, letterLabel, type Rec } from '../game/sections';
import { kindName, SECTION_COLORS } from '../editor/legend';
import { NumberInput, useSticky } from '../ui/book';
import { useSignal } from '../ui/useEditorState';
import { hex8 } from '../util/bytes';
import { EventObjectEditor } from './EventObjectEditor';
import { OAHU_LAYOUTS, oahuFloorLabel, oahuRecEventRow, type OahuMapInfo, type OahuMaps } from './maps';
import { OahuMapView, OAHU_POINT_SECTIONS } from './mapview';
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
  const [view, setView] = useState<OahuMapView | null>(null);
  const [mode, setMode] = useState<Mode>('split');
  const pane2d = useRef<HTMLDivElement>(null);
  const pane3d = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (info.world) return;
    const v = new OahuMapView(session.dump, maps, info, maps.doc(info));
    pane2d.current!.append(v.grid.canvas);
    pane3d.current!.append(v.scene.canvas);
    setView(v);
    requestAnimationFrame(() => v.fit());
    return () => {
      v.grid.canvas.remove();
      v.scene.canvas.remove();
      v.dispose();
    };
  }, [session, maps, info]);
  useEffect(() => {
    requestAnimationFrame(() => view?.refresh());
  }, [view, mode]);
  const dungeon = maps.dungeonOf(info);
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
        {view && <button onClick={() => view.fit()}>全体を表示</button>}
        {view && <button onClick={() => view.scene.topView()}>真上から</button>}
        {maps.isChanged(info) && <button onClick={() => { maps.revert(info); session.scheduleSave(); }}>このマップの変更を元に戻す</button>}
      </header>
      {info.world ? (
        <p className="book-desc" style={{ padding: 16 }}>ワールドマップ (W01) の区画は別の形 (naauao oahu/map.md §8) なので、まだ表示できません。</p>
      ) : (
        <>
          <div className="views">
            <div className="pane pane2d" ref={pane2d} />
            <div className="pane pane3d" ref={pane3d} />
          </div>
          <aside className="right">{view && <Inspector session={session} view={view} dungeonArchive={dungeon?.archive ?? ''} />}</aside>
          <div className="status">{view ? <Status view={view} /> : null}</div>
        </>
      )}
    </div>
  );
}

function Status({ view }: { view: OahuMapView }): ReactNode {
  useSignal(view.signal);
  return <>{view.status || '左ドラッグ: 選ぶ・レコードを動かす / 右ドラッグ: 2D は移動、3D は回転 / 中ドラッグ: 3D の移動 / ホイール: 拡大'}</>;
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

function Inspector({ session, view, dungeonArchive }: { session: OahuSession; view: OahuMapView; dungeonArchive: string }): ReactNode {
  useSignal(view.signal);
  const { maps } = session;
  useMaps(maps);
  const sel = view.selection;
  const doc = view.doc;
  const edited = (): void => {
    view.commit();
    session.scheduleSave();
  };
  return (
    <>
      <div className="layers">
        {OAHU_POINT_SECTIONS.map((k) => (
          <label key={k} className="layer">
            <input type="checkbox" checked={view.layers[k]} onChange={(e) => { view.layers[k] = e.target.checked; view.refresh(); }} />
            <span style={{ color: SECTION_COLORS[k] }}>● </span>{`${OAHU_LAYOUTS[k]!.label} ${doc.recs[k]?.length ?? 0}`}
          </label>
        ))}
      </div>
      <hr />
      {sel.type === 'none' && <p className="muted small">タイルかレコードを選んでください。</p>}
      {sel.type === 'tile' && doc.tiles[sel.index] && <TileFields session={session} view={view} index={sel.index} onEdit={edited} />}
      {sel.type === 'rec' && doc.recs[sel.section]?.[sel.index] && (
        <RecFields session={session} section={sel.section} rec={doc.recs[sel.section]![sel.index]!} index={sel.index} dungeonArchive={dungeonArchive} view={view} onEdit={edited} />
      )}
    </>
  );
}

function TileFields({ session, view, index, onEdit }: { session: OahuSession; view: OahuMapView; index: number; onEdit: () => void }): ReactNode {
  const t = view.doc.tiles[index]!;
  const src = session.maps.tileSource(view.info, view.doc);
  const model = session.maps.partModel(t.kind, src.tileset, t.letter >= 0x61 && t.letter <= 0x67 ? t.letter - 0x60 : 0);
  return (
    <>
      <h3>{`タイル (${t.x}, ${t.y})`}</h3>
      <label className="field"><span>種類</span><NumberInput value={t.kind} min={0} max={65} onCommit={(v) => { t.kind = v; onEdit(); }} /></label>
      <p className="muted small">{kindName(t.kind)}</p>
      <label className="field"><span>向き</span>
        <select value={t.rot} onChange={(e) => { t.rot = Number(e.target.value); onEdit(); }}>
          {['↑ 0', '→ 1', '↓ 2', '← 3'].map((l, i) => <option key={i} value={i}>{l}</option>)}
        </select>
      </label>
      <label className="field"><span>文字 (部品の差分)</span>
        <select value={t.letter} onChange={(e) => { t.letter = Number(e.target.value); onEdit(); }}>
          <option value={LETTER_DEFAULT}>なし (z)</option>
          {Array.from({ length: 7 }, (_, i) => 0x61 + i).map((c) => <option key={c} value={c}>{letterLabel(c)}</option>)}
          {t.letter !== LETTER_DEFAULT && !(t.letter >= 0x61 && t.letter <= 0x67) && <option value={t.letter}>{`0x${t.letter.toString(16)}`}</option>}
        </select>
      </label>
      <p className="muted small">{`タイルセット ${src.tileset} (mapData ${src.mapData})・モデル ${model ? hex8(model).toUpperCase() : 'なし'} (${src.modelArchive})`}</p>
    </>
  );
}

function RecFields({ session, section, rec, index, dungeonArchive, view, onEdit }: {
  session: OahuSession;
  section: number;
  rec: Rec;
  index: number;
  dungeonArchive: string;
  view: OahuMapView;
  onEdit: () => void;
}): ReactNode {
  const { maps } = session;
  const L = OAHU_LAYOUTS[section]!;
  const dungeon = maps.dungeonOf(view.info);
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
      <div className="row">
        <label className="field"><span>{`x (${L.unit === 'cell' ? 'マス' : L.unit === 'quarter' ? '1/4 マス' : '1/5 マス'})`}</span><NumberInput value={rec.x} min={0} max={max} onCommit={(v) => { rec.x = v; onEdit(); }} /></label>
        <label className="field"><span>y</span><NumberInput value={rec.y} min={0} max={max} onCommit={(v) => { rec.y = v; onEdit(); }} /></label>
      </div>
      {(REC_FIELDS[section] ?? []).map((f) => (
        <label key={f.key} className="field"><span>{f.label}</span>
          <NumberInput value={readField(rec.raw, f)} min={0} max={f.type === 'u8' ? 255 : f.type === 'u16' ? 0xffff : 0x7fffffff} onCommit={(v) => { writeField(rec.raw, f, v); onEdit(); }} />
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
            {' '}<a className="small" href={`#/events/${view.info.dungeon}.${evRow}`}>イベント一覧で見る</a>
          </h3>
          {!dungeonArchive ? <p className="muted small">このダンジョンにはイベント表がありません。</p>
            : !table ? <p className="muted small">読み込み中…</p>
            : evRow >= table.rows ? <p className="warn-box">{`表は ${table.rows} 行です。`}</p>
            : <EventObjectEditor maps={maps} row={table.row(evRow)} original={maps.originalEventRow(dungeon!, evRow)} onEdit={() => { maps.changed(); session.scheduleSave(); }} />}
        </>
      )}
    </>
  );
}
