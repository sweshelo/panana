// RPG3's world map (#/world[/entrance]; naauao oahu/worldmap.md) in the world map frame shared with RPG2
// (editor/worldpage.tsx): the views draw OahuWorldSource (worldsource.ts). Left: the entrances by the dungeon they lead
// to; right: the selected entrance (its fields, its EventObject row, the maps behind it and the exits that come back to
// the world), range, chest, prop or event range.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWorldView, WorldFrame } from '../editor/worldpage';
import type { WorldSelection, WorldView } from '../editor/worldview';
import { NumberInput } from '../ui/book';
import { MapPickerButton } from '../ui/MapPicker';
import { useSignal } from '../ui/useEditorState';
import { equalBytes, f32, hex8, u32, w32 } from '../util/bytes';
import { EventObjectEditor } from './EventObjectEditor';
import { oahuEventKey } from './events';
import { OAHU_EVENT_SECTIONS, OAHU_EXIT_KIND, oahuFloorLabel, oahuRecEventRow, type OahuMapInfo } from './maps';
import { oahuDungeonLabel, oahuMapHref, useMapGroups, useMaps } from './MapPage';
import { oahuGroupHref } from './pickers';
import type { OahuSession } from './session';
import { ENTRANCE_COLORS, OAHU_POINT_SLOT, OAHU_RANGE_SLOT, OahuWorldSource } from './worldsource';
import {
  entranceCell, grid2, moveEntrance, OAHU_WORLD, OAHU_WORLD_SECTIONS, OAHU_WORLD_SIZE, parseChests, parseEventRanges, parseProps, setEntranceByte, setEntranceU32, WE, WS,
  type OahuWorldRange,
} from './worldmap';

export const oahuWorldHref = (index?: number): string => (index === undefined ? '#/world' : `#/world/${index}`);
/** The entrances' directions and the angles of their models (worldObjectAngle). */
const DIRS = ['0 (0°)', '1 (−90°)', '2 (180°)', '3 (90°)'];
/** Sections whose records name an EventObject row (an exit to the world can be any of them). */
const SECTION_NAME: Record<number, string> = { 3: '出入口', 4: '宝箱', 5: 'キャラ・オブジェクト', 8: 'イベントの範囲' };
const SLOT_LABEL: Record<number, string> = { [WS.land]: 'エンカウントの範囲 (陸、区画 3)', [WS.sea]: 'エンカウントの範囲 (海、区画 4)', [WS.chests]: '宝箱 (区画 8)', [WS.props]: '置物 (区画 6)', [WS.events]: 'イベントの範囲 (区画 5)' };

export function OahuWorldPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { maps, world } = session;
  useMaps(maps);
  useEffect(() => {
    // the dungeons' event codes (D10 …) come with their tables
    for (const d of maps.dungeons) if (d.archive && !d.code) void maps.eventTable(d).catch(() => null);
  }, [maps]);
  const { view, pane2d, pane3d } = useWorldView(() => new OahuWorldSource(session.dump, world), [session, world], '#/world', (sel) => {
    const want = sel.type === 'entrance' ? oahuWorldHref(sel.index) : oahuWorldHref();
    if (location.hash !== want) history.replaceState(null, '', want);
  });
  // the route picks the first selection
  useEffect(() => {
    if (!view) return;
    const index = arg !== undefined ? Number(arg) : NaN;
    requestAnimationFrame(() => {
      if (Number.isInteger(index) && index >= 0 && index < world.entrances().length) view.select({ type: 'entrance', index }, true);
      else {
        view.focus();
        view.fitWorld();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => maps.on(() => session.scheduleSave()), [maps, session]);
  return (
    <WorldFrame view={view} pane2d={pane2d} pane3d={pane3d}
      title={<><strong>ワールドマップ W01</strong><span className="muted small">{`${hex8(OAHU_WORLD).toUpperCase()}・${OAHU_WORLD_SIZE} × ${OAHU_WORLD_SIZE} セル`}</span></>}
      changed={world.isChanged()}
      onRevert={() => {
        if (!view || !confirm('ワールドマップの変更 (地形・入口・範囲など) をすべて元に戻しますか? (入口の EventObject の行はイベントの表のまま残ります)')) return;
        view.mark();
        world.revertGround();
        for (let k = 0; k < OAHU_WORLD_SECTIONS.length; k++) world.setSection(k, world.originalSection(k).slice());
      }}
      list={view && <EntranceList session={session} view={view} />}
      inspector={view && <WorldInspector session={session} view={view} />}
      statusOf={(x, y) => {
        const out: string[] = [];
        const dark = grid2(world.section(WS.dark), x, y);
        if (dark) out.push(`暗い海 ${dark} / 3`);
        const inRange = (slot: typeof WS.land | typeof WS.sea): number => world.ranges(slot).filter((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h).length;
        const land = inRange(WS.land), sea = inRange(WS.sea);
        if (land || sea) out.push(`範囲 陸 ${land}・海 ${sea}`);
        return out;
      }}
    />
  );
}

/** The points of a set of the world (chests, props, event ranges). */
const pointsOf = (session: OahuSession, slot: number): ReturnType<typeof parseChests> => {
  const b = session.world.section(slot);
  return slot === WS.chests ? parseChests(b) : slot === WS.props ? parseProps(b) : parseEventRanges(b);
};

/** The entrances grouped by the dungeon (mapGroup) their destination belongs to. */
function EntranceList({ session, view }: { session: OahuSession; view: WorldView }): ReactNode {
  const { world } = session;
  const [query, setQuery] = useState('');
  const list = world.entrances();
  const original = world.originalEntrances();
  const sel = view.sel;
  const groups = new Map<number, number[]>();
  const loose: number[] = [];
  list.forEach((r, i) => {
    const d = world.dest(r);
    if (d.map) groups.set(d.map.dungeon, [...(groups.get(d.map.dungeon) ?? []), i]);
    else loose.push(i);
  });
  const q = query.trim().toUpperCase();
  const match = (i: number): boolean => {
    if (!q) return true;
    const r = list[i]!, d = world.dest(r);
    return hex8(WE.id(r)).toUpperCase().includes(q) || (d.map?.name.includes(q) ?? false) || (d.map ? oahuDungeonLabel(session, d.map.dungeon).toUpperCase().includes(q) : false);
  };
  const row = (i: number): ReactNode => {
    const r = list[i]!, d = world.dest(r);
    const active = sel.type === 'entrance' && sel.index === i;
    const changed = !original[i] || !equalBytes(original[i]!, r);
    return (
      <tr key={i} className={active ? 'active' : ''} onClick={() => view.select({ type: 'entrance', index: i }, true)}>
        <td className="num muted">{i}</td>
        <td>
          {WE.part(r) ? <span style={{ color: ENTRANCE_COLORS[WE.part(r)] }}>● </span> : <span className="muted">○ </span>}
          {d.map ? d.map.name : WE.part(r) ? '行き先なし' : '出る位置'}
          {changed && <span className="edited-mark"> ●</span>}
          {world.ports.has(WE.id(r)) && <span className="muted small" title="worldmapPort: 船が止まる"> ⚓</span>}
        </td>
        <td className="num muted small">{`${WE.x(r)},${WE.y(r)}`}</td>
      </tr>
    );
  };
  return (
    <div className="world-entrances">
      <h3>{`入口 ${list.length}`}</h3>
      <input type="search" placeholder="行き先のマップ・ダンジョン・ID で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      <table className="book-table world-entrance-table">
        <tbody>
          {[...groups].sort(([a], [b]) => a - b).map(([dg, idx]) => {
            const shown = idx.filter(match);
            if (!shown.length) return null;
            return [
              <tr key={`g${dg}`} className="group"><th colSpan={3}>{oahuDungeonLabel(session, dg)}</th></tr>,
              ...shown.map(row),
            ];
          })}
          {loose.filter(match).length > 0 && <tr className="group"><th colSpan={3}>行き先のない入口・出る位置</th></tr>}
          {loose.filter(match).map(row)}
        </tbody>
      </table>
    </div>
  );
}

// ---- right: the inspector

function WorldInspector({ session, view }: { session: OahuSession; view: WorldView }): ReactNode {
  useSignal(view.signal);
  const sel = view.sel;
  if (sel.type === 'entrance') return <EntranceInspector key={sel.index} session={session} view={view} index={sel.index} />;
  if (sel.type === 'range') return <RangeInspector session={session} view={view} slot={OAHU_RANGE_SLOT[sel.set]!} index={sel.index} />;
  if (sel.type === 'point') return <PointInspector session={session} view={view} sel={sel} />;
  return <WorldSummary session={session} view={view} />;
}

function WorldSummary({ session, view }: { session: OahuSession; view: WorldView }): ReactNode {
  const { world } = session;
  const slots = world.changedSlots();
  return (
    <div className="world-help">
      <h3>ワールドマップ</h3>
      <p className="small">
        地形は master の <code>W01_ground.bin</code> (300 × 300 セル、worldmapParts の行と向き)、入口・範囲・宝箱などはマップ DB の区画 (code.bin 0x556D54 の表) にあります。
        3D は 3D の画面の中心のまわり {`${22 * 2 + 1}`} × {`${22 * 2 + 1}`} セルを描きます (右ドラッグで回転、中ドラッグで移動)。
      </p>
      <ul className="small">
        <li>選択・移動 (V): 入口をクリックで選び、ドラッグか矢印キーで動かします。範囲は中をドラッグで移動、右下の角で大きさ (3 セル単位)。</li>
        <li>地形を塗る (B): 部品を選んでクリック・ドラッグで置きます。Alt+クリックで地図から拾い、R で回します。2×2 や 2 マスの部品は左上 (起点) のセルに置きます。</li>
        <li>地形を変えると、書き出しで部品ごとのプールの数 (W01_ground.bin +0x08 の表) を作り直します。</li>
      </ul>
      <h3>変更</h3>
      {!world.isChanged() ? <p className="muted small">変更はありません。</p> : (
        <ul className="small">
          {world.groundChanged() && <li>地形 (W01_ground.bin)</li>}
          {slots.map((k) => <li key={k}>{`区画 ${k} (${hex8(OAHU_WORLD_SECTIONS[k]!).toUpperCase()})`}</li>)}
        </ul>
      )}
      <p className="muted small">{view.status}</p>
    </div>
  );
}

/** A number with decimals (an entrance's offset in cells), applied when left. */
function FloatInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }): ReactNode {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const v = Number(text);
    if (Number.isFinite(v) && Math.abs(v) <= 100) {
      if (v !== value) onCommit(v);
    } else setText(String(value));
  };
  return <input className="num-input" type="number" step={0.25} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

function EntranceInspector({ session, view, index }: { session: OahuSession; view: WorldView; index: number }): ReactNode {
  const { world, maps } = session;
  const groups = useMapGroups(session);
  // the kinds of entrance (worldmapParts 88〜93) and the first letters of the maps they lead to in the ROM
  const kinds = useMemo(() => {
    const ex = new Map<number, Set<string>>();
    for (const e of world.originalEntrances()) {
      const m = world.dest(e).map;
      if (m && WE.part(e)) ex.set(WE.part(e), new Set([...(ex.get(WE.part(e)) ?? []), m.name.slice(0, 1)]));
    }
    return ex;
  }, [world]);
  const r = world.entrances()[index];
  const original = world.originalEntrances()[index];
  if (!r) return null;
  const d = world.dest(r);
  const set = (next: Uint8Array): void => {
    view.mark();
    world.setEntrance(index, next);
  };
  const differs = (o: number, n = 4): boolean => !!original && !equalBytes(original.subarray(o, o + n), r.subarray(o, o + n));
  const cls = (o: number, n = 4): string => `num-input${differs(o, n) ? ' edited' : ''}`;
  const part = WE.part(r);
  const defaultModel = part ? world.parts[part]?.object ?? 0 : 0;
  const ev = world.eventTable();
  const evRow = d.row && ev && d.row < ev.rows ? ev.row(d.row) : null;
  const wd = world.info && maps.dungeonOf(world.info);
  const evOriginal = wd && d.row ? maps.originalEventRow(wd, d.row) : null;
  const editEvent = (f: (row: Uint8Array) => void): void => {
    if (!evRow) return;
    f(evRow);
    maps.changed();
  };
  return (
    <div className="world-entrance">
      <div className="book-head">
        <h3>{`入口 #${index}`}</h3>
        <span className="mono muted small">{hex8(WE.id(r)).toUpperCase()}</span>
        {world.ports.has(WE.id(r)) && <span className="badge" title="worldmapPort にある (船が止まる)">港</span>}
        {original && !equalBytes(original, r) && <button className="small" onClick={() => set(original.slice())}>元に戻す</button>}
      </div>
      <table className="enc-table row-fields">
        <tbody>
          <tr>
            <td>種類 (+0x00)</td>
            <td>
              <select className={differs(0) ? 'edited' : ''} value={part} onChange={(e) => set(setEntranceU32(r, 0x00, Number(e.target.value)))}>
                <option value={0}>0 模型なし (出る位置)</option>
                {world.parts.filter((p) => !p.model && p.object).map((p) => (
                  <option key={p.row} value={p.row}>{`${p.row}${kinds.get(p.row) ? ` (行き先 ${[...kinds.get(p.row)!].join('・')}…)` : ''}`}</option>
                ))}
              </select>
            </td>
          </tr>
          <tr>
            <td>モデル (+0x04)</td>
            <td>
              <NumberInput value={WE.model(r)} min={0} max={Math.max(0, maps.objectRows - 1)} className={cls(0x04)} title={`mapObject の行。0 = 種類の既定 (${defaultModel})`}
                onCommit={(v) => set(setEntranceU32(r, 0x04, v))} />
              <span className="muted small">{` mapObject${WE.model(r) ? '' : ` (既定 ${defaultModel})`}`}</span>
            </td>
          </tr>
          <tr>
            <td>位置 x, y</td>
            <td>
              <NumberInput value={WE.x(r)} min={0} max={OAHU_WORLD_SIZE - 1} className={cls(0x10, 2)} onCommit={(v) => set(moveEntrance(r, v, WE.y(r)))} />
              <NumberInput value={WE.y(r)} min={0} max={OAHU_WORLD_SIZE - 1} className={cls(0x12, 2)} onCommit={(v) => set(moveEntrance(r, WE.x(r), v))} />
            </td>
          </tr>
          <tr>
            <td>ずれ dx, dy (セル)</td>
            <td>
              <FloatInput value={WE.dx(r)} onCommit={(v) => set(moveEntrance(r, WE.x(r), WE.y(r), v, WE.dy(r)))} />
              <FloatInput value={WE.dy(r)} onCommit={(v) => set(moveEntrance(r, WE.x(r), WE.y(r), WE.dx(r), v))} />
            </td>
          </tr>
          <tr>
            <td>向き (+0x1C)</td>
            <td>
              <select className={differs(0x1c, 1) ? 'edited' : ''} value={WE.dir(r)} onChange={(e) => set(setEntranceByte(r, 0x1c, Number(e.target.value)))}>
                {DIRS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                {WE.dir(r) > 3 && <option value={WE.dir(r)}>{`${WE.dir(r)} (= 0)`}</option>}
              </select>
            </td>
          </tr>
          <tr>
            <td>ワープの行 (+0x1D)</td>
            <td>
              <NumberInput value={WE.jump(r)} min={0} max={255} className={cls(0x1d, 1)} title="mapJumpPoint の行 (0 = なし)" onCommit={(v) => set(setEntranceByte(r, 0x1d, v))} />
              <span className="muted small"> mapJumpPoint</span>
            </td>
          </tr>
          <tr>
            <td>イベント (+0x0C)</td>
            <td>
              <NumberInput value={WE.event(r)} min={0} max={Math.max(0, (ev?.rows ?? 1) - 1)} className={cls(0x0c)} title="w01_EventObject の行 (0 = なし)" onCommit={(v) => set(setEntranceU32(r, 0x0c, v))} />
              {wd && d.row > 0 && <a className="small" href={`#/events/${oahuEventKey({ dungeon: wd.row, row: d.row })}`}> 一覧で開く</a>}
            </td>
          </tr>
        </tbody>
      </table>
      {evRow && (
        <>
          <h3>行き先</h3>
          <div className="row">
            <MapPickerButton groups={groups} value={d.mapHash} className="map-select"
              label={d.map ? `${oahuDungeonLabel(session, d.map.dungeon)}・${oahuFloorLabel(d.map.floor) || '地上'} ${d.map.name}` : d.mapHash ? hex8(d.mapHash) : '(なし)'}
              onChange={(h) => editEvent((row) => w32(row, 0x10, h))} />
          </div>
          {d.map && <DestPoint session={session} map={d.map} point={d.point} onChange={(p) => editEvent((row) => w32(row, 0x14, p))} />}
          <details className="small">
            <summary>{`w01_EventObject の行 ${d.row}`}</summary>
            <EventObjectEditor maps={maps} row={evRow} original={evOriginal} onEdit={() => maps.changed()} />
          </details>
          {d.map && <DestMaps session={session} view={view} map={d.map} entranceId={WE.id(r)} />}
        </>
      )}
      {!part && <ComesHere session={session} view={view} id={WE.id(r)} />}
    </div>
  );
}

/** The point of the destination map: its exits (section 3) by their IDs. */
function DestPoint({ session, map, point, onChange }: { session: OahuSession; map: OahuMapInfo; point: number; onChange: (p: number) => void }): ReactNode {
  const { maps } = session;
  const exits = maps.doc(map).recs[3] ?? [];
  const known = exits.some((e) => u32(e.raw, 0) === point);
  return (
    <label className="field">
      <span>行き先の地点 (EventObject +0x14 = 出入口の ID)</span>
      <select value={point} onChange={(e) => onChange(Number(e.target.value))}>
        {!known && <option value={point}>{`${hex8(point).toUpperCase()} (このマップにない)`}</option>}
        {exits.map((e, i) => (
          <option key={i} value={u32(e.raw, 0)}>{`出入口 #${i} ${OAHU_EXIT_KIND[e.raw[0x15]!] ?? `種類 ${e.raw[0x15]}`} (${e.x}, ${e.y})  ${hex8(u32(e.raw, 0)).toUpperCase()}`}</option>
        ))}
      </select>
      <a className="small" href={oahuMapHref(map)}>{`${map.name} を開く`}</a>
    </label>
  );
}

interface WorldExit {
  map: OahuMapInfo;
  /** The record's section (3 exits, 8 event ranges …) and index. */
  section: number;
  exit: number;
  point: number;
  /** The entrance of the world the exit leads to (-1: none with that ID). */
  entrance: number;
}

/** The maps behind an entrance (the destination's dungeon) and their exits that lead back to the world. */
function DestMaps({ session, view, map, entranceId }: { session: OahuSession; view: WorldView; map: OahuMapInfo; entranceId: number }): ReactNode {
  const { maps, world } = session;
  const revision = useMaps(maps);
  const list = world.dungeonMaps(map.dungeon);
  const d = maps.dungeons[map.dungeon];
  const [exits, setExits] = useState<WorldExit[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const t = d ? await maps.eventTable(d).catch(() => null) : null;
      const out: WorldExit[] = [];
      for (const m of list)
        for (const section of OAHU_EVENT_SECTIONS)
          (maps.doc(m).recs[section] ?? []).forEach((e, i) => {
            const row = oahuRecEventRow(section, e.raw);
            if (!t || !row || row >= t.rows) return;
            const ev = t.row(row);
            if (u32(ev, 0x10) !== OAHU_WORLD) return;
            out.push({ map: m, section, exit: i, point: u32(ev, 0x14), entrance: world.entranceById(u32(ev, 0x14)) });
          });
      if (live) setExits(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, world, map.dungeon, revision]);
  return (
    <div className="world-dest-maps">
      <h3>{`この入口の先のマップ (${oahuDungeonLabel(session, map.dungeon)})`}</h3>
      <table className="book-table">
        <tbody>
          {list.map((m) => (
            <tr key={m.hash} className={m.hash === map.hash ? 'active' : ''}>
              <td>{oahuFloorLabel(m.floor) || '地上'}</td>
              <td><a href={oahuMapHref(m)}>{m.name}</a>{maps.isChanged(m) && <span className="edited-mark"> ●</span>}</td>
              <td className="num muted small">{`${maps.doc(m).tiles.length} マス`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>ワールドへの出口</h3>
      {!exits ? <p className="muted small">イベントの表を読み込み中…</p> : !exits.length ? <p className="muted small">このダンジョンにワールドへ出る出入口はありません。</p> : (
        <ul className="small world-exits">
          {exits.map((x) => {
            const e = x.entrance >= 0 ? world.entrances()[x.entrance] : undefined;
            return (
              <li key={`${x.map.hash}.${x.section}.${x.exit}`}>
                <a href={oahuMapHref(x.map)}>{`${x.map.name} の${SECTION_NAME[x.section] ?? `区画 ${x.section} の`} #${x.exit}`}</a>
                {' → '}
                {e ? <a href={oahuWorldHref(x.entrance)} onClick={(ev) => { ev.preventDefault(); view.select({ type: 'entrance', index: x.entrance }, true); }}>
                  {`${WE.part(e) ? '入口' : '出る位置'} #${x.entrance} (${WE.x(e)}, ${WE.y(e)})`}
                </a> : <span className="warn-mark">{`${hex8(x.point).toUpperCase()} (ワールドにない ID)`}</span>}
                {WE.id(e ?? new Uint8Array(32)) === entranceId && <span className="muted"> (この入口)</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The exits of every map that lead to a place of the world without a model (where the player comes out). */
function ComesHere({ session, view, id }: { session: OahuSession; view: WorldView; id: number }): ReactNode {
  const { world } = session;
  // the entrance next to this place (the town it belongs to)
  const list = world.entrances();
  const me = list.find((r) => WE.id(r) === id)!;
  const [mx, my] = entranceCell(me);
  let best = -1, bd = 9;
  list.forEach((r, i) => {
    if (!WE.part(r)) return;
    const [x, y] = entranceCell(r);
    const dd = (x - mx) ** 2 + (y - my) ** 2;
    if (dd < bd) [best, bd] = [i, dd];
  });
  return (
    <div className="small">
      <p className="muted">模型のない入口は、町・ダンジョンの出入口から出たときに立つ位置です (その出入口の EventObject +0x14 がこの ID)。</p>
      {best >= 0 && (
        <p>
          {'隣の入口: '}
          <a href={oahuWorldHref(best)} onClick={(e) => { e.preventDefault(); view.select({ type: 'entrance', index: best }, true); }}>
            {`#${best} ${world.dest(list[best]!).map?.name ?? ''}`}
          </a>
        </p>
      )}
    </div>
  );
}

function RangeInspector({ session, view, slot, index }: { session: OahuSession; view: WorldView; slot: typeof WS.land | typeof WS.sea; index: number }): ReactNode {
  const { world, master } = session;
  const list = world.ranges(slot);
  const r = list[index];
  const orig = world.originalSection(slot);
  if (!r) return null;
  const ai = master.table('areaInfoData.bin');
  const row = ai.hashIndex().get(r.hash);
  const info = row !== undefined ? ai.row(row) : null;
  const set = (next: OahuWorldRange): void => {
    view.mark();
    const l = list.slice();
    l[index] = next;
    world.setRanges(slot, l);
  };
  const hashes = [...new Set(world.ranges(slot).map((x) => x.hash))];
  const o = index * 12 + 12 <= orig.length ? orig.subarray(index * 12, index * 12 + 12) : null;
  const changed = !o || u32(o, 0) !== r.hash || (o[4]! | (o[5]! << 8)) !== r.x || (o[6]! | (o[7]! << 8)) !== r.y || o[8] !== r.w || o[9] !== r.h;
  return (
    <div>
      <div className="book-head">
        <h3>{`${SLOT_LABEL[slot]} #${index}`}</h3>
        {changed && <span className="edited-mark">●</span>}
      </div>
      <p className="small muted">ゲームは 3 セル単位 (100 × 100 のエリアの格子、x / 3) で areaInfoData の行を書き込みます (FUN_0032cb14)。</p>
      <table className="enc-table row-fields">
        <tbody>
          <tr><td>x, y</td><td>
            <NumberInput value={r.x} min={0} max={OAHU_WORLD_SIZE - 1} onCommit={(v) => set({ ...r, x: v })} />
            <NumberInput value={r.y} min={0} max={OAHU_WORLD_SIZE - 1} onCommit={(v) => set({ ...r, y: v })} />
          </td></tr>
          <tr><td>幅, 高さ</td><td>
            <NumberInput value={r.w} min={1} max={255} onCommit={(v) => set({ ...r, w: v })} />
            <NumberInput value={r.h} min={1} max={255} onCommit={(v) => set({ ...r, h: v })} />
          </td></tr>
          <tr><td>areaInfoData</td><td>
            <select value={r.hash} onChange={(e) => set({ ...r, hash: Number(e.target.value) })}>
              {hashes.map((h) => <option key={h} value={h}>{`${hex8(h).toUpperCase()} (行 ${ai.hashIndex().get(h) ?? '?'})`}</option>)}
            </select>
          </td></tr>
        </tbody>
      </table>
      {info && (
        <p className="small">
          {`areaInfoData の行 ${row}: 群れ (推定、+0x00) `}<a href={oahuGroupHref(u32(info, 0))}>{`#${u32(info, 0)}`}</a>
          {` ・+0x04 = ${info[4]! | (info[5]! << 8)}・+0x06 = ${info[6]} (${info[6] === 1 ? '陸' : info[6] === 2 ? '海' : '?'})`}
        </p>
      )}
      <button className="small" onClick={() => { view.mark(); world.setRanges(slot, [...list, { ...r, x: Math.min(OAHU_WORLD_SIZE - r.w, r.x + 3) }]); view.select({ type: 'range', set: slot === WS.land ? 'land' : 'sea', index: list.length }); }}>この範囲を複製</button>
      <button className="small" onClick={() => { view.mark(); world.setRanges(slot, list.filter((_, i) => i !== index)); view.select({ type: 'none' }); }}>この範囲を消す</button>
    </div>
  );
}

function PointInspector({ session, view, sel }: { session: OahuSession; view: WorldView; sel: Extract<WorldSelection, { type: 'point' }> }): ReactNode {
  const { world, maps } = session;
  const slot = OAHU_POINT_SLOT[sel.set]!;
  const p = pointsOf(session, slot)[sel.index];
  if (!p) return null;
  const wd = world.info && maps.dungeonOf(world.info);
  const raw = world.section(slot);
  return (
    <div>
      <h3>{`${SLOT_LABEL[slot]} #${sel.index}`}</h3>
      <p className="small">{`位置 (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) セル`}</p>
      {slot === WS.props ? (
        <p className="small">{`mapObject の行 ${p.value}`}</p>
      ) : (
        <p className="small">
          {slot === WS.events && `種類 ${p.kind}・`}
          {`w01_EventObject の行 ${p.value}`}
          {wd && <a href={`#/events/${oahuEventKey({ dungeon: wd.row, row: p.value })}`}> 一覧で開く</a>}
        </p>
      )}
      {slot === WS.events && <p className="muted small">{`範囲の大きさ ${f32(raw, sel.index * 32 + 0x14).toFixed(2)} × ${f32(raw, sel.index * 32 + 0x18).toFixed(2)}・+0x1D = ${raw[sel.index * 32 + 0x1d]}`}</p>}
      <p className="muted small">この区画の編集はまだできません (表示のみ)。</p>
    </div>
  );
}
