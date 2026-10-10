// Views of one file of the RomFS viewer, by format. A format is added by putting a FormatView in FORMAT_VIEWS (the
// first whose `match` takes the bytes is used; the hex dump takes the rest).
import { useMemo, useState, type ReactNode } from 'react';
import { BchView } from '../bch/BchView';
import { isBch } from '../bch/bch';
import { GsTable } from '../archive/gstable';
import { Gmsg, toUnits } from '../game/gmsg';
import { defFor, fieldPlace, fieldText, readField, type FieldContext, type TableDef } from '../game/tabledef';
import { hex4, unitsToText } from '../game/msgtext';
import { lanaiText, parseLanaiMessage } from '../lanai/message';
import { LanaiTable } from '../lanai/table';
import { ascii, hex8, u16, u32 } from '../util/bytes';
import type { RomfsProfile } from './profile';
import { formatName, isGsTable } from './sniff';

export interface FormatViewProps {
  body: Uint8Array;
  /** File name (the ZIP's for an archive entry), or null. */
  name: string | null;
  profile: RomfsProfile;
  /** Names the values of the table fields (messages, rows of other tables), when the page knows them. */
  context?: FieldContext;
}

export interface FormatView {
  id: string;
  label: string;
  match(body: Uint8Array, name: string | null): boolean;
  View(props: FormatViewProps): ReactNode;
}

const PAGE = 200;

/** Rows shown so far, and a button for the next page. */
function usePaged(total: number, reset: unknown): [number, ReactNode] {
  const [shown, setShown] = useState({ n: PAGE, reset });
  const n = shown.reset === reset ? shown.n : PAGE;
  const more = n < total
    ? <div className="row"><button onClick={() => setShown({ n: n + PAGE * 5, reset })}>{`続きを表示 (${total - n} 行)`}</button></div>
    : null;
  return [Math.min(n, total), more];
}

type Cell = 'fields' | 'x32' | 'd32' | 'x16' | 'x8';
const CELLS: [Cell, string, number][] = [['x32', 'u32 (16 進)', 4], ['d32', 'u32 (10 進)', 4], ['x16', 'u16 (16 進)', 2], ['x8', 'u8 (16 進)', 1]];

function cellText(row: Uint8Array, o: number, cell: Cell): string {
  switch (cell) {
    case 'x32': return hex8(u32(row, o));
    case 'd32': return String(u32(row, o) | 0);
    case 'x16': return hex4(u16(row, o));
    case 'x8': return row[o]!.toString(16).toUpperCase().padStart(2, '0');
    case 'fields': return '';
  }
}

/** The rows by the fields of the game's definition: a column per field, the values as text. */
function FieldRows({ t, def, shown, context }: { t: GsTable; def: TableDef; shown: number; context?: FieldContext }): ReactNode {
  const cols = def.fields.filter((f) => !f.alias);
  return (
    <table className="book-table romfs-fields">
      <thead>
        <tr>
          <th>行</th>
          {cols.map((f) => (
            <th key={f.key} className={f.unsure ? 'muted' : ''} title={[fieldPlace(f), f.note].filter(Boolean).join('\n')}>{f.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: shown }, (_, r) => {
          const row = t.row(r);
          return (
            <tr key={r}>
              <td className="num muted">{r}</td>
              {cols.map((f) => {
                const v = readField(row, f);
                const text = fieldText(f, v, context);
                return <td key={f.key} className={`${f.ref?.kind === 'message' ? 'romfs-msg' : 'num'}${v ? '' : ' muted'}`} title={f.ref ? String(v) : undefined}>{text}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** GS table: the header and the rows as columns of the chosen width. */
export function GsTableView({ body, name, profile, context }: FormatViewProps): ReactNode {
  const t = useMemo(() => new GsTable(body), [body]);
  const def = defFor(profile.tables, name, t.rowSize);
  const [pick, setCell] = useState<Cell>('fields');
  const cell: Cell = pick === 'fields' && !def ? 'x32' : pick;
  const width = CELLS.find((c) => c[0] === cell)?.[2] ?? 4;
  const [shown, more] = usePaged(t.rows, body);
  const cols = Array.from({ length: Math.floor(t.rowSize / width) }, (_, i) => i * width);
  const rest = t.rowSize % width;
  const extra = u32(body, 0x20);
  return (
    <div>
      <div className="row">
        <b className="mono">{t.name || '(名前なし)'}</b>
        <span className="muted">{`${t.rows} 行 × 0x${t.rowSize.toString(16).toUpperCase()} バイト`}</span>
        {extra ? <span className="muted">{`行の後ろの領域 +0x${extra.toString(16).toUpperCase()}`}</span> : null}
        <span className="grow" />
        <select value={cell} onChange={(e) => setCell(e.target.value as Cell)}>
          {def && <option value="fields">欄ごと</option>}
          {CELLS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div className="romfs-grid">
        {cell === 'fields' && def ? <FieldRows t={t} def={def} shown={shown} context={context} /> : <table className="book-table mono">
          <thead><tr><th>行</th>{cols.map((o) => <th key={o}>{`+${o.toString(16).toUpperCase()}`}</th>)}{rest ? <th>…</th> : null}</tr></thead>
          <tbody>
            {Array.from({ length: shown }, (_, r) => {
              const row = t.row(r);
              return (
                <tr key={r}>
                  <td className="num muted">{r}</td>
                  {cols.map((o) => <td key={o} className={row.subarray(o, o + width).some((b) => b) ? '' : 'muted'}>{cellText(row, o, cell)}</td>)}
                  {rest ? <td>{[...row.subarray(t.rowSize - rest)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>}
      </div>
      {more}
    </div>
  );
}

/**
 * RPG FREE!'s GS table: the header (name, row IDs, the names of the string fields, the extra pairs) and the rows, the
 * strings in their text form and the other u32s in hex (or the chosen width); searchable by string or row ID.
 */
export function LanaiTableView({ body }: FormatViewProps): ReactNode {
  const t = useMemo(() => new LanaiTable(body), [body]);
  const strings = useMemo(() => new Set(t.stringOffsets()), [t]);
  const [pick, setCell] = useState<Cell>('fields');
  const [query, setQuery] = useState('');
  const cell = pick;
  const width = cell === 'fields' ? 4 : CELLS.find((c) => c[0] === cell)?.[2] ?? 4;
  const cols = Array.from({ length: Math.floor(t.rowSize / width) }, (_, i) => i * width);
  const rest = t.rowSize % width;
  const text = (r: number, o: number): string | undefined => {
    const at = t.stringOffset(r, o);
    return at < 0 ? undefined : lanaiText(parseLanaiMessage(body, at).tokens);
  };
  const q = query.trim();
  const rows = useMemo(() => {
    const all = Array.from({ length: t.rows }, (_, r) => r);
    if (!q) return all;
    // a row ID with or without its top bit ("800000C7", "C7")
    const id = /^(0x)?[0-9A-Fa-f]{1,8}$/.test(q) ? parseInt(q.replace(/^0x/i, ''), 16) : -1;
    return all.filter((r) => t.rowId(r) === id || (t.rowId(r) & 0x7fffffff) === id || [...strings].some((o) => text(r, o)?.includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- text reads t and body
  }, [t, q, strings]);
  const [shown, more] = usePaged(rows.length, `${q}:${body.length}`);
  return (
    <div>
      <div className="row">
        <b className="mono">{t.name}</b>
        <span className="muted">{`${t.rows} 行 × 0x${t.rowSize.toString(16).toUpperCase()} バイト`}</span>
        <span className="muted">{t.rowIds.length ? '行 ID あり' : '行 ID なし'}</span>
        {t.fields.length > 0 && <span className="muted" title="欄の名前の表 (文字列の欄)">{t.fields.map((f) => `${f.name} +${f.offset.toString(16).toUpperCase()}`).join('、')}</span>}
        {t.extra.length > 0 && <span className="muted" title={t.extra.map(([h, v]) => `${hex8(h)} ${hex8(v)}`).join('\n')}>{`追加の領域 ${t.extra.length} 組 (用途は未解析)`}</span>}
        <span className="grow" />
        <input type="search" placeholder="文字列か行 ID で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={cell} onChange={(e) => setCell(e.target.value as Cell)}>
          <option value="fields">文字列と u32</option>
          {CELLS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div className="romfs-grid">
        <table className="book-table">
          <thead>
            <tr>
              <th>行</th>
              {t.rowIds.length > 0 && <th>行 ID</th>}
              {cols.map((o) => <th key={o} className="mono">{(cell === 'fields' && t.fieldName(o)) || `+${o.toString(16).toUpperCase()}`}</th>)}
              {rest ? <th>…</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r) => {
              const row = t.row(r);
              return (
                <tr key={r}>
                  <td className="num muted">{r}</td>
                  {t.rowIds.length > 0 && <td className="mono muted">{hex8(t.rowId(r))}</td>}
                  {cols.map((o) => {
                    const s = cell === 'fields' && strings.has(o) ? text(r, o) : undefined;
                    if (s !== undefined) return <td key={o} className="romfs-msg">{s}</td>;
                    return <td key={o} className={`mono${row.subarray(o, o + width).some((b) => b) ? '' : ' muted'}`}>{cellText(row, o, cell === 'fields' ? 'x32' : cell)}</td>;
                  })}
                  {rest ? <td className="mono">{[...row.subarray(t.rowSize - rest)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {more}
    </div>
  );
}

/** A reading (*_IN) message: 1-byte characters up to the terminator. */
const readingText = (b: Uint8Array): string => String.fromCharCode(...b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));

/** GMSG: every message with its ID and type code, in the editors' text form; searchable. */
export function GmsgView({ body }: FormatViewProps): ReactNode {
  const g = useMemo(() => new Gmsg(body), [body]);
  const [query, setQuery] = useState('');
  const all = useMemo(() => g.raw.map((raw, i) => {
    const id = g.first + i;
    if (g.reading) return { id, kind: '', text: readingText(raw) };
    const t = unitsToText(toUnits(raw));
    return { id, kind: hex4(t.kind), text: t.text };
  }), [g]);
  const q = query.trim();
  const list = q ? all.filter((m) => m.text.includes(q) || String(m.id) === q || `0x${m.id.toString(16)}` === q.toLowerCase()) : all;
  const [shown, more] = usePaged(list.length, `${q}:${body.length}`);
  return (
    <div>
      <div className="row">
        <span className="muted">{`ID ${g.first}〜${g.last} (${g.raw.length} 件)${g.reading ? '、読み (音声用)' : ''}`}</span>
        <input type="search" placeholder="本文か ID で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <table className="book-table">
        <thead><tr><th>ID</th><th>種別</th><th>本文</th></tr></thead>
        <tbody>
          {list.slice(0, shown).map((m) => (
            <tr key={m.id}>
              <td className="num muted" title={`0x${m.id.toString(16).toUpperCase()}`}>{m.id}</td>
              <td className="mono muted">{m.kind}</td>
              <td className="romfs-msg">{m.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </div>
  );
}

/** Offset, bytes and ASCII, 16 bytes a line. */
export function hexDump(b: Uint8Array, from = 0, to = b.length): string {
  const lines: string[] = [];
  for (let o = from; o < Math.min(to, b.length); o += 16) {
    const row = b.subarray(o, Math.min(o + 16, b.length));
    const hex = [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const text = [...row].map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('');
    lines.push(`${o.toString(16).padStart(8, '0')}  ${hex}  ${text}`);
  }
  return lines.join('\n');
}

const HEX_STEP = 0x1000;

export function HexView({ body }: FormatViewProps): ReactNode {
  const [shown, setShown] = useState({ n: HEX_STEP, body });
  const n = shown.body === body ? shown.n : HEX_STEP;
  return (
    <div>
      <pre className="hexdump">{hexDump(body, 0, n)}</pre>
      {n < body.length && <button onClick={() => setShown({ n: n + HEX_STEP * 4, body })}>{`続きを表示 (残り ${body.length - n} バイト)`}</button>}
    </div>
  );
}

const isGmsg = (b: Uint8Array): boolean => b.length >= 0x20 && ascii(b, 0, 4) === 'GMSG';

export const FORMAT_VIEWS: FormatView[] = [
  { id: 'gmsg', label: 'メッセージ', match: isGmsg, View: GmsgView },
  { id: 'gstable', label: '表', match: (b) => isGsTable(b), View: GsTableView },
  { id: 'lanai-table', label: '表', match: (b) => LanaiTable.is(b), View: LanaiTableView },
  { id: 'bch', label: 'モデル', match: isBch, View: BchView },
];

export const HEX_VIEW: FormatView = { id: 'hex', label: '16 進', match: () => true, View: HexView };

/** The views that take these bytes: the matching formats, then the hex dump. */
export const viewsFor = (body: Uint8Array, name: string | null): FormatView[] => [...FORMAT_VIEWS.filter((v) => v.match(body, name)), HEX_VIEW];

/** The bytes of one file: what they are, a tab per view that takes them, and the view. */
export function FormatBody(props: FormatViewProps): ReactNode {
  const { body, name } = props;
  const views = useMemo(() => viewsFor(body, name), [body, name]);
  const [pick, setPick] = useState<string | null>(null);
  const view = views.find((v) => v.id === pick) ?? views[0]!;
  return (
    <div className="romfs-body">
      <div className="row">
        <span>{formatName(body) ?? '形式は不明'}</span>
        <span className="muted">{`${body.length.toLocaleString()} バイト`}</span>
        <span className="grow" />
        {views.length > 1 && views.map((v) => (
          <button key={v.id} className={v === view ? 'active' : ''} onClick={() => setPick(v.id)}>{v.label}</button>
        ))}
      </div>
      <view.View {...props} />
    </div>
  );
}
