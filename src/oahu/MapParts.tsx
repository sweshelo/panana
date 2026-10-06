// Inspector blocks of RPG3's map page (naauao oahu/map.md §9〜§11), built like RPG2's map editor: the contents of a
// chest (treasureGroup, edited with an undo point of the map), what a character of section 5 is (mapChara: NPC,
// monster or Denpa person) and the enemies of the map (section 6: the map's group, the cells' groups).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Field } from '../editor/fields';
import { NumberInput } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import { GroupIconRow, GroupListView, SlotTiles } from '../ui/GroupDetail';
import { hex8, u16, u32, w32 } from '../util/bytes';
import type { OahuBattle, OahuGroup } from './battle';
import { EO } from './events';
import type { OahuEditState } from './mapedit';
import { OAHU_CHARA_KIND, oahuCharaKindOf, type OahuRecordLook } from './mapObjects';
import type { OahuMapInfo } from './maps';
import type { OahuMapView } from './mapview';
import { oahuGroupHref, oahuGroupMonster, oahuItemIcon, oahuMonsterIcon, OahuItemPicker } from './pickers';
import type { OahuSession } from './session';
import {
  OAHU_CHEST_KINDS,
  OAHU_TREASURE_FILE,
  OAHU_TREASURE_KIND,
  OAHU_TREASURE_SLOTS,
  oahuChestTreasureRow,
  oahuTreasureLabel,
  oahuTreasureSlots,
  oahuTreasureTable,
  oahuWriteTreasure,
  type OahuTreasureSlot,
} from './treasure';

/** "mapObject #52 gimk_05_trebox_1" for the model line of the inspector. */
export function ModelLine({ view, look }: { view: OahuMapView; look: OahuRecordLook | null }): ReactNode {
  if (!look) return null;
  const m = look.model;
  const name = view.modelName(m);
  const text = !m ? 'モデルなし'
    : m.type === 'object' ? `mapObject #${m.row}${name ? ` ${name}` : ''}`
    : m.type === 'monster' ? `モンスターのデザイン #${m.design}${name ? ` ${name}` : ''}`
    : m.type === 'invisible' ? `見えない壁 (mapObject #${m.row}、${m.width} × ${m.depth}。灰色の箱で表示)`
    : '電波人間 (パーツから組み立てるので、まだ表示できません)';
  return <p className="muted small">{`モデル: ${text}`}</p>;
}

// ---- chests

/** The chests (EventObject rows of the loaded dungeons) using each treasureGroup row. */
function chestUsers(session: OahuSession): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const { maps } = session;
  for (const d of maps.dungeons) {
    const t = maps.loadedEventTable(d);
    if (!t) continue;
    for (let i = 0; i < t.rows; i++) {
      const row = oahuChestTreasureRow(t.row(i));
      if (row !== null) out.set(row, [...(out.get(row) ?? []), `${d.code || `#${d.row}`} の行 ${i}`]);
    }
  }
  return out;
}

function treasureSummary(battle: OahuBattle, slots: OahuTreasureSlot[]): string {
  const total = slots.reduce((a, s) => a + s.weight, 0);
  if (!slots.length) return '(空)';
  return slots.map((s) => `${oahuTreasureLabel(s, (id) => battle.itemName(id))}${slots.length > 1 && total ? ` ${Math.round((s.weight / total) * 100)}%` : ''}`).join('、');
}

/** Pick a treasureGroup row for a chest, or make a new one from the current contents (RPG2's dialog). */
function TreasureRowPicker({ session, current, apply, onPick, onClose }: {
  session: OahuSession; current: number; apply: (f: () => void) => void; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const { battle, master } = session;
  const t = oahuTreasureTable(master);
  const [query, setQuery] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), []);
  const used = useMemo(() => chestUsers(session), [session]);
  const q = query.trim();
  const rows: { row: number; text: string; users: string[] }[] = [];
  for (let row = 0; row < t.rows; row++) {
    const text = treasureSummary(battle, oahuTreasureSlots(t, row));
    const users = used.get(row) ?? [];
    if (onlyFree && users.length) continue;
    if (q && String(row) !== q && !text.includes(q)) continue;
    rows.push({ row, text, users });
  }
  return (
    <Dialog title="宝箱の中身を選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="アイテム名か行番号で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="layer"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> どの宝箱も使っていない行だけ</label>
        <button className="primary" onClick={() => {
          let row = -1;
          apply(() => (row = master.addRow(OAHU_TREASURE_FILE, t.row(current < t.rows ? current : 0).slice())));
          onPick(row);
        }}>今の中身を写して新しい行を作る</button>
      </div>
      <p className="muted small">「使っている宝箱」は、読み込んだダンジョンの宝箱のうちこの行を指す数。共有している行の中身を変えると、それらの宝箱も全部変わります。</p>
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
 * Contents of a chest: the treasureGroup row of its EventObject row (+0x10) with its entries (item, G or jewels, and
 * the weight). Edits go through `apply` (an undo point of the map page).
 */
export function TreasureEditor({ session, ev, apply }: { session: OahuSession; ev: Uint8Array; apply: (f: () => void) => void }): ReactNode {
  const { battle, master } = session;
  const t = oahuTreasureTable(master);
  const [picking, setPicking] = useState<{ current?: number; onPick: (id: number) => void } | null>(null);
  const [pickingRow, setPickingRow] = useState(false);
  const row = oahuChestTreasureRow(ev);
  if (row === null) return null;
  const users = chestUsers(session).get(row) ?? [];
  const valid = row >= 0 && row < t.rows;
  const slots = valid ? oahuTreasureSlots(t, row) : [];
  const total = slots.reduce((a, s) => a + s.weight, 0);
  const changed = valid && row < master.originalRows(OAHU_TREASURE_FILE) && master.originalRow(OAHU_TREASURE_FILE, row).some((b, i) => b !== t.row(row)[i]);
  const write = (next: OahuTreasureSlot[]): void => apply(() => oahuWriteTreasure(t, row, next));
  const update = (i: number, next: OahuTreasureSlot | null): void => {
    const copy = slots.map((x) => ({ ...x }));
    if (next) copy[i] = next;
    else copy.splice(i, 1);
    write(copy);
  };
  return (
    <div className="treasure">
      <h3>{`宝箱の中身 (${OAHU_CHEST_KINDS[ev[EO.kind]!]})`}</h3>
      <div className="row">
        <span className="grow">
          {`中身の表 #${row}`}
          {users.length > 1 && <span className="badge" title={users.join('、')}>{`${users.length} 個の宝箱で共有`}</span>}
        </span>
        <button onClick={() => setPickingRow(true)}>変更…</button>
      </div>
      {!valid && <div className="error">{`中身の表 (treasureGroup) に行 ${row} がありません`}</div>}
      {valid && (
        <>
          <div className="loot">
            {slots.map((s, i) => (
              <div key={i} className="loot-row">
                <span className="loot-item">
                  <select value={s.kind} title="出るものの種類 (+0x06)" onChange={(e) => {
                    const kind = Number(e.target.value);
                    update(i, { ...s, kind, value: kind === 1 ? (battle.items.item(s.value) ? s.value : 1) : s.value });
                  }}>
                    {Object.entries(OAHU_TREASURE_KIND).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    {!OAHU_TREASURE_KIND[s.kind] && <option value={s.kind}>{`種類 ${s.kind}`}</option>}
                  </select>
                  {s.kind === 1
                    ? <button className="loot-item" title="クリックでアイテムを変える" onClick={() => setPicking({ current: s.value, onPick: (id) => update(i, { ...s, value: id }) })}>
                        {oahuItemIcon(battle, battle.items.item(s.value))}
                        <span className="muted">{`${s.value} `}</span>{battle.itemName(s.value) || `アイテム ${s.value}`}
                      </button>
                    : <NumberInput value={s.value} min={1} max={0x7fffffff} title={s.kind === 2 ? 'G' : s.kind === 3 ? 'ジュエルの数' : '値'} onCommit={(v) => update(i, { ...s, value: v })} />}
                </span>
                <NumberInput value={s.weight} min={1} max={0xffff} className="" title="重み (出やすさ)" onCommit={(v) => update(i, { ...s, weight: v })} />
                <span className="loot-pct">{total ? `${Math.round((s.weight / total) * 100)}%` : ''}</span>
                <button className="danger" title="外す" onClick={() => update(i, null)}>×</button>
              </div>
            ))}
            {!slots.length && <div className="muted">空です (開けても何も出ません)。</div>}
            {slots.length < OAHU_TREASURE_SLOTS && (
              <button className="loot-add" onClick={() => setPicking({ onPick: (id) => write([...slots, { value: id, weight: 1, kind: 1 }]) })}>＋ 追加</button>
            )}
          </div>
          <div className="muted small">
            {`開けると、並んだものから重みに比例して 1 つ選ばれます (最大 ${OAHU_TREASURE_SLOTS} 個)。G とジュエルは値がそのまま数です。${users.length > 1 ? 'この中身を変えると共有している宝箱も変わります。別の中身にするには「変更…」で新しい行を作ってください。' : ''}${changed ? ' 変更済み。' : ''}`}
          </div>
        </>
      )}
      {picking && (
        <OahuItemPicker battle={battle} current={picking.current ?? 0} title="宝箱に入れるアイテムを選ぶ"
          onClose={() => setPicking(null)} onPick={(id) => { setPicking(null); picking.onPick(id); }} />
      )}
      {pickingRow && (
        <TreasureRowPicker session={session} current={row} apply={apply} onClose={() => setPickingRow(false)}
          onPick={(v) => { setPickingRow(false); if (v !== row) apply(() => w32(ev, EO.args, v)); }} />
      )}
    </div>
  );
}

// ---- characters

/** What a character of section 5 (kinds 0〜2) is: its mapChara row and the model of its variant (EventObject +0x50). */
export function CharaInfo({ session, ev }: { session: OahuSession; ev: Uint8Array }): ReactNode {
  const t = session.master.table('mapChara.bin');
  const chara = u16(ev, EO.model);
  if (chara <= 0 || chara >= t.rows) return <p className="muted small">{`mapChara の行 ${chara} (なし)`}</p>;
  const c = t.row(chara);
  const kind = oahuCharaKindOf(c);
  const variant = u16(ev, EO.flags);
  const id = variant <= 2 ? u16(c, 8 + variant * 2) : 0;
  const { battle } = session;
  const monsters = kind === 1 ? battle.monsterList().filter((m) => (battle.monsters.get(m.id, 'design') & 0xff) === id) : [];
  return (
    <p className="muted small">
      {`mapChara の行 ${chara}: ${OAHU_CHARA_KIND[kind] ?? `種類 ${kind}`} (+0x00 = ${hex8(u32(c, 0)).toUpperCase()})・EventObject +0x50 = ${variant} で`}
      {kind === 0 ? ` mapObject #${id}` : kind === 1 ? ` モンスターのデザイン #${id}` : ` 電波人間の設定 ${id} (未解析)`}
      {kind === 1 && monsters.length > 0 && ` (${monsters.slice(0, 3).map((m) => m.name).join('、')}${monsters.length > 3 ? ' …' : ''} の見た目)`}
    </p>
  );
}

// ---- enemies (section 6)

/** monsterGroup hash -> row and back (row 0 is "none", the game's default hash 6B223E6C). */
function groupHashes(battle: OahuBattle): { row: Map<number, number>; hash: Map<number, number> } {
  const row = battle.groups.table.hashIndex();
  const hash = new Map<number, number>();
  for (const [h, r] of row) hash.set(r, h);
  return { row, hash };
}

const groupMonsters = (g: OahuGroup): number[] => [...new Set([...g.leads, ...g.mates].map((s) => s.monster).concat(g.fixed))];

function GroupLine({ battle, row }: { battle: OahuBattle; row: number | undefined }): ReactNode {
  if (row === undefined) return <span className="muted">不明な群れ</span>;
  if (!row) return <span className="muted">(なし: 敵が出ない)</span>;
  const g = battle.group(row);
  return (
    <>
      <span className="muted">{`#${row}`}</span>
      <GroupIconRow icons={groupMonsters(g).map((m, i) => <span key={i}>{oahuMonsterIcon(battle, m)}</span>)} changed={battle.groups.changed(row)} />
    </>
  );
}

function OahuGroupPicker({ battle, current, onPick, onClose }: { battle: OahuBattle; current: number; onPick: (row: number) => void; onClose: () => void }): ReactNode {
  const groups = useMemo(() => battle.groupList(), [battle]);
  return (
    <Dialog title="群れを選ぶ" onClose={onClose}>
      <p className="muted small">群れの中身は「群れ」のページで編集できます (共有している群れを変えると、使っているマップ全部に効きます)。</p>
      <div className="group-picker">
        <GroupListView groups={groups} monsters={groupMonsters} name={(r) => battle.monsterName(r)}
          icon={(r, i) => <span key={i}>{oahuMonsterIcon(battle, r)}</span>} changed={(g) => battle.groups.changed(g.row)}
          filters={[['used', 'モンスターのいる群れ', (g) => g.leads.length + g.mates.length > 0], ['all', 'すべて', () => true]]}
          selected={current} onSelect={(g) => onPick(g.row)}>
          <tr className={current === 0 ? 'active' : ''} onClick={() => onPick(0)}>
            <td></td>
            <td className="muted">(なし: 敵が出ない)</td>
          </tr>
        </GroupListView>
      </div>
    </Dialog>
  );
}

/** The enemies of the open map: the map's group (section 6 header) and the groups of the listed cells. */
export function EncounterPanel({ session, st, info }: { session: OahuSession; st: OahuEditState; info: OahuMapInfo }): ReactNode {
  const { battle } = session;
  const [picking, setPicking] = useState(false);
  const doc = st.current!;
  const { row: rowOf, hash: hashOf } = useMemo(() => groupHashes(battle), [battle]);
  const header = doc.sec6Header.length >= 4 ? u32(doc.sec6Header, 0) : 0;
  const cur = header ? rowOf.get(header) : 0;
  const monster = oahuGroupMonster(battle);
  const setGroup = (row: number): void =>
    st.edit((d) => {
      if (d.sec6Header.length < 8) {
        d.sec6Header = new Uint8Array(8);
        w32(d.sec6Header, 4, 0xffffffff);
      }
      w32(d.sec6Header, 0, row ? hashOf.get(row)! : 0);
    });
  const cells = new Map<number, [number, number][]>();
  for (const c of doc.cells6) cells.set(c.value, [...(cells.get(c.value) ?? []), [c.x, c.y]]);
  return (
    <div className="enc-box">
      <h3>出現する敵</h3>
      <Field label="マップの群れ (区画 6 のヘッダー)">
        <button className="group-pick" title="群れを選び直す" onClick={() => setPicking(true)}><GroupLine battle={battle} row={cur} /></button>
      </Field>
      {header !== 0 && cur === undefined && <div className="error">{`群れ ${hex8(header).toUpperCase()} が monsterGroup にありません`}</div>}
      {!!cur && (
        <div className="enc-group">
          <div className="small"><a href={oahuGroupHref(cur)}>{`群れ #${cur} を開く (編集)`}</a></div>
          <SlotTiles title="先頭 (マップで見える敵)・3 体目" slots={battle.group(cur).leads} monster={monster} count={String} />
          <SlotTiles title="2・4 体目" slots={battle.group(cur).mates} monster={monster} count={String} />
        </div>
      )}
      <div className="muted small">
        {`マップ表の +0x30 (出現の度合いと推定): ${info.encounterRate}。区画 6 のセル ${doc.cells6.length} 個は、それぞれの群れだけが出るセルです (値 0 のセルは敵が出ない。RPG3 のデータにはない)。`}
      </div>
      {[...cells].map(([hash, list]) => (
        <details key={hash} className="enc-cells">
          <summary>{`セル ${list.length} 個: `}<GroupLine battle={battle} row={hash ? rowOf.get(hash) : 0} /></summary>
          <div className="muted small">{list.map(([x, y]) => `(${x}, ${y})`).join(' ')}</div>
        </details>
      ))}
      {picking && (
        <OahuGroupPicker battle={battle} current={cur ?? -1} onClose={() => setPicking(false)}
          onPick={(row) => { setPicking(false); if (row !== cur) setGroup(row); }} />
      )}
    </div>
  );
}
