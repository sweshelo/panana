// RPG FREE!'s encounter groups (#/groups/<content>.<row>), built from the same parts as RPG2's and RPG3's group pages
// (ui/GroupDetail): the content's MonsterGroup rows with the photos of their monsters, and one row's 25 monster slots
// (+0x04〜+0x64, MonsterParameter row IDs; naauao lanai/map.md §5.7), the maps that use it, a copy into a new row and
// the bytes not read yet. Each content's archive has its own MonsterGroup; edits are written with the content's tables.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { HexInput, RawBytes } from '../editor/fields';
import { useScrollTop, useSticky } from '../ui/book';
import { Board, EmptyBoard } from '../ui/Board';
import { GroupListView } from '../ui/GroupDetail';
import { useAsync } from '../ui/useAsync';
import { hex8, u32 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiMapHref } from './MapPage';
import { DEFAULT_GROUP_LABEL, groupMonsterRows, lanaiGroupHref } from './MapParts';
import { lanaiMaps, LANAI_MG_SLOT0, LANAI_MG_SLOTS, type LanaiMaps, type LanaiMonsterGroupRow } from './maps';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiMonsterName, lanaiMonsterStats } from './monsterBook';
import { lanaiMonsterHref, lanaiMonsters } from './monsters';
import { lanaiMonsterIcon, LanaiMonsterPicker } from './pickers';
import type { LanaiSession } from './session';

export function LanaiGroupPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const m = arg ? /^(\d+)(?:\.(\d+))?$/.exec(arg) : null;
  const content = useSticky<number>(m ? Number(m[1]) : undefined, (i) => i < contents.length, () => (contents.length > 1 ? 1 : 0));
  const c = contents[content]!;
  const loaded = useAsync(() => lanaiMaps(session, c), [session, c]);
  return (
    <div className="book">
      {!loaded ? <p className="muted" style={{ padding: 16 }}>群れを読み込み中…</p>
        : loaded instanceof Error ? <Groups key={c.index} session={session} contents={contents} content={c} maps={null} error={loaded.message} row={undefined} />
        : <Groups key={c.index} session={session} contents={contents} content={c} maps={loaded} row={m?.[2] ? Number(m[2]) : undefined} />}
    </div>
  );
}

/** The contents to pick from, as the stage page names them. */
function ContentSelect({ contents, content }: { contents: LanaiContent[]; content: LanaiContent }): ReactNode {
  return (
    <select className="grow" value={content.index} title="群れ (MonsterGroup) はコンテンツごとの表です" onChange={(e) => (location.hash = lanaiGroupHref(Number(e.target.value)))}>
      {contents.map((c) => <option key={c.index} value={c.index}>{`${c.index}: ${contentTitle(c)}`}</option>)}
    </select>
  );
}

function Groups({ session, contents, content, maps, row, error }: {
  session: LanaiSession;
  contents: LanaiContent[];
  content: LanaiContent;
  maps: LanaiMaps | null;
  row: number | undefined;
  error?: string;
}): ReactNode {
  const revision = useLanaiRevision(session);
  const detail = useRef<HTMLDivElement>(null);
  const t = maps?.monsterGroup;
  const groups = useMemo(() => maps?.monsterGroups() ?? [], [maps, revision]);
  // the maps' current documents (edits of the maps included)
  const uses = useMemo(() => maps?.monsterGroupUses() ?? new Map(), [maps, revision]);
  const selected = useSticky(row, (r) => r >= 0 && r < groups.length, () => (groups.length > 1 ? 1 : 0));
  useScrollTop(detail, selected);
  const list = lanaiMonsters(session);
  const changed = (g: LanaiMonsterGroupRow): boolean => !!t && (g.row >= t.originalRows || t.rowChanged(g.row));
  const used = (g: LanaiMonsterGroupRow): boolean => (uses.get(g.row)?.length ?? 0) > 0;
  const g = groups[selected];
  return (
    <>
      <div className="book-side">
        <div className="row"><ContentSelect contents={contents} content={content} /></div>
        {!maps || !t ? <p className="muted small">{error ?? 'このコンテンツには MonsterGroup の表がありません。'}</p> : (
          <GroupListView
            groups={groups}
            monsters={(x) => groupMonsterRows(maps, x)}
            name={(r) => list[r]?.name}
            icon={(r, i) => <Fragment key={i}>{lanaiMonsterIcon(session, r)}</Fragment>}
            changed={changed}
            filters={[
              ['all', 'すべて', () => true],
              ['used', 'マップで使う', used],
              ['unused', 'どのマップも使わない', (x) => !used(x)],
              ['changed', '変更した', changed],
            ]}
            extra={{ head: 'マップ', cell: (x) => uses.get(x.row)?.length || '' }}
            selected={selected}
            onSelect={(x) => (location.hash = lanaiGroupHref(content.index, x.row))}
          />
        )}
      </div>
      <div className="book-detail" ref={detail}>
        {maps && t && g && <LanaiGroupDetail key={`${content.index}.${selected}`} session={session} maps={maps} content={content} g={g} />}
      </div>
    </>
  );
}

export function LanaiGroupDetail({ session, maps, content, g }: { session: LanaiSession; maps: LanaiMaps; content: LanaiContent; g: LanaiMonsterGroupRow }): ReactNode {
  const t = maps.monsterGroup!;
  const [picking, setPicking] = useState<number | null>(null);
  const mp = session.need('MonsterParameter');
  const added = g.row >= t.originalRows;
  const uses = maps.monsterGroupUses().get(g.row) ?? [];
  const edited = (): void => {
    maps.changed();
    session.edited();
  };
  /** Write the u32 at `offset` of the row. */
  const set = (offset: number, v: number): void => {
    t.setU32(g.row, offset, v >>> 0);
    edited();
  };
  /** An empty slot's value: what the row's other empty slots hold (0 or 0x80000000), else 0. */
  const empty = g.slots.find((v) => !v || v === 0x80000000) ?? 0;
  const original = t.originalRow(g.row);
  const slotChanged = (i: number): boolean => !original || u32(original, LANAI_MG_SLOT0 + i * 4) !== g.slots[i];
  const tailAt = LANAI_MG_SLOT0 + LANAI_MG_SLOTS * 4;
  return (
    <>
      <div className="book-head">
        <h2>{`群れ #${g.row}`}</h2>
        <span className="muted">{`${contentTitle(content)} の MonsterGroup・行 ID ${hex8(g.id).toUpperCase()}${added ? '  (追加した行)' : ''}`}</span>
      </div>
      <p className="muted small book-desc">
        {g.row === 0 ? `${DEFAULT_GROUP_LABEL}。区画 6 の値が表にないとき、ゲームはこの行の群れを使います。` : ''}
        群れは +0x04 から 25 個のモンスターの枠 (MonsterParameter の行 ID) を持ちます。枠の並び・重複・+0x68 以降のバイトの意味 (重み・数など) はまだ分かっていません。
        変更はこのコンテンツのアーカイブの MonsterGroup として書き出されます。
      </p>
      <div className="row">
        <button title="この群れを写した新しい行を作ります。マップの区画 6 や宝箱の戦闘で選べます" onClick={() => {
          const n = t.addRow(g.row);
          edited();
          location.hash = lanaiGroupHref(content.index, n);
        }}>写して新しい群れを作る</button>
        {!added && t.rowChanged(g.row) && <button onClick={() => { t.revertRow(g.row); edited(); }}>この群れの変更を元に戻す</button>}
      </div>
      <h3>{`モンスターの枠 (${g.monsters.length} / ${g.slots.length})`}</h3>
      <div className="slot-list lanai-group-slots">
        {g.slots.map((v, i) => {
          const r = v && v !== 0x80000000 ? mp.find(v) : -1;
          const label = <span className="muted small slot-index">{i + 1}</span>;
          if (!v || v === 0x80000000) return <div key={i} className="slot-row">{label}<EmptyBoard label="＋" title={`枠 ${i + 1} (+0x${(LANAI_MG_SLOT0 + i * 4).toString(16).toUpperCase()}) にモンスターを入れる`} onClick={() => setPicking(i)} /></div>;
          const s = r >= 0 ? lanaiMonsterStats(session, r) : null;
          return (
            <div key={i} className="slot-row">
              {label}
              <Board icon={lanaiMonsterIcon(session, r, true)} name={r >= 0 ? lanaiMonsterName(session, r) : `${hex8(v).toUpperCase()} (MonsterParameter にない)`}
                sub={s ? `Lv${s.level}` : undefined} id={r >= 0 ? r : undefined} href={r >= 0 ? lanaiMonsterHref(r) : undefined}
                edited={slotChanged(i)} title="モンスターを選び直す" onClick={() => setPicking(i)} />
              <button className="small slot-remove" title="外す" onClick={() => set(LANAI_MG_SLOT0 + i * 4, empty)}>×</button>
            </div>
          );
        })}
      </div>
      <h3>{`使うマップ (${uses.length})`}</h3>
      {uses.length
        ? <table className="enc-table book-chests">
            <tbody>
              <tr><th>マップ</th><th>使い方</th></tr>
              {uses.map((u, i) => (
                <tr key={i}>
                  <td><a href={lanaiMapHref(content.index, u.map)}>{u.map}</a></td>
                  <td className="muted">{u.cells === 'map' ? 'マップの群れ (区画 6 のヘッダー)' : `セル ${u.cells} 個`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        : <div className="muted">このコンテンツのどのマップも使っていません (マップの右ペイン「敵 (区画 6)」や区画 6 のセルで選べます)。</div>}
      <details className="row-fields-box">
        <summary>{`MonsterGroup の行 ${g.row} の未解析の欄`}</summary>
        <label className="field"><span>+0x00 (小さな行 ID、意味は未解析)</span><HexInput value={g.kind} onChange={(v) => set(0, v)} /></label>
        <label className="field"><span>{`+0x${tailAt.toString(16).toUpperCase()}〜 (${g.tail.length} バイト)`}</span>
          <RawBytes bytes={g.tail} rows={4} onChange={(b) => {
            const row = t.row(g.row).slice();
            row.set(b, tailAt);
            t.setRow(g.row, row);
            edited();
          }} />
        </label>
      </details>
      {picking !== null && (
        <LanaiMonsterPicker session={session} current={Math.max(0, g.slots[picking] ? mp.find(g.slots[picking]!) : 0)} title={`枠 ${picking + 1} のモンスターを選ぶ`}
          onClose={() => setPicking(null)} onPick={(r) => { const i = picking; setPicking(null); set(LANAI_MG_SLOT0 + i * 4, mp.rowId(r)); }} />
      )}
    </>
  );
}
