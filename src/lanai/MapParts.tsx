// Inspector blocks of RPG FREE!'s map page, as RPG3's (oahu/MapParts.tsx): the MonsterGroup rows of the content (for
// section 6 and chest battles) and the contents of a chest (the content's TreasureGroup, edited with an undo point of
// the map: treasure.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import { EmptyGroupIcon, GroupIconRow, GroupListView } from '../ui/GroupDetail';
import type { PickerChoice } from '../ui/GridPicker';
import { hex8 } from '../util/bytes';
import { LANAI_ACTION_GOAL_CHEST } from './actions';
import { contentTitle } from './contents';
import { lanaiShopHref } from './hrefs';
import { lanaiShops } from './shops';
import { useAsync } from '../ui/useAsync';
import { useLanaiRevision } from './MonsterEditor';
import { useLanaiContents } from './useContents';
import type { LanaiEditState } from './mapedit';
import type { LanaiMaps, LanaiMonsterGroupRow, LanaiMonsterGroupUse } from './maps';
import { lanaiItemName } from './monsterBook';
import { lanaiMonsters } from './monsters';
import { lanaiItemEntry, LanaiItemPicker, lanaiMonsterIcon } from './pickers';
import { lanaiItems } from './items';
import { SoundButton } from '../ui/SoundPicker';
import {
  LANAI_CHEST_ACTIONS,
  LANAI_TREASURE_BATTLE,
  LANAI_TREASURE_GOLD,
  LANAI_TREASURE_ITEM,
  LANAI_TREASURE_KIND,
  LANAI_TREASURE_SLOTS,
  lanaiChestFields,
  lanaiChestUsers,
  lanaiTreasureLabel,
  lanaiTreasureSlots,
  lanaiWriteTreasure,
  type LanaiChestUser,
  type LanaiTreasureSlot,
} from './treasure';

// ---- MonsterGroup

/** The group page of a content (#/groups/<content>.<row>). */
export const lanaiGroupHref = (content: number, row?: number): string =>
  `#/groups/${content}${row !== undefined ? `.${row}` : ''}`;

/** Row 0 (row ID 0x80000000): the game's default group, where values the table does not have go (map.md §5.7). */
export const DEFAULT_GROUP_LABEL = '既定 (番号 0: 敵なし相当)';

/** "いちごおばけ・おおくちばし": the monsters of a MonsterGroup row. */
function monsterGroupNames(maps: LanaiMaps, row: number): string {
  const g = maps.monsterGroups()[row];
  const mp = maps.session.table('MonsterParameter');
  const list = lanaiMonsters(maps.session);
  return g
    ? [...new Set(g.monsters.map((id) => (mp ? list[mp.find(id)]?.name : undefined) ?? hex8(id).toUpperCase()))].join(
        '・',
      )
    : '';
}

/** The MonsterParameter rows of a group, each once (-1 for an ID the table does not have). */
export function groupMonsterRows(maps: LanaiMaps, g: LanaiMonsterGroupRow): number[] {
  const mp = maps.session.table('MonsterParameter');
  return [...new Set(g.monsters.map((id) => (mp ? mp.find(id) : -1)))];
}

const groupChanged = (maps: LanaiMaps, row: number): boolean =>
  !!maps.monsterGroup && row < maps.monsterGroup.originalRows && maps.monsterGroup.rowChanged(row);

/** A group at a glance: its row and the photos of its monsters ("既定" for row 0, a warning for a value not in the table). */
export function MonsterGroupLine({
  maps,
  value,
  showRow = true,
}: {
  maps: LanaiMaps;
  value: number;
  showRow?: boolean;
}): ReactNode {
  const row = maps.monsterGroupRow(value);
  if (row < 0) return <EmptyGroupIcon label={`${hex8(value).toUpperCase()} (表にない: 番号 0 になる)`} />;
  if (row === 0) return <EmptyGroupIcon label={DEFAULT_GROUP_LABEL} />;
  const g = maps.monsterGroups()[row]!;
  return (
    <>
      {showRow && <span className="muted">{`#${row}`}</span>}
      <GroupIconRow
        icons={groupMonsterRows(maps, g).map((r, i) => (
          <span key={i}>{lanaiMonsterIcon(maps.session, r)}</span>
        ))}
        changed={groupChanged(maps, row)}
      />
    </>
  );
}

const useLabel = (u: LanaiMonsterGroupUse): string =>
  `${u.map} ${u.cells === 'map' ? '(マップの群れ)' : `セル ${u.cells} 個`}`;

/** Pick a MonsterGroup row of the content (the pick is its row ID), as RPG3's group picker: search, photos, the maps that use it. */
function LanaiGroupPicker({
  maps,
  current,
  onPick,
  onClose,
}: {
  maps: LanaiMaps;
  current: number;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const groups = useMemo(() => maps.monsterGroups().slice(1), [maps, maps.revision]);
  // the maps' current documents (edits of the open map included); computed once per opening
  const uses = useMemo(() => maps.monsterGroupUses(), [maps]);
  const mp = maps.session.table('MonsterParameter');
  const list = lanaiMonsters(maps.session);
  const used = (g: LanaiMonsterGroupRow): boolean => (uses.get(g.row)?.length ?? 0) > 0;
  const row = maps.monsterGroupRow(current);
  const defaultUses = uses.get(0) ?? [];
  return (
    <Dialog title="群れを選ぶ" onClose={onClose}>
      <p className="muted small">
        「マップ」はこのコンテンツでこの群れを使うマップの数 (区画 6 のヘッダーかセル)。表にない値はゲームでは番号 0
        の群れになります。群れの中身は<a href={lanaiGroupHref(maps.content.index)}>「群れ」のページ</a>で編集できます
        (共有している群れを変えると、使っているマップ全部に効きます)。
      </p>
      <div className="group-picker">
        <GroupListView
          groups={groups}
          monsters={(g) => groupMonsterRows(maps, g)}
          name={(r) => list[r]?.name}
          icon={(r, i) => <span key={i}>{lanaiMonsterIcon(maps.session, r)}</span>}
          changed={(g) => groupChanged(maps, g.row)}
          filters={[
            ['all', 'すべて', () => true],
            ['used', 'マップで使う', used],
            ['unused', 'どのマップも使わない', (g) => !used(g)],
          ]}
          extra={{
            head: 'マップ',
            cell: (g) => {
              const u = uses.get(g.row) ?? [];
              return u.length ? <span title={u.map(useLabel).join('、')}>{u.length}</span> : '';
            },
          }}
          selected={row}
          onSelect={(g) => onPick(g.id)}
        >
          <tr className={row === 0 ? 'active' : ''} onClick={() => onPick(maps.monsterGroups()[0]?.id ?? 0x80000000)}>
            <td className="num muted">0</td>
            <td>
              <EmptyGroupIcon label={DEFAULT_GROUP_LABEL} />
            </td>
            <td className="num muted">
              {defaultUses.length ? <span title={defaultUses.map(useLabel).join('、')}>{defaultUses.length}</span> : ''}
            </td>
          </tr>
          {row < 0 && (
            <tr className="active">
              <td></td>
              <td className="muted">{`${hex8(current).toUpperCase()} (表にない: 番号 0 になる)`}</td>
              <td></td>
            </tr>
          )}
        </GroupListView>
      </div>
      {!mp && <p className="muted small">このコンテンツには MonsterParameter の表がありません。</p>}
    </Dialog>
  );
}

/**
 * A MonsterGroup row ID of the content (section 6 values, chest battles): the group's photos on a button that opens the
 * picker. A value the table does not have is shown as such.
 */
export function MonsterGroupSelect({
  maps,
  value,
  onChange,
}: {
  maps: LanaiMaps;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  const row = maps.monsterGroupRow(value);
  return (
    <>
      <div className="row group-pick-row">
        <button
          className="group-pick"
          title={`群れを選び直す (ID ${hex8(value).toUpperCase()})`}
          onClick={() => setPicking(true)}
        >
          <MonsterGroupLine maps={maps} value={value} />
        </button>
        {row >= 0 && (
          <a href={lanaiGroupHref(maps.content.index, row)} title={`群れ #${row} を「群れ」のページで開く (編集)`}>
            ↗
          </a>
        )}
      </div>
      {picking && (
        <LanaiGroupPicker
          maps={maps}
          current={value}
          onClose={() => setPicking(false)}
          onPick={(v) => {
            setPicking(false);
            if (v !== value) onChange(v >>> 0);
          }}
        />
      )}
    </>
  );
}

/** A MonsterGroup row number of the content (the boss battle, action 0x8000000C, names the row, not its ID), with the group picker. */
export function MonsterGroupRowSelect({
  maps,
  value,
  onChange,
}: {
  maps: LanaiMaps;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  const g = maps.monsterGroups()[value];
  return (
    <>
      <div className="row group-pick-row">
        <button className="group-pick" title={`群れを選び直す (番号 ${value})`} onClick={() => setPicking(true)}>
          {g ? (
            <MonsterGroupLine maps={maps} value={g.id} />
          ) : (
            <span className="muted">{`番号 ${value} (表は ${maps.monsterGroups().length} 件: 表の外)`}</span>
          )}
        </button>
        {g && (
          <a href={lanaiGroupHref(maps.content.index, value)} title={`群れ #${value} を「群れ」のページで開く (編集)`}>
            ↗
          </a>
        )}
      </div>
      {picking && (
        <LanaiGroupPicker
          maps={maps}
          current={g?.id ?? 0}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            const row = maps.monsterGroupRow(id);
            if (row >= 0 && row !== value) onChange(row);
          }}
        />
      )}
    </>
  );
}

// ---- contents

/**
 * A content number (the content a goal chest or the clear warp marks cleared: save flag group 0x53, FUN_00191130).
 * In the ROM every one names its own content, so another one is flagged.
 */
export function ContentSelect({
  maps,
  value,
  onChange,
  allowNone,
  checking = false,
}: {
  maps: LanaiMaps;
  value: number;
  onChange: (v: number) => void;
  allowNone?: boolean;
  checking?: boolean;
}): ReactNode {
  const list = useLanaiContents(maps.session);
  const own = maps.content.index;
  return (
    <>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
        {value >= list.length && <option value={value}>{`${value} (コンテンツの表にない)`}</option>}
        {list.map((c) => (
          <option key={c.index} value={c.index}>
            {c.index === 0 && allowNone
              ? '0: なし'
              : `${c.index}: ${contentTitle(c)}${c.index === own ? ' (このコンテンツ)' : ''}`}
          </option>
        ))}
      </select>
      {value !== own && !(allowNone && value === 0) && (
        <span className="muted small">
          {checking
            ? '別のコンテンツのクリア状態を判定します。'
            : `このコンテンツ (${own}) と別のコンテンツをクリア済みにします。`}
        </span>
      )}
    </>
  );
}

/**
 * The shop a clerk opens (its second argument): the Shop rows of this content, by row number. A row ID is shown as the
 * row it names; a value no row has opens row 0.
 */
export function ShopSelect({
  maps,
  value,
  onChange,
}: {
  maps: LanaiMaps;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  const revision = useLanaiRevision(maps.session);
  const shops = useAsync(() => lanaiShops(maps.session, maps.content), [maps]);
  const content = maps.content.index;
  if (!shops || shops instanceof Error)
    return <HexSelectFallback value={value} text={shops ? shops.message : '店の表を読み込み中…'} />;
  void revision;
  const opened = shops.shopOf(value);
  const known = value === opened || value >>> 0 >= 0x80000000;
  return (
    <>
      <select value={known ? opened : value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
        {!known && <option value={value}>{`${value} (Shop の表にない → 店 0)`}</option>}
        {shops.shops.map((s) => (
          <option key={s.row} value={s.row}>
            {`店 ${s.row} (${shops.rows(s.row).length} 品)`}
          </option>
        ))}
      </select>
      <a className="small" href={lanaiShopHref(content, opened)}>
        品揃え
      </a>
    </>
  );
}

function HexSelectFallback({ value, text }: { value: number; text: string }): ReactNode {
  return <span className="muted small">{`${hex8(value).toUpperCase()} — ${text}`}</span>;
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

const userLabel = (u: LanaiChestUser): string =>
  `${u.map} ${u.section === 4 ? '宝箱' : `区画 ${u.section}`} #${u.index}`;

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
  return slots
    .map(
      (s) =>
        `${lanaiTreasureLabel(
          s,
          (id) => itemLabel(maps, id),
          (id) => groupLabel(maps, id),
        )}${slots.length > 1 && total ? ` ${Math.round((s.weight / total) * 100)}%` : ''}`,
    )
    .join('、');
}

/** Pick a TreasureGroup row for a chest, or make a new one from the current contents (RPG2's / RPG3's dialog). */
function TreasureRowPicker({
  st,
  current,
  onPick,
  onNew,
  onClose,
}: {
  st: LanaiEditState;
  current: number;
  onPick: (row: number) => void;
  onNew: () => void;
  onClose: () => void;
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
        <input
          type="search"
          placeholder="アイテム名か番号で絞り込み"
          className="picker-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="layer">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />{' '}
          どの宝箱も使っていない中身だけ
        </label>
        <button className="primary" onClick={onNew}>
          今の中身を写して新しい中身を作る
        </button>
      </div>
      <p className="muted small">
        「使っている宝箱」は、このコンテンツのマップの宝箱のうちこの中身を指す数。共有している中身を変えると、それらの宝箱も全部変わります。
      </p>
      <div className="picker-list" ref={list}>
        <table className="picker-table">
          <thead>
            <tr>
              <th>番号</th>
              <th>中身</th>
              <th>使っている宝箱</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row} className={'pick' + (r.row === current ? ' current' : '')} onClick={() => onPick(r.row)}>
                <td className="num">{r.row}</td>
                <td>{r.text}</td>
                <td className="muted" title={r.users.join('、')}>
                  {r.users.length ? `${r.users.length} 個` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** The headings of a goal chest's contents by its state (the action: map.md §7.3). */
const STAGE_HEADINGS = ['初めて開けたとき (状態 0)', '2 回目以降 (状態 1)', '2 回目以降 (状態 2〜3)'];

/**
 * Contents of a chest: the TreasureGroup row its EventObject row's chest action names (the first argument) with its
 * entries (item, G, kinds 3 and 4, and the weight); for the goal chest one per state, and the content it clears.
 * Edits are undo points of the map page.
 */
export function TreasureEditor({ st, event }: { st: LanaiEditState; event: number }): ReactNode {
  const maps = st.maps;
  const events = st.info ? maps.eventTable(st.info.dungeon) : undefined;
  const stages = events ? lanaiChestFields(events, event) : [];
  if (!events || !stages.length) return null;
  const goal = events.u32(event, stages[0]!.field - 4) === LANAI_ACTION_GOAL_CHEST;
  if (!goal) return <TreasureStage st={st} event={event} field={stages[0]!.field} />;
  // the content it clears: argument 2 of the first state's action (the others have 0)
  const clearField = stages[0]!.field + 4;
  const clears = events.u32(event, clearField);
  return (
    <>
      <div className="treasure">
        <h3>ゴールの宝箱: クリア判定</h3>
        <label className="field">
          <span>{`開けるとクリア済みにするコンテンツ (動作 ${stages[0]!.stage + 1} の引数 2)`}</span>
          <ContentSelect
            maps={maps}
            value={clears}
            allowNone
            onChange={(v) => st.setEventField(event, (x) => x.setU32(event, clearField, v))}
          />
        </label>
        <p className="muted small">
          {clears
            ? `開けると中身を渡し、コンテンツ ${clears} をクリア済みにします (セーブのフラグ群 0x53)。`
            : '0 なので、開けてもクリアにはなりません。'}
          {'開けた後の台詞は下の動作の「台詞 (引数 3)」で選びます。'}
        </p>
      </div>
      {stages.map((x) => (
        <TreasureStage key={x.field} st={st} event={event} field={x.field} heading={STAGE_HEADINGS[x.stage]} />
      ))}
    </>
  );
}

/** The contents of one chest action (the TreasureGroup row at `field` of the EventObject row). */
function TreasureStage({
  st,
  event,
  field,
  heading,
}: {
  st: LanaiEditState;
  event: number;
  field: number;
  heading?: string;
}): ReactNode {
  const maps = st.maps;
  const { session } = maps;
  const t = maps.treasureGroup;
  const events = maps.eventTable(st.info!.dungeon)!;
  const [picking, setPicking] = useState<{ current?: number; onPick: (id: number) => void } | null>(null);
  const [pickingRow, setPickingRow] = useState(false);
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
  const pick = (s: LanaiTreasureSlot | null, onPick: (next: LanaiTreasureSlot) => void): void =>
    setPicking({
      current: !s ? undefined : s.kind === LANAI_TREASURE_ITEM ? items.find(s.value) : -s.kind,
      onPick: (id) => {
        if (id > 0) return onPick({ kind: LANAI_TREASURE_ITEM, value: items.rowId(id), weight: 1 });
        const kind = -id;
        const value =
          s?.kind === kind
            ? s.value
            : kind === LANAI_TREASURE_BATTLE
              ? (maps.monsterGroups()[1]?.id ?? maps.monsterGroups()[0]?.id ?? 0)
              : kind === LANAI_TREASURE_GOLD
                ? 100
                : 1;
        onPick({ kind, value, weight: 1 });
      },
    });
  return (
    <div className="treasure">
      <h3>{`宝箱の中身 (${LANAI_CHEST_ACTIONS[events.u32(event, field - 4)]}${heading ? `、${heading}` : ''})`}</h3>
      <div className="row">
        <span className="grow">
          {`中身の表 TreasureGroup #${row}${added ? ' (追加した中身)' : ''}`}
          {users.length > 1 && (
            <span className="badge" title={users.map(userLabel).join('、')}>{`${users.length} 個の宝箱で共有`}</span>
          )}
        </span>
        <button onClick={() => setPickingRow(true)}>変更…</button>
      </div>
      {users.length > 1 && (
        <div className="row">
          <button onClick={separate}>この宝箱専用の中身にする</button>
        </div>
      )}
      {!valid && <div className="error">{`中身の表 (TreasureGroup) に番号 ${row} がありません`}</div>}
      {valid && (
        <>
          <div className="loot">
            {slots.map((s, i) => (
              <div key={i} className="loot-row">
                <span className="loot-item">
                  <button
                    className={s.kind === LANAI_TREASURE_ITEM ? 'loot-item' : 'loot-item loot-kind'}
                    title="クリックで出るもの (アイテム・G・種類 3・戦闘) を変える"
                    onClick={() => pick(s, (next) => update(i, { ...next, weight: s.weight }))}
                  >
                    {s.kind === LANAI_TREASURE_ITEM ? (
                      lanaiItemEntry(session, s.value).icon
                    ) : (
                      <span className="photo item-badge item-kind-0">{KIND_BADGE[s.kind] ?? '?'}</span>
                    )}
                    {s.kind === LANAI_TREASURE_ITEM
                      ? itemLabel(maps, s.value)
                      : !s.kind || s.kind === LANAI_TREASURE_BATTLE
                        ? ''
                        : (LANAI_TREASURE_KIND[s.kind] ?? `種類 ${s.kind}`)}
                  </button>
                  {s.kind === LANAI_TREASURE_BATTLE ? (
                    <MonsterGroupSelect maps={maps} value={s.value} onChange={(v) => update(i, { ...s, value: v })} />
                  ) : (
                    s.kind !== LANAI_TREASURE_ITEM && (
                      <NumberInput
                        value={s.value}
                        min={0}
                        max={0x7fffffff}
                        title={s.kind === LANAI_TREASURE_GOLD ? 'G' : '値'}
                        onCommit={(v) => update(i, { ...s, value: v })}
                      />
                    )
                  )}
                </span>
                <NumberInput
                  value={s.weight}
                  min={1}
                  max={0xffff}
                  className=""
                  title="重み (出やすさ)"
                  onCommit={(v) => update(i, { ...s, weight: v })}
                />
                <span className="loot-pct">{total ? `${Math.round((s.weight / total) * 100)}%` : ''}</span>
                <button className="danger" title="外す" onClick={() => update(i, null)}>
                  ×
                </button>
              </div>
            ))}
            {!slots.length && <div className="muted">空です (開けても何も出ません)。</div>}
            {slots.length < LANAI_TREASURE_SLOTS && (
              <button className="loot-add" onClick={() => pick(null, (next) => write([...slots, next]))}>
                ＋ 追加
              </button>
            )}
          </div>
          <div className="muted small">
            {`開けると、並んだものから重みに比例して 1 つ選ばれます (最大 ${LANAI_TREASURE_SLOTS} 個)。G は値がそのまま額です。種類 3 と「戦闘 (群れ)」の意味は ROM のデータからの推定です。${users.length > 1 ? 'この中身を変えると共有している宝箱も変わります。' : ''}${changed ? ' 変更済み。' : ''}`}
          </div>
        </>
      )}
      {picking && (
        <LanaiItemPicker
          session={session}
          current={picking.current ?? 0}
          title="宝箱に入れるものを選ぶ"
          choices={KIND_CHOICES}
          onClose={() => setPicking(null)}
          onPick={(r) => {
            setPicking(null);
            picking.onPick(r);
          }}
        />
      )}
      {pickingRow && (
        <TreasureRowPicker
          st={st}
          current={row}
          onClose={() => setPickingRow(false)}
          onPick={(v) => {
            setPickingRow(false);
            if (v !== row) point(v);
          }}
          onNew={() => {
            setPickingRow(false);
            separate();
          }}
        />
      )}
    </div>
  );
}

// ---- Doors (actions 0x15 / 0x16 / 0x19 / 0x1C / 0x38 / 0x39 / 0x3B / 0x3C: roms survey 2026-11-21)

/** ItemDataCore +0x32 of the items a door takes: keys (かぎ) and the idols of 0x3B / 0x3C (あかし). */
export const LANAI_DOOR_ITEM_KIND = { key: 0x16, idol: 0x27 } as const;

/**
 * The key (or idol) of a door: 0 = none (a key door opens without one; the confirming doors 0x38 / 0x39 then stay
 * shut), else an ItemData row number as the shipped doors have it (JudgeOpen 0x18F618 passes the value to GetItemNum
 * untouched: below 0x80000000 a row number, else a row ID). The list has the items of the kind; any other item can be
 * picked from the item picker.
 */
export function DoorItemSelect({
  maps,
  value,
  which,
  allowNone,
  onChange,
}: {
  maps: LanaiMaps;
  value: number;
  which: keyof typeof LANAI_DOOR_ITEM_KIND;
  allowNone: boolean;
  onChange: (v: number) => void;
}): ReactNode {
  const session = maps.session;
  useLanaiRevision(session);
  const [picking, setPicking] = useState(false);
  const items = lanaiItems(session).filter((it) => it.kind === LANAI_DOOR_ITEM_KIND[which]);
  const listed = (value === 0 && allowNone) || items.some((it) => it.row === value);
  return (
    <>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) >>> 0)}>
        {allowNone && <option value={0}>{which === 'key' ? '0: 鍵なし' : '0: なし'}</option>}
        {!listed && (
          <option value={value}>
            {value
              ? `${hex8(value)
                  .toUpperCase()
                  .replace(/^0+(?=.)/, '')}: ${lanaiItemName(session, value)}`
              : '0: なし (この扉では開きません)'}
          </option>
        )}
        {items.map((it) => (
          <option key={it.row} value={it.row}>{`${it.row.toString(16).toUpperCase()}: ${it.name}`}</option>
        ))}
      </select>
      <button
        type="button"
        className="small"
        onClick={() => setPicking(true)}
        title="鍵・あかし以外のアイテムも選べます"
      >
        ほかのアイテム…
      </button>
      {picking && (
        <LanaiItemPicker
          session={session}
          current={value}
          title={which === 'key' ? '扉の鍵にするアイテム' : 'はめる像にするアイテム'}
          onPick={(row) => {
            setPicking(false);
            onChange(row);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** Whether the door's key is used up when it opens (only 1 is used in the data; any value but 0 counts). */
export function DoorConsumeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }): ReactNode {
  return (
    <select value={value ? 1 : 0} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={0}>0: 減らない</option>
      <option value={1}>1: 開けると 1 個減る</option>
    </select>
  );
}

/** The sounds the shipped doors open with (SoundData rows): 0x7A 32 times, 0x8C 50 times. */
export const LANAI_DOOR_SOUNDS = [0x7a, 0x8c] as const;

/**
 * The sound a door opens with (a SoundData row, kept as u16 by the factories). 0 is no sound for the backdoor, the
 * door "standing open" for 0x19 / 0x1A / 0x1B, and is played as row 0 by 0x15.
 */
export function DoorSoundSelect({
  maps,
  value,
  onChange,
}: {
  maps: LanaiMaps;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  const session = maps.session;
  const revision = useLanaiRevision(session);
  const sounds = useAsync(() => session.sounds(), [session, revision]);
  const rows = session.table('SoundData')?.rows ?? 0;
  const outside = rows > 0 && (value & 0xffff) >= rows;
  return (
    <>
      {sounds && !(sounds instanceof Error) ? (
        <SoundButton
          game={session}
          sounds={sounds}
          value={value}
          kind="se"
          max={0xffff}
          title="扉が開く音を選ぶ"
          onChange={onChange}
        />
      ) : (
        <HexSelectFallback value={value} text={sounds ? sounds.message : '音の一覧を読み込み中…'} />
      )}
      {LANAI_DOOR_SOUNDS.filter((s) => s !== value).map((s) => (
        <button key={s} type="button" className="small" onClick={() => onChange(s)}>
          {`0x${s.toString(16).toUpperCase()} にする`}
        </button>
      ))}
      {outside && <span className="muted small">{`SoundData は ${rows} 件なので、範囲の外です`}</span>}
    </>
  );
}
