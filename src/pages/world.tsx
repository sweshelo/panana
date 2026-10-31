// World maps (W01 ...; docs/worldmap.md) in the world map frame shared with RPG3 (editor/worldpage.tsx): the 2D map and
// the 3D preview of KaharaWorldSource (worldsource.ts), the terrain painted with worldmapParts rows (W01 / W02's
// Wxx_ground.bin), and the entrances to towns and dungeons (section 2), moved on the map and pointed at other maps.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { mapLabel, pointLabel, worldHref, worldLabel } from '../editor/labels';
import { validateWorld, type WorldIssue } from '../editor/validate';
import { useWorldView, WorldFrame } from '../editor/worldpage';
import { CONDITION_FIELDS } from '../game/conditions';
import { kindName } from '../game/eventkinds';
import { conditionTypes } from '../game/eventlist';
import type { EventTable } from '../game/events';
import { P3 } from '../game/sections';
import { entranceRowUsers, newEntranceRow, setRowCondition, worldEventPlaces } from '../game/worldconditions';
import { KIND_ENTRANCE, NOTICE_DUNGEON, NOTICE_SOUND_DEFAULT, NOTICE_TEMPLATE, noticeMessage, noticeSound, setNoticeMessage, setNoticeSound } from '../game/worldnotice';
import { SoundButton } from '../ui/SoundPicker';
import { textToUnits } from '../game/msgtext';
import { hexId } from '../editor/message';
import { ENT, WORLD_SIZE, freeEntranceId, moveEntrance, newEntrance, parseWorldPoints, setEntranceU32, type EntranceField, type WorldInfo, type WorldPoint } from '../game/worldmap';
import type { Session } from '../session';
import { Count, EditedMark, ListFilter, NumberInput, useEdits, useSticky, type PageProps } from '../ui/book';
import { ConditionPicker } from '../ui/ConditionPicker';
import { MapButton } from '../ui/MapPicker';
import { ObjectPicker, objectModelRef } from '../ui/ObjectPicker';
import { Photo } from '../ui/Photo';
import { useSignal } from '../ui/useEditorState';
import { equalBytes, hex8, u16, u32, w32 } from '../util/bytes';
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
  /** A new entrance (section 2 grows) at the centre of the 2D view. */
  const addEntrance = (): void => {
    view?.mark();
    const [x, y] = view?.viewCell() ?? src?.start ?? [150, 150];
    const r = newEntrance(sel, freeEntranceId(list), x, y);
    session.setEntrances(world, [...list, r]);
    src?.changed();
    setSelId(ENT.id(r));
    history.replaceState(null, '', worldHref(world.code, ENT.id(r)));
    edited();
  };
  /** Remove an entrance Panana added (the game's own keep their places in the list). */
  const removeEntrance = (i: number): void => {
    if (i < original.length) return;
    view?.mark();
    const l = list.filter((_, k) => k !== i);
    session.setEntrances(world, l);
    src?.changed();
    setSelId(l[Math.min(i, l.length - 1)] ? ENT.id(l[Math.min(i, l.length - 1)]!) : 0);
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
  const worldChanged = session.changedWorlds().includes(world) || session.changedGrounds().includes(world) || !!session.st.events.get(world.dungeon)?.changed();

  return (
    <WorldFrame view={view} pane2d={pane2d} pane3d={pane3d}
      title={<><strong>{worldLabel(world.code)}</strong><span className="muted small">{`${hex8(world.hash)}・${WORLD_SIZE} × ${WORLD_SIZE} セル`}</span></>}
      changed={worldChanged}
      onRevert={() => {
        if (!confirm(`${worldLabel(world.code)} の変更 (地形・入口・出現条件) をすべて元に戻しますか?`)) return;
        view?.mark();
        session.setEntrances(world, original);
        if (session.groundEditable(world)) session.setGround(world, null);
        session.st.events.get(world.dungeon)?.revert();
        session.scheduleSave();
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
          <div className="row">
            <Count shown={rows.length} total={list.length} unit="入口" />
            <button className="small" title="2D の地図の真ん中に、選んでいる入口と同じ種類・見た目・行き先の入口を置きます" onClick={addEntrance}>入口を追加</button>
            {index >= original.length && <button className="small" onClick={() => removeEntrance(index)}>この入口を消す</button>}
          </div>
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
          mark={() => view?.mark()}
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
function EntranceEditor({ session, world, r, original, points, issues, update, mark, edited }: {
  session: Session;
  world: WorldInfo;
  r: Uint8Array;
  original: Uint8Array | undefined;
  points: WorldPoint[];
  issues: WorldIssue[];
  update: (next: Uint8Array) => void;
  mark: () => void;
  edited: () => void;
}): ReactNode {
  const { game, st } = session;
  const [picking, setPicking] = useState(false);
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
        <EntranceCondition session={session} world={world} r={r} edited={differs(0x10)} update={update} mark={mark} changed={edited} />
        <label className="field">
          <span>移動先の地点 (+0x14、区画 3)</span>
          <select value={ENT.point(r)} className={cls(0x14)} onChange={(e) => set(0x14)(Number(e.target.value))}>
            {!points.some((p) => p.id === ENT.point(r)) && <option value={ENT.point(r)}>{ENT.point(r) ? `${hex8(ENT.point(r))} (区画 3 にない)` : '0 (なし)'}</option>}
            {points.map((p) => <option key={p.id} value={p.id}>{`${hex8(p.id)} (${p.x}, ${p.y})`}</option>)}
          </select>
        </label>
        <div className="field">
          <span>表示モデル (+0x18、mapObject の行。0 = 入口の種類のモデル)</span>
          <div className="row">
            <Photo model={objectModelRef(game, ENT.model(r) || (game.worldParts()[ENT.part(r)]?.object ?? 0))} className="photo" />
            <NumberInput value={ENT.model(r)} min={0} max={game.master.mapObject.rows - 1} className={`num-input${differs(0x18) ? ' edited' : ''}`} onCommit={set(0x18)} />
            <button className="small" onClick={() => setPicking(true)}>モデルを選ぶ</button>
          </div>
          {picking && (
            <ObjectPicker game={game} title="入口のモデルを選ぶ" current={ENT.model(r)} zero="0 (入口の種類のモデル)"
              used={session.entrancesOf(world).map((e) => ENT.model(e)).filter((m) => m)}
              onPick={(row) => { setPicking(false); set(0x18)(row); }} onClose={() => setPicking(false)} />
          )}
        </div>
        <label className="field">
          <span>入口の種類 (+0x00、worldmapParts の行)</span>
          <NumberInput value={ENT.part(r)} min={0} max={255} className={`num-input${differs(0x00) ? ' edited' : ''}`} onCommit={set(0x00)} />
        </label>
      </div>
      <div className="muted small mono">{`36 バイト: ${Array.from(r, (b) => b.toString(16).padStart(2, '0')).join(' ')}`}</div>
    </div>
  );
}


/**
 * When the entrance is placed: the conditions of the Wxx_EventObject row its +0x10 names (FUN_001e2ac4 checks them
 * like any other row; docs/worldmap.md §6). Rows shared with other entrances, or with section 6, change them too.
 */
function EntranceCondition({ session, world, r, edited, update, mark, changed }: {
  session: Session;
  world: WorldInfo;
  r: Uint8Array;
  edited: boolean;
  update: (next: Uint8Array) => void;
  mark: () => void;
  changed: () => void;
}): ReactNode {
  const { game, st } = session;
  const [events, setEvents] = useState<EventTable | null | undefined>(() => st.events.get(world.dungeon));
  useEffect(() => {
    if (events !== undefined) return;
    let live = true;
    void session.eventsOf(world.dungeon).then((t) => {
      if (!live) return;
      if (t && !st.events.has(world.dungeon)) st.events.set(world.dungeon, t);
      setEvents(t ? st.events.get(world.dungeon)! : null);
    });
    return () => {
      live = false;
    };
  }, [session, world, events, st]);
  const types = useMemo(() => conditionTypes(game.code.code), [game]);
  const row = ENT.event(r);
  const label = `出現条件 (+0x10、${world.code}_EventObject の行。0 = 常に出る)`;
  const raw = <NumberInput value={row} min={0} max={0xffff} className={`num-input${edited ? ' edited' : ''}`} title="行の番号" onCommit={(v) => update(setEntranceU32(r, 0x10, v))} />;
  if (events === undefined) return <div className="field"><span>{label}</span><div className="row">{raw}<span className="muted small">イベントの表を読み込み中…</span></div></div>;
  if (!events) return <div className="field"><span>{label}</span><div className="row">{raw}<span className="muted small">{`${world.code} にはイベントの表がありません`}</span></div></div>;

  const users = entranceRowUsers(session.entrancesOf(world), row).filter((i) => ENT.id(session.entrancesOf(world)[i]!) !== ENT.id(r));
  const placed = row ? worldEventPlaces(game.db.get(world.sections[6]!), row) : 0;
  const has = row > 0 && events.has(row);
  const room = events.roomLeft();
  const write = (f: (row: Uint8Array) => void): void => {
    mark();
    f(events.table.row(row));
    session.scheduleSave();
    changed();
  };
  /** Give this entrance a row of its own (a new row, kind 0 = no action, with the conditions copied). */
  const own = (from: Uint8Array | null): void => {
    mark();
    const n = events.addRow(newEntranceRow(events.table.rowSize, from));
    session.scheduleSave();
    update(setEntranceU32(r, 0x10, n));
  };
  return (
    <div className="field entrance-condition">
      <span>{label}</span>
      <div className="row">
        {raw}
        {has && <a href={`#/events/${world.dungeon}.${row}`} className="small">{`行 ${row} (${kindName(events.kind(row))})`}</a>}
        {row > 0 && !has && <span className="issue error">{`行 ${row} は表にありません (${events.rows} 行)`}</span>}
      </div>
      {!row && (
        <div className="row">
          <span className="muted small">いつも出ます。</span>
          <button className="small" disabled={!room} title={room ? '' : `${world.code} のイベントの行と状態の枠に空きがありません`} onClick={() => own(null)}>出現条件をつける</button>
        </div>
      )}
      {has && CONDITION_FIELDS.map(({ field, value, label: what }) => (
        <div key={field} className="row">
          <span className="small">{`${what}:`}</span>
          <ConditionPicker types={types} type={events.table.row(row)[field]!} value={u32(events.table.row(row), value)}
            edited={!equalBytes(events.originalRow(row)?.subarray(field, field + 1) ?? new Uint8Array(1), events.table.row(row).subarray(field, field + 1)) || !equalBytes(events.originalRow(row)?.subarray(value, value + 4) ?? new Uint8Array(4), events.table.row(row).subarray(value, value + 4))}
            dungeonName={(d) => game.master.dungeonName(d)}
            onChange={(t, v) => write((b) => setRowCondition(b, field, t, v))} />
        </div>
      ))}
      {has && <div className="muted small">「出る」が成り立つときだけ置かれ、「消える」が成り立つと置かれなくなります。</div>}
      {has && (users.length > 0 || placed > 0) && (
        <div className="issue warn">
          {`この行は${users.length ? `ほかの入口 ${users.length} 件` : ''}${users.length && placed ? 'と' : ''}${placed ? `区画 6 のイベント ${placed} 件` : ''}も使っています。条件を変えるとそちらも変わります。`}
          <button className="small" disabled={!room} onClick={() => own(events.table.row(row))}>この入口だけの行にする</button>
        </div>
      )}
      {has && events.kind(row) === 0x24 && <div className="muted small">この行はスクリプト (種類 0x24) です。動きは行の番号で決まるので、条件だけを変えられます。</div>}
      {has && events.kind(row) !== 0x24 && events.kind(row) !== KIND_ENTRANCE && (
        <div className="issue warn">{`行の種類が ${kindName(events.kind(row))} なので、入れない入口になります (ふつうの入口は種類 0x11)。`}</div>
      )}
      {has && world.dungeon === NOTICE_DUNGEON && (
        <EntranceNotice session={session} events={events} row={row} r={r} added={!events.originalRow(row)} write={write} />
      )}
    </div>
  );
}

/**
 * "〇〇が出現した！" the first time the entrance shows (game/worldnotice.ts): the message ID in the row's +0x40, a new
 * message made from the game's "[黄泉の門]が開いた！" with the destination's name. Only rows Panana added: the game's
 * own rows have states the story uses.
 */
function EntranceNotice({ session, events, row, r, added, write }: {
  session: Session;
  events: EventTable;
  row: number;
  r: Uint8Array;
  added: boolean;
  write: (f: (row: Uint8Array) => void) => void;
}): ReactNode {
  const { game, sounds } = session;
  const { texts } = game.master;
  const message = noticeMessage(events.table.row(row));
  const sound = noticeSound(events.table.row(row));
  if (!added) return <div className="muted small">「〇〇が出現した！」の告知は、この入口だけの行 (Panana が足した行) につけられます。</div>;
  const enable = (): void => {
    const dest = game.code.byHash(ENT.destMap(r));
    const nameId = dest && dest.dungeon >= 0 && dest.dungeon < game.master.mapGroup.rows ? u16(game.master.mapGroup.row(dest.dungeon), 0x14) : 0;
    const tpl = texts.text(NOTICE_TEMPLATE);
    const text = `${nameId ? `{msg:${nameId.toString(16).toUpperCase().padStart(4, '0')}}` : '新しい場所'}が出現した！`;
    const id = tpl ? texts.add(textToUnits({ ...tpl, text })) : 0;
    if (id) write((b) => (setNoticeMessage(b, id), setNoticeSound(b, NOTICE_SOUND_DEFAULT)));
  };
  return (
    <div className="world-notice">
      <label className="row small">
        <input type="checkbox" checked={!!message} disabled={!message && !texts.canAdd()}
          onChange={(e) => (e.target.checked ? enable() : write((b) => setNoticeMessage(b, 0)))} />
        はじめて出たときに「〇〇が出現した！」と出す
      </label>
      {message > 0 && (
        <div className="muted small">
          <a href={`#/messages/${hexId(message)}`}>{texts.preview(message, true) ?? `メッセージ ${hexId(message)}`}</a>
          {' '}— ワールドマップに入ったとき、条件が成り立っていて行の状態が 0 なら一度だけ、カメラをこの入口へ向けて出し、状態を 1 にします (書き出しの code.ips に告知のパッチが入ります)。
        </div>
      )}
      {message > 0 && (
        <div className="row small">
          出現の音:
          {sounds
            ? <SoundButton game={game} sounds={sounds} value={sound} title="出現の音を選ぶ" onChange={(v) => write((b) => setNoticeSound(b, v))} />
            : <NumberInput value={sound} min={0} max={0xffff} onCommit={(v) => write((b) => setNoticeSound(b, v))} />}
          {sound > 0 && <button type="button" className="link" onClick={() => write((b) => setNoticeSound(b, 0))}>鳴らさない</button>}
          {sound === 0 && <span className="muted">鳴らさない</span>}
        </div>
      )}
    </div>
  );
}
