// 初代's maps (#/maps/<マップのハッシュ>; naauao honolulu/map.md, #156), shown with the parts of the other games' map
// pages: the frame, the layers and the status bar (editor/mappage.tsx), the top-down grid and its controller
// (honolulu/mapview.ts), the map picker dialog (ui/MapPicker.tsx). View only. Header: the map (by dungeon) and which of
// its floors to show; left: the layers and the dungeon's floors; right: the picked tile or record, or the floor's
// encounters and chests (the floor definitions, naauao#47).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapFrame, MapHeaderControls, MapLayers, MapStatus } from '../editor/mappage';
import { tileAt } from '../editor/model';
import type { Rec } from '../game/sections';
import { MapPickerButton, type MapPickerGroups, type MapPickerRow } from '../ui/MapPicker';
import { useSticky } from '../ui/book';
import { useAsync } from '../ui/useAsync';
import { useEditorState, useSignal } from '../ui/useEditorState';
import { hex8, u32, u8 } from '../util/bytes';
import { honoluluItemHref } from './ItemPage';
import {
  dungeonLabel, facingLetter, floorLabel, HONOLULU_CHEST2_SECTION, HONOLULU_CHEST_SECTION, HONOLULU_EXIT_SECTION, HONOLULU_LAYOUTS, HONOLULU_MONSTER_SECTION, HONOLULU_NPC_SECTION, FLOOR_CELL_OFFSET,
  HONOLULU_OBJECT_SECTION, HONOLULU_POINT_SECTIONS, HONOLULU_ROT_CODEC, mapCode, mapTitle, RANDOM_POS, type FloorPoint, type HonoluluFloor, type HonoluluMapInfo, type HonoluluMaps,
} from './maps';
import { HonoluluMapState, HonoluluMapView } from './mapview';
import { GROUP_FILE, honoluluMonsterHref, monsterName } from './monsters';
import type { HonoluluSession } from './session';

export const honoluluMapHref = (m: HonoluluMapInfo): string => `#/maps/${mapCode(m)}`;

const hexUp = (v: number): string => hex8(v).toUpperCase();

export function HonoluluMapPage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const maps = useAsync(() => session.maps(), [session]);
  if (maps instanceof Error) return <p className="warn-box" style={{ margin: 16 }}>{`マップを読み込めませんでした: ${maps.message}`}</p>;
  if (!maps) return <p className="muted" style={{ padding: 16 }}>マップを読み込み中…</p>;
  return <MapBody session={session} maps={maps} arg={arg} />;
}

function MapBody({ session, maps, arg }: { session: HonoluluSession; maps: HonoluluMaps; arg: string | undefined }): ReactNode {
  const byCode = (c: string): HonoluluMapInfo | undefined => maps.map(parseInt(c, 16));
  const code = useSticky(arg?.toUpperCase(), (c) => /^[0-9A-F]{1,8}$/.test(c) && !!byCode(c), () => mapCode(maps.dungeons[0] ? maps.map(maps.dungeons[0].maps[0]!)! : maps.maps[0]!));
  const info = byCode(code)!;
  return (
    <div className="map-detail">
      <MapDetail key={info.hash} session={session} maps={maps} info={info} />
    </div>
  );
}

/** The maps by dungeon (a map some dungeons share is under each), then the ones no floor names. */
function mapGroups(maps: HonoluluMaps): MapPickerGroups {
  const row = (m: HonoluluMapInfo, title: string): MapPickerRow => ({ hash: m.hash, title: `${mapTitle(m)}・${title}${maps.doc(m).tiles.length} マス`, code: mapCode(m) });
  const out: MapPickerGroups = maps.dungeons.filter((d) => d.maps.length).map((d) => [
    `${dungeonLabel(d)}  (${hexUp(d.floors)})`,
    d.maps.map((h) => {
      const m = maps.map(h)!;
      const floors = m.floors.filter((f) => f.dungeon === d.row).map((f) => floorLabel(f.floor));
      return row(m, `${[...new Set(floors)].join('・')}・`);
    }),
  ]);
  const rest = maps.maps.filter((m) => !m.dungeons.length);
  if (rest.length) out.push(['どの階の定義にもないマップ', rest.map((m) => row(m, ''))]);
  return out;
}

function MapDetail({ session, maps, info }: { session: HonoluluSession; maps: HonoluluMaps; info: HonoluluMapInfo }): ReactNode {
  const st = useMemo(() => new HonoluluMapState(), [info]);
  const [view, setView] = useState<HonoluluMapView | null>(null);
  const [floorIndex, setFloorIndex] = useState(0);
  const floor = info.floors[floorIndex] ?? null;
  const pane2d = useRef<HTMLDivElement>(null);
  const pane3d = useRef<HTMLDivElement>(null);
  useEditorState(st);
  useEffect(() => {
    st.show(maps.floorDoc(info, floor));
    const v = new HonoluluMapView(st);
    pane2d.current!.append(v.grid.canvas);
    setView(v);
    requestAnimationFrame(() => v.fit());
    return () => v.grid.canvas.remove();
  }, [st, maps, info]);
  useEffect(() => {
    if (!view) return;
    st.show(maps.floorDoc(info, floor));
    view.refresh();
  }, [view, floor]);
  const groups = useMemo(() => mapGroups(maps), [maps]);
  const dungeon = floor ? maps.dungeon(floor.dungeon) : undefined;
  return (
    <MapFrame mode="2d" pane2d={pane2d} pane3d={pane3d}
      header={
        <>
          <MapPickerButton groups={groups} value={info.hash} className="map-select" label={`${mapTitle(info)}  ${mapCode(info)}`}
            onChange={(h) => { const m = maps.map(h); if (m) location.hash = honoluluMapHref(m); }} />
          {info.floors.length > 1 ? (
            <select value={floorIndex} title="このマップを使う階 (階の定義の記録)" onChange={(e) => setFloorIndex(Number(e.target.value))}>
              {info.floors.map((f, i) => <option key={i} value={i}>{floorName(maps, f)}</option>)}
            </select>
          ) : <span>{floor ? floorName(maps, floor) : 'どの階の定義にもない'}</span>}
          <span className="muted small">{`csvMap の行 ${info.index}・2 つ目の区画 ${info.objects ? hexUp(info.objects) : 'なし'}`}</span>
          <MapHeaderControls st={st} view={view} open={false} mode="2d" setMode={() => {}} showModes={false} />
        </>
      }
      left={view && (
        <>
          <MapLayers st={st} view={view} sections={HONOLULU_POINT_SECTIONS} layouts={HONOLULU_LAYOUTS} room={false} />
          {dungeon && (
            <div className="layers">
              <h3>{dungeonLabel(dungeon)}</h3>
              {dungeon.records.map((f) => {
                const m = maps.map(f.map);
                const here = f === floor;
                return (
                  <div key={f.index} className="small">
                    {`${floorLabel(f.floor)} `}
                    {!m ? <span className="muted">マップなし (決まったマップを持たない階と推定)</span>
                      : here ? <b>{mapTitle(m)}</b>
                      : <a href={honoluluMapHref(m)}>{mapTitle(m)}</a>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      right={view && <Inspector session={session} maps={maps} st={st} view={view} info={info} floor={floor} />}
      status={view ? <MapStatus st={st} view={view} /> : null} />
  );
}

const floorName = (maps: HonoluluMaps, f: HonoluluFloor): string => {
  const d = maps.dungeon(f.dungeon);
  return `${d ? dungeonLabel(d) : `ダンジョン ${f.dungeon}`}・${floorLabel(f.floor)}`;
};

function Inspector({ session, maps, st, view, info, floor }: {
  session: HonoluluSession;
  maps: HonoluluMaps;
  st: HonoluluMapState;
  view: HonoluluMapView;
  info: HonoluluMapInfo;
  floor: HonoluluFloor | null;
}): ReactNode {
  useEditorState(st);
  useSignal(view.signal);
  const sel = st.selection;
  const doc = view.doc;
  if (sel.type === 'rec' && doc.recs[sel.section]?.[sel.index]) return <RecInfo session={session} maps={maps} section={sel.section} rec={doc.recs[sel.section]![sel.index]!} index={sel.index} />;
  if (sel.type === 'tiles' && sel.cells.length === 1) {
    const [x, y] = sel.cells[0]!;
    const t = tileAt(doc, x, y);
    if (t) {
      return (
        <>
          <h3>{`タイル (${t.x}, ${t.y})`}</h3>
          <table className="enc-table desc-table small">
            <tbody>
              <tr><th>種類</th><td>{t.kind}</td></tr>
              <tr><th>+0x08〜0x0B</th><td className="mono">{[t.rotHi || HONOLULU_ROT_CODEC.encode(t.rot), t.letter, t.pad & 0xff, t.pad >> 8].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</td></tr>
            </tbody>
          </table>
          <p className="muted small">種類からモデル (mapParts・mapResource) へのたどり方はまだ分かっていません (naauao#49)。+0x08 は全タイルで 'N'。</p>
        </>
      );
    }
  }
  if (sel.type === 'tiles' && sel.cells.length > 1) return <p className="muted small">{`${sel.cells.length} マスを選択中`}</p>;
  return (
    <>
      <p className="muted small">タイルかレコードを選んでください。初代のマップは表示だけです (編集は未対応)。</p>
      {floor ? <FloorInfo session={session} maps={maps} floor={floor} /> : <p className="muted small">このマップを使う階が階の定義にないので、敵・宝箱は分かりません。</p>}
      <h3>マップ</h3>
      <table className="enc-table desc-table small">
        <tbody>
          <tr><th>ハッシュ</th><td className="mono">{mapCode(info)}</td></tr>
          <tr><th>タイル</th><td>{`${doc.tiles.length} マス`}</td></tr>
          <tr><th>置物</th><td>{`${doc.recs[HONOLULU_OBJECT_SECTION]?.length ?? 0} 個`}</td></tr>
          <tr><th>使う階</th><td>{info.floors.length ? info.floors.map((f) => floorName(maps, f)).join(' / ') : 'なし'}</td></tr>
        </tbody>
      </table>
    </>
  );
}

/** The members of a monsterGroup row (slots A, then B), linked to the monster book. */
function GroupMembers({ session, row }: { session: HonoluluSession; row: number }): ReactNode {
  const t = session.master.rows(GROUP_FILE);
  if (row >= t.rows) return <span className="muted">{`行 ${row} は表にありません`}</span>;
  const slot = (k: string): ReactNode => {
    const m = t.get(row, k);
    return m ? <a key={k} href={honoluluMonsterHref(m)}>{monsterName(session, m) || `#${m}`}</a> : null;
  };
  const list = (ks: string[]): ReactNode[] => ks.map(slot).filter(Boolean).flatMap((n, i) => (i ? ['・', n] : [n]));
  return (
    <>
      <div>{'枠 A: '}{list([0, 1, 2, 3, 4].map((k) => `a${k}`))}</div>
      <div>{'枠 B: '}{list([0, 1, 2, 3, 4].map((k) => `b${k}`))}</div>
    </>
  );
}

/** The contents of an itemGroup key (a chest), linked to the item book. */
function ChestItems({ session, maps, chestKey }: { session: HonoluluSession; maps: HonoluluMaps; chestKey: number }): ReactNode {
  if (!chestKey) return <span className="muted">なし</span>;
  const row = maps.itemGroupRow(chestKey);
  if (row === undefined) return <span className="muted">{`キー ${hexUp(chestKey)} は itemGroup にありません`}</span>;
  const name = session.master.context().rowName!;
  const items = maps.chestItems(row);
  return (
    <span>
      {`itemGroup ${row}: `}
      {items.length ? items.map((x, i) => <span key={i}>{i ? '・' : ''}<a href={honoluluItemHref(x.item)}>{name('itemData.bin', x.item) ?? `#${x.item}`}</a>{` × ${x.count}`}</span>) : <span className="muted">空</span>}
    </span>
  );
}

function MonsterKey({ session, maps, groupKey }: { session: HonoluluSession; maps: HonoluluMaps; groupKey: number }): ReactNode {
  if (!groupKey) return <span className="muted">なし</span>;
  if (groupKey === 0xffffffff) return <span className="muted">群れなし (キー −1)</span>;
  const row = maps.monsterGroupRow(groupKey);
  if (row === undefined) return <span className="muted">{`キー ${hexUp(groupKey)} は monsterGroup にありません`}</span>;
  return <div>{`monsterGroup ${row}`}<GroupMembers session={session} row={row} /></div>;
}

const random = (p: FloorPoint): boolean => p.x === RANDOM_POS || p.y === RANDOM_POS;
const range = (raw: Uint8Array, o: number): string => `${u8(raw, o)}〜${u8(raw, o + 1)}`;

/** The floor's encounters and chests (naauao#47). */
function FloorInfo({ session, maps, floor }: { session: HonoluluSession; maps: HonoluluMaps; floor: HonoluluFloor }): ReactNode {
  const randomChests = [...floor.chests, ...floor.chests2].filter(random);
  const randomGroups = floor.monsters.filter(random);
  return (
    <>
      <h3>{floorName(maps, floor)}</h3>
      <table className="enc-table desc-table small">
        <tbody>
          <tr><th>記録</th><td>{`${floor.index} (ID ${hexUp(floor.id)})`}</td></tr>
          <tr><th>出てくる敵</th><td><MonsterKey session={session} maps={maps} groupKey={floor.monsterGroup} /></td></tr>
          <tr><th>宝箱の既定の中身</th><td><ChestItems session={session} maps={maps} chestKey={floor.itemGroup} /></td></tr>
          <tr><th>宝箱</th><td>{`${floor.chests.length + floor.chests2.length} 個${randomChests.length ? ` (うち場所がランダム ${randomChests.length})` : ''}`}</td></tr>
          <tr><th>置かれた群れ</th><td>{`${floor.monsters.length}${randomGroups.length ? ` (うち場所がランダム ${randomGroups.length})` : ''}`}</td></tr>
          <tr><th>出入口</th><td>{floor.exits.length}</td></tr>
        </tbody>
      </table>
      {randomChests.length > 0 && (
        <>
          <h4>場所がランダムな宝箱</h4>
          {randomChests.map((c, i) => <div key={i} className="small"><ChestItems session={session} maps={maps} chestKey={u32(c.raw, 0)} /></div>)}
        </>
      )}
      {randomGroups.length > 0 && (
        <>
          <h4>場所がランダムな群れ</h4>
          {randomGroups.map((g, i) => <div key={i} className="small"><MonsterKey session={session} maps={maps} groupKey={u32(g.raw, 0)} /></div>)}
        </>
      )}
      <p className="muted small">階の定義は naauao honolulu/map.md §4 (#47)。ファイルの位置 (x, y) はタイルの座標より 1 小さいので、1 足して描いています。</p>
    </>
  );
}

function RecInfo({ session, maps, section, rec, index }: { session: HonoluluSession; maps: HonoluluMaps; section: number; rec: Rec; index: number }): ReactNode {
  const L = HONOLULU_LAYOUTS[section]!;
  const r = rec.raw;
  const floorRec = section !== HONOLULU_OBJECT_SECTION;
  const rows: [string, ReactNode][] = [['位置', floorRec ? `(${rec.x}, ${rec.y}) (ファイルの値 + ${FLOOR_CELL_OFFSET})` : `(${rec.x}, ${rec.y})`]];
  if (section === HONOLULU_OBJECT_SECTION) rows.push(['種類', u32(r, 0)], ['向き', facingLetter(r[8]!)]);
  if (section === HONOLULU_EXIT_SECTION) {
    rows.push(['出入口の ID', hexUp(u32(r, 0))], ['行き先の記録', hexUp(u32(r, 4))], ['行き先の出入口', hexUp(u32(r, 8))], ['+0x0C〜0x0F', [...r.subarray(0x0c, 0x10)].join(' ')]);
    const dest = maps.dungeons.flatMap((d) => d.records).find((f) => f.id === u32(r, 4) && f.exits.some((e) => u32(e.raw, 0) === u32(r, 8)));
    const m = dest && maps.map(dest.map);
    if (dest) rows.push(['行き先', m ? <a href={honoluluMapHref(m)}>{`${floorName(maps, dest)} (${mapTitle(m)})`}</a> : floorName(maps, dest)]);
  }
  if (section === HONOLULU_CHEST_SECTION || section === HONOLULU_CHEST2_SECTION) {
    rows.push(['中身', <ChestItems session={session} maps={maps} chestKey={u32(r, 0)} />], ['数 (+0x04〜+0x05、最大は含まない)', range(r, 4)], ['部屋 (+0x06、生成する階だけ)', u8(r, 6) === 0xff ? 'どこでも' : u8(r, 6)]);
  }
  if (section === HONOLULU_MONSTER_SECTION) rows.push(['群れ', <MonsterKey session={session} maps={maps} groupKey={u32(r, 0)} />], ['+0x04', u8(r, 4)], ['数 (+0x05〜+0x06)', range(r, 5)]);
  if (section === HONOLULU_NPC_SECTION) {
    const row = maps.mapCharaRow(u32(r, 0));
    rows.push(['mapChara', row === undefined ? `キー ${hexUp(u32(r, 0))} (表にない)` : `行 ${row} (キー ${hexUp(u32(r, 0))})`], ['+0x04〜+0x07', [...r.subarray(4, 8)].join(' ')]);
  }
  return (
    <>
      <h3>{`${L.label} #${index}`}</h3>
      <table className="enc-table desc-table small">
        <tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody>
      </table>
      <details>
        <summary className="small">{`レコードのバイト (${r.length})`}</summary>
        <code className="small mono" style={{ wordBreak: 'break-all' }}>{[...r].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</code>
      </details>
      {section === HONOLULU_OBJECT_SECTION && <p className="muted small">2 つ目の区画の種類 (24〜57) が何を置くかは未確認です (naauao honolulu/map.md §3.2)。</p>}
    </>
  );
}
