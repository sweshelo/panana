// RPG3's save values (#/flags/<values.N | flags.N | key.N>, #87; naauao oahu/story.md §3): the keys of flagData.bin,
// and the story values 0xF9 / flags 0xFA split by the dungeons' ranges (mapGroup +0x26〜+0x2C). For each value: its
// name (kept with the edits; the event inspector picks values by it), the EventObject conditions and the code that
// read it, the code that writes it (immediates editable, code.ips), and its value in the preview state the map page
// shows the events with.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { fnLabel } from '../game/scriptasm';
import { Count, NumberInput, useActiveRow, useEdits, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { NeedsUpdate } from './CodePage';
import type { OahuEventEntry } from './events';
import { oahuDungeonLabel } from './MapPage';
import type { OahuSession } from './session';
import { conditionReads, emptyStoryState, OAHU_KEY, oahuRangeOf, siteTargets, valueLabel, valueNameKey, type ValueKind } from './story';
import { EventLink, useEventEntries, useSiteOwners, ValueName, WriteSiteTable } from './StoryParts';

type Sel = { kind: ValueKind; index: number } | { kind: 'key'; index: number };

const KEY_NOTES: Record<number, string> = {
  [OAHU_KEY.residents]: '住人・島の一覧と推定 (EventObject の条件 0x17 / 0x18 が読む)',
  [OAHU_KEY.dungeon]: '今のダンジョン (mapGroup の行、FUN_004EE968)',
  [OAHU_KEY.step]: 'ストーリーの段階 (ナビの行、ストーリーのページ)',
  [OAHU_KEY.values]: '物語の値 (u8)。全体 = 0〜45、以降はダンジョンごと',
  [OAHU_KEY.flags]: 'フラグ (1 bit)。全体 = 0〜19、以降はダンジョンごと',
  [OAHU_KEY.hint]: 'ナビのヒントの番号',
};

function parseSel(arg: string | undefined): Sel | undefined {
  const m = arg?.match(/^(values|flags|key)\.(\d+)$/);
  return m ? { kind: m[1] as Sel['kind'], index: Number(m[2]) } : undefined;
}
const selKey = (s: Sel): string => `${s.kind}.${s.index}`;

interface Reader {
  e: OahuEventEntry;
  field: 'appear' | 'gone';
  text: string;
}

export function OahuFlagPage({ session, arg, onAddUpdate }: { session: OahuSession; arg: string | undefined; onAddUpdate: () => void }): ReactNode {
  const [rev, edited] = useEdits();
  const { keys, ranges, writes, reads } = session.story();
  const entries = useEventEntries(session);
  const owners = useSiteOwners(entries, writes);
  const code = session.code?.code ?? null;
  const [show, setShow] = useState<'values' | 'flags' | 'key'>('values');
  const [dungeon, setDungeon] = useState(0);
  const [query, setQuery] = useState('');
  const counts: Record<ValueKind, number> = { values: keys[OAHU_KEY.values]?.count ?? 0, flags: keys[OAHU_KEY.flags]?.count ?? 0 };
  const selected = useSticky(parseSel(arg), (s) => (s.kind === 'key' ? s.index < keys.length : s.index < counts[s.kind]), () => ({ kind: 'values', index: 4 }) as Sel);
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selKey(selected));

  /** Readers of each element: the EventObject conditions (by the dungeon of their row) and the code's getter calls. */
  const readers = useMemo(() => {
    const out = new Map<string, Reader[]>();
    for (const e of entries ?? [])
      for (const c of e.conditions)
        for (const t of conditionReads(code, ranges, c.kind, c.v1, c.v2, e.dungeon)) {
          const k = valueNameKey(t.kind, t.index);
          out.set(k, [...(out.get(k) ?? []), { e, field: c.field === 0x53 ? 'appear' : 'gone', text: c.text }]);
        }
    return out;
  }, [entries, code, ranges]);
  const codeReads = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const r of reads) for (const i of r.indices) out.set(valueNameKey(r.kind, i), [...(out.get(valueNameKey(r.kind, i)) ?? []), r.fn]);
    return out;
  }, [reads]);
  const writers = useMemo(() => {
    const out = new Map<string, typeof writes>();
    for (const s of writes) {
      const here = (owners.get(s.at) ?? []).map((e) => e.dungeon);
      for (const t of siteTargets(s, ranges, here)) out.set(valueNameKey(t.kind, t.index), [...(out.get(valueNameKey(t.kind, t.index)) ?? []), s]);
    }
    return out;
  }, [writes, owners, ranges]);
  const free = (kind: ValueKind, i: number): boolean => !!code && !!entries && !readers.has(valueNameKey(kind, i)) && !codeReads.has(valueNameKey(kind, i)) && !writers.has(valueNameKey(kind, i));

  const q = query.trim();
  const g = ranges[dungeon];
  const items: Sel[] = show === 'key'
    ? keys.filter((k) => k.count).map((k) => ({ kind: 'key', index: k.key }))
    : g ? Array.from({ length: g[show][1] }, (_, i) => ({ kind: show, index: g[show][0] + i })) : [];
  const shown = items.filter((s) => {
    if (!q) return true;
    const name = s.kind === 'key' ? KEY_NOTES[s.index] ?? '' : session.storyNames[valueNameKey(s.kind, s.index)] ?? '';
    return name.includes(q) || String(s.index) === q;
  });
  return (
    <div className="book">
      <div className="book-side">
        <div className="row">
          <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="values">物語の値 0xF9</option>
            <option value="flags">フラグ 0xFA</option>
            <option value="key">セーブのキー (flagData.bin)</option>
          </select>
          {show !== 'key' && (
            <select value={dungeon} onChange={(e) => setDungeon(Number(e.target.value))}>
              {ranges.filter((r) => r[show][1]).map((r) => <option key={r.dungeon} value={r.dungeon}>{r.dungeon ? `${oahuDungeonLabel(session, r.dungeon)} (${r[show][1]})` : `全体 (${r[show][1]})`}</option>)}
            </select>
          )}
          <input type="search" placeholder="名前・番号" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {!code && <div className="warn-box">書く所・コードが読む所と、プレビューには Update が要ります。<button onClick={onAddUpdate}>Update を追加…</button></div>}
        <StatePanel session={session} onEdit={edited} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={items.length} />
          <table className="book-table">
            <thead><tr><th>#</th><th>名前</th>{show !== 'key' && <><th>読む</th><th>書く</th></>}</tr></thead>
            <tbody>
              {shown.map((s) => {
                const k = selKey(s);
                if (s.kind === 'key') {
                  const key = keys[s.index]!;
                  return (
                    <tr key={k} className={k === selKey(selected) ? 'active' : ''} onClick={() => (location.hash = `#/flags/${k}`)}>
                      <td className="num muted">{`0x${s.index.toString(16).toUpperCase()}`}</td>
                      <td className="small">{KEY_NOTES[s.index] ?? <span className="muted">{`${key.bits} bit × ${key.count}`}</span>}</td>
                    </tr>
                  );
                }
                const nk = valueNameKey(s.kind, s.index);
                return (
                  <tr key={k} className={k === selKey(selected) ? 'active' : ''} onClick={() => (location.hash = `#/flags/${k}`)}>
                    <td className="num muted">{s.index}</td>
                    <td>{session.storyNames[nk] ?? ''}{free(s.kind, s.index) && <span className="muted small"> 空き</span>}</td>
                    <td className="num muted">{(readers.get(nk)?.length ?? 0) + (codeReads.get(nk)?.length ?? 0) || ''}</td>
                    <td className="num muted">{writers.get(nk)?.length || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" key={`${selKey(selected)}.${rev}`}>
        {selected.kind === 'key'
          ? <KeyDetail session={session} k={selected.index} />
          : (
            <ValueDetail session={session} kind={selected.kind} index={selected.index} readers={readers.get(valueNameKey(selected.kind, selected.index)) ?? []}
              codeReads={codeReads.get(valueNameKey(selected.kind, selected.index)) ?? []} writes={writers.get(valueNameKey(selected.kind, selected.index)) ?? []}
              owners={owners} free={free(selected.kind, selected.index)} loading={!entries} onAddUpdate={onAddUpdate} onEdit={edited} />
          )}
      </div>
    </div>
  );
}

function KeyDetail({ session, k }: { session: OahuSession; k: number }): ReactNode {
  const key = session.story().keys[k]!;
  return (
    <>
      <div className="book-head"><h2>{`セーブのキー 0x${k.toString(16).toUpperCase()}`}</h2><span className="muted">{`flagData.bin の行 ${k}`}</span></div>
      <p>{KEY_NOTES[k] ?? <span className="muted">意味は未解析です。</span>}</p>
      <table className="enc-table small"><tbody>
        <tr><td>ビット数</td><td>{key.bits}</td></tr>
        <tr><td>要素の数</td><td>{key.count}</td></tr>
        <tr><td>最大値</td><td>{key.max || '制限なし'}</td></tr>
      </tbody></table>
      {(k === OAHU_KEY.values || k === OAHU_KEY.flags) && <p><a href={`#/flags/${k === OAHU_KEY.values ? 'values' : 'flags'}.0`}>要素の一覧を見る</a></p>}
      {k === OAHU_KEY.step && <p><a href="#/story">ストーリーのページで段階を見る</a></p>}
    </>
  );
}

function ValueDetail({ session, kind, index, readers, codeReads, writes, owners, free, loading, onAddUpdate, onEdit }: {
  session: OahuSession;
  kind: ValueKind;
  index: number;
  readers: Reader[];
  codeReads: number[];
  writes: ReturnType<OahuSession['story']>['writes'];
  owners: ReturnType<typeof useSiteOwners>;
  free: boolean;
  loading: boolean;
  onAddUpdate: () => void;
  onEdit: () => void;
}): ReactNode {
  const { ranges } = session.story();
  const g = oahuRangeOf(ranges, kind, index);
  const local = g ? index - g[kind][0] : index;
  const state = session.storyState;
  return (
    <>
      <div className="book-head">
        <h2>{valueLabel(kind, index)}</h2>
        <span className="muted">{g?.dungeon ? `${oahuDungeonLabel(session, g.dungeon)} の${kind === 'values' ? '値' : 'フラグ'} ${local} (条件では「ダンジョン ${g.dungeon} の${kind === 'values' ? '値' : 'フラグ'} ${local}」)` : `全体の${kind === 'values' ? '物語の値' : 'フラグ'}`}</span>
      </div>
      <label className="field"><span>名前<InfoTip text="名前は編集内容といっしょに保存され、EventObject の条件の欄で値を名前で選べます。ゲームには書き出されません。" /></span><ValueName session={session} kind={kind} index={index} onEdit={onEdit} /></label>
      {free && <p className="warn-box">どのイベントの条件も、コードも読み書きしていない値です。MOD の物語に使えそうです (ゲームでの確認はまだ)。</p>}
      {state && (
        <label className="field"><span>プレビューの値</span>
          <NumberInput value={(kind === 'values' ? state.values : state.flags)[index] ?? 0} min={0} max={kind === 'values' ? 255 : 1} onCommit={(v) => { (kind === 'values' ? state.values : state.flags)[index] = v; session.storyStateChanged(); onEdit(); }} />
        </label>
      )}
      <h3>{`読むイベント (出る・消える条件) ${readers.length || ''}`}</h3>
      {loading ? <div className="muted">読み込み中…</div> : readers.length ? (
        <ul className="small">{readers.map((r, i) => <li key={i}><EventLink session={session} e={r.e} />{` ${r.field === 'appear' ? '出る' : '消える'}: ${r.text}`}</li>)}</ul>
      ) : <div className="muted small">ありません</div>}
      <h3>書く所</h3>
      {session.code ? <WriteSiteTable session={session} sites={writes} owners={owners} valueOnly onEdit={onEdit} /> : <NeedsUpdate session={session} onAddUpdate={onAddUpdate} />}
      {codeReads.length > 0 && (
        <>
          <h3>コードが即値で読む所</h3>
          <p className="small">{[...new Set(codeReads)].map(fnLabel).join('、')}</p>
        </>
      )}
      <p className="muted small">書く所は、code.bin の中の書き込み関数 (FUN_001EE8F8 など) の呼び出しと、その前の即値から求めています。今のダンジョンの値・フラグを書く所は、その所を動かす EventObject の行のダンジョンで数えています。</p>
    </>
  );
}

/** The preview state: on / off, the step, the residents (0x49), reset. */
function StatePanel({ session, onEdit }: { session: OahuSession; onEdit: () => void }): ReactNode {
  const s = session.storyState;
  const set = (): void => {
    session.storyStateChanged();
    onEdit();
  };
  if (!session.code) return null;
  if (!s) return (
    <div className="row small">
      <button onClick={() => { const k = session.story().keys; session.storyState = emptyStoryState(k[OAHU_KEY.values]?.count, k[OAHU_KEY.flags]?.count); set(); }}>プレビューの状態を作る</button>
      <InfoTip text="段階と値を仮に決めると、マップのページで出る・消えるイベントを確かめられます。" />
    </div>
  );
  const nonzero = s.values.filter((v) => v).length + s.flags.filter((v) => v).length;
  return (
    <div className="story-state small">
      <b>プレビューの状態</b>
      <label> 段階 <NumberInput value={s.step} min={0} max={0xffff} onCommit={(v) => { s.step = v; set(); }} /></label>
      <label><input type="checkbox" checked={s.residents} onChange={(e) => { s.residents = e.target.checked; set(); }} /> 0x49 はすべて真</label>
      <span className="muted">{` 0 でない値・フラグ ${nonzero} 個`}</span>
      <button onClick={() => { s.values.fill(0); s.flags.fill(0); set(); }}>すべて 0 に</button>
      <button onClick={() => { session.storyState = null; set(); }}>やめる</button>
    </div>
  );
}

