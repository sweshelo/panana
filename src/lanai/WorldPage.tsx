// RPG FREE!'s world maps (#/world/<content>.<W01|W02>[@entrance]; naauao lanai/worldmap.md) in the world map frame shared
// with RPG2 and RPG3 (editor/worldpage.tsx): the views draw LanaiWorldSource (worldsource.ts). Left: the tools ("チップ"
// paints the terrain, "パーツ" puts entrances copied from the world's own), the layers and the entrances; right: the
// selected entrance (its fields, where its EventObject row leads, the exits that come back), range or point.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PartPicker, PartSelection, type PartChoice } from '../editor/partpalette';
import { useWorldView, WorldFrame } from '../editor/worldpage';
import type { WorldSelection, WorldStamp, WorldView } from '../editor/worldview';
import type { ModelRef } from '../pages/modelview';
import { NumberInput } from '../ui/book';
import { Photo } from '../ui/Photo';
import { useSignal } from '../ui/useEditorState';
import { equalBytes, hex8, u32 } from '../util/bytes';
import { grid2, moveEntrance, parseEventRanges, parseProps, setEntranceByte, setEntranceU32 } from '../oahu/worldmap';
import { lanaiActionName } from './actions';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiMapHref } from './MapPage';
import { lanaiGroupHref } from './MapParts';
import { lanaiObjectModels } from './mapModels';
import { lanaiObjectRef } from './mapObjects';
import { lanaiExitLabel, lanaiFloorLabel, lanaiMaps, type LanaiMapInfo, type LanaiMaps } from './maps';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';
import { LANAI_ENTRANCE_COLORS, LANAI_POINT_SLOT, LANAI_RANGE_SLOT, LanaiWorldSource } from './worldsource';
import {
  entranceTurn, LANAI_EO_MODEL, LANAI_WORLD_CONTENTS, LANAI_WORLD_ENTER, LANAI_WORLD_PARTS, LANAI_WORLD_SIZE, LANAI_WORLD_SLOT_LABEL, LanaiWorld, lanaiWorldParts, LW,
  parseWorldObjects, WE, type LanaiWorldRange,
} from './worldmap';

/** The worlds of the contents (W02 only in 33 / 71 / 126). */
const WORLD_NAMES: Record<number, string[]> = { 33: ['W01', 'W02'], 71: ['W01', 'W02'], 126: ['W01', 'W02'] };
const worldNames = (content: number): string[] => WORLD_NAMES[content] ?? ['W01'];

export const lanaiWorldHref = (content: number, name = 'W01', entrance?: number): string => `#/world/${content}.${name}${entrance === undefined ? '' : `@${entrance}`}`;

/** Facing bytes (+0x1C) in the order of the turns of the stamp (↑ north, → east, ↓ south, ← west). */
const FACINGS: [byte: number, label: string][] = [[1, '北 (1)'], [8, '東 (8)'], [4, '南 (4)'], [2, '西 (2)']];
const facingOfRot = (rot: number): number => FACINGS[rot & 3]![0];

const SECTION_NAME: Record<number, string> = { 3: '出入口', 4: '宝箱', 5: 'キャラ・オブジェクト', 8: 'イベントの範囲' };

const worlds = new WeakMap<LanaiMaps, Map<number, LanaiWorld>>();
/** One LanaiWorld per map (it keeps the terrain being painted). */
function worldOf(maps: LanaiMaps, info: LanaiMapInfo): LanaiWorld {
  let m = worlds.get(maps);
  if (!m) worlds.set(maps, (m = new Map()));
  let w = m.get(info.hash);
  if (!w) m.set(info.hash, (w = new LanaiWorld(maps, info, lanaiWorldParts(maps.session.table(LANAI_WORLD_PARTS)))));
  return w;
}

const noop = (): void => {};
function useMaps(maps: LanaiMaps | null): number {
  return useSyncExternalStore((f) => (maps ? maps.on(f) : noop), () => maps?.revision ?? 0, () => maps?.revision ?? 0);
}

/** A MapObject row's model for the pictures. */
function objectRef(session: LanaiSession, row: number): ModelRef | null {
  const ref = lanaiObjectRef(session.table('MapObject'), row);
  return ref ? { key: `lanai/object/${row}`, load: async () => ({ set: await lanaiObjectModels(session, ref), hash: ref.entry }) } : null;
}

export function LanaiWorldPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const m = /^(\d+)(?:\.(W\d\d))?(?:@(\d+))?$/.exec(arg ?? '');
  const content = contents.find((c) => c.index === (m ? Number(m[1]) : LANAI_WORLD_CONTENTS[0])) ?? contents.find((c) => c.index === LANAI_WORLD_CONTENTS[0]);
  const name = m?.[2] ?? 'W01';
  const entrance = m?.[3] !== undefined ? Number(m[3]) : undefined;
  const [maps, setMaps] = useState<LanaiMaps | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!content) return;
    let live = true;
    setMaps(null);
    setError('');
    lanaiMaps(session, content).then((x) => live && setMaps(x), (e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [session, content]);
  if (!content) return <div className="start"><div className="error">ワールドマップのあるコンテンツが見つかりません。</div></div>;
  if (error) return <div className="start"><div className="error">{error}</div></div>;
  if (!maps) return <div className="start"><p className="muted">{`コンテンツ ${content.index} のマップを読み込み中…`}</p></div>;
  const info = maps.mapByName(name) ?? maps.maps.find((x) => x.world);
  if (!info?.world) return <div className="start"><div className="error">{`コンテンツ ${content.index} に ${name} がありません。`}</div></div>;
  const world = worldOf(maps, info);
  return <WorldEditor key={info.hash + ':' + content.index} session={session} contents={contents} content={content} world={world} entrance={entrance} />;
}

function WorldPicker({ contents, content, name }: { contents: LanaiContent[]; content: LanaiContent; name: string }): ReactNode {
  return (
    <label className="field">
      <span className="muted small">ワールドマップ</span>
      <select value={`${content.index}.${name}`} onChange={(e) => { location.hash = `#/world/${e.target.value}`; }}>
        {LANAI_WORLD_CONTENTS.flatMap((ci) => {
          const c = contents.find((x) => x.index === ci);
          return worldNames(ci).map((n) => <option key={`${ci}.${n}`} value={`${ci}.${n}`}>{`${ci}: ${c ? contentTitle(c) : ''} ${n}`}</option>);
        })}
      </select>
    </label>
  );
}

function WorldEditor({ session, contents, content, world, entrance }: { session: LanaiSession; contents: LanaiContent[]; content: LanaiContent; world: LanaiWorld; entrance: number | undefined }): ReactNode {
  const maps = world.maps;
  useMaps(maps);
  const { view, pane2d, pane3d } = useWorldView(() => new LanaiWorldSource(world), [world], '#/world', (sel) => {
    const want = lanaiWorldHref(content.index, world.name, sel.type === 'entrance' ? sel.index : undefined);
    if (location.hash !== want) history.replaceState(null, '', want);
  });
  useEffect(() => {
    if (!view) return;
    requestAnimationFrame(() => {
      if (entrance !== undefined && entrance >= 0 && entrance < world.entrances().length) view.select({ type: 'entrance', index: entrance }, true);
      else {
        view.focus();
        view.fitWorld();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useSignal(view?.signal ?? DUMMY);
  // Delete / Ctrl+D on the selected entrance
  if (view) {
    const sel = view.sel;
    const index = sel.type === 'entrance' ? sel.index : -1;
    view.onDelete = index >= world.originalEntrances().length ? () => {
      view.mark();
      if (world.removeEntrance(index)) view.select({ type: 'none' });
    } : null;
    view.onDuplicate = index >= 0 ? () => {
      const r = world.entrances()[index]!;
      view.mark();
      view.select({ type: 'entrance', index: world.addEntrance(index, WE.x(r) + 1, WE.y(r)) }, true);
    } : null;
  }
  return (
    <WorldFrame view={view} pane2d={pane2d} pane3d={pane3d}
      title={<><strong>{`ワールドマップ ${world.name}`}</strong><span className="muted small">{`コンテンツ ${content.index}・${hex8(world.info.hash).toUpperCase()}・${LANAI_WORLD_SIZE} × ${LANAI_WORLD_SIZE} セル`}</span></>}
      changed={world.isChanged()}
      onRevert={() => {
        if (!view || !confirm(`${world.name} の変更 (地形・入口・範囲) をすべて元に戻しますか? (入口の EventObject の行はイベントの表のまま残ります)`)) return;
        view.mark();
        world.revert();
      }}
      top={<WorldPicker contents={contents} content={content} name={world.name} />}
      parts={view && <WorldParts world={world} view={view} />}
      canEditPart={view?.sel.type === 'entrance'}
      list={view && <EntranceList world={world} view={view} />}
      inspector={view && <WorldInspector world={world} view={view} content={content} />}
      statusOf={(x, y) => {
        const out: string[] = [];
        const dark = grid2(world.section(LW.dark), x, y);
        if (dark) out.push(`暗い海 ${dark} / 3`);
        const inRange = (slot: typeof LW.land | typeof LW.sea): number => world.ranges(slot).filter((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h).length;
        const land = inRange(LW.land), sea = inRange(LW.sea);
        if (land || sea) out.push(`範囲 陸 ${land}・海 ${sea}`);
        return out;
      }}
    />
  );
}

const DUMMY = { subscribe: () => () => {}, get: () => 0 } as unknown as Parameters<typeof useSignal>[0];

/** "D01001F01 (水源どうくつ B1F)" for a destination map. */
function mapName(maps: LanaiMaps, m: LanaiMapInfo | undefined, hash = 0): string {
  if (!m) return hash ? hex8(hash).toUpperCase() : '(なし)';
  const g = maps.groupName(m.dungeon);
  const floor = lanaiFloorLabel(m.floor);
  return `${m.name}${g || floor ? ` (${[g, floor].filter(Boolean).join(' ')})` : ''}`;
}

/** The entrances grouped by the MapGroup of the map they lead to. */
function EntranceList({ world, view }: { world: LanaiWorld; view: WorldView }): ReactNode {
  const maps = world.maps;
  const [query, setQuery] = useState('');
  const list = world.entrances();
  const original = world.originalEntrances();
  const sel = view.sel;
  const q = query.trim().toUpperCase();
  const rows = list.map((r, i) => ({ r, i, d: world.dest(r) })).filter(({ r, d }) => !q || hex8(WE.id(r)).toUpperCase().includes(q) || mapName(maps, d.map, d.mapHash).toUpperCase().includes(q));
  return (
    <div className="world-entrances">
      <h3>{`入口 ${list.length}`}</h3>
      <input type="search" placeholder="行き先のマップ・ID で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      <table className="book-table world-entrance-table">
        <tbody>
          {rows.map(({ r, i, d }) => {
            const changed = !original[i] || !equalBytes(original[i]!, r);
            return (
              <tr key={i} className={sel.type === 'entrance' && sel.index === i ? 'active' : ''} onClick={() => view.select({ type: 'entrance', index: i }, true)}>
                <td className="num muted">{i}</td>
                <td>
                  <span style={{ color: LANAI_ENTRANCE_COLORS[WE.part(r)] ?? '#fff' }}>● </span>
                  {d.action >= 0 ? mapName(maps, d.map, d.mapHash) : d.row ? lanaiActionName(d.type) : '行き先なし'}
                  {changed && <span className="edited-mark"> ●</span>}
                </td>
                <td className="num muted small">{`${WE.x(r)},${WE.y(r)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- "パーツ": new entrances copied from the world's own

interface EntranceStamp extends WorldStamp {
  from: number;
}

function WorldParts({ world, view }: { world: LanaiWorld; view: WorldView }): ReactNode {
  const session = world.maps.session;
  useSignal(view.signal);
  const [open, setOpen] = useState(false);
  const stamp = view.stamp as EntranceStamp | null;
  const list = world.entrances();
  // one kind per look (the MapObject row the entrance shows) among the world's entrances
  const kinds: { from: number; shown: number; name: string }[] = [];
  const seen = new Set<number>();
  list.forEach((r, i) => {
    const shown = world.entranceObject(r);
    if (seen.has(shown)) return;
    seen.add(shown);
    const d = world.dest(r);
    kinds.push({ from: i, shown, name: `${d.action >= 0 ? mapName(world.maps, d.map, d.mapHash) : `入口 #${i}`} と同じ` });
  });
  const choose = (k: (typeof kinds)[number]): void => {
    setOpen(false);
    const next: EntranceStamp = {
      label: k.name,
      from: k.from,
      place: (x, y, rot) => {
        const i = world.addEntrance(k.from, x, y);
        world.setEntrance(i, setEntranceByte(world.entrances()[i]!, 0x1c, facingOfRot(rot)));
        return { type: 'entrance', index: i };
      },
    };
    view.setStamp(next);
  };
  const cur = kinds.find((k) => k.from === stamp?.from);
  const choices: PartChoice[] = kinds.map((k) => ({
    key: String(k.from), name: k.name, sub: `MapObject #${k.shown}`, category: 'いまある入口と同じ見た目',
    icon: <Photo model={objectRef(session, k.shown)} className="photo photo-lg" />,
  }));
  return (
    <div className="add-panel compact-add-panel world-parts-panel">
      <PartSelection label={cur ? cur.name : '置くものを選ぶ…'} onChoose={() => setOpen(true)}
        icon={cur ? <Photo model={objectRef(session, cur.shown)} className="photo photo-lg" /> : undefined}
        help={'町・ダンジョンの入口を選び、地図をクリックして置きます (区画 2 の入口が増えます)。Esc で選択に戻ります。\n置いた入口には写し元の EventObject の行の写しが付くので、行き先・見た目は右ペインで変えられます。'}
        directions={cur ? { labels: ['↑ 北', '→ 東', '↓ 南', '← 西'], value: view.stampRot, onChange: (r) => view.setStampRot(r) } : undefined} />
      {open && <PartPicker choices={choices} current={cur ? String(cur.from) : undefined} onClose={() => setOpen(false)} onPick={(key) => { const k = kinds.find((x) => String(x.from) === key); if (k) choose(k); }} />}
    </div>
  );
}

// ---- right: the inspector

function WorldInspector({ world, view, content }: { world: LanaiWorld; view: WorldView; content: LanaiContent }): ReactNode {
  useSignal(view.signal);
  const sel = view.sel;
  if (sel.type === 'entrance') return <EntranceInspector key={`${world.info.hash}.${sel.index}`} world={world} view={view} index={sel.index} content={content} />;
  if (sel.type === 'range') return <RangeInspector world={world} view={view} slot={LANAI_RANGE_SLOT[sel.set]!} index={sel.index} content={content} />;
  if (sel.type === 'point') return <PointInspector world={world} sel={sel} />;
  return <WorldSummary world={world} view={view} />;
}

function WorldSummary({ world, view }: { world: LanaiWorld; view: WorldView }): ReactNode {
  const slots = world.changedSlots();
  return (
    <div className="world-help">
      <h3>ワールドマップ</h3>
      <p className="small">
        地形はマップ表の行のスロット 9 (300 × 300 セル、WorldmapParts の行と向き)、入口・範囲などはスロット 1〜8 にあり、どれもこのコンテンツのマップ DB に書き出します。
        W01 と W02 があるコンテンツでは、2 つは別々に編集します (ROM では地形が同じ)。
      </p>
      <ul className="small">
        <li>選択・移動 (V): 入口をクリックで選び、ドラッグか矢印キーで動かします。範囲は中をドラッグで移動、右下の角で大きさ (3 セル単位)。</li>
        <li>地形を塗る (B): 部品を選んでクリック・ドラッグで置きます。Alt+クリックで地図から拾い、R で回します。地形を変えると部品ごとのプールの数も作り直します。</li>
        <li>パーツ: いまある入口と同じ見た目の入口を置きます。Ctrl+D で選んだ入口を複製、Delete で Panana が足した入口を消します。</li>
      </ul>
      <h3>変更</h3>
      {!slots.length ? <p className="muted small">変更はありません。</p> : (
        <ul className="small">{slots.map((k) => <li key={k}>{`スロット ${k} ${LANAI_WORLD_SLOT_LABEL[k] ?? ''} (${hex8(world.hash(k)).toUpperCase()})`}</li>)}</ul>
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

function EntranceInspector({ world, view, index, content }: { world: LanaiWorld; view: WorldView; index: number; content: LanaiContent }): ReactNode {
  const maps = world.maps;
  const session = maps.session;
  const r = world.entrances()[index];
  const original = world.originalEntrances()[index];
  if (!r) return null;
  const d = world.dest(r);
  const t = world.eventTable();
  const set = (next: Uint8Array): void => {
    view.mark();
    world.setEntrance(index, next);
  };
  const editEvent = (f: (t: LanaiTable, row: number) => void): void => {
    if (!t || !d.row || d.row >= t.rows) return;
    view.mark();
    f(t, d.row);
    world.changed();
  };
  const differs = (o: number, n = 4): boolean => !!original && !equalBytes(original.subarray(o, o + n), r.subarray(o, o + n));
  const cls = (o: number, n = 4): string => `num-input${differs(o, n) ? ' edited' : ''}`;
  const facing = r[0x1c]!;
  const shown = world.entranceObject(r);
  const own = t && d.row > 0 && d.row < t.rows ? t.u16(d.row, LANAI_EO_MODEL) : 0;
  const users = d.row ? world.eventUsers(d.row) : 0;
  const targets = maps.maps.filter((m) => !m.world).sort((a, b) => a.dungeon - b.dungeon || a.floor - b.floor || a.name.localeCompare(b.name));
  const exits = (m: LanaiMapInfo | undefined): { id: number; label: string }[] => (m ? (maps.doc(m).recs[3] ?? []).map((e, i) => ({ id: u32(e.raw, 0), label: `出入口 #${i} ${lanaiExitLabel(e.raw[0x15]!)} (${e.x}, ${e.y})  ${hex8(u32(e.raw, 0)).toUpperCase()}` })) : []);
  const destExits = exits(d.map);
  const isAdded = index >= world.originalEntrances().length;
  return (
    <div className="world-entrance">
      <div className="book-head">
        <h3>{`入口 #${index}`}</h3>
        <span className="mono muted small">{hex8(WE.id(r)).toUpperCase()}</span>
        {isAdded && <span className="badge" title="Panana が足した入口 (Delete で消せます)">追加</span>}
        {original && !equalBytes(original, r) && <button className="small" onClick={() => set(original.slice())}>元に戻す</button>}
      </div>
      <div className="row"><Photo model={objectRef(session, shown)} className="photo photo-lg" /></div>
      <table className="enc-table row-fields">
        <tbody>
          <tr>
            <td>種類 (+0x00)</td>
            <td>
              <select className={differs(0) ? 'edited' : ''} value={WE.part(r)} onChange={(e) => set(setEntranceU32(r, 0x00, Number(e.target.value)))}>
                {world.parts.filter((p) => p.row >= 87).map((p) => <option key={p.row} value={p.row}>{`${p.row}${p.object ? ` (既定の見た目 MapObject #${p.object})` : ''}`}</option>)}
                {WE.part(r) < 87 && <option value={WE.part(r)}>{WE.part(r)}</option>}
              </select>
            </td>
          </tr>
          <tr>
            <td>位置 x, y</td>
            <td>
              <NumberInput value={WE.x(r)} min={0} max={LANAI_WORLD_SIZE - 1} className={cls(0x10, 2)} onCommit={(v) => set(moveEntrance(r, v, WE.y(r)))} />
              <NumberInput value={WE.y(r)} min={0} max={LANAI_WORLD_SIZE - 1} className={cls(0x12, 2)} onCommit={(v) => set(moveEntrance(r, WE.x(r), v))} />
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
              <select className={differs(0x1c, 1) ? 'edited' : ''} value={facing} onChange={(e) => set(setEntranceByte(r, 0x1c, Number(e.target.value)))}>
                {FACINGS.map(([b, l]) => <option key={b} value={b}>{l}</option>)}
                {!FACINGS.some(([b]) => b === facing) && <option value={facing}>{`${facing} (= 南)`}</option>}
              </select>
              <span className="muted small">{` 回転 ${entranceTurn(r)}`}</span>
            </td>
          </tr>
          <tr>
            <td>イベント (+0x0C)</td>
            <td>
              <NumberInput value={WE.event(r)} min={0} max={Math.max(0, (t?.rows ?? 1) - 1)} className={cls(0x0c)} title="ワールドの EventObject の行 (0 = なし)" onCommit={(v) => set(setEntranceU32(r, 0x0c, v))} />
              <span className="muted small">{d.row ? ` ${lanaiActionName(d.type)}` : ' なし'}</span>
            </td>
          </tr>
        </tbody>
      </table>
      {d.row > 0 && t && d.row < t.rows && (
        <>
          <h3>行き先</h3>
          {users > 1 && <p className="small warn-mark">{`この EventObject の行はほかの入口 ${users - 1} 件も使っています。行き先・見た目を変えるとそちらも変わります。`}</p>}
          {d.action < 0 ? (
            <p className="small">
              {`この行の動作は「${lanaiActionName(d.type)}」で、ワールドの入口の動作 (型 8000001F) がありません。`}
              <button className="small" onClick={() => editEvent((tt, row) => {
                tt.setU32(row, 0x10, LANAI_WORLD_ENTER);
                const first = targets[0];
                tt.setU32(row, 0x14, first?.hash ?? 0);
                const id = exits(first)[0]?.id ?? 0;
                for (let k = 0; k < 4; k++) tt.setU32(row, 0x18 + k * 4, id);
              })}>行き先のある入口にする</button>
            </p>
          ) : (
            <>
              <label className="field">
                <span>行き先のマップ (型 8000001F の引数 1)</span>
                <select value={d.mapHash} onChange={(e) => editEvent((tt, row) => {
                  const h = Number(e.target.value) >>> 0;
                  tt.setU32(row, d.action + 4, h);
                  const id = exits(maps.map(h))[0]?.id ?? 0;
                  for (let k = 0; k < 4; k++) tt.setU32(row, d.action + 8 + k * 4, id);
                })}>
                  {!d.map && <option value={d.mapHash}>{mapName(maps, undefined, d.mapHash)}</option>}
                  {targets.map((m) => <option key={m.hash} value={m.hash}>{mapName(maps, m)}</option>)}
                </select>
                {d.map && <a className="small" href={lanaiMapHref(content.index, d.map.name)}>{`${d.map.name} を開く`}</a>}
              </label>
              {d.points.map((p, k) => (
                <label key={k} className="field">
                  <span>{`行き先の地点 ${k + 1} (引数 ${k + 2}、出入口の ID)${k ? '' : ' — 4 つの使い分けは未解析 (入る向きごとと推定)'}`}</span>
                  <select value={p} onChange={(e) => editEvent((tt, row) => tt.setU32(row, d.action + 8 + k * 4, Number(e.target.value) >>> 0))}>
                    {!destExits.some((x) => x.id === p) && <option value={p}>{`${hex8(p).toUpperCase()} (このマップにない)`}</option>}
                    {destExits.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </label>
              ))}
              {d.points.some((p) => p !== d.points[0]) || (
                <p className="muted small">4 つの地点は同じです。</p>
              )}
            </>
          )}
          <label className="field">
            <span>{`見た目 (EventObject +0x5A、MapObject の行。0 = 種類の既定 #${world.parts[WE.part(r)]?.object ?? 0})`}</span>
            <NumberInput value={own} min={0} max={Math.max(0, (session.table('MapObject')?.rows ?? 1) - 1)} onCommit={(v) => editEvent((tt, row) => tt.setU16(row, LANAI_EO_MODEL, v))} />
          </label>
          <ExitsBack world={world} view={view} id={WE.id(r)} content={content} />
        </>
      )}
    </div>
  );
}

/** The exits of the content's maps that lead out to this entrance (their EventObject actions name the world and its ID). */
function ExitsBack({ world, view, id, content }: { world: LanaiWorld; view: WorldView; id: number; content: LanaiContent }): ReactNode {
  const rev = useMaps(world.maps);
  const all = useMemo(() => world.exitsTo(), [world, rev]);
  const here = all.filter((x) => x.point === id);
  return (
    <div className="world-dest-maps">
      <h3>この入口に戻る出口</h3>
      {!here.length ? <p className="muted small">この入口に出るマップの出口はありません (出口の EventObject の引数 2 がこの入口の ID なら出ます)。</p> : (
        <ul className="small world-exits">
          {here.map((x) => (
            <li key={`${x.map.hash}.${x.section}.${x.index}`}>
              <a href={lanaiMapHref(content.index, x.map.name, { section: x.section, index: x.index })}>{`${x.map.name} の${SECTION_NAME[x.section] ?? `区画 ${x.section} の`} #${x.index}`}</a>
            </li>
          ))}
        </ul>
      )}
      {all.some((x) => world.entranceById(x.point) < 0) && (
        <p className="small warn-mark">{`ワールドにない入口 ID を指す出口が ${all.filter((x) => world.entranceById(x.point) < 0).length} 件あります。`}</p>
      )}
      <p className="muted small">
        {'出口の行き先は、そのマップの出入口の EventObject (型 80000011 など) で変えます。'}
        <a href="#" onClick={(e) => { e.preventDefault(); view.select({ type: 'none' }); }}>選択を外す</a>
      </p>
    </div>
  );
}

function RangeInspector({ world, view, slot, index, content }: { world: LanaiWorld; view: WorldView; slot: typeof LW.land | typeof LW.sea; index: number; content: LanaiContent }): ReactNode {
  const maps = world.maps;
  const list = world.ranges(slot);
  const r = list[index];
  if (!r) return null;
  const set = (next: LanaiWorldRange): void => {
    view.mark();
    const l = list.slice();
    l[index] = next;
    world.setRanges(slot, l);
  };
  const info = world.areaInfo(r.hash);
  const ids = [...new Set([...world.areaInfoIds(slot === LW.land ? 1 : 2), r.hash])];
  const key = slot === LW.land ? 'land' : 'sea';
  const groupRow = info ? maps.monsterGroupRow(info.group) : -1;
  return (
    <div>
      <h3>{`エンカウントの範囲 (${slot === LW.land ? '陸、スロット 3' : '海、スロット 4'}) #${index}`}</h3>
      <p className="small muted">ゲームは x・y・幅・高さを 3 で割って (切り捨て) 100 × 100 の格子に AreaInfo の行を書きます。3 の倍数にしておくのが安全です。</p>
      <table className="enc-table row-fields">
        <tbody>
          <tr><td>x, y</td><td>
            <NumberInput value={r.x} min={0} max={LANAI_WORLD_SIZE - 1} onCommit={(v) => set({ ...r, x: v })} />
            <NumberInput value={r.y} min={0} max={LANAI_WORLD_SIZE - 1} onCommit={(v) => set({ ...r, y: v })} />
          </td></tr>
          <tr><td>幅, 高さ</td><td>
            <NumberInput value={r.w} min={1} max={255} onCommit={(v) => set({ ...r, w: v })} />
            <NumberInput value={r.h} min={1} max={255} onCommit={(v) => set({ ...r, h: v })} />
          </td></tr>
          <tr><td>AreaInfo</td><td>
            <select value={r.hash} onChange={(e) => set({ ...r, hash: Number(e.target.value) >>> 0 })}>
              {ids.map((h) => { const a = world.areaInfo(h); return <option key={h} value={h}>{`行 ${a?.row ?? '?'} (${hex8(h).toUpperCase()})`}</option>; })}
            </select>
          </td></tr>
        </tbody>
      </table>
      {info && (
        <p className="small">
          {`AreaInfo の行 ${info.row}: 群れ `}
          {groupRow >= 0 ? <a href={lanaiGroupHref(content.index, groupRow)}>{`MonsterGroup #${groupRow}`}</a> : hex8(info.group)}
          {`・${info.kind === 1 ? '陸' : info.kind === 2 ? '海' : `種類 ${info.kind}`}`}
        </p>
      )}
      <button className="small" onClick={() => { view.mark(); world.setRanges(slot, [...list, { ...r, x: Math.min(LANAI_WORLD_SIZE - r.w, r.x + 3) }]); view.select({ type: 'range', set: key, index: list.length }); }}>この範囲を複製</button>
      <button className="small" onClick={() => { view.mark(); world.setRanges(slot, list.filter((_, i) => i !== index)); view.select({ type: 'none' }); }}>この範囲を消す</button>
    </div>
  );
}

function PointInspector({ world, sel }: { world: LanaiWorld; sel: Extract<WorldSelection, { type: 'point' }> }): ReactNode {
  const slot = LANAI_POINT_SLOT[sel.set]!;
  const b = world.section(slot);
  const p = (slot === LW.objects ? parseWorldObjects(b) : slot === LW.props ? parseProps(b) : parseEventRanges(b))[sel.index];
  if (!p) return null;
  const t = world.eventTable();
  return (
    <div>
      <h3>{`${LANAI_WORLD_SLOT_LABEL[slot]} (スロット ${slot}) #${sel.index}`}</h3>
      <p className="small">{`位置 (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) セル`}</p>
      {slot === LW.props ? <p className="small">{`MapObject の行 ${p.value}`}</p> : (
        <p className="small">
          {p.kind !== undefined && `種類 ${p.kind}・`}
          {`EventObject の行 ${p.value}`}
          {t && p.value > 0 && p.value < t.rows && ` (${lanaiActionName(t.u32(p.value, 0x10))})`}
        </p>
      )}
      <p className="muted small">この区画の編集はまだできません (表示のみ)。</p>
    </div>
  );
}
