// The look of a record with an event (EventObject +0x5A), picked from every model instead of typed as a number: a
// MapObject row for exits, doors, chests, buttons and objects (photos of all 784 rows), a MapChara row for the
// characters (section 5 kinds 0〜2), with new MapChara rows made for any NPC model or any monster
// (LanaiMaps.addCharaRow). What starts the event and what it does are the record's kind and the row's actions; the
// look only changes what is drawn (eventParts.ts).
import { useMemo, useState, type ReactNode } from 'react';
import type { Rec } from '../game/sections';
import { PartPhoto, PartPicker, type PartChoice } from '../editor/partpalette';
import { EO_LOOK, lanaiLookKind } from './eventParts';
import type { LanaiEditState } from './mapedit';
import {
  LANAI_CHARA_KIND,
  LANAI_CHARA_MONSTER,
  LANAI_CHARA_NPC,
  LANAI_EO_CHARA_SELECT,
  lanaiCharaKind,
  lanaiCharaModel,
  lanaiCharaTables,
  lanaiExitDefaultRow,
  lanaiObjectRef,
  type LanaiRecordModel,
} from './mapObjects';
import { lanaiExitKind, lanaiIsBuildingExit } from './maps';
import { lanaiDenpaCustomName } from './animationModels';
import type { LanaiMapView } from './mapview';
import { lanaiMonsters } from './monsters';
import { LanaiMonsterPicker } from './pickers';
import type { LanaiTable } from './table';

const photo = (view: LanaiMapView, model: LanaiRecordModel | null): ReactNode => (
  <PartPhoto source={view} part={model} partKey={JSON.stringify(model)} />
);

/** Picks a MapObject row from the photos of every model: the looks the group's events use first, and 0 if allowed. */
function ObjectModelPicker({
  st,
  view,
  title,
  current,
  zero,
  onPick,
  onClose,
}: {
  st: LanaiEditState;
  view: LanaiMapView;
  title: string;
  current: number;
  /** The label of row 0 (the kind's own model), when it can be picked. */
  zero?: string;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const objects = st.maps.session.table('MapObject');
  const events = st.info ? st.maps.eventTable(st.info.dungeon) : undefined;
  const choices = useMemo(() => {
    const out: PartChoice[] = [];
    if (zero) out.push({ key: '0', name: zero, category: '既定' });
    const used = new Set<number>();
    for (let r = 1; r < (events?.rows ?? 0); r++) {
      const look = events!.u16(r, EO_LOOK);
      if (lanaiObjectRef(objects, look)) used.add(look);
    }
    const item = (row: number, category: string): PartChoice => ({
      key: String(row),
      name: `#${row}`,
      category,
      icon: photo(view, { type: 'object', row }),
    });
    for (const row of [...used].sort((a, b) => a - b)) out.push(item(row, 'このマップグループのイベントの見た目'));
    for (let row = 1; row < (objects?.rows ?? 0); row++)
      if (!used.has(row) && lanaiObjectRef(objects, row)) out.push(item(row, 'すべてのモデル (MapObject)'));
    return out;
  }, [objects, events, view, zero]);
  return (
    <PartPicker
      title={title}
      choices={choices}
      current={String(current)}
      onClose={onClose}
      onPick={(key) => {
        onPick(Number(key));
        onClose();
      }}
    />
  );
}

/** What a MapChara row is, for a list. */
function charaLabel(st: LanaiEditState, mc: LanaiTable | undefined, row: number): string {
  const kind = lanaiCharaKind(mc, row);
  if (kind < 0) return `#${row} (表にない行)`;
  const model = charaModel(st, mc, row, 0);
  const name = !model
    ? 'モデルなし'
    : model.type === 'monster'
      ? (lanaiMonsters(st.maps.session).find((m) => m.designRow === model.design && m.name)?.name ?? '') +
        ` (MonsterDesign #${model.design})`
      : model.type === 'denpa'
        ? `${lanaiDenpaCustomName(st.maps.session, model.custom)} (DenpaCustom #${model.custom})`
        : model.type === 'object'
          ? `MapObject #${model.row}`
          : '';
  return `#${row} ${LANAI_CHARA_KIND[kind] ?? `種類 ${kind}`}: ${name}${row >= (mc?.originalRows ?? 0) ? ' (追加した行)' : ''}`;
}

/** The model of a MapChara row as the game picks it for an event whose +0x5C is `select`. */
function charaModel(
  st: LanaiEditState,
  mc: LanaiTable | undefined,
  row: number,
  select: number,
): LanaiRecordModel | null {
  const session = st.maps.session;
  return lanaiCharaModel({ ...lanaiCharaTables(session), mapChara: mc }, row, select);
}

/**
 * MapChara +0x0C / +0x1C / +0x28 (the look EventObject +0x5C selects): the low 10 bits are how far the character
 * walks about; 0 stands still. The placing code (Update 0x23D04C〜0x23D18C) gives the actor its wandering only when
 * the value is positive (roms/tmpmap/parts-npc-findings.md). The shipped rows use 0, 75, 110, 150 and 250.
 */
const CHARA_MOVE = [0x0c, 0x1c, 0x28] as const;
const WANDER_MASK = 0x3ff;
const WANDER_VALUES = [0, 75, 110, 150, 250];

function WanderField({
  st,
  mc,
  chara,
  select,
}: {
  st: LanaiEditState;
  mc: LanaiTable;
  chara: number;
  select: number;
}): ReactNode {
  const offset = CHARA_MOVE[select] ?? CHARA_MOVE[0];
  const raw = mc.u32(chara, offset);
  const value = raw & WANDER_MASK;
  const set = (v: number): void =>
    st.editTables(() => mc.setU32(chara, offset, ((raw & ~WANDER_MASK) | (v & WANDER_MASK)) >>> 0));
  return (
    <label className="field">
      <span>歩き回り</span>
      <select aria-label="歩き回り" value={value} onChange={(e) => set(Number(e.target.value))}>
        {[...new Set([...WANDER_VALUES, value])]
          .sort((a, b) => a - b)
          .map((v) => (
            <option key={v} value={v}>
              {v ? `歩き回る (範囲 ${v})` : 'その場に立つ'}
            </option>
          ))}
      </select>
      <span className="muted small">
        MapChara #{chara} の値です。同じ行を見た目に使うほかのキャラも同じ動きになります。範囲は出荷データの値 (75〜250)
        から選びます。
      </span>
    </label>
  );
}

/** The building kinds (exit +0x15, 28〜69 but 68) with a model of their own (lanaiExitDefaultRow). */
const BUILDING_KINDS = Array.from({ length: 42 }, (_, i) => 28 + i).filter(
  (k) => lanaiIsBuildingExit(k) && lanaiExitDefaultRow(k) > 0,
);

/**
 * A building's entrance: the kind (+0x15) is the building's look (its default model), the action stays. Choosing one
 * clears the event's own look (+0x5A) so that the kind's model shows.
 */
function BuildingField({
  st,
  view,
  rec,
  row,
}: {
  st: LanaiEditState;
  view: LanaiMapView;
  rec: Rec;
  row: number;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const kind = lanaiExitKind(rec.raw);
  const choices: PartChoice[] = BUILDING_KINDS.map((k) => ({
    key: String(k),
    name: `建物 ${k}`,
    category: '建物',
    sub: `MapObject #${lanaiExitDefaultRow(k)}`,
    icon: photo(view, { type: 'object', row: lanaiExitDefaultRow(k) }),
  }));
  return (
    <div className="field">
      <span>建物の見た目 (種類)</span>
      <div className="row">
        {lanaiExitDefaultRow(kind) > 0 && photo(view, { type: 'object', row: lanaiExitDefaultRow(kind) })}
        <span className="small">{`種類 ${kind}`}</span>
        <button onClick={() => setOpen(true)}>建物を選ぶ…</button>
      </div>
      {open && (
        <PartPicker
          title="建物の見た目を選ぶ"
          choices={choices}
          current={String(kind)}
          onClose={() => setOpen(false)}
          onPick={(key) => {
            setOpen(false);
            st.edit(() => {
              rec.raw[0x15] = Number(key);
            });
            st.setEventField(row, (t) => t.setU16(row, EO_LOOK, 0));
          }}
        />
      )}
    </div>
  );
}

/** The look of a record's event (EventObject row `row`). Circle ranges keep their radius there (RangeFields). */
export function LookField({
  st,
  view,
  section,
  rec,
  row,
}: {
  st: LanaiEditState;
  view: LanaiMapView;
  section: number;
  rec: Rec;
  row: number;
}): ReactNode {
  const [pick, setPick] = useState<null | 'object' | 'npc' | 'monster'>(null);
  const events = st.info ? st.maps.eventTable(st.info.dungeon) : undefined;
  if (!events || row <= 0 || row >= events.rows) return null;
  const kind = lanaiLookKind(section, rec.raw);
  if (kind === 'radius') return null;
  if (kind === 'effect')
    return <p className="muted small">見た目: ゲームがエフェクトを置きます (イベントの +0x5A は読まれません)。</p>;
  const look = events.u16(row, EO_LOOK);
  const setLook = (v: number): void => st.setEventField(row, (t) => t.setU16(row, EO_LOOK, v));
  if (kind === 'object')
    return (
      <>
        {section === 3 && lanaiIsBuildingExit(lanaiExitKind(rec.raw)) && (
          <BuildingField st={st} view={view} rec={rec} row={row} />
        )}
        <div className="field">
          <span>見た目のモデル</span>
          <div className="row">
            {photo(view, look ? { type: 'object', row: look } : null)}
            <span className="small">{look ? `MapObject #${look}` : '0 (種類の既定のモデル)'}</span>
            <button onClick={() => setPick('object')}>モデルを選ぶ…</button>
          </div>
          {pick === 'object' && (
            <ObjectModelPicker
              st={st}
              view={view}
              title="見た目のモデルを選ぶ"
              current={look}
              zero="0 = 種類の既定のモデル"
              onPick={setLook}
              onClose={() => setPick(null)}
            />
          )}
        </div>
      </>
    );
  const mc = st.maps.contentTable('MapChara');
  /** Make a MapChara row and give it to the event, in one undo point. */
  const make = (charaKind: number, model: number): void =>
    st.editTables(() => {
      const chara = st.maps.addCharaRow(charaKind, model);
      events.setU16(row, EO_LOOK, chara);
    });
  return (
    <div className="field">
      <span>キャラの見た目</span>
      <div className="row">
        {photo(view, charaModel(st, mc, look, events.u16(row, LANAI_EO_CHARA_SELECT)))}
        <select aria-label="キャラの見た目" value={look} onChange={(e) => setLook(Number(e.target.value))}>
          {Array.from({ length: mc?.rows ?? 0 }, (_, i) => i).map((r) => (
            <option key={r} value={r}>
              {charaLabel(st, mc, r)}
            </option>
          ))}
          {look >= (mc?.rows ?? 0) && <option value={look}>{`#${look} (表にない行)`}</option>}
        </select>
      </div>
      {mc && look < mc.rows && (
        <WanderField st={st} mc={mc} chara={look} select={events.u16(row, LANAI_EO_CHARA_SELECT)} />
      )}
      <div className="row">
        <button disabled={!mc} onClick={() => setPick('npc')}>
          NPC を新しく作る…
        </button>
        <button disabled={!mc} onClick={() => setPick('monster')}>
          モンスターを新しく作る…
        </button>
      </div>
      <p className="muted small">
        新しく作ると、選んだモデルの MapChara の行をコンテンツに足して、このイベントの見た目にします
        (動きは同じ種類の行から写します)。同じ行を使うほかのイベントの見た目は変わりません。
      </p>
      {pick === 'npc' && (
        <ObjectModelPicker
          st={st}
          view={view}
          title="NPC のモデルを選ぶ"
          current={0}
          onPick={(model) => make(LANAI_CHARA_NPC, model)}
          onClose={() => setPick(null)}
        />
      )}
      {pick === 'monster' && (
        <LanaiMonsterPicker
          session={st.maps.session}
          current={-1}
          title="モンスターを選ぶ (見た目に使う)"
          onPick={(m) => {
            const design = lanaiMonsters(st.maps.session)[m]?.designRow ?? -1;
            if (design > 0) make(LANAI_CHARA_MONSTER, design);
            setPick(null);
          }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}
