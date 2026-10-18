// Inspector blocks of RPG FREE!'s map page, as RPG3's (oahu/MapParts.tsx): the MonsterGroup rows of the content (for
// section 6 and chest battles) and the contents of a chest (the content's TreasureGroup, edited with an undo point of
// the map: treasure.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import type { PickerChoice } from '../ui/GridPicker';
import { hex8 } from '../util/bytes';
import { contentTitle, lanaiContents } from './contents';
import type { LanaiEditState } from './mapedit';
import type { LanaiMaps } from './maps';
import { lanaiItemName } from './monsterBook';
import { lanaiMonsters } from './monsters';
import { lanaiItemEntry, LanaiItemPicker } from './pickers';
import {
  LANAI_CHEST_ACTIONS,
  LANAI_TREASURE_BATTLE,
  LANAI_TREASURE_GOLD,
  LANAI_TREASURE_ITEM,
  LANAI_TREASURE_KIND,
  LANAI_TREASURE_SLOTS,
  lanaiChestField,
  lanaiChestUsers,
  lanaiTreasureLabel,
  lanaiTreasureSlots,
  lanaiWriteTreasure,
  type LanaiChestUser,
  type LanaiTreasureSlot,
} from './treasure';

// ---- MonsterGroup

/** "#1 80000040: いちごおばけ・おおくちばし" for a MonsterGroup row. */
export function monsterGroupLabel(maps: LanaiMaps, row: number): string {
  const g = maps.monsterGroups()[row];
  if (!g) return `行 ${row}`;
  return `#${row} ${hex8(g.id).toUpperCase()}: ${row === 0 ? '既定 (行 0)' : monsterGroupNames(maps, row) || '(モンスターなし)'}`;
}

/** "いちごおばけ・おおくちばし": the monsters of a MonsterGroup row. */
function monsterGroupNames(maps: LanaiMaps, row: number): string {
  const g = maps.monsterGroups()[row];
  const mp = maps.session.table('MonsterParameter');
  const list = lanaiMonsters(maps.session);
  return g ? [...new Set(g.monsters.map((id) => (mp ? list[mp.find(id)]?.name : undefined) ?? hex8(id).toUpperCase()))].join('・') : '';
}

/** A MonsterGroup row ID of the content (section 6 values); a value the table does not have is shown as such. */
export function MonsterGroupSelect({ maps, value, onChange }: { maps: LanaiMaps; value: number; onChange: (v: number) => void }): ReactNode {
  const groups = maps.monsterGroups();
  const known = groups.some((g) => g.id === value);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
      {!known && <option value={value}>{`${hex8(value).toUpperCase()} (${maps.monsterGroupRow(value) >= 0 ? `行番号 ${value}` : '表にない: 行 0 になる'})`}</option>}
      {groups.map((g) => <option key={g.row} value={g.id}>{monsterGroupLabel(maps, g.row)}</option>)}
    </select>
  );
}

/** A MonsterGroup row number of the content (the boss battle, action 0x8000000C, names the row, not its ID). */
export function MonsterGroupRowSelect({ maps, value, onChange }: { maps: LanaiMaps; value: number; onChange: (v: number) => void }): ReactNode {
  const groups = maps.monsterGroups();
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
      {value >= groups.length && <option value={value}>{`行 ${value} (表は ${groups.length} 行: 表の外)`}</option>}
      {groups.map((g) => <option key={g.row} value={g.row}>{monsterGroupLabel(maps, g.row)}</option>)}
    </select>
  );
}

// ---- contents

/**
 * A content number (the content a goal chest or the clear warp marks cleared: save flag group 0x53, FUN_00191130).
 * In the ROM every one names its own content, so another one is flagged.
 */
export function ContentSelect({ maps, value, onChange, allowNone }: { maps: LanaiMaps; value: number; onChange: (v: number) => void; allowNone?: boolean }): ReactNode {
  const list = useMemo(() => lanaiContents(maps.session), [maps.session]);
  const own = maps.content.index;
  return (
    <>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
        {value >= list.length && <option value={value}>{`${value} (コンテンツの表にない)`}</option>}
        {list.map((c) => <option key={c.index} value={c.index}>{c.index === 0 && allowNone ? '0: なし' : `${c.index}: ${contentTitle(c)}${c.index === own ? ' (このコンテンツ)' : ''}`}</option>)}
      </select>
      {value !== own && !(allowNone && value === 0) && <span className="muted small">{`このコンテンツ (${own}) と別のコンテンツをクリア済みにします。`}</span>}
    </>
  );
}

// ---- chests

/** The kinds besides items, offered before the items in the picker (as -kind). */
const KIND_CHOICES: PickerChoice[] = [
  { value: -LANAI_TREASURE_GOLD, label: 'G', sub: '額は後で入力' },
  { value: -3, label: '種類 3', sub: 'ジュエル? (推定)' },
  { value: -LANAI_TREASURE_BATTLE, label: '戦闘 (群れ)', sub: '推定' },
];
/** The badge of an entry that is not an item. */
const KIND_BADGE: Record<number, string> = { [LANAI_TREASURE_GOLD]: 'G', 3: '3', [LANAI_TREASURE_BATTLE]: '戦' };

const userLabel = (u: LanaiChestUser): string => `${u.map} ${u.section === 4 ? '宝箱' : `区画 ${u.section}`} #${u.index}`;

function itemLabel(maps: LanaiMaps, id: number): string {
  return lanaiItemName(maps.session, id);
}

function groupLabel(maps: LanaiMaps, id: number): string {
  const row = maps.monsterGroupRow(id);
  return row < 0 ? `群れ ${hex8(id).toUpperCase()} (表にない)` : monsterGroupNames(maps, row) || `群れ #${row}`;
}

function treasureSummary(maps: LanaiMaps, slots: LanaiTreasureSlot[]): string {
  const total = slots.reduce((a, s) => a + s.weight, 0);
  if (!slots.length) return '(空)';
  return slots.map((s) => `${lanaiTreasureLabel(s, (id) => itemLabel(maps, id), (id) => groupLabel(maps, id))}${slots.length > 1 && total ? ` ${Math.round((s.weight / total) * 100)}%` : ''}`).join('、');
}

/** Pick a TreasureGroup row for a chest, or make a new one from the current contents (RPG2's / RPG3's dialog). */
function TreasureRowPicker({ st, current, onPick, onNew, onClose }: {
  st: LanaiEditState; current: number; onPick: (row: number) => void; onNew: () => void; onClose: () => void;
}): ReactNode {
  const maps = st.maps;
  const t = maps.treasureGroup!;
  const [query, setQuery] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), []);
  const used = useMemo(() => lanaiChestUsers(maps), [maps, maps.revision]);
  const q = query.trim();
  const rows: { row: number; text: string; users: string[] }[] = [];
  for (let row = 0; row < t.rows; row++) {
    const text = treasureSummary(maps, lanaiTreasureSlots(t, row));
    const users = (used.get(row) ?? []).map(userLabel);
    if (onlyFree && users.length) continue;
    if (q && String(row) !== q && !text.includes(q)) continue;
    rows.push({ row, text, users });
  }
  return (
    <Dialog title="宝箱の中身を選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="アイテム名か行番号で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="layer"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> どの宝箱も使っていない行だけ</label>
        <button className="primary" onClick={onNew}>今の中身を写して新しい行を作る</button>
      </div>
      <p className="muted small">「使っている宝箱」は、このコンテンツのマップの宝箱のうちこの行を指す数。共有している行の中身を変えると、それらの宝箱も全部変わります。</p>
      <div className="picker-list" ref={list}>
        <table className="picker-table">
          <thead><tr><th>行</th><th>中身</th><th>使っている宝箱</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row} className={'pick' + (r.row === current ? ' current' : '')} onClick={() => onPick(r.row)}>
                <td className="num">{r.row}</td>
                <td>{r.text}</td>
                <td className="muted" title={r.users.join('、')}>{r.users.length ? `${r.users.length} 個` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/**
 * Contents of a chest: the TreasureGroup row its EventObject row's chest action names (the first argument) with its
 * entries (item, G, kinds 3 and 4, and the weight). Edits are undo points of the map page.
 */
export function TreasureEditor({ st, event }: { st: LanaiEditState; event: number }): ReactNode {
  const maps = st.maps;
  const { session } = maps;
  const t = maps.treasureGroup;
  const events = st.info ? maps.eventTable(st.info.dungeon) : undefined;
  const [picking, setPicking] = useState<{ current?: number; onPick: (id: number) => void } | null>(null);
  const [pickingRow, setPickingRow] = useState(false);
  const field = events ? lanaiChestField(events, event) : null;
  if (!events || field === null) return null;
  const row = events.u32(event, field);
  const users = lanaiChestUsers(maps).get(row) ?? [];
  if (!t) return <p className="muted small">このコンテンツには TreasureGroup の表がありません。</p>;
  const valid = row < t.rows;
  const slots = valid ? lanaiTreasureSlots(t, row) : [];
  const total = slots.reduce((a, s) => a + s.weight, 0);
  const added = valid && row >= t.originalRows;
  const changed = valid && !added && t.rowChanged(row);
  const items = session.need('ItemData');
  const write = (next: LanaiTreasureSlot[]): void => st.editTreasure((x) => lanaiWriteTreasure(x, row, next));
  const update = (i: number, next: LanaiTreasureSlot | null): void => {
    const copy = slots.map((x) => ({ ...x }));
    if (next) copy[i] = next;
    else copy.splice(i, 1);
    write(copy);
  };
  /** Point the chest at another row. */
  const point = (v: number): void => st.setEventField(event, (x) => x.setU32(event, field, v));
  /** A new row with the current contents (the chest is pointed at it in the same undo point). */
  const separate = (): void => {
    st.editTables(() => {
      const r = t.addRow(valid ? row : undefined);
      if (!valid) lanaiWriteTreasure(t, r, []);
      events.setU32(event, field, r);
    });
  };
  /** Pick what an entry gives (an item, or a kind from the choices before the items); `s` is the entry, null for a new one. */
  const pick = (s: LanaiTreasureSlot | null, onPick: (next: LanaiTreasureSlot) => void): void => setPicking({
    current: !s ? undefined : s.kind === LANAI_TREASURE_ITEM ? items.find(s.value) : -s.kind,
    onPick: (id) => {
      if (id > 0) return onPick({ kind: LANAI_TREASURE_ITEM, value: items.rowId(id), weight: 1 });
      const kind = -id;
      const value = s?.kind === kind ? s.value
        : kind === LANAI_TREASURE_BATTLE ? maps.monsterGroups()[1]?.id ?? maps.monsterGroups()[0]?.id ?? 0
        : kind === LANAI_TREASURE_GOLD ? 100 : 1;
      onPick({ kind, value, weight: 1 });
    },
  });
  return (
    <div className="treasure">
      <h3>{`宝箱の中身 (${LANAI_CHEST_ACTIONS[events.u32(event, field - 4)]})`}</h3>
      <div className="row">
        <span className="grow">
          {`中身の表 TreasureGroup #${row}${added ? ' (追加した行)' : ''}`}
          {users.length > 1 && <span className="badge" title={users.map(userLabel).join('、')}>{`${users.length} 個の宝箱で共有`}</span>}
        </span>
        <button onClick={() => setPickingRow(true)}>変更…</button>
      </div>
      {users.length > 1 && (
        <div className="row">
          <button onClick={separate}>この宝箱専用の行にする</button>
        </div>
      )}
      {!valid && <div className="error">{`中身の表 (TreasureGroup) に行 ${row} がありません`}</div>}
      {valid && (
        <>
          <div className="loot">
            {slots.map((s, i) => (
              <div key={i} className="loot-row">
                <span className="loot-item">
                  <button className={s.kind === LANAI_TREASURE_ITEM ? 'loot-item' : 'loot-item loot-kind'} title="クリックで出るもの (アイテム・G・種類 3・戦闘) を変える" onClick={() => pick(s, (next) => update(i, { ...next, weight: s.weight }))}>
                    {s.kind === LANAI_TREASURE_ITEM ? lanaiItemEntry(session, s.value).icon : <span className="photo item-badge item-kind-0">{KIND_BADGE[s.kind] ?? '?'}</span>}
                    {s.kind === LANAI_TREASURE_ITEM ? itemLabel(maps, s.value) : !s.kind || s.kind === LANAI_TREASURE_BATTLE ? '' : LANAI_TREASURE_KIND[s.kind] ?? `種類 ${s.kind}`}
                  </button>
                  {s.kind === LANAI_TREASURE_BATTLE
                    ? <MonsterGroupSelect maps={maps} value={s.value} onChange={(v) => update(i, { ...s, value: v })} />
                    : s.kind !== LANAI_TREASURE_ITEM && <NumberInput value={s.value} min={0} max={0x7fffffff} title={s.kind === LANAI_TREASURE_GOLD ? 'G' : '値'} onCommit={(v) => update(i, { ...s, value: v })} />}
                </span>
                <NumberInput value={s.weight} min={1} max={0xffff} className="" title="重み (出やすさ)" onCommit={(v) => update(i, { ...s, weight: v })} />
                <span className="loot-pct">{total ? `${Math.round((s.weight / total) * 100)}%` : ''}</span>
                <button className="danger" title="外す" onClick={() => update(i, null)}>×</button>
              </div>
            ))}
            {!slots.length && <div className="muted">空です (開けても何も出ません)。</div>}
            {slots.length < LANAI_TREASURE_SLOTS && (
              <button className="loot-add" onClick={() => pick(null, (next) => write([...slots, next]))}>＋ 追加</button>
            )}
          </div>
          <div className="muted small">
            {`開けると、並んだものから重みに比例して 1 つ選ばれます (最大 ${LANAI_TREASURE_SLOTS} 個)。G は値がそのまま額です。種類 3 と「戦闘 (群れ)」の意味は ROM のデータからの推定です。${users.length > 1 ? 'この中身を変えると共有している宝箱も変わります。' : ''}${changed ? ' 変更済み。' : ''}`}
          </div>
        </>
      )}
      {picking && (
        <LanaiItemPicker session={session} current={picking.current ?? 0} title="宝箱に入れるものを選ぶ" choices={KIND_CHOICES}
          onClose={() => setPicking(null)} onPick={(r) => { setPicking(null); picking.onPick(r); }} />
      )}
      {pickingRow && (
        <TreasureRowPicker st={st} current={row} onClose={() => setPickingRow(false)}
          onPick={(v) => { setPickingRow(false); if (v !== row) point(v); }}
          onNew={() => { setPickingRow(false); separate(); }} />
      )}
    </div>
  );
}
