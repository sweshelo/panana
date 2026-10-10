// The contents (stages) of 電波人間のRPG FREE! (#/stages/<content>): the stages of MapStageIntegration with their names,
// missions and stamina, and what the content's archive holds: ContentsDef, the CRO of its event scripts (classes and
// the Script API it calls), its tables and its talks (naauao lanai/contents.md).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { romfsHref } from '../romfs/RomfsPage';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { CATEGORY_NOTE, contentTitle, lanaiContents, readContent, type ContentArchive, type LanaiContent } from './contents';
import { textColumns } from './MessagePage';
import { LanaiMessage } from './MessageView';
import type { LanaiSession, LanaiTableRef } from './session';

type Filter = 'all' | 'stages' | 'none';

const staminaText = (c: LanaiContent): string => [...new Set(c.stages.map((s) => s.stamina))].join(' / ');

export function LanaiStagePage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const contents = useMemo(() => lanaiContents(session), [session]);
  const index = useSticky<number>(arg === undefined || !/^\d+$/.test(arg) ? undefined : Number(arg), (i) => i < contents.length, () => (contents.length > 1 ? 1 : 0));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, index);
  useScrollTop(detail, index);
  const q = query.trim();
  const shown = contents.filter((c) => {
    if (filter === 'stages' && !c.stages.length) return false;
    if (filter === 'none' && c.stages.length) return false;
    return !q || String(c.index) === q || c.archive.includes(q.toUpperCase()) || c.stages.some((s) => s.name.includes(q) || s.mission.includes(q));
  });
  const c = contents[index];
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="ステージ名・ミッション・番号で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['stages', 'ステージの行がある'], ['none', 'ステージの行がない']]} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={contents.length} />
          <table className="book-table">
            <thead><tr><th>#</th><th>ステージ</th><th title="ステージに入るのに要るスタミナ (MapStage +0x3D)">スタミナ</th></tr></thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.index} className={x.index === index ? 'active' : ''} onClick={() => (location.hash = `#/stages/${x.index}`)}>
                  <td className="num muted">{x.index}</td>
                  <td>{contentTitle(x)}</td>
                  <td className="num muted">{staminaText(x)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {c && <ContentDetail key={c.index} session={session} c={c} />}
      </div>
    </div>
  );
}

function ContentDetail({ session, c }: { session: LanaiSession; c: LanaiContent }): ReactNode {
  const msg = session.need('MessageMapStage');
  const read = useAsync(() => readContent(session, c), [session, c]);
  return (
    <>
      <div className="book-head">
        <h2>{contentTitle(c)}</h2>
        <span className="muted">{`コンテンツ ${c.index}`}</span>
        <a className="mono muted" href={romfsHref(c.archive)} title="RomFS ビューでアーカイブを開く">{c.archive}</a>
        <span className="muted mono" title="Contents +0x04: TableResource のエントリ">{`TableResource ${hex8(c.tableResource)}`}</span>
      </div>
      <h3>ステージ (MapStageIntegration)</h3>
      {!c.stages.length ? <p className="muted">このコンテンツを指す行はありません。</p> : (
        <table className="book-table">
          <thead>
            <tr>
              <th>行</th><th>ステージ名</th><th>ミッション</th>
              <th title="+0x49 (MapStage +0x3D)。クイズの正解と照合して確定">スタミナ</th>
              <th title="+0x24。3 = 本編、0x16 = イベント系 (推定)">分類</th>
              <th title="+0x00。0x64 刻み (並び順と推定)">順</th>
            </tr>
          </thead>
          <tbody>
            {c.stages.map((s) => {
              const m = msg.find(s.messageId);
              const exp = m < 0 ? undefined : session.field(msg, m, msg.fields.find((f) => f.name === 'stage_exp')?.offset ?? -1);
              return (
                <tr key={s.row}>
                  <td className="num muted">{s.row}</td>
                  <td>
                    {s.name || <span className="muted">(なし)</span>}
                    <div className="muted small mono">{`MessageMapStage ${hex8(s.messageId)}`}</div>
                  </td>
                  <td>
                    {s.mission}
                    {exp && <div className="small romfs-msg"><LanaiMessage session={session} tokens={exp.tokens} /></div>}
                  </td>
                  <td className="num">{s.stamina}</td>
                  <td className="muted" title={CATEGORY_NOTE[s.category]}>{`0x${s.category.toString(16).toUpperCase()}`}</td>
                  <td className="num muted">{s.order}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!read ? <p className="muted">アーカイブを読み込み中…</p>
        : read instanceof Error ? <div className="error">{read.message}</div>
        : <ContentArchiveView session={session} c={c} a={read} />}
    </>
  );
}

function ContentArchiveView({ session, c, a }: { session: LanaiSession; c: LanaiContent; a: ContentArchive }): ReactNode {
  const talks = a.tables.filter((t) => textColumns(t).length);
  return (
    <>
      <h3>ContentsDef</h3>
      <p className="mono">{a.def.map((v) => `0x${v.toString(16).toUpperCase()}`).join(', ') || <span className="muted">なし</span>}</p>
      <p className="muted small">行 0・1 = コンテンツ番号、行 2 = CRO のエントリのハッシュ、行 3 = 1 (意味は未確認)。4 行目以降は未解析。</p>
      <h3>イベントのスクリプト (CRO)</h3>
      {!a.cro ? <p className="muted">CRO がありません。</p> : (
        <>
          <p>
            <span className="mono">{a.cro.name}</span>
            <span className="muted">{` モジュール ${a.cro.info.module || '?'}。クラス ${a.cro.info.classes.length}、本体から取り込む関数 ${a.cro.info.imports.length}`}</span>
          </p>
          <p className="muted small">クラスの名前は「マップ名 + EventObject の種類 + 番号」(D01001B01Npc0201) や、ステージ共通のもの (D01Intro、D01BossEvent)。読み込みの CRR は Update の <span className="mono">.crr/</span> にあります。</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: '4px 12px' }}>{a.cro.info.classes.map((x) => <span key={x} className="mono small">{x}</span>)}</div>
          <details>
            <summary>{`取り込む関数 (Script API など) ${a.cro.info.imports.length}`}</summary>
            <ul className="mono small">{a.cro.info.imports.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        </>
      )}
      <h3>表</h3>
      <table className="book-table">
        <thead><tr><th>エントリ</th><th>表</th><th>行 × 大きさ</th></tr></thead>
        <tbody>
          {a.tables.map((t) => (
            <tr key={t.entry} onClick={() => (location.hash = romfsHref(c.archive, t.entry))}>
              <td className="mono muted">{hex8(t.entry)}</td>
              <td>{t.table.name}</td>
              <td className="num muted">{`${t.table.rows} × 0x${t.table.rowSize.toString(16).toUpperCase()}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {talks.map((t) => <ContentStrings key={t.entry} session={session} t={t} />)}
    </>
  );
}

function ContentStrings({ session, t }: { session: LanaiSession; t: LanaiTableRef }): ReactNode {
  const cols = textColumns(t);
  return (
    <details open={t.table.name.endsWith('_msg') || t.table.name === 'MessageContents'}>
      <summary>{`${t.table.name} (${t.table.rows} 行)`}</summary>
      <table className="book-table">
        <thead><tr><th>行 ID</th>{cols.map((x) => <th key={x.offset} className="mono">{x.name}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: t.table.rows }, (_, r) => (
            <tr key={r}>
              <td className="mono muted">{hex8(t.table.rowId(r))}</td>
              {cols.map((x) => {
                const s = session.field(t.table, r, x.offset);
                return <td key={x.offset} className="romfs-msg">{s && <LanaiMessage session={session} tokens={s.tokens} />}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
