// RPG3's event list (#/events/<dungeon>.<row>; naauao oahu/map.md §5), laid out like RPG2's (pages/events.tsx): every
// EventObject row with where the maps place it, its conditions, where an exit leads, and for scripts (kind 0x2E) the
// class the Update's code builds for it with the messages it shows (oahu/scripts.ts). The row is editable.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, ListFilter, useActiveRow, useSticky } from '../ui/book';
import { fnLabel } from '../game/scriptasm';
import { EventObjectEditor, pointLabel } from './EventObjectEditor';
import { oahuEventEntries, oahuEventKey, oahuKindName, type OahuEventEntry } from './events';
import { oahuDungeonLabel, oahuMapHref, useMaps } from './MapPage';
import { OAHU_LAYOUTS } from './maps';
import { OAHU_SCRIPT_KIND } from './scripts';
import type { OahuSession } from './session';

type Filter = 'all' | 'script' | 'exit' | 'cond' | 'unplaced' | 'changed';

/** MessageField_JP's ID range (the messages the scripts' code names). */
function fieldRange(session: OahuSession): [number, number] {
  const f = session.messages.texts.files.find((x) => x.name === 'MessageField_JP.gsmb');
  return f ? [f.gmsg.first, f.gmsg.last] : [40000, 49999];
}

export function OahuEventPage({ session, arg, onAddUpdate }: { session: OahuSession; arg: string | undefined; onAddUpdate: () => void }): ReactNode {
  const { maps } = session;
  const revision = useMaps(maps);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<OahuEventEntry[] | null>(null);
  const code = session.code?.code ?? null;
  // rebuilt when the maps change (records moved, rows edited)
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      oahuEventEntries(maps, code, fieldRange(session)).then((e) => live && setEntries(e));
    }, entries ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, code, session, revision]);
  const byKey = useMemo(() => new Map((entries ?? []).map((e) => [oahuEventKey(e), e])), [entries]);
  const selected = useSticky(arg, (k) => !entries || byKey.has(k), () => (entries?.[0] ? oahuEventKey(entries[0]) : ''));
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, `${selected} ${entries?.length}`);
  const texts = session.messages.texts;
  const firstMessage = (e: OahuEventEntry): string => {
    const id = e.scripts[0]?.cls.messages[0];
    return id !== undefined ? texts.preview(id, true) ?? '' : '';
  };
  const changed = (e: OahuEventEntry): boolean => {
    const d = maps.dungeons[e.dungeon];
    const o = d ? maps.originalEventRow(d, e.row) : null;
    return !!o && o.some((b, i) => b !== e.raw[i]);
  };
  const FILTERS: Record<Filter, (e: OahuEventEntry) => boolean> = {
    all: () => true,
    script: (e) => e.kind === OAHU_SCRIPT_KIND,
    exit: (e) => !!e.dest,
    cond: (e) => e.conditions.length > 0,
    unplaced: (e) => !e.places.length,
    changed,
  };
  const q = query.trim();
  const rows = (entries ?? []).filter((e) => {
    if (!e.kind || !FILTERS[filter](e)) return false;
    if (!q) return true;
    const hay = [oahuDungeonLabel(session, e.dungeon), oahuKindName(e.kind), ...e.places.map((p) => p.map.name), e.dest?.map.name ?? '', ...e.conditions.map((c) => c.text), ...e.scripts.flatMap((s) => [fnLabel(s.make), ...s.cls.messages.map((id) => texts.preview(id, true) ?? '')])];
    return hay.some((t) => t.includes(q));
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="マップ名・本文・条件で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['script', 'スクリプト (0x2E)'], ['exit', '行き先のある出入口'], ['cond', '出現条件あり'], ['unplaced', 'どのマップにも置かれていない'], ['changed', '変更した行']]} />
        {!code && <div className="warn-box">スクリプトの中身 (作るクラスとメッセージ) には Update の code.bin が要ります。<button onClick={onAddUpdate}>Update を追加…</button></div>}
        <div className="book-list" ref={list}>
          {!entries && <div className="muted">読み込み中…</div>}
          {entries && <Count shown={rows.length} total={entries.filter((e) => e.kind).length} unit="行" />}
          <table className="book-table">
            <thead><tr><th></th><th>行</th><th>種類</th><th>場所・メッセージ</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const k = oahuEventKey(e);
                return (
                  <tr key={k} className={k === selected ? 'active' : ''} onClick={() => (location.hash = `#/events/${k}`)}>
                    <td className="muted nowrap">{maps.dungeons[e.dungeon]?.code || e.dungeon}</td>
                    <td className="num muted">{e.row}</td>
                    <td className="muted nowrap">{oahuKindName(e.kind)}{changed(e) && <span className="edited-mark"> ●</span>}</td>
                    <td className="msg-cell">{firstMessage(e) || e.places[0]?.map.name || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        {entries && byKey.get(selected) && <EventDetail key={selected} session={session} e={byKey.get(selected)!} />}
      </div>
    </div>
  );
}

function EventDetail({ session, e }: { session: OahuSession; e: OahuEventEntry }): ReactNode {
  const { maps } = session;
  const texts = session.messages.texts;
  const d = maps.dungeons[e.dungeon]!;
  const table = maps.loadedEventTable(d);
  return (
    <>
      <div className="book-head">
        <h2>{`${oahuDungeonLabel(session, e.dungeon)} — イベント #${e.row}`}</h2>
        <span className="muted">{`${oahuKindName(e.kind)}、${d.archive} の EventObject`}</span>
      </div>
      <h3>置かれている場所</h3>
      {e.places.length
        ? <ul>{e.places.map((p, i) => (
            <li key={i}>
              <a href={oahuMapHref(p.map)}>{p.map.name}</a>
              <span className="muted">{` ${OAHU_LAYOUTS[p.section]!.label} #${p.index} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`}</span>
            </li>
          ))}</ul>
        : <div className="muted">どのマップにも置かれていません</div>}
      {e.dest && <p>{'行き先: '}<a href={oahuMapHref(e.dest.map)}>{e.dest.map.name}</a>{` ${pointLabel(maps, e.dest.map, e.dest.point)}`}</p>}
      <h3>出現条件</h3>
      {e.conditions.length
        ? <ul>{e.conditions.map((c) => <li key={c.field}>{`${c.field === 0x53 ? '出る' : '消える'}: ${c.text}`}<span className="muted">{` (種類 0x${c.kind.toString(16).toUpperCase()}、値 ${c.v1} / ${c.v2})`}</span></li>)}</ul>
        : <div className="muted">条件なし (いつも置かれる)</div>}
      <div className="muted small">+0x53 の条件が成り立つときだけ置かれ、+0x54 の条件が成り立つと置かれなくなります (FUN_004B6AC8 / FUN_004B6B38)。</div>
      {session.code && (
        <>
          <h3>動作のクラス</h3>
          {e.scripts.length === 0 && <div className="muted">{e.kind === OAHU_SCRIPT_KIND ? 'コードはこの行に何も作りません (ダンジョンと行番号の組がコードにない、または進行で分けている)' : 'クラスを作れませんでした'}</div>}
          {e.scripts.map((s, i) => (
            <Fragment key={i}>
              <div className="small">
                {`${fnLabel(s.make)} が作るクラス 0x${s.cls.vtable.toString(16).toUpperCase()}。処理: `}
                {s.cls.roots.length ? s.cls.roots.map(fnLabel).join(' ') : <span className="muted">(共通の処理だけ)</span>}
              </div>
              {s.cls.messages.length > 0
                ? <ul>{s.cls.messages.map((id) => <li key={id}><a href={`#/messages/${id}`}>{id}</a>{' '}{texts.preview(id, true) ?? <span className="muted">(なし)</span>}</li>)}</ul>
                : <div className="muted">コードに書かれたメッセージはありません</div>}
            </Fragment>
          ))}
          <div className="muted small">クラスは、ハンドラの「動作の生成」関数をこの行と今のダンジョンで実際に動かして求めています (Update の code.bin)。メッセージは、そのクラスだけが持つ関数から呼ばれる関数が読み込む MessageField_JP の ID です。</div>
        </>
      )}
      <h3>行の欄</h3>
      {table && e.row < table.rows
        ? <EventObjectEditor maps={maps} row={table.row(e.row)} original={maps.originalEventRow(d, e.row)} onEdit={() => { maps.changed(); session.scheduleSave(); }} />
        : <div className="muted">読み込み中…</div>}
    </>
  );
}
