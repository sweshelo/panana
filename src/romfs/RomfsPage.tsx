// RomFS viewer (#/romfs/<path>[:<entry hash>]): every file of the dump, the entries of a root archive, and the
// bytes of a file or entry through the views of formats.tsx. Shared by the games; what differs is the profile.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { entryBlob, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import type { FieldContext } from '../game/tabledef';
import type { Dump, RomfsListing } from '../rom/dump';
import { Count, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { download } from '../ui/download';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { FormatBody } from './formats';
import { entryTypeLabel, fileNote, type RomfsProfile } from './profile';
import { asArchive } from './sniff';

export const romfsHref = (path: string, entry?: number): string =>
  `#/romfs/${encodeURIComponent(path)}${entry === undefined ? '' : `:${hex8(entry)}`}`;

export interface RomfsRoute {
  path: string;
  /** Hash of an entry of the file (a root archive). */
  entry?: number;
}

/** The route argument: a file path and maybe the hash of an entry of it. */
export function parseRomfsArg(arg: string | undefined): RomfsRoute | undefined {
  if (!arg) return undefined;
  let s: string;
  try {
    s = decodeURIComponent(arg);
  } catch {
    return undefined;
  }
  const m = /^(.*):([0-9A-Fa-f]{8})$/.exec(s);
  return m ? { path: m[1]!, entry: parseInt(m[2]!, 16) } : { path: s };
}

export const romfsFiles = (dump: Dump): RomfsListing[] =>
  (dump.files?.() ?? dump.names().map((path) => ({ path, size: NaN }))).sort((a, b) => a.path.localeCompare(b.path));

const sizeText = (n: number): string => (Number.isNaN(n) ? '' : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

type Filter = 'all' | 'root' | 'folders' | 'known';

export function RomfsPage({ dump, profile, arg, context }: {
  dump: Dump;
  profile: RomfsProfile;
  arg: string | undefined;
  /** Names table values (messages, rows) in the table views. */
  context?: FieldContext;
}): ReactNode {
  const files = useMemo(() => romfsFiles(dump), [dump]);
  const paths = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const route = useSticky<RomfsRoute>(parseRomfsArg(arg), (r) => paths.has(r.path), () => ({ path: paths.has(profile.title.master) ? profile.title.master : files[0]?.path ?? '' }));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, route.path);
  useScrollTop(detail, route.path);
  const q = query.trim().toUpperCase();
  const shown = files.filter((f) => {
    const note = fileNote(profile, f.path);
    if (q && !f.path.toUpperCase().includes(q) && !note?.toUpperCase().includes(q)) return false;
    switch (filter) {
      case 'root': return !f.path.includes('/');
      case 'folders': return f.path.includes('/');
      case 'known': return !!note;
      default: return true;
    }
  });
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="ファイル名 (21350000、sound/ など) で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['root', 'ルートのファイル'], ['folders', 'フォルダの中'], ['known', '中身の分かるもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={files.length} />
          <table className="book-table">
            <thead><tr><th>ファイル</th><th>大きさ</th></tr></thead>
            <tbody>
              {shown.map((f) => {
                const note = fileNote(profile, f.path);
                return (
                  <tr key={f.path} className={f.path === route.path ? 'active' : ''} onClick={() => (location.hash = romfsHref(f.path))}>
                    <td className="romfs-file">
                      <span className="mono">{f.path}</span>
                      {note && <span className="muted small" title={note}>{note}</span>}
                    </td>
                    <td className="num muted">{sizeText(f.size)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {route.path && <FileDetail key={route.path} dump={dump} profile={profile} path={route.path} entry={route.entry} context={context} />}
      </div>
    </div>
  );
}

function FileDetail({ dump, profile, path, entry, context }: { dump: Dump; profile: RomfsProfile; path: string; entry?: number; context?: FieldContext }): ReactNode {
  const data = useAsync(() => dump.readRomfs(path), [dump, path]);
  const arc = useMemo(() => (data instanceof Uint8Array ? asArchive(data, path) : null), [data, path]);
  const note = fileNote(profile, path);
  return (
    <>
      <div className="book-head">
        <h2 className="mono">{path}</h2>
        {note && <span className="muted">{note}</span>}
        <span className="grow" />
        {data instanceof Uint8Array && <button onClick={() => download(data, path.split('/').pop()!)}>ファイルを保存</button>}
      </div>
      {!data ? <p className="muted">読み込み中…</p>
        : data instanceof Error ? <div className="error">{data.message}</div>
        : arc ? <ArchiveView arc={arc} path={path} profile={profile} entry={entry} context={context} />
        : <FormatBody body={data} name={path.split('/').pop()!} profile={profile} context={context} />}
    </>
  );
}

/** File name of an entry: the one in its ZIP (compression 1), else null. */
const entryName = (arc: Archive, e: ArcEntry): string | null => (e.comp === 1 ? zipEntryName(entryBlob(arc, e)) : null);

const COMP: Record<number, string> = { 0: 'なし', 1: 'ZIP', 6: 'LZ10' };

function ArchiveView({ arc, path, profile, entry, context }: { arc: Archive; path: string; profile: RomfsProfile; entry?: number; context?: FieldContext }): ReactNode {
  const names = useMemo(() => arc.entries.map((e) => entryName(arc, e)), [arc]);
  const [query, setQuery] = useState('');
  const q = query.trim().toUpperCase();
  const shown = arc.entries.filter((e) => !q || hex8(e.hash).includes(q) || names[e.index]?.toUpperCase().includes(q) || entryTypeLabel(profile, e.type).toUpperCase().includes(q));
  const types = new Map<number, number>();
  for (const e of arc.entries) types.set(e.type, (types.get(e.type) ?? 0) + 1);
  const selected = entry === undefined ? undefined : arc.entries.find((e) => e.hash === entry);
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  return (
    <>
      <div className="row">
        <span>{`アーカイブ (version ${arc.version}、${arc.entries.length} エントリ)`}</span>
        {arc.version !== profile.archiveVersion && <span className="warn-mark">{`この作品のアーカイブは version ${profile.archiveVersion} のはずです`}</span>}
        <span className="muted">{[...types].sort((a, b) => a[0] - b[0]).map(([t, n]) => `${entryTypeLabel(profile, t)} ${n}`).join('、')}</span>
      </div>
      <div className="row">
        <input type="search" placeholder="ハッシュ・ファイル名・種類で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted small">{`${shown.length} / ${arc.entries.length}`}</span>
      </div>
      <div className="romfs-entries" ref={list}>
        <table className="book-table">
          <thead><tr><th>#</th><th>ハッシュ</th><th>ファイル名</th><th>種類</th><th>圧縮</th><th>大きさ</th></tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.index} className={e === selected ? 'active' : ''} onClick={() => (location.hash = romfsHref(path, e.hash))}>
                <td className="num muted">{e.index}</td>
                <td className="mono">{hex8(e.hash)}</td>
                <td className="mono">{names[e.index] ?? ''}</td>
                <td className="muted">{entryTypeLabel(profile, e.type)}</td>
                <td className="muted">{COMP[e.comp] ?? e.comp}</td>
                <td className="num muted" title={`格納 ${e.size} バイト`}>{sizeText(e.raw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? <EntryView key={selected.index} arc={arc} e={selected} profile={profile} context={context} />
        : <p className="muted">エントリを選ぶと中身を表示します。</p>}
    </>
  );
}

function EntryView({ arc, e, profile, context }: { arc: Archive; e: ArcEntry; profile: RomfsProfile; context?: FieldContext }): ReactNode {
  const unpacked = useMemo(() => {
    try {
      return unpackEntry(arc, e);
    } catch (err) {
      return err as Error;
    }
  }, [arc, e]);
  if (unpacked instanceof Error) return <div className="error">{`展開できませんでした: ${unpacked.message}`}</div>;
  const file = unpacked.name ?? `${hex8(e.hash)}.bin`;
  return (
    <div className="romfs-entry">
      <div className="book-head">
        <h3 className="mono">{`${hex8(e.hash)} ${unpacked.name ?? ''}`}</h3>
        <span className="muted">{entryTypeLabel(profile, e.type)}</span>
        <span className="grow" />
        <button onClick={() => download(unpacked.body, file)}>展開して保存</button>
        {e.comp !== 0 && <button onClick={() => download(entryBlob(arc, e), `${hex8(e.hash)}.${e.comp === 1 ? 'zip' : 'lz'}`)}>圧縮のまま保存</button>}
      </div>
      <FormatBody body={unpacked.body} name={unpacked.name} profile={profile} context={context} />
    </div>
  );
}
