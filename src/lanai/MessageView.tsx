// A string of 電波人間のRPG FREE! as a reader sees it: ruby as <ruby>, the strings of other tables put in (0x37), run-time
// names and numbers as 〈variables〉, the page break as ▼, other tags as their code.
import type { ReactNode } from 'react';
import { tagCode, TAG_PAGE, type LanaiToken } from './message';
import type { LanaiSession } from './session';

export function LanaiMessage({ session, tokens }: { session: LanaiSession; tokens: LanaiToken[] }): ReactNode {
  return (
    <span className="msg-render">
      {tokens.map((t, i): ReactNode => {
        switch (t.t) {
          case 'text': return t.s;
          case 'br': return tokens[i - 1]?.t === 'tag' && (tokens[i - 1] as { code: number }).code === TAG_PAGE ? null : <br key={i} />;
          case 'ruby': return <ruby key={i}>{t.base}<rp>(</rp><rt>{t.reading}</rt><rp>)</rp></ruby>;
          case 'ins': {
            const title = `${t.table} の行 ${t.id.toString(16).toUpperCase()} の ${t.field} (タグ 37)`;
            return <span key={i} className="msg-ref" title={title}>{session.insert(t.table, t.id, t.field) ?? `〈${t.table}〉`}</span>;
          }
          case 'tag': {
            const title = `タグ ${tagCode(t.code)}${t.args.length ? `: ${t.args.join(', ')}` : ''}`;
            if (t.code === TAG_PAGE && !t.args.length) return [<span key={`${i}p`} className="msg-page" title={`${title} (改ページと推定)`}>▼</span>, <hr key={`${i}r`} className="msg-page-rule" />];
            if (typeof t.args[0] === 'string') return <span key={i} className="msg-ph" title={title}>{t.args[0]}</span>;
            return <span key={i} className="msg-ctl" title={`${title} (意味は未解析)`}>{tagCode(t.code)}</span>;
          }
        }
      })}
    </span>
  );
}
