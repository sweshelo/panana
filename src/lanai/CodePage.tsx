// RPG FREE!'s codes and deliveries (#/codes/<table>.<row>, or #/codes/<16-character code>): reading a code typed in
// 「コード入力」, making the code of a CampaignCodeLocal row, and the rows of CampaignCodeLocal and the checkin tables
// (A9DF0000) with their conditions and rewards (naauao lanai/codes.md, lanai/checkin.md §5).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import {
  CHECKIN_ARCHIVE, CHECKIN_TABLES, CODE_KINDS, CODE_TABLE, codeVerdict, conditionLabel, decodeCode, encodeCode, LANAI_VERSION, normalizeCode,
  parseVersion, rewardLabel, rewardRows, rowKindLabel, supportFields, versionText, versionValue, type DecodedCode, type RewardRow,
} from './codes';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

const TABLES: readonly string[] = [CODE_TABLE, ...CHECKIN_TABLES];
const EXAMPLE = 'A4J8Y13ML7TAWWE1';

export const lanaiCodeHref = (table: string, row?: number): string => `#/codes/${table}${row === undefined ? '' : `.${row}`}`;

const hx = (n: number, w = 2): string => `0x${n.toString(16).toUpperCase().padStart(w, '0')}`;
const oneLine = (s: string): string => s.replace(/\n+/g, ' ');

/** The route argument: a table (and row), or a code. */
function parseArg(arg: string | undefined): { table?: string; row?: number; code?: string } {
  if (!arg) return {};
  const [t, r] = decodeURIComponent(arg).split('.');
  if (t && TABLES.includes(t)) return { table: t, row: r !== undefined && /^\d+$/.test(r) ? Number(r) : undefined };
  return /^[0-9A-Za-z]{16}$/.test(arg) ? { code: arg } : {};
}

export function LanaiCodePage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const parsed = parseArg(arg);
  const codeTable = session.need(CODE_TABLE);
  const codeRows = useMemo(() => rewardRows(session, codeTable), [session, codeTable]);
  const checkin = useAsync(() => session.tablesIn(CHECKIN_ARCHIVE), [session]);
  const table = useSticky(parsed.code ? CODE_TABLE : parsed.table, (t) => TABLES.includes(t), () => CODE_TABLE);
  const checkinTable = checkin && !(checkin instanceof Error) ? checkin.find((r) => r.table.name === table)?.table : undefined;
  const rows = useMemo(
    () => (table === CODE_TABLE ? codeRows : checkinTable ? rewardRows(session, checkinTable) : []),
    [table, codeRows, checkinTable, session],
  );
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  // a code in the route selects its CampaignCodeLocal row
  const codeRow = useMemo(() => {
    if (!parsed.code) return undefined;
    try {
      return codeVerdict(decodeCode(parsed.code), codeTable.rows).row;
    } catch {
      return undefined;
    }
  }, [parsed.code, codeTable]);
  const want = parsed.row ?? (table === CODE_TABLE ? codeRow : undefined) ?? 0;
  const selected = want < rows.length ? want : 0;
  const key = `${table}.${selected}`;
  useActiveRow(list, key);
  useScrollTop(detail, key);
  const isCode = table === CODE_TABLE;
  const label = (r: RewardRow): string => rewardLabel(session, r);
  const codeOf = (row: number): string => encodeCode(0, row, 0, LANAI_VERSION);
  const q = query.trim();
  const shown = rows.filter((r) => !q || String(r.row) === q || [r.message, label(r), isCode ? codeOf(r.row) : ''].some((t) => t.includes(q) || t.includes(q.toUpperCase())));
  const tableRows = (t: string): number | undefined => (t === CODE_TABLE ? codeTable.rows : checkin && !(checkin instanceof Error) ? checkin.find((r) => r.table.name === t)?.table.rows : undefined);
  return (
    <div className="book">
      <div className="book-side">
        <div className="row">
          <select value={table} onChange={(e) => (location.hash = lanaiCodeHref(e.target.value))}>
            {TABLES.map((t) => <option key={t} value={t}>{`${t}${t === CODE_TABLE ? ' (コード入力)' : ''}${tableRows(t) === undefined ? '' : ` ${tableRows(t)} 行`}`}</option>)}
          </select>
          <input type="search" placeholder="メッセージ・報酬・コードで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="book-list" ref={list}>
          {!isCode && checkin === undefined && <div className="muted">{`${CHECKIN_ARCHIVE} を読み込み中…`}</div>}
          {!isCode && checkin instanceof Error && <div className="error">{checkin.message}</div>}
          {rows.length > 0 && <Count shown={shown.length} total={rows.length} unit="行" />}
          <table className="book-table">
            <thead><tr><th>#</th>{isCode && <th>コード ({versionText(LANAI_VERSION)})</th>}<th>報酬</th><th>メッセージ</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.row} className={r.row === selected ? 'active' : ''} onClick={() => (location.hash = lanaiCodeHref(table, r.row))}>
                  <td className="num muted">{r.row}</td>
                  {isCode && <td className="mono">{codeOf(r.row)}</td>}
                  <td className="msg-cell" title={label(r)}>{label(r)}</td>
                  <td className="msg-cell muted" title={r.message}>{oneLine(r.message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail code-page" ref={detail}>
        <h2>コード・配信</h2>
        <p className="muted small">
          タイトル画面の「せってい」→「コード入力」の 16 文字のコードと、チェックインで受け取る報酬の表 (読むだけ)。
          コードは {CODE_TABLE} の行番号と版だけで決まります。
        </p>
        <CodeReader key={parsed.code} session={session} rows={codeRows} table={codeTable} initial={parsed.code} />
        <CodeMaker session={session} rows={codeRows} />
        {rows[selected] && <RowDetail session={session} table={table} r={rows[selected]} />}
      </div>
    </div>
  );
}

function CodeReader({ session, rows, table, initial }: { session: LanaiSession; rows: RewardRow[]; table: LanaiTable; initial?: string }): ReactNode {
  const [text, setText] = useState(initial ?? '');
  const code = normalizeCode(text);
  let decoded: DecodedCode | undefined;
  let error = '';
  if (code) {
    try {
      decoded = decodeCode(code);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <section>
      <h3 className="with-info">コードを読む<InfoTip text={'16 文字を 32 文字の表 (CampaignCharacter) で 5 ビットずつにして 10 バイトに詰め、撹拌を戻します (FUN_001B53D4)。\n小文字は大文字として読みます。'} /></h3>
      <div className="row">
        <input type="text" className="mono" size={22} maxLength={24} spellCheck={false} placeholder="16 文字のコード" value={text} onChange={(e) => setText(e.target.value)} />
        <button onClick={() => setText(EXAMPLE)}>{`例: ${EXAMPLE}`}</button>
      </div>
      {error && <div className="error">{error}</div>}
      {decoded && <Decoded session={session} c={decoded} rows={rows} table={table} />}
    </section>
  );
}

function Decoded({ session, c, rows, table }: { session: LanaiSession; c: DecodedCode; rows: RewardRow[]; table: LanaiTable }): ReactNode {
  const verdict = codeVerdict(c, table.rows);
  const newer = versionValue(c.version) > versionValue(LANAI_VERSION);
  const support = c.kind === 2 ? supportFields(c) : undefined;
  const row = verdict.row !== undefined ? rows[verdict.row] : undefined;
  return (
    <>
      <table className="small">
        <tbody>
          <tr><td className="muted">種類</td><td>{`${c.kind}: ${CODE_KINDS[c.kind]}`}</td></tr>
          <tr><td className="muted">版</td><td>{versionText(c.version)}{newer && <span className="error-text">{` (ソフトの版 ${versionText(LANAI_VERSION)} より新しい)`}</span>}</td></tr>
          <tr><td className="muted">チェック</td><td>{hx(c.check)} {c.checkOk ? <span className="ok">OK</span> : <span className="error-text">NG (SHA-256 の先頭と違う)</span>}</td></tr>
          <tr><td className="muted">中身</td><td className="mono">{`${hex8(c.payload)} (${c.payload})  バイト 9 = ${hx(c.extra)}`}</td></tr>
          {support && <tr><td className="muted">サポート</td><td>{`操作 ${support.op}${support.op >= 1 && support.op <= 12 ? '' : ' (1〜12 ではない)'}, 引数 ${support.args.join(', ')}, 値 ${hx(support.value, 4)} (中身は未解析)`}</td></tr>}
          <tr><td className="muted">10 バイト</td><td className="mono">{[...c.bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</td></tr>
        </tbody>
      </table>
      <div className={verdict.ok ? 'small' : 'warn-box'}>{verdict.ok ? <span className="ok">{verdict.text}</span> : verdict.text}</div>
      {row && (
        <div className="small">
          <a href={lanaiCodeHref(CODE_TABLE, row.row)}>{`行 ${row.row}`}</a>{`: ${rewardLabel(session, row)}`}
          {row.message && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{row.message}</div>}
        </div>
      )}
    </>
  );
}

function CodeMaker({ session, rows }: { session: LanaiSession; rows: RewardRow[] }): ReactNode {
  const [row, setRow] = useState(rows.length - 1);
  const [ver, setVer] = useState(versionText(LANAI_VERSION));
  const v = parseVersion(ver);
  const r = rows[row];
  return (
    <section>
      <h3 className="with-info">コードを作る<InfoTip text={`種類 0 (${CODE_TABLE} の行) のコード。lanaicode.py enc 0 <行> 0 <版> と同じです。\n表にない行番号のコードは「コードが間違っています」になります (表に行を足した Update 用)。`} /></h3>
      <div className="row">
        <label>行 <input type="number" className="num-input" min={0} max={0xffff} value={row} onChange={(e) => setRow(Math.max(0, Math.min(0xffff, Math.round(Number(e.target.value)) || 0)))} /></label>
        <label>版 <input type="text" size={10} value={ver} onChange={(e) => setVer(e.target.value)} /></label>
        {v ? <b className="mono">{encodeCode(0, row, 0, v)}</b> : <span className="error-text small">版は 1.17.0 の形で (1 番目 0〜63、2 番目 0〜1023、3 番目 0〜16383)</span>}
      </div>
      <div className="muted small">
        {r ? `行 ${row}: ${rewardLabel(session, r)}` : `行 ${row} は ${CODE_TABLE} (${rows.length} 行) にありません`}
        {v && versionValue(v) > versionValue(LANAI_VERSION) && ` / 版がソフトの版 ${versionText(LANAI_VERSION)} より新しいので断られます`}
      </div>
    </section>
  );
}

function RowDetail({ session, table, r }: { session: LanaiSession; table: string; r: RewardRow }): ReactNode {
  const isCode = table === CODE_TABLE;
  const conditions = r.conditions.map((c, i) => [i + 1, conditionLabel(c)] as const).filter(([, l]) => l);
  return (
    <section>
      <div className="book-head">
        <h3>{`${table} 行 ${r.row}`}</h3>
        <span className="muted small">{`ID ${hex8(r.id)}`}</span>
      </div>
      <table className="small">
        <tbody>
          {isCode && <tr><td className="muted">コード</td><td className="mono">{`${encodeCode(0, r.row, 0, LANAI_VERSION)} (版 ${versionText(LANAI_VERSION)})`}</td></tr>}
          <tr><td className="muted">行の種類</td><td>{`${rowKindLabel(r.kind)} (${hex8(r.kind)})`}</td></tr>
          <tr>
            <td className="muted">条件</td>
            <td>
              {conditions.length ? conditions.map(([n, l]) => <div key={n}>{`${n}: ${l}`}</div>) : <span className="muted">なし</span>}
              {isCode && conditions.length > 0 && <div className="muted">条件 1・2 はどちらかが合わないと失敗、3・4 は両方合うと失敗</div>}
            </td>
          </tr>
          <tr><td className="muted">報酬</td><td>{rewardLabel(session, r)} <span className="muted">{`(種類 ${hx(r.reward)}, 値 ${hex8(r.value)}, 数 ${r.count})`}</span></td></tr>
          <tr>
            <td className="muted">まとまり</td>
            <td>
              {r.group === 0xffff ? 'なし' : hx(r.group, 4)}
              {isCode && <InfoTip text={'使用済みの記録: FlagData のキー 0x67 のビット [行番号] と、まとまりのキー 0x27 のビット。\nどちらかが立っていると「このコードは既に使用されています。」'} />}
            </td>
          </tr>
        </tbody>
      </table>
      {r.message && <><h3>メッセージ</h3><div className="book-desc" style={{ whiteSpace: 'pre-wrap' }}>{r.message}</div></>}
      {r.failMessage && <><h3>条件に合わないときのメッセージ</h3><div className="book-desc" style={{ whiteSpace: 'pre-wrap' }}>{r.failMessage}</div></>}
    </section>
  );
}
