// RPG FREE!'s encounter groups (#/groups/<content>.<row>), built from the same parts as RPG2's and RPG3's group pages
// (ui/GroupDetail): the content's MonsterGroup rows with the photos of their monsters, and one row's lists (leaders,
// mates, fixed formations: monsterGroup.ts) with their weights and count codes, the weights of the ways a battle is
// formed, the battle settings, the maps that use it and a copy into a new row. Each content's archive has its own
// MonsterGroup; edits are written with the content's tables.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { RawBytes } from '../editor/fields';
import { NumberInput, useScrollTop, useSticky } from '../ui/book';
import { GroupListView } from '../ui/GroupDetail';
import { Dialog } from '../ui/Dialog';
import { CopyRemoveButtons, NewRecordButton, type CopySpec } from '../ui/RecordButtons';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiMapHref } from './MapPage';
import { DEFAULT_GROUP_LABEL, groupMonsterRows, lanaiGroupHref } from './MapParts';
import { lanaiMaps, type LanaiMaps, type LanaiMonsterGroupRow } from './maps';
import {
  LANAI_MG_COUNT_CODES, LANAI_MG_FLAG_BITS, LANAI_MG_FLAGS, LANAI_MG_LIMIT, LANAI_MG_LISTS, LANAI_MG_MATE_LISTS, LANAI_MG_MATES, LANAI_MG_PATTERN,
  LANAI_MG_PATTERNS, lanaiCountLabel, lanaiMgOriginal, lanaiMgSlots, type LanaiMgList,
} from './monsterGroup';
import { LanaiGroupBattleField } from './BattleParts';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiMonsterName } from './monsterBook';
import { lanaiMonsterHref, lanaiMonsters } from './monsters';
import { lanaiMonsterIcon, LanaiMonsterPicker } from './pickers';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

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
  // the URL holds the selection (#/groups/<content>.<row>): picking a stage shows its list with nothing selected
  const selected = row !== undefined && row >= 0 && row < groups.length ? row : undefined;
  useScrollTop(detail, selected);
  const list = lanaiMonsters(session);
  const changed = (g: LanaiMonsterGroupRow): boolean => !!t && (g.row >= t.originalRows || t.rowChanged(g.row));
  const used = (g: LanaiMonsterGroupRow): boolean => (uses.get(g.row)?.length ?? 0) > 0;
  const g = selected === undefined ? undefined : groups[selected];
  return (
    <>
      <div className="book-side">
        <div className="row"><ContentSelect contents={contents} content={content} /></div>
        {maps && t && (
          <NewRecordButton copy={lanaiGroupCopy(maps, content)} current={selected ?? 0} onEdit={() => session.edited()} picker={(p) => (
            <Dialog title={p.title} onClose={p.onClose}>
              <div className="group-picker">
                <GroupListView groups={groups} monsters={(x) => groupMonsterRows(maps, x)} name={(r) => list[r]?.name}
                  icon={(r, i) => <Fragment key={i}>{lanaiMonsterIcon(session, r)}</Fragment>} changed={changed}
                  filters={[['all', 'すべて', () => true], ['used', 'マップで使う', used]]} selected={p.current} onSelect={(x) => p.onPick(x.row)} />
              </div>
            </Dialog>
          )} />
        )}
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
        {maps && t && !g && <p className="muted">左の一覧から群れを選んでください。</p>}
      </div>
    </>
  );
}

/** Copying a group to a new row of the content's MonsterGroup (the buttons of a group and the list's "＋ 新しい群れ"). */
function lanaiGroupCopy(maps: LanaiMaps, content: LanaiContent): CopySpec {
  return {
    noun: '群れ', can: true, info: 'この群れを写した新しい行を作ります。マップの区画 6 や宝箱の戦闘で選べます。',
    copy: (row) => { const n = maps.monsterGroup!.addRow(row); maps.changed(); return n; }, href: (n) => lanaiGroupHref(content.index, n),
  };
}

export function LanaiGroupDetail({ session, maps, content, g }: { session: LanaiSession; maps: LanaiMaps; content: LanaiContent; g: LanaiMonsterGroupRow }): ReactNode {
  const t = maps.monsterGroup!;
  const [picking, setPicking] = useState<{ offset: number; title: string } | null>(null);
  const mp = session.need('MonsterParameter');
  const added = g.row >= t.originalRows;
  const uses = maps.monsterGroupUses().get(g.row) ?? [];
  const edited = (): void => {
    maps.changed();
    session.edited();
  };
  const set32 = (offset: number, v: number): void => {
    t.setU32(g.row, offset, v >>> 0);
    edited();
  };
  const set8 = (offset: number, v: number): void => {
    t.setU8(g.row, offset, v & 0xff);
    edited();
  };
  const ed = (offset: number, size: 1 | 4): boolean => {
    const o = lanaiMgOriginal(t, g.row, offset, size);
    return o === undefined || o !== (size === 4 ? t.u32(g.row, offset) : t.u8(g.row, offset));
  };
  const pattern = LANAI_MG_PATTERNS.map((_, i) => t.u8(g.row, LANAI_MG_PATTERN + i));
  const patternTotal = pattern.reduce((a, b) => a + b, 0);
  const flags = t.u8(g.row, LANAI_MG_FLAGS);
  const ctx: SlotCtx = { session, t, row: g.row, set32, set8, ed, pick: (offset, title) => setPicking({ offset, title }) };
  return (
    <>
      <div className="book-head">
        <h2>{`群れ #${g.row}`}</h2>
        <span className="muted">{`${contentTitle(content)} の MonsterGroup・行 ID ${hex8(g.id).toUpperCase()}${added ? '  (追加した行)' : ''}`}</span>
      </div>
      <p className="muted small book-desc">
        {g.row === 0 ? `${DEFAULT_GROUP_LABEL}。区画 6 の値が表にないとき、ゲームはこの行の群れを使います。` : ''}
        マップのシンボルを出すとき、まず「編成の出方」の重みで出方を選び、A から重みに比例してリーダーを 1 体選びます (D / E ならその最初のモンスター)。
        戦闘ではリーダーが匹数のぶん出て、「リーダー + お供」なら、そのリーダーの枠が指すリスト (B か C) から重みでお供を選んで足します (リーダーと同じモンスターは除く)。D / E は並んだ全員が出ます。1 回の戦闘は 8 体まで。
        変更はこのコンテンツのアーカイブの MonsterGroup として書き出されます。
      </p>
      <div className="row">
        <CopyRemoveButtons copy={lanaiGroupCopy(maps, content)} from={g.row} onEdit={edited} remove={added ? {
          used: uses.map((u) => (u.cells === 'map' ? u.map : `${u.map} (セル ${u.cells} 個)`)),
          why: g.row === t.rows - 1 ? undefined : '消せるのは最後に追加した群れだけです',
          remove: () => t.removeLastRow(), next: lanaiGroupHref(content.index, g.row - 1),
        } : undefined} />
        {!added && t.rowChanged(g.row) && <button onClick={() => { t.revertRow(g.row); edited(); }}>この群れの変更を元に戻す</button>}
      </div>
      <h3>編成の出方 (+0x6A)</h3>
      <table className="enc-table group-slots">
        <tbody>
          <tr><th>出方</th><th>重み</th><th>割合</th></tr>
          {LANAI_MG_PATTERNS.map((label, i) => (
            <tr key={i} className={ed(LANAI_MG_PATTERN + i, 1) ? 'edited' : ''}>
              <td>{label}</td>
              <td><NumberInput value={pattern[i]!} min={0} max={255} onCommit={(v) => set8(LANAI_MG_PATTERN + i, v)} /></td>
              <td className="num">{patternTotal ? `${Math.round((pattern[i]! / patternTotal) * 100)}%` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!patternTotal && <div className="muted small">重みがすべて 0 なので、この群れの敵は出ません。</div>}
      <div className="book-cols group-cols">
        {LANAI_MG_LISTS.map((list) => <ListEditor key={list.key} ctx={ctx} list={list} />)}
      </div>
      <h3>戦闘の背景と BGM</h3>
      <LanaiGroupBattleField session={session} maps={maps} row={g.row} edited={edited} />
      <h3>戦闘の設定</h3>
      <div className="row">
        <label className="field"><span>戦闘回数の上限 (+0x68、0 = 無制限・推定)</span><NumberInput value={t.u8(g.row, LANAI_MG_LIMIT)} min={0} max={255} onCommit={(v) => set8(LANAI_MG_LIMIT, v)} /></label>
      </div>
      <div className="row">
        {LANAI_MG_FLAG_BITS.filter(([bit]) => bit !== 3).map(([bit, label]) => (
          <label key={bit} className="layer"><input type="checkbox" checked={!!(flags & (1 << bit))} onChange={(e) => set8(LANAI_MG_FLAGS, e.target.checked ? flags | (1 << bit) : flags & ~(1 << bit))} /> {label}</label>
        ))}
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
        <summary>{`MonsterGroup の行 ${g.row} のバイト`}</summary>
        <RawBytes bytes={t.row(g.row)} rows={6} onChange={(b) => { t.setRow(g.row, b); edited(); }} />
      </details>
      {picking && (
        <LanaiMonsterPicker session={session} current={Math.max(0, mp.find(t.u32(g.row, picking.offset)))} title={picking.title}
          onClose={() => setPicking(null)} onPick={(r) => { const o = picking.offset; setPicking(null); set32(o, mp.rowId(r)); }} />
      )}
    </>
  );
}

interface SlotCtx {
  session: LanaiSession;
  t: LanaiTable;
  row: number;
  set32: (offset: number, v: number) => void;
  set8: (offset: number, v: number) => void;
  /** Whether the field differs from the ROM's. */
  ed: (offset: number, size: 1 | 4) => boolean;
  pick: (offset: number, title: string) => void;
}

const COUNT_OPTIONS = Array.from({ length: LANAI_MG_COUNT_CODES }, (_, c): [number, string] => [c, `${c}: ${lanaiCountLabel(c)}`]);

/** One list of five slots: monster, weight (A to C) with its share, count code, and for A the mates' list. */
function ListEditor({ ctx, list }: { ctx: SlotCtx; list: LanaiMgList }): ReactNode {
  const { session, t, row, set32, set8, ed, pick } = ctx;
  const mp = session.need('MonsterParameter');
  const slots = lanaiMgSlots(t, row, list);
  const weighted = list.weight >= 0;
  const total = slots.reduce((a, s) => a + (s.id ? s.weight : 0), 0);
  const isA = list.key === 'A';
  return (
    <section>
      <h3>{list.label}</h3>
      <table className="enc-table group-slots">
        <tbody>
          <tr><th>モンスター</th>{weighted && <><th>重み</th><th>割合</th></>}<th>数</th>{isA && <th>お供</th>}<th></th></tr>
          {slots.map((s, i) => {
            const at = list.ids + i * 4;
            const r = s.id ? mp.find(s.id) : -1;
            const title = `${list.key}[${i}] (+0x${at.toString(16).toUpperCase()}) のモンスターを選ぶ`;
            const counts = s.count < LANAI_MG_COUNT_CODES ? COUNT_OPTIONS : [...COUNT_OPTIONS, [s.count, `${s.count}: 1 体`] as [number, string]];
            return (
              <tr key={i} className={ed(at, 4) ? 'edited' : ''}>
                <td>
                  {s.id ? (
                    <div className="row">
                      <button className="monster-pick" title="モンスターを選び直す" onClick={() => pick(at, title)}>
                        {lanaiMonsterIcon(session, r)}
                        <span>{r >= 0 ? lanaiMonsterName(session, r) : `${hex8(s.id).toUpperCase()} (表にない)`}</span>
                      </button>
                      {r >= 0 && <a href={lanaiMonsterHref(r)} title="モンスター図鑑で開く">↗</a>}
                    </div>
                  ) : <button className="small" onClick={() => pick(at, title)}>＋ 入れる</button>}
                </td>
                {weighted && (
                  <>
                    <td><NumberInput value={s.weight} min={0} max={255} onCommit={(v) => set8(list.weight + i, v)} /></td>
                    <td className="num">{s.id && total ? `${Math.round((s.weight / total) * 100)}%` : ''}</td>
                  </>
                )}
                <td>
                  <select value={s.count} onChange={(e) => set8(list.count + i, Number(e.target.value))}>
                    {counts.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                  </select>
                </td>
                {isA && (
                  <td>
                    <select value={t.u8(row, LANAI_MG_MATES + i)} onChange={(e) => set8(LANAI_MG_MATES + i, Number(e.target.value))}>
                      {LANAI_MG_MATE_LISTS.map((label, k) => <option key={k} value={k}>{label}</option>)}
                      {t.u8(row, LANAI_MG_MATES + i) > 2 && <option value={t.u8(row, LANAI_MG_MATES + i)}>{`値 ${t.u8(row, LANAI_MG_MATES + i)}`}</option>}
                    </select>
                  </td>
                )}
                <td>{!!s.id && <button title="外す (枠を 0 にする)" onClick={() => set32(at, 0)}>×</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
