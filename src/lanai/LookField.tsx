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
  lanaiObjectRef,
  type LanaiRecordModel,
} from './mapObjects';
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
          {look === 0 && <option value={0}>0 (なし)</option>}
          {Array.from({ length: Math.max(0, (mc?.rows ?? 0) - 1) }, (_, i) => i + 1).map((r) => (
            <option key={r} value={r}>
              {charaLabel(st, mc, r)}
            </option>
          ))}
          {look > 0 && look >= (mc?.rows ?? 0) && <option value={look}>{`#${look} (表にない行)`}</option>}
        </select>
      </div>
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
