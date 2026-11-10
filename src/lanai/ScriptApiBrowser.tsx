import { useState, type ReactNode } from 'react';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import type { LanaiSession } from './session';
import { crsExports } from './scriptApi';
export function ScriptApiBrowser({ session, imported }: { session: LanaiSession; imported: string[] }): ReactNode {
  const [query, setQuery] = useState(''), [used, setUsed] = useState(false);
  const result = useAsync(async () => crsExports(await (session.dump.readUpdateRomfs?.('app/lanai.crs') ?? session.dump.readRomfs('app/lanai.crs'))).filter(x => /^(Script\w*|StageResult|IntroCommon)::/.test(x.name)), [session]);
  return <details><summary>Script API リファレンス (本体のシンボル)</summary>
    <p className="muted small">{session.dump.readUpdateRomfs ? 'Update' : 'Base'} の app/lanai.crs にある関数と C++ シンボルです。CRO は ARM ネイティブコードです。メッセージ・移動などの任意の API 呼び出しを生成する機能は未対応です。条件スクリプトは確認済みの判定関数を使用します。</p>
    <input aria-label="Script API を検索" placeholder="ScriptFlag / MoveTo など" value={query} onChange={e => setQuery(e.target.value)} />
    <label><input type="checkbox" checked={used} onChange={e => setUsed(e.target.checked)} />この CRO が使う関数だけ</label>
    {!result ? <p>読み込み中…</p> : result instanceof Error ? <p className="error">{result.message}</p> : <table className="book-table"><thead><tr><th>API</th><th>アドレス</th><th>C++ シンボル (引数型を含む)</th></tr></thead><tbody>{result.filter(x => (!used || imported.includes(x.name)) && `${x.name} ${x.symbol}`.toLowerCase().includes(query.toLowerCase())).map(x => <tr key={x.symbol}><td className="mono small">{x.name}</td><td className="mono small">{hex8(x.address)}</td><td className="mono small">{x.symbol}</td></tr>)}</tbody></table>}
  </details>;
}
