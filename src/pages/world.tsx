// World maps (W01 ...; docs/worldmap.md) in the world map frame shared with RPG3 (editor/worldpage.tsx): the 2D map and
// the 3D preview of KaharaWorldSource (worldsource.ts), the terrain painted with worldmapParts rows (W01 / W02's
// Wxx_ground.bin), and the entrances to towns and dungeons (section 2), moved on the map and pointed at other maps.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { mapLabel, pointLabel, worldHref, worldLabel } from '../editor/labels';
import { validateWorld, type WorldIssue } from '../editor/validate';
import { useWorldView, WorldFrame } from '../editor/worldpage';
import { P3 } from '../game/sections';
import { ENT, WORLD_SIZE, moveEntrance, parseWorldPoints, setEntranceU32, type EntranceField, type WorldInfo, type WorldPoint } from '../game/worldmap';
import type { Session } from '../session';
import { Count, EditedMark, ListFilter, NumberInput, useEdits, useSticky, type PageProps } from '../ui/book';
import { MapButton } from '../ui/MapPicker';
import { useSignal } from '../ui/useEditorState';
import { equalBytes, hex8, w32 } from '../util/bytes';
import { KaharaWorldSource } from './worldsource';

const ROT_LABEL = ['↑ 0', '→ 1', '↓ 2', '← 3'];
const DUMMY = { subscribe: () => () => {}, get: () => 0 } as unknown as Parameters<typeof useSignal>[0];

export function WorldPage({ session, arg }: PageProps): ReactNode {
  const { game } = session;
  const worlds = useMemo(() => game.worldMaps(), [game]);
  const [code, idHex] = (arg ?? '').split('.');
  const world = useSticky(worlds.find((w) => w.code === code), (w) => worlds.includes(w), () => worlds[0]!);
  if (!world) return <div className="start"><div className="error">ワールドマップの表 (code.bin 0x4C3A7C) を読めませんでした。</div></div>;
  return <WorldView key={world.hash} session={session} world={world} worlds={worlds} routeId={idHex ? parseInt(idHex, 16) >>> 0 : undefined} />;
}

function WorldView({ session, world, worlds, routeId }: { session: Session; world: WorldInfo; worlds: WorldInfo[]; routeId: number | undefined }): ReactNode {
  const { game } = session;
  const [rev, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'changed' | 'issues'>('all');
  const list = session.entrancesOf(world);
  const original = useMemo(() => session.originalEntrances(world), [session, world]);
  const [selId, setSelId] = useState(() => routeId ?? (list[0] ? ENT.id(list[0]) : 0));
  const index = list.findIndex((r) => ENT.id(r) === selId);
  const sel = list[index];
  const { view, pane2d, pane3d } = useWorldView(() => new KaharaWorldSource(session, world), [session, world], '#/world', (s) => {
    const r = s.type === 'entrance' ? session.entrancesOf(world)[s.index] : undefined;
    if (!r) return;
    setSelId(ENT.id(r));
    history.replaceState(null, '', worldHref(world.code, ENT.id(r)));
  });
  useSignal(view?.signal ?? DUMMY);
  const src = view?.src as KaharaWorldSource | undefined;
  // the views follow the selection of the list (and the route)
  useEffect(() => {
    if (routeId !== undefined) setSelId(routeId);
  }, [routeId]);
  useEffect(() => {
    if (!view || index < 0) return;
    if (view.sel.type !== 'entrance' || view.sel.index !== index) requestAnimationFrame(() => view.select({ type: 'entrance', index }, true));
  }, [view, index]);
  const issues = useMemo(() => validateWorld(game, world.hash, list, original, session.st.docs), [game, world, list, original, session, rev, src?.revision()]);
  const points = useMemo(() => parseWorldPoints(game.db.get(world.sections[3]!)), [game, world]);

  const changed = (i: number): boolean => !original[i] || !equalBytes(original[i]!, list[i]!);
  const update = (i: number, next: Uint8Array): void => {
    view?.mark();
    const l = list.slice();
    l[i] = next;
    session.setEntrances(world, l);
    src?.changed();
    edited();
  };
  const q = query.trim();
  const rows = list
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => {
      if (filter === 'changed' && !changed(i)) return false;
      if (filter === 'issues' && !issues.some((x) => x.index === i)) return false;
      return !q || mapLabel(game, ENT.destMap(r)).includes(q) || hex8(ENT.id(r)).includes(q.toUpperCase());
    });
  const worldChanged = session.changedWorlds().includes(world) || session.changedGrounds().includes(world);

  return (
    <WorldFrame view={view} pane2d={pane2d} pane3d={pane3d}
      title={<><strong>{worldLabel(world.code)}</strong><span className="muted small">{`${hex8(world.hash)}・${WORLD_SIZE} × ${WORLD_SIZE} セル`}</span></>}
      changed={worldChanged}
      onRevert={() => {
        if (!confirm(`${worldLabel(world.code)} の変更 (地形・入口) をすべて元に戻しますか?`)) return;
        view?.mark();
        session.setEntrances(world, original);
        if (session.groundEditable(world)) session.setGround(world, null);
        src?.changed();
        edited();
      }}
      top={
        <div className="row">
          <select value={world.code} onChange={(e) => (location.hash = worldHref(e.target.value))}>
            {worlds.map((w) => <option key={w.hash} value={w.code}>{`${worldLabel(w.code)} (${hex8(w.hash)})`}</option>)}
          </select>
        </div>
      }
      list={
        <div className="world-entrances">
          <ListFilter query={query} setQuery={setQuery} placeholder="行き先のマップ・入口 ID で検索" filter={filter} setFilter={setFilter}
            options={[['all', 'すべて'], ['changed', '変更した'], ['issues', '問題あり']]} />
          <Count shown={rows.length} total={list.length} unit="入口" />
          <table className="book-table world-entrance-table">
            <tbody>
              {rows.map(({ r, i }) => (
                <tr key={i} className={i === index ? 'active' : ''} onClick={() => { setSelId(ENT.id(r)); history.replaceState(null, '', worldHref(world.code, ENT.id(r))); }}>
                  <td className="num muted">{i}</td>
                  <td>
                    {mapLabel(game, ENT.destMap(r))}
                    {changed(i) && <EditedMark text=" ●" />}
                    {issues.some((x) => x.index === i) && <span className="warn-mark" title="問題あり"> ⚠</span>}
                    <div className="muted small mono">{hex8(ENT.id(r))}</div>
                  </td>
                  <td className="num muted small">{`${ENT.x(r)},${ENT.y(r)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      inspector={sel && (
        <EntranceEditor
          session={session}
          world={world}
          r={sel}
          original={original[index]}
          points={points}
          issues={issues.filter((x) => x.index === index)}
          update={(next) => update(index, next)}
          edited={() => { src?.changed(); edited(); }}
        />
      )}
      statusOf={(x, y) => {
        const under = list.findIndex((r) => ENT.x(r) === x && ENT.y(r) === y);
        return under >= 0 ? [`入口 ${hex8(ENT.id(list[under]!))} → ${mapLabel(game, ENT.destMap(list[under]!))}`] : [];
      }}
    />
  );
}

/** The fields of one entrance, and whether the map it leads to leads back to it. */
function EntranceEditor({ session, world, r, original, points, issues, update, edited }: {
  session: Session;
  world: WorldInfo;
  r: Uint8Array;
  original: Uint8Array | undefined;
  points: WorldPoint[];
  issues: WorldIssue[];
  update: (next: Uint8Array) => void;
  edited: () => void;
}): ReactNode {
  const { game, st } = session;
  const id = ENT.id(r);
  const set = (field: EntranceField) => (v: number) => update(setEntranceU32(r, field, v));
  const dest = ENT.destMap(r);
  const destInfo = game.code.byHash(dest);
  const destDoc = destInfo ? session.docOf(destInfo) : null;
  const destPoints = destDoc?.recs[3] ?? [];
  const back = destPoints.find((p) => P3.id(p.raw) === ENT.destPoint(r));
  const leadsBack = !!back && P3.destMap(back.raw) === world.hash && P3.destPoint(back.raw) === id;
  const differs = (o: number, n = 4): boolean => !!original && !equalBytes(original.subarray(o, o + n), r.subarray(o, o + n));
  const cls = (o: number, n = 4): string | undefined => (differs(o, n) ? 'edited' : undefined);

  /** Make the destination point lead back to this entrance (edits that map, like the map editor would). */
  const fixBack = (): void => {
    if (!destInfo) return;
    const doc = session.docOf(destInfo);
    const p = doc.recs[3]?.find((q) => P3.id(q.raw) === ENT.destPoint(r));
    if (!p) return;
    st.docs.set(destInfo.hash, doc);
    w32(p.raw, 4, world.hash);
    w32(p.raw, 8, id);
    st.emit('doc');
    session.scheduleSave();
    edited();
  };

  return (
    <div className="world-entrance">
      <div className="book-head">
        <h2>{`入口 ${hex8(id)}`}</h2>
        <span className="muted">{`${worldLabel(world.code)} の区画 2`}</span>
        {original && !equalBytes(original, r) && <button onClick={() => update(original.slice())}>この入口を元に戻す</button>}
      </div>
      {issues.map((x) => <div key={x.key} className={`issue ${x.level}`}>{`${x.level === 'error' ? '✖' : '⚠'} ${x.msg}`}</div>)}
      <div className="world-fields">
        <label className="field">
          <span>位置 x, y (セル 0〜299、地図でドラッグしても動きます)</span>
          <div className="row">
            <NumberInput value={ENT.x(r)} min={0} max={WORLD_SIZE - 1} className={`num-input${differs(0x1c, 2) ? ' edited' : ''}`} onCommit={(v) => update(moveEntrance(r, v, ENT.y(r)))} />
            <NumberInput value={ENT.y(r)} min={0} max={WORLD_SIZE - 1} className={`num-input${differs(0x1e, 2) ? ' edited' : ''}`} onCommit={(v) => update(moveEntrance(r, ENT.x(r), v))} />
            <select value={ENT.rot(r)} className={cls(0x20, 1)} title="向き (+0x20)" onChange={(e) => update(moveEntrance(r, ENT.x(r), ENT.y(r), Number(e.target.value)))}>
              {ROT_LABEL.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
          </div>
        </label>
        <label className="field">
          <span>行き先のマップ (+0x08)</span>
          <MapButton game={game} value={dest} worlds className={cls(0x08)} title="行き先のマップを選ぶ" onChange={set(0x08)} />
        </label>
        <label className="field">
          <span>行き先の地点 (+0x0C)</span>
          {destInfo ? (
            <select value={ENT.destPoint(r)} className={cls(0x0c)} onChange={(e) => set(0x0c)(Number(e.target.value))}>
              {!back && <option value={ENT.destPoint(r)}>{`${hex8(ENT.destPoint(r))} (行き先にない)`}</option>}
              {destPoints.map((p) => <option key={P3.id(p.raw)} value={P3.id(p.raw)}>{`${pointLabel(p.raw, p.x, p.y)}  ${hex8(P3.id(p.raw))}`}</option>)}
            </select>
          ) : <span className="mono">{hex8(ENT.destPoint(r))}</span>}
        </label>
        {destInfo && back && (
          <div className={leadsBack ? 'muted small' : 'issue warn'}>
            {leadsBack
              ? `行き先の地点から出ると、この入口に戻ります。`
              : `行き先の地点から出ると ${game.code.world(P3.destMap(back.raw)) ? `${mapLabel(game, P3.destMap(back.raw))} の入口 ${hex8(P3.destPoint(back.raw))}` : mapLabel(game, P3.destMap(back.raw))} に出ます。`}
            {!leadsBack && <button className="small" onClick={fixBack}>この入口に戻るようにする</button>}
            {' '}<a href={`#/map/${destInfo.name}`}>{`${destInfo.name} を開く`}</a>
          </div>
        )}
        <label className="field">
          <span>出現条件 (+0x10、{world.code}_EventObject の行。0 = 常に出る)</span>
          <NumberInput value={ENT.event(r)} min={0} max={0xffff} className={`num-input${differs(0x10) ? ' edited' : ''}`} onCommit={set(0x10)} />
        </label>
        <label className="field">
          <span>移動先の地点 (+0x14、区画 3)</span>
          <select value={ENT.point(r)} className={cls(0x14)} onChange={(e) => set(0x14)(Number(e.target.value))}>
            {!points.some((p) => p.id === ENT.point(r)) && <option value={ENT.point(r)}>{ENT.point(r) ? `${hex8(ENT.point(r))} (区画 3 にない)` : '0 (なし)'}</option>}
            {points.map((p) => <option key={p.id} value={p.id}>{`${hex8(p.id)} (${p.x}, ${p.y})`}</option>)}
          </select>
        </label>
        <label className="field">
          <span>表示モデル (+0x18、mapObject の行。0 = 入口の種類のモデル)</span>
          <NumberInput value={ENT.model(r)} min={0} max={game.master.mapObject.rows - 1} className={`num-input${differs(0x18) ? ' edited' : ''}`} onCommit={set(0x18)} />
        </label>
        <label className="field">
          <span>入口の種類 (+0x00、worldmapParts の行)</span>
          <NumberInput value={ENT.part(r)} min={0} max={255} className={`num-input${differs(0x00) ? ' edited' : ''}`} onCommit={set(0x00)} />
        </label>
      </div>
      <div className="muted small mono">{`36 バイト: ${Array.from(r, (b) => b.toString(16).padStart(2, '0')).join(' ')}`}</div>
    </div>
  );
}

