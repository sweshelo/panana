// Inspector: properties of the selection (tile / point record / rectangle) or of the map.
import { useState, type ReactNode } from 'react';
import { LAYOUTS, LETTER_DEFAULT, P3, POINT_SECTIONS, letterByte, letterIndex, loadDoc, pointKindLabel, recCellPos, type MapDoc, type Rec } from '../game/sections';
import { hex8, u32, w32 } from '../util/bytes';
import { norm } from './controller';
import { kindName, ROT_ARROW, SECTION_COLORS } from './legend';
import { tileAt } from './state';
import { mapLabel, pointLabel, worldHref } from './labels';
import { TreasureEditor } from './treasure';
import { EventListDialog, EventPanel } from './events';
import { EncounterPanel } from './encounters';
import { MapSoundPanel } from './sounds';
import { Field, HexInput, Num, RawBytes } from './fields';
import type { MapEditor } from './mapeditor';
import { mapTitle } from '../game/names';
import { SECTION1_KIND, isIndoor, objectCategory, recordObjectRow, OBJ_INVISIBLE } from '../game/objects';
import { ENT, parseEntrances } from '../game/worldmap';
import { MapButton } from '../ui/MapPicker';
import { useEditorState } from '../ui/useEditorState';

const Dot = ({ k }: { k: number }): ReactNode => <span className="dot" style={{ background: SECTION_COLORS[k] }} />;

export function Inspector({ editor }: { editor: MapEditor }): ReactNode {
  const st = editor.st;
  useEditorState(st);
  const doc = st.current;
  if (!doc) return <div className="inspector" />;
  const s = st.selection;
  return (
    <div className="inspector">
      {s.type === 'tiles' ? <Tiles editor={editor} doc={doc} cells={s.cells} />
        : s.type === 'rec' ? <RecordProps key={`${doc.hash}/${s.section}/${s.index}`} editor={editor} doc={doc} k={s.section} i={s.index} />
        : s.type === 'rect' ? <Rect editor={editor} s={s} />
        : <MapProps editor={editor} doc={doc} />}
    </div>
  );
}

function Tiles({ editor, doc, cells }: { editor: MapEditor; doc: MapDoc; cells: [number, number][] }): ReactNode {
  const { st, ctl } = editor;
  const tiles = cells.map(([x, y]) => tileAt(doc, x, y)).filter((t): t is NonNullable<typeof t> => !!t);
  const rotButtons = (
    <div className="row">
      <button onClick={() => ctl.rotate(-1)}>⟲ 左</button>
      <button onClick={() => ctl.rotate(1)}>右 ⟳</button>
      <button className="danger" onClick={() => ctl.deleteSelection()}>削除</button>
    </div>
  );
  const title = <h3>{cells.length === 1 ? `タイル (${cells[0]![0]}, ${cells[0]![1]})` : `タイル ${tiles.length} 枚`}</h3>;
  if (tiles.length !== 1) return <>{title}{rotButtons}</>;
  const t = tiles[0]!;
  const pal = st.game.master.palette(st.tileset);
  const kinds = [...new Set([...pal.keys(), t.kind])].sort((a, b) => a - b);
  const li = letterIndex(t.letter);
  const letters = [...new Set([...(pal.get(t.kind) ?? [0]), li])];
  const model = st.game.master.partModel(t.kind, st.tileset, li);
  const edit = (f: (tt: NonNullable<ReturnType<typeof tileAt>>) => void): void =>
    st.edit((d) => {
      const tt = tileAt(d, t.x, t.y);
      if (tt) f(tt);
    });
  return (
    <>
      {title}
      <Field label="種類">
        <select value={t.kind} onChange={(e) => edit((tt) => (tt.kind = Number(e.target.value)))}>
          {kinds.map((k) => <option key={k} value={k}>{`${k} ${kindName(k)}${pal.has(k) ? '' : ' (モデルなし)'}`}</option>)}
        </select>
      </Field>
      <Field label="文字">
        <select value={li} onChange={(e) => edit((tt) => (tt.letter = letterByte(Number(e.target.value))))}>
          {letters.map((l) => <option key={l} value={l}>{l ? String.fromCharCode(0x60 + l) : `既定 (${t.letter === LETTER_DEFAULT ? "'z'" : t.letter})`}</option>)}
        </select>
      </Field>
      <Field label="向き"><span>{`${ROT_ARROW[t.rot]} ${t.rot} (${t.rot * 90}°)`}</span></Field>
      {rotButtons}
      <div className="muted">{`モデル ${hex8(model)}`}</div>
      <button onClick={() => {
        st.brush = { kind: t.kind, letter: t.letter, rot: t.rot };
        st.setTool('paint');
      }}>このタイルでブラシを作る</button>
    </>
  );
}

function Rect({ editor, s }: { editor: MapEditor; s: { x0: number; y0: number; x1: number; y1: number } }): ReactNode {
  const r = norm({ type: 'rect', ...s });
  const c = editor.ctl;
  return (
    <>
      <h3>{`範囲 (${r.x0}, ${r.y0})〜(${r.x1}, ${r.y1})`}</h3>
      <div className="row">
        <button onClick={() => c.copy()}>コピー (Ctrl+C)</button>
        <button onClick={() => c.paste()} disabled={!editor.st.clip}>貼り付け (Ctrl+V)</button>
        <button className="danger" onClick={() => c.deleteSelection()}>タイルを消す (Del)</button>
      </div>
      <div className="row">
        <span>中身を動かす: </span>
        <button onClick={() => c.shiftSelection(0, -1)}>↑</button>
        <button onClick={() => c.shiftSelection(0, 1)}>↓</button>
        <button onClick={() => c.shiftSelection(-1, 0)}>←</button>
        <button onClick={() => c.shiftSelection(1, 0)}>→</button>
      </div>
      <p className="muted">移動では、範囲内のタイルと、その上の地点・宝箱・区画 6 のセルも一緒に動きます (Shift+矢印キー)。貼り付けはマウスのあるセルが左上になります。</p>
    </>
  );
}

type Upd = (f: (rec: Rec) => void) => void;

function RecordProps({ editor, doc, k, i }: { editor: MapEditor; doc: MapDoc; k: number; i: number }): ReactNode {
  const { st, session } = editor;
  const L = LAYOUTS[k]!;
  const r = doc.recs[k]?.[i];
  if (!r) return null;
  const [cx, cy] = recCellPos(r, L);
  const upd: Upd = (f) => st.edit((d) => f(d.recs[k]![i]!));
  const setU32 = (off: number) => (v: number) => upd((rec) => w32(rec.raw, off, v >>> 0));
  const setByte = (off: number) => (v: number) => upd((rec) => (rec.raw[off] = v & 0xff));
  const row = recordObjectRow(k, r, { master: st.game.master, events: st.currentEvents, indoor: isIndoor(doc) });
  const ev = st.currentEvents;
  const evRow = k === 3 ? P3.door(r.raw) : k >= 4 ? u32(r.raw, 0) : 0;
  return (
    <>
      <h3><Dot k={k} />{` ${L.label} #${i}`}</h3>
      <Field label={L.unit === 'cell' ? 'x (セル)' : 'x (細かい単位)'}><Num value={r.x} onChange={(v) => upd((rec) => (rec.x = v))} /></Field>
      <Field label={L.unit === 'cell' ? 'y (セル)' : 'y (細かい単位)'}><Num value={r.y} onChange={(v) => upd((rec) => (rec.y = v))} /></Field>
      <div className="muted">{`セル (${cx.toFixed(1)}, ${cy.toFixed(1)})` + (L.unit === 'fine' ? '  ワールド = 50 + 値 × 100 (0〜299)' : '')}</div>
      {!!row && <div className="model-line">{`モデル: ${objectCategory(row)} ${row === OBJ_INVISIBLE ? '' : editor.v3.objectName(row)} (mapObject #${row})`}</div>}
      {k === 3 && <PointFields editor={editor} r={r} setU32={setU32} setByte={setByte} />}
      {k === 1 && (
        <Field label="種類 (+5)">
          <select value={r.raw[5]} onChange={(e) => setByte(5)(Number(e.target.value))}>
            {Object.entries(SECTION1_KIND).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            {!(r.raw[5]! in SECTION1_KIND) && <option value={r.raw[5]}>{`種類 ${r.raw[5]}`}</option>}
          </select>
        </Field>
      )}
      {k === 2 && (
        <>
          <Field label="オブジェクト = mapObject の行 (+0)"><Num value={u32(r.raw, 0)} min={0} onChange={setU32(0)} /></Field>
          <Field label="向き (+8)"><Num value={r.raw[8]!} min={0} max={3} onChange={setByte(8)} /></Field>
        </>
      )}
      {k >= 4 && (
        <>
          <Field label="イベントの行 (+0)"><Num value={u32(r.raw, 0)} min={0} onChange={setU32(0)} /></Field>
          {k === 4 && (
            <>
              <Field label="向き (+8)"><Num value={r.raw[8]!} min={0} max={3} onChange={setByte(8)} /></Field>
              {!ev && <div className="muted">イベントの表を読み込み中…</div>}
              {ev?.has(evRow) && <TreasureEditor session={session} ev={ev} evRow={evRow} apply={(f) => st.editTables(f)} />}
            </>
          )}
          {k === 5 && (
            <>
              <Field label={`種類 (+8) ${r.raw[8] === 0 ? 'キャラクター (mapChara)' : [1, 2, 3, 4, 5, 6, 8].includes(r.raw[8]!) ? 'オブジェクト' : ''}`}>
                <Num value={r.raw[8]!} min={0} max={255} onChange={setByte(8)} />
              </Field>
              <Field label="向き (+9)"><Num value={r.raw[9]!} min={0} max={3} onChange={setByte(9)} /></Field>
            </>
          )}
          {k === 8 && <div className="muted">イベントの範囲 (モデルなし)</div>}
          {ev && (k === 4 || k === 5) && (
            <Field label={`モデルの上書き (イベント #${evRow} +0x46、0 = 既定)`}>
              <Num value={ev.model(evRow)} min={0} onChange={(v) => st.editTables(() => ev.setModel(evRow, v & 0xffff))} />
            </Field>
          )}
          {ev && !ev.has(evRow) && <div className="error">{`イベントの行 ${evRow} はこのダンジョンの表 (${ev.rows} 行) にありません`}</div>}
        </>
      )}
      {(evRow || k === 4 || k === 5 || k === 8) && ev?.has(evRow) ? <EventPanel st={st} row={evRow} /> : null}
      {/* raw bytes (x / y are overwritten from the fields above) */}
      <Field label={`生データ (${L.size} バイト)`}>
        <RawBytes bytes={r.raw} rows={3} onChange={(b) => upd((rec) => {
          rec.raw = b;
          rec.x = (b[L.xo]! | (b[L.xo + 1]! << 8)) << 16 >> 16;
          rec.y = (b[L.yo]! | (b[L.yo + 1]! << 8)) << 16 >> 16;
        })} />
      </Field>
      <div className="row">
        <button onClick={() => editor.ctl.duplicateRec()}>複製</button>
        <button className="danger" onClick={() => editor.ctl.deleteSelection()}>削除 (Del)</button>
      </div>
    </>
  );
}

/** Section 3 (exits, doors, warps): where it leads. */
function PointFields({ editor, r, setU32, setByte }: {
  editor: MapEditor; r: Rec; setU32: (off: number) => (v: number) => void; setByte: (off: number) => (v: number) => void;
}): ReactNode {
  const st = editor.st;
  const game = st.game;
  const destMap = P3.destMap(r.raw);
  const destPoint = P3.destPoint(r.raw);
  const destInfo = destMap ? game.code.byHash(destMap) : undefined;
  const world = destMap ? game.code.world(destMap) : undefined;
  let pointSel: ReactNode;
  if (destInfo) {
    const dd = st.docs.get(destMap) ?? loadDoc(game.db, destInfo);
    const ids = (dd.recs[3] ?? []).map((p) => ({ id: P3.id(p.raw), label: pointLabel(p.raw, p.x, p.y) }));
    pointSel = (
      <select value={destPoint} onChange={(e) => setU32(8)(Number(e.target.value))}>
        {!ids.some((p) => p.id === destPoint) && <option value={destPoint}>{`${hex8(destPoint)} (行き先にない)`}</option>}
        {ids.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    );
  } else if (world) {
    // Leaving to the world map: the point is the ID of one of its entrances (docs/worldmap.md §6).
    const ents = parseEntrances(game.db.get(world.sections[2]!));
    pointSel = (
      <select value={destPoint} onChange={(e) => setU32(8)(Number(e.target.value))}>
        {!ents.some((e) => ENT.id(e) === destPoint) && <option value={destPoint}>{`${hex8(destPoint)} (ワールドマップにない)`}</option>}
        {ents.map((e) => <option key={ENT.id(e)} value={ENT.id(e)}>{`入口 ${hex8(ENT.id(e))} (${ENT.x(e)}, ${ENT.y(e)}) → ${mapLabel(game, ENT.destMap(e))}`}</option>)}
      </select>
    );
  } else pointSel = <HexInput value={destPoint} onChange={setU32(8)} />;
  const kind = P3.kind(r.raw);
  return (
    <>
      <Field label="地点 ID (+0x00)"><HexInput value={P3.id(r.raw)} onChange={setU32(0)} /></Field>
      <Field label="行き先マップ (+0x04)">
        <MapButton game={game} value={destMap} withNone worlds modified={editor.modifiedMaps()} title="行き先のマップを選ぶ" onChange={setU32(4)} />
      </Field>
      {!!destMap && <div className="muted small">{`${mapLabel(game, destMap)}  ${destInfo?.name ?? ''}`}</div>}
      {world && <a className="small" href={worldHref(world.code, destPoint)}>ワールドマップでこの入口を開く</a>}
      <Field label="行き先の地点 (+0x08)">{pointSel}</Field>
      <Field label="イベントの行 (+0x0C、扉・ワープなど。0 = なし)"><Num value={P3.door(r.raw)} onChange={setU32(0x0c)} /></Field>
      <Field label={`種類 (+0x14) ${pointKindLabel(kind)}`}><Num value={kind} min={0} max={255} onChange={setByte(0x14)} /></Field>
      <Field label="補助 (+0x15)"><Num value={P3.aux(r.raw)} min={0} max={255} onChange={setByte(0x15)} /></Field>
      <Field label="セル内の位置 (+0x19、3×3: 0 = 左上、4 = 中央、8 = 右下)"><Num value={P3.slot(r.raw)} min={0} max={8} onChange={setByte(0x19)} /></Field>
      <Field label="扉のずらし (+0x1A、0 = 100、それ以外 = 250)"><Num value={P3.doorStep(r.raw)} min={0} max={255} onChange={setByte(0x1a)} /></Field>
    </>
  );
}

function MapProps({ editor, doc }: { editor: MapEditor; doc: MapDoc }): ReactNode {
  const { st, session } = editor;
  const game = st.game;
  const info = st.info!;
  const changed = st.changedSections(doc);
  const def = game.master.tileset(st.ref!);
  const [listing, setListing] = useState(false);
  const mark = (k: number): ReactNode => <td>{changed.includes(k) ? '変更' : ''}</td>;
  return (
    <>
      <h3>{mapTitle(info, game.code.maps, game.master)}</h3>
      <div className="muted">{`${doc.name}  ダンジョン ${info.dungeon} (${info.dungeonCode})  ハッシュ ${hex8(doc.hash)}`}</div>
      <Field label="タイルセット (表示のみ)">
        <select value={st.tileset} onChange={(e) => {
          st.tileset = Number(e.target.value);
          st.emit('map');
        }}>
          {Array.from({ length: 12 }, (_, t) => <option key={t} value={t}>{`${t}${t === def ? ' (既定)' : ''}`}</option>)}
        </select>
      </Field>
      <table className="sections">
        <tbody>
          <tr><th>区画</th><th>件数</th><th></th></tr>
          <tr><td>0 タイル</td><td>{doc.tiles.length}</td>{mark(0)}</tr>
          {POINT_SECTIONS.map((k) => (
            <tr key={k}><td><Dot k={k} />{` ${LAYOUTS[k]!.label}`}</td><td>{doc.recs[k]?.length ?? 0}</td>{mark(k)}</tr>
          ))}
          <tr><td>6 敵が出ないセル</td><td>{doc.cells6.length}</td>{mark(6)}</tr>
          <tr><td>7 (未対応・保持)</td><td>{`${doc.raw[7]?.length ?? 0} B`}</td><td /></tr>
        </tbody>
      </table>
      {st.currentEvents && <button onClick={() => setListing(true)}>{`イベントの一覧… (${st.currentEvents.rows} 行)`}</button>}
      {changed.length
        ? <button className="danger" onClick={() => confirm(`${doc.name} の変更をすべて取り消しますか?`) && st.revert(doc.hash)}>このマップの変更を元に戻す</button>
        : <div className="muted">変更なし</div>}
      <MapSoundPanel session={session} sounds={session.sounds} />
      <EncounterPanel st={st} book={session.book} />
      {listing && st.currentEvents && (
        <EventListDialog st={st} onClose={() => setListing(false)} onPick={(m, sec, i) => {
          setListing(false);
          void editor.gotoRecord(m, sec, i);
        }} />
      )}
    </>
  );
}
