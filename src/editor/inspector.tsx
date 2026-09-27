// Inspector: properties of the selection (tile / point record / rectangle) or of the map.
import { useState, type ReactNode } from 'react';
import { CELL, LAYOUTS, LETTER_DEFAULT, P3, P7, POINT_SECTIONS, recEventRow, letterByte, letterIndex, loadDoc, pointKindLabel, recCellPos, type MapDoc, type Rec } from '../game/sections';
import { hex8, u32, w32 } from '../util/bytes';
import { norm } from './controller';
import { kindName, ROT_ARROW, SECTION_COLORS } from './legend';
import { tileAt } from './state';
import { mapLabel, pointLabel, worldHref } from './labels';
import { TreasureEditor } from './treasure';
import { EventListDialog, EventPanel } from './events';
import { EncounterPanel } from './encounters';
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

const UNIT_LABEL = { cell: 'セル', fine: '細かい単位', world: 'ワールド' } as const;

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
  const evRow = recEventRow(k, r.raw);
  return (
    <>
      <h3><Dot k={k} />{` ${L.label} #${i}`}</h3>
      <Field label={`x (${UNIT_LABEL[L.unit]})`}><Num value={r.x} onChange={(v) => upd((rec) => (rec.x = v))} /></Field>
      <Field label={`y (${UNIT_LABEL[L.unit]})`}><Num value={r.y} onChange={(v) => upd((rec) => (rec.y = v))} /></Field>
      <div className="muted">{`セル (${cx.toFixed(1)}, ${cy.toFixed(1)})` + (L.unit === 'fine' ? '  ワールド = 50 + 値 × 100 (0〜299)' : L.unit === 'world' ? '  1 セル = 500' : '')}</div>
      {!!row && <div className="model-line">{`モデル: ${objectCategory(row)} ${row === OBJ_INVISIBLE ? '' : editor.v3.objectName(row)} (mapObject #${row})`}</div>}
      {k === 3 && <PointFields editor={editor} r={r} setU32={setU32} setByte={setByte} />}
      {k === 7 && <WallDoorFields editor={editor} r={r} setU32={setU32} setByte={setByte} />}
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
      {(k === 4 || k === 5 || k === 8) && (
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

/** Section 7: a door (or an invisible exit) on a wall. */
function WallDoorFields({ editor, r, setU32, setByte }: {
  editor: MapEditor; r: Rec; setU32: (off: number) => (v: number) => void; setByte: (off: number) => (v: number) => void;
}): ReactNode {
  return (
    <>
      <Field label="地点 ID (+0x00)"><HexInput value={P7.id(r.raw)} onChange={setU32(0)} /></Field>
      <Field label="イベントの行 (+0x04、扉。0 = なし)"><Num value={P7.door(r.raw)} onChange={setU32(4)} /></Field>
      <DestFields editor={editor} r={r} setU32={setU32} offMap={8} offPoint={0x0c} />
      <Field label="種類 (+0x14、0 = 扉、それ以外 = 出口)"><Num value={P7.kind(r.raw)} min={0} max={255} onChange={setByte(0x14)} /></Field>
      <Field label="向き (+0x16、0〜3。R で回す)"><Num value={P7.dir(r.raw)} min={0} max={3} onChange={setByte(0x16)} /></Field>
      <Field label="壁に沿ったずらし (+0x15、0 / 1 で 50 ずらす向きが逆)"><Num value={P7.side(r.raw)} min={0} max={1} onChange={setByte(0x15)} /></Field>
      <Field label="扉を表示 (+0x17、1 = 扉、0 = 見えない出口)"><Num value={P7.visible(r.raw)} min={0} max={1} onChange={setByte(0x17)} /></Field>
    </>
  );
}

const hexOff = (o: number): string => `+0x${o.toString(16).padStart(2, '0').toUpperCase()}`;

/** Destination map (u32 at `offMap`) and point (ID at `offPoint`) of an exit. */
function DestFields({ editor, r, setU32, offMap, offPoint }: {
  editor: MapEditor; r: Rec; setU32: (off: number) => (v: number) => void; offMap: number; offPoint: number;
}): ReactNode {
  const st = editor.st;
  const game = st.game;
  const destMap = u32(r.raw, offMap);
  const destPoint = u32(r.raw, offPoint);
  const destInfo = destMap ? game.code.byHash(destMap) : undefined;
  const world = destMap ? game.code.world(destMap) : undefined;
  let pointSel: ReactNode;
  if (destInfo) {
    const dd = st.docs.get(destMap) ?? loadDoc(game.db, destInfo);
    // exits lead to section 3 points or to the doors on walls (section 7) of the other map
    const ids = [
      ...(dd.recs[3] ?? []).map((p) => ({ id: P3.id(p.raw), label: pointLabel(p.raw, p.x, p.y) })),
      ...(dd.recs[7] ?? []).map((p) => ({ id: P7.id(p.raw), label: `${P7.visible(p.raw) ? '壁の扉' : '壁の出口'} (${(p.x / CELL).toFixed(1)}, ${(p.y / CELL).toFixed(1)})` })),
    ];
    pointSel = (
      <select value={destPoint} onChange={(e) => setU32(offPoint)(Number(e.target.value))}>
        {!ids.some((p) => p.id === destPoint) && <option value={destPoint}>{`${hex8(destPoint)} (行き先にない)`}</option>}
        {ids.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    );
  } else if (world) {
    // Leaving to the world map: the point is the ID of one of its entrances (docs/worldmap.md §6).
    const ents = parseEntrances(game.db.get(world.sections[2]!));
    pointSel = (
      <select value={destPoint} onChange={(e) => setU32(offPoint)(Number(e.target.value))}>
        {!ents.some((e) => ENT.id(e) === destPoint) && <option value={destPoint}>{`${hex8(destPoint)} (ワールドマップにない)`}</option>}
        {ents.map((e) => <option key={ENT.id(e)} value={ENT.id(e)}>{`入口 ${hex8(ENT.id(e))} (${ENT.x(e)}, ${ENT.y(e)}) → ${mapLabel(game, ENT.destMap(e))}`}</option>)}
      </select>
    );
  } else pointSel = <HexInput value={destPoint} onChange={setU32(offPoint)} />;
  return (
    <>
      <Field label={`行き先マップ (${hexOff(offMap)})`}>
        <MapButton game={game} value={destMap} withNone worlds modified={editor.modifiedMaps()} title="行き先のマップを選ぶ" onChange={setU32(offMap)} />
      </Field>
      {!!destMap && <div className="muted small">{`${mapLabel(game, destMap)}  ${destInfo?.name ?? ''}`}</div>}
      {world && <a className="small" href={worldHref(world.code, destPoint)}>ワールドマップでこの入口を開く</a>}
      <Field label={`行き先の地点 (${hexOff(offPoint)})`}>{pointSel}</Field>
    </>
  );
}

/** Section 3 (exits, doors, warps): where it leads. */
function PointFields({ editor, r, setU32, setByte }: {
  editor: MapEditor; r: Rec; setU32: (off: number) => (v: number) => void; setByte: (off: number) => (v: number) => void;
}): ReactNode {
  const kind = P3.kind(r.raw);
  return (
    <>
      <Field label="地点 ID (+0x00)"><HexInput value={P3.id(r.raw)} onChange={setU32(0)} /></Field>
      <DestFields editor={editor} r={r} setU32={setU32} offMap={4} offPoint={8} />
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
        </tbody>
      </table>
      {st.currentEvents && <button onClick={() => setListing(true)}>{`イベントの一覧… (${st.currentEvents.rows} 行)`}</button>}
      {changed.length
        ? <button className="danger" onClick={() => confirm(`${doc.name} の変更をすべて取り消しますか?`) && st.revert(doc.hash)}>このマップの変更を元に戻す</button>
        : <div className="muted">変更なし</div>}
      <EncounterPanel st={st} book={session.book} sounds={session.sounds} />
      {listing && st.currentEvents && (
        <EventListDialog st={st} onClose={() => setListing(false)} onPick={(m, sec, i) => {
          setListing(false);
          void editor.gotoRecord(m, sec, i);
        }} />
      )}
    </>
  );
}
