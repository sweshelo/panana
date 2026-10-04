// RPG3's story page (#/story/<step>, #87; naauao oahu/story.md §1, §5): the navi table mapNavi.bin by step (save key
// 0x74), each row's title, destination and four hints editable (the master's rows are saved as diffs), and where
// the code sets the step (the immediates before FUN_00213010 / FUN_002ECE28, with the script rows that run them),
// whose values can be changed (code.ips; needs the Update).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { readField, writeField } from '../game/tabledef';
import { Count, ListFilter, NumberInput, useActiveRow, useEdits, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { hex8, u32 } from '../util/bytes';
import { NeedsUpdate } from './CodePage';
import type { OahuSession } from './session';
import { OAHU_STORY_STEPS } from './story';
import { MessageSlot, siteStep, useEventEntries, useSiteOwners, WriteSiteTable } from './StoryParts';
import { OAHU_MAP_NAVI } from './tables';

type Tab = 'story' | 'extra' | 'all';

const NAVI = 'mapNavi.bin';
const field = (key: string) => OAHU_MAP_NAVI.fields.find((f) => f.key === key)!;

export function OahuStoryPage({ session, arg, onAddUpdate }: { session: OahuSession; arg: string | undefined; onAddUpdate: () => void }): ReactNode {
  const [rev, edited] = useEdits();
  const t = session.master.table(NAVI);
  const texts = session.messages.texts;
  const { ranges, writes } = session.story();
  const entries = useEventEntries(session);
  const stepSites = useMemo(() => writes.filter((s) => s.kind === 'step' || s.kind === 'stepAction'), [writes]);
  const owners = useSiteOwners(entries, stepSites);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('story');
  const selected = useSticky(arg !== undefined ? Number(arg) : undefined, (n) => Number.isInteger(n) && n >= 0 && n < t.rows, () => 1);
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  const placeName = useMemo(() => {
    const out = new Map<number, string>();
    for (const g of ranges) if (g.place && !out.has(g.place)) out.set(g.place, `${texts.preview(g.nameId, true) || `mapGroup ${g.dungeon}`}${session.maps.dungeons[g.dungeon]?.code ? ` (${session.maps.dungeons[g.dungeon]!.code})` : ''}`);
    return out;
  }, [ranges, texts, session]);
  /** step -> the sites that set it (with the edits). */
  const byStep = useMemo(() => {
    const out = new Map<number, typeof stepSites>();
    for (const s of stepSites) for (const v of siteStep(session, s)) out.set(v, [...(out.get(v) ?? []), s]);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSites, session, rev]);
  /** Who uses each navi message (title / hints of which steps). */
  const users = useMemo(() => {
    const out = new Map<number, string[]>();
    for (let r = 0; r < t.rows; r++) {
      const row = t.row(r);
      for (const [o, label] of [[0x0c, '見出し'], [0x10, 'ヒント 1'], [0x18, 'ヒント 2'], [0x20, 'ヒント 3'], [0x28, 'ヒント 4']] as const) {
        const id = u32(row, o);
        if (id) out.set(id, [...(out.get(id) ?? []), `段階 ${r} ${label}`]);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, rev]);
  const q = query.trim();
  const rows = Array.from({ length: t.rows }, (_, r) => r).filter((r) => {
    if (tab === 'story' && r >= OAHU_STORY_STEPS) return false;
    if (tab === 'extra' && r < OAHU_STORY_STEPS) return false;
    if (!q) return true;
    const row = t.row(r);
    const hay = [String(r), texts.preview(u32(row, 0x0c), true) ?? '', placeName.get(u32(row, 4)) ?? '', ...[0, 1, 2, 3].map((i) => texts.preview(u32(row, 0x10 + i * 8), true) ?? '')];
    return hay.some((h) => h.includes(q));
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="見出し・目的地・ヒントで検索" filter={tab} setFilter={setTab}
          options={[['story', 'ストーリー (段階 0〜99)'], ['extra', 'やりこみのヒント (100〜)'], ['all', 'すべて']]} />
        {!session.code && <div className="warn-box">段階を書く所 (code.bin) を見るには Update が要ります。<button onClick={onAddUpdate}>Update を追加…</button></div>}
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={t.rows} unit="行" />
          <table className="book-table">
            <thead><tr><th>段階</th><th>見出し</th><th>目的地</th>{session.code && <th className="nowrap">書く所</th>}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const row = t.row(r);
                const changed = session.master.originalRow(NAVI, r).some((b, i) => b !== row[i]);
                return (
                  <tr key={r} className={r === selected ? 'active' : ''} onClick={() => (location.hash = `#/story/${r}`)}>
                    <td className="num muted">{r}{changed && <span className="edited-mark"> ●</span>}</td>
                    <td className="msg-cell">{texts.preview(u32(row, 0x0c), true) || <span className="muted">—</span>}</td>
                    <td className="muted small nowrap">{placeName.get(u32(row, 4)) ?? ''}</td>
                    {session.code && <td className="num muted">{byStep.get(r)?.length || ''}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        <StepDetail key={selected} session={session} step={selected} placeName={placeName} users={users} sites={byStep.get(selected) ?? []} owners={owners} onAddUpdate={onAddUpdate} onEdit={edited} />
      </div>
    </div>
  );
}

function StepDetail({ session, step, placeName, users, sites, owners, onAddUpdate, onEdit }: {
  session: OahuSession;
  step: number;
  placeName: Map<number, string>;
  users: Map<number, string[]>;
  sites: ReturnType<OahuSession['story']>['writes'];
  owners: ReturnType<typeof useSiteOwners>;
  onAddUpdate: () => void;
  onEdit: () => void;
}): ReactNode {
  const t = session.master.table(NAVI);
  const row = t.row(step);
  const original = session.master.originalRow(NAVI, step);
  const edited = (): void => {
    session.scheduleSave();
    onEdit();
  };
  const set = (key: string, v: number): void => {
    writeField(row, field(key), v);
    edited();
  };
  const num = (key: string, max: number): ReactNode => {
    const f = field(key);
    const v = readField(row, f), o = readField(original, f);
    return (
      <label className="field">
        <span>{f.label}{f.note && <InfoTip text={f.note} />}</span>
        <NumberInput value={v} min={0} max={max} className={`num-input${v !== o ? ' edited' : ''}`} title={v !== o ? `元の値 ${o}` : undefined} onCommit={(x) => set(key, x)} />
        {f.hex && <span className="mono muted small"> {f.type === 'u32' ? hex8(v).toUpperCase() : `0x${v.toString(16).toUpperCase()}`}</span>}
      </label>
    );
  };
  const extra = step >= OAHU_STORY_STEPS;
  const place = u32(row, 4);
  return (
    <>
      <div className="book-head">
        <h2>{`${extra ? 'やりこみのヒント' : '段階'} ${step}`}</h2>
        <span className="muted">{`mapNavi.bin の行 ${step}${extra ? ' (段階が 100 以上のとき、FUN_001F0EF8 が選んで段階に書く)' : ' (セーブのキー 0x74 がこの値のとき R ボタンのナビに出る)'}`}</span>
      </div>
      <h3>見出し</h3>
      <MessageSlot session={session} id={u32(row, 0x0c)} users={users} onPick={(id) => set('title', id)} onEdit={edited} />
      <h3>目的地</h3>
      <label className="field">
        <span>場所<InfoTip text={field('place').note!} /></span>
        <select value={place} className={place !== u32(original, 4) ? 'edited' : ''} onChange={(e) => set('place', Number(e.target.value))}>
          <option value={0}>なし</option>
          {[...placeName].map(([h, name]) => <option key={h} value={h}>{name}</option>)}
          {place && !placeName.has(place) && <option value={place}>{hex8(place).toUpperCase()}</option>}
        </select>
      </label>
      <h3>ヒント</h3>
      <p className="muted small">R ボタンを押すたびに 1 から順に出ます (ヒントの番号はセーブのキー 0xFC。段階が変わると 0 に戻る)。</p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="hint-slot">
          <h4>{`ヒント ${i + 1}`}</h4>
          <MessageSlot session={session} id={u32(row, 0x10 + i * 8)} users={users} onPick={(id) => set(`hint${i}`, id)} onEdit={edited} />
          <div className="row">{num(`motion${i}`, 0xffff)}{num(`face${i}`, 255)}{num(`mode${i}`, 255)}</div>
        </div>
      ))}
      <details>
        <summary className="small">ほかの欄</summary>
        {num('sound', 0x7fffffff)}
        {num('screen', 0x7fffffff)}
      </details>
      <h3>{`この段階${extra ? 'の行' : ''}を書く所`}</h3>
      {!session.code ? <NeedsUpdate session={session} onAddUpdate={onAddUpdate} /> : (
        <>
          <WriteSiteTable session={session} sites={sites} owners={owners} valueOnly onEdit={onEdit} />
          <p className="muted small">
            段階は code.bin のスクリプトの即値 (<code>mov r0, #段階</code> → FUN_00213010) で書かれます。値を変えると書き出しの exefs/code.ips に入ります。
            「段階が小さいときだけ」の所は、前の <code>cmp r0, #段階</code> も同じ値に変わるので、段階は前にしか進まないままです。
            EventObject の行はイベント一覧で、関数はコードのページで見られます。
          </p>
          {!sites.length && <p className="muted small">{step === 0 ? '段階 0 はセーブの初期値で、書く所はありません。' : 'この段階を即値で書く所は見つかりませんでした (使われていない段階か、計算した値で書かれる)。'}</p>}
        </>
      )}
    </>
  );
}
