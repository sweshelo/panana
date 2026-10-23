// What an RPG FREE! battle shows and plays (battleField.ts): the battle field of a group (its table by +0x69 bit3 and
// its row by +0x00) with the row's background and BGM, and the map's sounds (MapData +0x04 / +0x06 / +0x08) and the
// battle field it starts with (MapResource +0x10). The rows are shared by the groups and maps that pick them.
import type { ReactNode } from 'react';
import type { SoundNames } from '../game/sound';
import { SoundButton } from '../ui/SoundPicker';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import {
  LANAI_BATTLE_BACKGROUNDS, LANAI_BF, LANAI_MAP_SOUNDS, LANAI_MG_FIELD_CONTENTS, LANAI_RESOURCE_BATTLE_FIELD, lanaiBackgroundKey, lanaiBackgroundName,
  lanaiBattleFieldRow, lanaiBattleFieldTable, lanaiBattleFieldUses, lanaiGroupBattleField,
} from './battleField';
import { lanaiGroupHref } from './MapParts';
import type { LanaiMaps } from './maps';
import { LANAI_MG_FIELD, LANAI_MG_FLAGS } from './monsterGroup';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

const MAX_SOUND = 0xffff;

function useSounds(session: LanaiSession): SoundNames | null {
  const s = useAsync(() => session.sounds(), [session]);
  return s instanceof Error || !s ? null : s;
}

/** "80000001 btmp_07_ruinsB・BGM_BATTLE_NORMAL (2)" for a row of a battle-field table. */
function rowLabel(t: LanaiTable, r: number, sounds: SoundNames | null): string {
  const bgm = t.u32(r, LANAI_BF.bgm);
  return `${hex8(t.rowId(r)).toUpperCase()} ${lanaiBackgroundName(t.u32(r, LANAI_BF.archive), t.u32(r, LANAI_BF.entry))}・${sounds ? sounds.label(bgm) : `サウンド ${bgm}`}`;
}

/** A <select> of the rows of a battle-field table by row ID (with the value as it is when the table lacks it). */
function BattleFieldSelect({ t, value, sounds, none, onChange }: { t: LanaiTable; value: number; sounds: SoundNames | null; none?: string; onChange: (v: number) => void }): ReactNode {
  const { found } = lanaiBattleFieldRow(t, value);
  return (
    <select value={value >>> 0} onChange={(e) => onChange(Number(e.target.value))}>
      {none && <option value={0}>{none}</option>}
      {!found && !(none && !value) && <option value={value >>> 0}>{`${hex8(value).toUpperCase()} (表にない: 行 0 になる)`}</option>}
      {Array.from({ length: t.rows }, (_, r) => <option key={r} value={t.rowId(r)}>{rowLabel(t, r, sounds)}</option>)}
    </select>
  );
}

/** The background and BGM of one row (shared by everything that picks it). */
function BattleFieldRowEditor({ session, sounds, t, row, edit, users }: {
  session: LanaiSession;
  sounds: SoundNames | null;
  t: LanaiTable;
  row: number;
  edit: (f: () => void) => void;
  users: { label: string; href?: string }[];
}): ReactNode {
  const archive = t.u32(row, LANAI_BF.archive);
  const entry = t.u32(row, LANAI_BF.entry);
  const bgm = t.u32(row, LANAI_BF.bgm);
  const key = lanaiBackgroundKey(archive, entry);
  const known = LANAI_BATTLE_BACKGROUNDS.some((b) => lanaiBackgroundKey(b.archive, b.entry) === key);
  return (
    <div className={`event-box${t.rowChanged(row) ? ' edited' : ''}`}>
      <div className="small muted">{`${t.name} の行 ${row} (行 ID ${hex8(t.rowId(row)).toUpperCase()})${t.rowChanged(row) ? '・変更済み' : ''}`}</div>
      <label className="field"><span>背景 (+0x00 / +0x04)</span>
        <select value={key} onChange={(e) => {
          const b = LANAI_BATTLE_BACKGROUNDS.find((x) => lanaiBackgroundKey(x.archive, x.entry) === e.target.value);
          if (b) edit(() => { t.setU32(row, LANAI_BF.archive, b.archive); t.setU32(row, LANAI_BF.entry, b.entry); });
        }}>
          {!known && <option value={key}>{lanaiBackgroundName(archive, entry)}</option>}
          {LANAI_BATTLE_BACKGROUNDS.map((b) => {
            const k = lanaiBackgroundKey(b.archive, b.entry);
            return <option key={k} value={k}>{lanaiBackgroundName(b.archive, b.entry)}</option>;
          })}
        </select>
      </label>
      <div className="field">
        <span>戦闘の BGM (+0x08)</span>
        {sounds
          ? <SoundButton game={session} sounds={sounds} value={bgm} kind="bgm" max={MAX_SOUND} title="戦闘の BGM を選ぶ" onChange={(v) => edit(() => t.setU32(row, LANAI_BF.bgm, v))} />
          : <span>{`サウンド ${bgm}`}</span>}
      </div>
      <div className="muted small">
        {users.length > 1
          ? <>{`この行を使う ${users.length} か所 (`}{users.slice(0, 12).map((u, i) => <span key={i}>{i ? '、' : ''}{u.href ? <a href={u.href}>{u.label}</a> : u.label}</span>)}{users.length > 12 ? ' …' : ''}{') の背景と BGM がまとめて変わります。'}</>
          : '背景と BGM は 1 行で一緒に決まります。'}
        {' 背景のモデルの一覧は 52120000 と F0F40000 (末尾の 8 件) の btmp_*。'}
      </div>
    </div>
  );
}

/** Group page: which table and row the group's battles use (+0x69 bit3, +0x00), and that row. */
export function LanaiGroupBattleField({ session, maps, row, edited }: { session: LanaiSession; maps: LanaiMaps; row: number; edited: () => void }): ReactNode {
  const sounds = useSounds(session);
  const g = maps.monsterGroup!;
  const f = lanaiGroupBattleField(session, maps, row);
  const edit = (fn: () => void): void => {
    fn();
    edited();
  };
  const flags = g.u8(row, LANAI_MG_FLAGS);
  const setContents = (on: boolean): void => edit(() => {
    g.setU8(row, LANAI_MG_FLAGS, on ? flags | LANAI_MG_FIELD_CONTENTS : flags & ~LANAI_MG_FIELD_CONTENTS);
    // keep a value the new table has
    const t = lanaiBattleFieldTable(session, maps, on);
    if (t?.rows && !lanaiBattleFieldRow(t, g.u32(row, LANAI_MG_FIELD)).found) g.setU32(row, LANAI_MG_FIELD, t.rowId(0));
  });
  const users = f.row >= 0 ? lanaiBattleFieldUses(session, maps, f.contents, (r) => lanaiGroupHref(maps.content.index, r)).get(f.row) ?? [] : [];
  const contentsTable = lanaiBattleFieldTable(session, maps, true);
  return (
    <>
      <div className="row">
        <label className="field"><span>表 (+0x69 bit3)</span>
          <select value={f.contents ? 1 : 0} onChange={(e) => setContents(e.target.value === '1')}>
            <option value={0}>master の BattleField</option>
            <option value={1} disabled={!contentsTable}>このコンテンツの BattleFieldContents</option>
          </select>
        </label>
        <label className="field"><span>戦闘の背景と BGM (+0x00)</span>
          {f.table ? <BattleFieldSelect t={f.table} value={f.value} sounds={sounds} onChange={(v) => edit(() => g.setU32(row, LANAI_MG_FIELD, v))} /> : <span className="muted">表がありません</span>}
        </label>
      </div>
      {f.table && f.row >= 0 && (
        <>
          <BattleFieldRowEditor session={session} sounds={sounds} t={f.table} row={f.row} edit={edit} users={users} />
          {users.length > 1 && (
            <button title="この行を写した新しい行を作り、この群れだけがそれを使うようにします" onClick={() => edit(() => {
              const t = f.table!;
              const n = t.addRow(f.row);
              g.setU32(row, LANAI_MG_FIELD, t.rowId(n));
            })}>この群れ用に行を写す</button>
          )}
        </>
      )}
      <p className="muted small">
        {'歩いて出会う敵とのボス戦・ふつうの戦闘は、どちらもこの行の背景と BGM になります (BGM を指定して始める一部の戦闘を除く)。値が表にないときは、その表の行 0 です。'}
        {f.contents ? '' : ' master の BattleField はすべてのコンテンツで共有です。'}
      </p>
    </>
  );
}

/** Map page: the map's sounds (its MapData row) and the battle field it starts with (its MapResource row). */
export function LanaiMapBattlePanel({ session, maps, mapData, resource, edit }: {
  session: LanaiSession;
  maps: LanaiMaps;
  mapData: number;
  resource: number;
  edit: (f: () => void) => void;
}): ReactNode {
  const sounds = useSounds(session);
  const md = maps.contentTable('MapData');
  const res = maps.contentTable('MapResource');
  const bf = lanaiBattleFieldTable(session, maps, true);
  const hasMd = !!md && mapData >= 0 && mapData < md.rows;
  const hasRes = !!res && resource >= 0 && resource < res.rows;
  return (
    <div className="add-panel">
      <h3>BGM・戦闘</h3>
      {hasMd && LANAI_MAP_SOUNDS.map((s) => {
        const v = md!.u16(mapData, s.offset);
        return (
          <div key={s.offset} className="field" title={s.note}>
            <span>{`${s.label} (+0x${s.offset.toString(16).toUpperCase().padStart(2, '0')})`}</span>
            {sounds
              ? <SoundButton game={session} sounds={sounds} value={v} kind={s.kind} max={MAX_SOUND} title={`${s.label} を選ぶ`} onChange={(n) => edit(() => md!.setU16(mapData, s.offset, n))} />
              : <span>{`サウンド ${v}`}</span>}
          </div>
        );
      })}
      {hasRes && bf && (
        <label className="field"><span>入ったときの戦闘の背景 (MapResource +0x10)</span>
          <BattleFieldSelect t={bf} value={res!.u32(resource, LANAI_RESOURCE_BATTLE_FIELD)} sounds={sounds} none="0: 群れの行"
            onChange={(v) => edit(() => res!.setU32(resource, LANAI_RESOURCE_BATTLE_FIELD, v))} />
        </label>
      )}
      <p className="muted small">
        {hasMd ? `MapData 行 ${mapData} の欄 (同じ行を使うマップで共有)。` : 'MapData が見つかりません。'}
        {' フィールドの BGM はセーブの曲の指定があればそちらが鳴ります。'}
        {'歩いて出会う戦闘とボス戦の背景・BGM は群れ (MonsterGroup +0x00) の行で決まり、MapResource +0x10 は群れで引き直さない戦闘にだけ効きます (推定)。群れのページで変えられます。'}
      </p>
    </div>
  );
}
