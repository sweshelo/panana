// World maps (W01 ...): the terrain as a 2D map, painted with worldmapParts rows (W01 / W02's Wxx_ground.bin), the
// entrances to towns and dungeons (section 2), which can be moved on the map and pointed at other maps, and a 3D preview
// (world3d.tsx). docs/worldmap.md.
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { mapLabel, pointLabel, worldHref, worldLabel } from '../editor/labels';
import { validateWorld, type WorldIssue } from '../editor/validate';
import type { Game } from '../game/game';
import { P3 } from '../game/sections';
import { ENT, WORLD_SIZE, copyGround, coveredParts, moveEntrance, parseWorldPoints, setEntranceU32, type EntranceField, type Ground, type WorldInfo, type WorldPoint } from '../game/worldmap';
import type { Session } from '../session';
import { Count, EditedMark, ListFilter, NumberInput, useActiveRow, useEdits, useSticky, type PageProps } from '../ui/book';
import { MapButton } from '../ui/MapPicker';
import { equalBytes, hex8, w32 } from '../util/bytes';
import { partRgb, rgbHex, World3D } from './world3d';

const ROT_LABEL = ['↑ 0', '→ 1', '↓ 2', '← 3'];
const SCALES = [2, 3, 4, 6, 8];

/** A worldmapParts row and its rotation to paint the terrain with. */
interface Brush {
  part: number;
  rot: number;
}

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
  const selectedId = useSticky(routeId, (id) => list.some((r) => ENT.id(r) === id), () => (list[0] ? ENT.id(list[0]) : 0));
  const index = list.findIndex((r) => ENT.id(r) === selectedId);
  const sel = list[index];
  const listEl = useRef<HTMLDivElement>(null);
  useActiveRow(listEl, selectedId);
  const issues = useMemo(() => validateWorld(game, world.hash, list, original, session.st.docs), [game, world, list, original, session, rev]);
  const points = useMemo(() => parseWorldPoints(game.db.get(world.sections[3]!)), [game, world]);

  const changed = (i: number): boolean => !original[i] || !equalBytes(original[i]!, list[i]!);
  const update = (i: number, next: Uint8Array): void => {
    const l = list.slice();
    l[i] = next;
    session.setEntrances(world, l);
    edited();
  };
  const go = (id: number): void => {
    location.hash = worldHref(world.code, id);
  };
  const [brush, setBrush] = useState<Brush | null>(null);
  const [show3d, setShow3d] = useState(false);
  const undo = useRef<Ground[]>([]);
  const paint = (x: number, y: number): void => {
    const g = session.groundOf(world);
    if (!g || !brush) return;
    const i = y * WORLD_SIZE + x;
    if (g.parts[i] === brush.part && (g.rots[i] === brush.rot || !brush.part)) return;
    const next = copyGround(g);
    next.parts[i] = brush.part;
    next.rots[i] = brush.part ? brush.rot : 0;
    session.setGround(world, next);
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

  return (
    <div className="book">
      <div className="book-side">
        <div className="row">
          <select value={world.code} onChange={(e) => (location.hash = worldHref(e.target.value))}>
            {worlds.map((w) => <option key={w.hash} value={w.code}>{`${worldLabel(w.code)} (${hex8(w.hash)})`}</option>)}
          </select>
          {session.changedWorlds().includes(world) && (
            <button onClick={() => { if (confirm(`${worldLabel(world.code)} の入口の変更をすべて元に戻しますか?`)) { session.setEntrances(world, original); edited(); } }}>すべて元に戻す</button>
          )}
        </div>
        <ListFilter query={query} setQuery={setQuery} placeholder="行き先のマップ・入口 ID で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['changed', '変更した'], ['issues', '問題あり']]} />
        <div className="book-list" ref={listEl}>
          <Count shown={rows.length} total={list.length} unit="入口" />
          <table className="book-table">
            <thead><tr><th>#</th><th>行き先</th><th>位置</th></tr></thead>
            <tbody>
              {rows.map(({ r, i }) => (
                <tr key={i} className={i === index ? 'active' : ''} onClick={() => go(ENT.id(r))}>
                  <td className="num muted">{i}</td>
                  <td>
                    {mapLabel(game, ENT.destMap(r))}
                    {changed(i) && <EditedMark text=" ●" />}
                    {issues.some((x) => x.index === i) && <span className="warn-mark" title="問題あり"> ⚠</span>}
                    <div className="muted small mono">{hex8(ENT.id(r))}</div>
                  </td>
                  <td className="num">{`${ENT.x(r)}, ${ENT.y(r)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail world-detail">
        {sel && (
          <EntranceEditor
            session={session}
            world={world}
            r={sel}
            original={original[index]}
            points={points}
            issues={issues.filter((x) => x.index === index)}
            update={(next) => update(index, next)}
            edited={edited}
          />
        )}
        <TerrainTools session={session} world={world} brush={brush} setBrush={setBrush} undo={undo} edited={edited} />
        <WorldCanvas
          game={game}
          world={world}
          ground={session.groundOf(world)}
          entrances={list}
          points={points}
          selected={index}
          changed={changed}
          onSelect={(i) => go(ENT.id(list[i]!))}
          onMove={(i, x, y) => update(i, moveEntrance(list[i]!, x, y))}
          brush={brush}
          onPaint={paint}
          onStroke={() => {
            const g = session.groundOf(world);
            if (g) undo.current.push(copyGround(g));
          }}
          onPick={(part, rot) => setBrush((b) => (b ? { part, rot } : b))}
        />
        {show3d ? (
          <World3D session={session} world={world} entrances={list} selected={index} revision={rev} onSelect={(i) => go(ENT.id(list[i]!))} />
        ) : null}
        <label className="layer"><input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /> 3D で見る (地形・入口のモデル)</label>
      </div>
    </div>
  );
}

/** Painting the terrain (W01 / W02): the brush (a worldmapParts row and its rotation), undo and revert. */
function TerrainTools({ session, world, brush, setBrush, undo, edited }: {
  session: Session;
  world: WorldInfo;
  brush: Brush | null;
  setBrush: (f: (b: Brush | null) => Brush | null) => void;
  undo: { current: Ground[] };
  edited: () => void;
}): ReactNode {
  const { game } = session;
  const parts = game.worldParts();
  const flags = game.worldPartFlags();
  const editable = session.groundEditable(world);
  const changedGround = session.changedGrounds().includes(world);
  if (!editable) return <p className="muted small">{`${worldLabel(world.code)} の地形はマップ DB の区画 0 なので、まだ編集できません。`}</p>;
  return (
    <div className="world-terrain-tools">
      <div className="row">
        <label className="layer"><input type="checkbox" checked={!!brush} onChange={(e) => setBrush(() => (e.target.checked ? { part: parts.find((p) => p.model)?.row ?? 1, rot: 0 } : null))} /> 地形を塗る</label>
        {brush && (
          <>
            <select value={brush.part} onChange={(e) => setBrush((b) => b && { ...b, part: Number(e.target.value) })}>
              <option value={0}>0 なし (海)</option>
              {parts.filter((p) => p.model).map((p) => (
                <option key={p.row} value={p.row}>{`${p.row}${p.flags & 0x10 ? ' (2×2)' : p.flags & 0x20 ? ' (2 マス)' : ''} 種類 ${p.flags & 3}`}</option>
              ))}
            </select>
            <span className="pal-swatch small-swatch" style={{ background: rgbHex(partRgb(brush.part, flags)) }} />
            <span className="seg">{[0, 1, 2, 3].map((r) => <button key={r} className={r === brush.rot ? 'active small' : 'small'} onClick={() => setBrush((b) => b && { ...b, rot: r })}>{['↑', '→', '↓', '←'][r]}</button>)}</span>
            <span className="muted small">クリック・ドラッグで置く、Alt+クリックで拾う</span>
          </>
        )}
        <button className="small" disabled={!undo.current.length} onClick={() => { const g = undo.current.pop(); if (g) { session.setGround(world, g); edited(); } }}>↶ 地形を戻す</button>
        {changedGround && <button className="small" onClick={() => { if (confirm(`${worldLabel(world.code)} の地形の変更をすべて元に戻しますか?`)) { session.setGround(world, null); undo.current.length = 0; edited(); } }}>地形を元に戻す</button>}
      </div>
      {brush && <p className="muted small">{`2×2 や 2 マスの部品は左上 (起点) のセルに置きます。書き出しで ${world.groundFile} の部品ごとのプールの数 (+0x2BF30 / +0x2C074) を作り直します。`}</p>}
    </div>
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

/** The terrain (one pixel per cell, drawn scaled up) with the entrances and the section 3 points on top. */
function WorldCanvas({ game, world, ground, entrances, points, selected, changed, onSelect, onMove, brush, onPaint, onStroke, onPick }: {
  game: Game;
  world: WorldInfo;
  ground: Ground | null;
  entrances: Uint8Array[];
  points: WorldPoint[];
  selected: number;
  changed: (i: number) => boolean;
  onSelect: (i: number) => void;
  onMove: (i: number, x: number, y: number) => void;
  /** Painting the terrain (null: the entrances are dragged). */
  brush: Brush | null;
  onPaint: (x: number, y: number) => void;
  /** A stroke starts (an undo point). */
  onStroke: () => void;
  /** Alt+click: take the part (and rotation) of a cell. */
  onPick: (part: number, rot: number) => void;
}): ReactNode {
  const [scale, setScale] = useState(3);
  const painting = useRef(false);
  const [hover, setHover] = useState<[number, number] | null>(null);
  /** Entrance being dragged, and where it is now. */
  const [drag, setDrag] = useState<{ i: number; x: number; y: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [terrain, setTerrain] = useState<HTMLCanvasElement | null>(null);
  const size = WORLD_SIZE * scale;

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = c.height = WORLD_SIZE;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(WORLD_SIZE, WORLD_SIZE);
    const flags = game.worldPartFlags();
    const parts = ground && flags ? coveredParts(ground, (p) => flags[p] ?? 0) : ground?.parts;
    for (let i = 0; i < WORLD_SIZE * WORLD_SIZE; i++) {
      const [r, g, b] = partRgb(parts?.[i] ?? 0, flags);
      img.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    setTerrain(c);
  }, [game, ground]);

  const pos = (i: number): [number, number] => (drag?.i === i ? [drag.x, drag.y] : [ENT.x(entrances[i]!), ENT.y(entrances[i]!)]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !terrain) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrain, 0, 0, size, size);
    const cx = (v: number): number => (v + 0.5) * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (const p of points) ctx.fillRect(cx(p.x) - 1.5, cx(p.y) - 1.5, 3, 3);
    const r = Math.max(3, scale * 0.9);
    entrances.forEach((_, i) => {
      const [x, y] = pos(i);
      ctx.beginPath();
      ctx.arc(cx(x), cx(y), r, 0, Math.PI * 2);
      ctx.fillStyle = changed(i) ? '#e0b04c' : '#ff5a5a';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    });
    if (entrances[selected]) {
      const [x, y] = pos(selected);
      ctx.beginPath();
      ctx.arc(cx(x), cx(y), r + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  });

  // Bring the selected entrance into view when another one is selected (or the scale changes).
  useEffect(() => {
    const b = box.current;
    const e = entrances[selected];
    if (!b || !e) return;
    const x = (ENT.x(e) + 0.5) * scale;
    const y = (ENT.y(e) + 0.5) * scale;
    if (x < b.scrollLeft || x > b.scrollLeft + b.clientWidth || y < b.scrollTop || y > b.scrollTop + b.clientHeight)
      b.scrollTo({ left: x - b.clientWidth / 2, top: y - b.clientHeight / 2 });
  }, [selected, scale, world]);

  const cellAt = (e: PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    const clamp = (v: number): number => Math.max(0, Math.min(WORLD_SIZE - 1, Math.floor(v / scale)));
    return [clamp(e.clientX - rect.left), clamp(e.clientY - rect.top)];
  };
  /** Nearest entrance within 2 cells (the selected one first). */
  const hit = (x: number, y: number): number => {
    let best = -1;
    let bestD = 2.5;
    entrances.forEach((r, i) => {
      const d = Math.hypot(ENT.x(r) - x, ENT.y(r) - y) - (i === selected ? 0.5 : 0);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return best;
  };

  const cell = hover ? hover[1] * WORLD_SIZE + hover[0] : -1;
  const under = hover ? entrances.findIndex((r) => ENT.x(r) === hover[0] && ENT.y(r) === hover[1]) : -1;
  return (
    <div className="world-map">
      <div className="row">
        <span className="muted small">拡大</span>
        {SCALES.map((s) => <button key={s} className={s === scale ? 'active small' : 'small'} onClick={() => setScale(s)}>{`×${s}`}</button>)}
        <span className="muted small">入口 (赤、変更したものは黄) をクリックで選び、ドラッグで動かします。白い点は区画 3 の地点。地形は worldmapParts の地形の種類 (+4 の下位 2 ビット) で色分け。</span>
      </div>
      {/* Fixed height, so that the map does not move while the pointer is over it. */}
      <div className="world-hover muted small">
        {hover
          ? `(${hover[0]}, ${hover[1]})  地形: worldmapParts ${ground?.parts[cell] ?? '-'} 向き ${ground?.rots[cell] ?? '-'}${under >= 0 ? `  入口 ${hex8(ENT.id(entrances[under]!))} → ${mapLabel(game, ENT.destMap(entrances[under]!))}` : ''}`
          : '\u00a0'}
      </div>
      {!ground && <div className="issue warn">{`地形 (${world.groundFile ?? '区画 0'}) を読めなかったので、海だけを表示しています。`}</div>}
      <div className="world-scroll" ref={box}>
        <canvas
          ref={canvas}
          width={size}
          height={size}
          style={{ width: size, height: size, cursor: drag ? 'grabbing' : 'crosshair' }}
          onPointerDown={(e) => {
            const [x, y] = cellAt(e);
            if (brush) {
              if (e.altKey) {
                const c = ground ? coveredOrigin(ground, game.worldPartFlags(), x, y) : -1;
                onPick(c >= 0 ? ground!.parts[c]! : 0, c >= 0 ? ground!.rots[c]! : 0);
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              painting.current = true;
              onStroke();
              onPaint(x, y);
              return;
            }
            const i = hit(x, y);
            if (i < 0) return;
            if (i !== selected) onSelect(i);
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ i, x: ENT.x(entrances[i]!), y: ENT.y(entrances[i]!) });
          }}
          onPointerMove={(e) => {
            const [x, y] = cellAt(e);
            if (!hover || hover[0] !== x || hover[1] !== y) setHover([x, y]);
            if (painting.current) onPaint(x, y);
            if (drag && (drag.x !== x || drag.y !== y)) setDrag({ ...drag, x, y });
          }}
          onPointerUp={() => {
            painting.current = false;
            if (!drag) return;
            const r = entrances[drag.i]!;
            if (drag.x !== ENT.x(r) || drag.y !== ENT.y(r)) onMove(drag.i, drag.x, drag.y);
            setDrag(null);
          }}
          onPointerLeave={() => setHover(null)}
        />
      </div>
    </div>
  );
}

/** The cell whose part covers (x, y): its own, or a 2 x 2 / 2-cell part starting left of or above it (-1: none). */
function coveredOrigin(g: Ground, flags: Uint8Array | null, x: number, y: number): number {
  const N = WORLD_SIZE;
  const at = (cx: number, cy: number): number => ((cy + N) % N) * N + ((cx + N) % N);
  const i = at(x, y);
  if (g.parts[i]) return i;
  for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]] as const) {
    const j = at(x + dx, y + dy), p = g.parts[j]!;
    if (!p) continue;
    const f = flags?.[p] ?? 0;
    if (f & 0x10) return j;
    if (f & 0x20 && dx + dy === -1 && (dy === -1) === !!(g.rots[j]! & 1)) return j;
  }
  return -1;
}
