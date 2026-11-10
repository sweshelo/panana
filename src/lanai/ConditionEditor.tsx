import { useState, type ReactNode } from 'react';
import { LANAI_CONDITIONS, type LanaiCondition } from './conditions';
import { CONDITION_SCRIPT_HELP, parseConditionScript } from './conditionScript';
import type { LanaiSession } from './session';
export function LanaiConditionEditor({ session, value, onChange, onScript }: { session: LanaiSession; value: LanaiCondition; onChange: (c: LanaiCondition) => void; onScript?: (source: string) => void }): ReactNode {
  const [source, setSource] = useState(session.conditionScripts.get(value.v1) ?? 'flag(17) && !cleared(1)');
  const [error, setError] = useState('');
  const known = LANAI_CONDITIONS.some(([k]) => k === value.kind);
  return <div>
    <label className="field"><span>判定方法</span><select value={value.kind} onChange={e => onChange({ ...value, kind: Number(e.target.value) })}>
      {!known && <option value={value.kind}>{value.kind === 0x72 ? `条件スクリプト #${value.v1}` : `未解析 0x${value.kind.toString(16)} (保持)`}</option>}
      {LANAI_CONDITIONS.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
    </select></label>
    {known && ![0, 8, 9, 10, 11, 29].includes(value.kind) && <>
      <label className="field"><span>番号 (値 1)</span><input aria-label="条件の番号" type="number" min={0} max={4294967295} value={value.v1} onChange={e => onChange({ ...value, v1: Number(e.target.value) })} /></label>
      {[5, 6, 7, 12, 13].includes(value.kind) && <label className="field"><span>比較する値 (値 2)</span><input aria-label="条件の比較値" type="number" min={0} max={4294967295} value={value.v2} onChange={e => onChange({ ...value, v2: Number(e.target.value) })} /></label>}
    </>}
    <details open={value.kind === 0x72}>
      <summary>条件をスクリプトで組み合わせる</summary>
      <p className="small muted">{CONDITION_SCRIPT_HELP}</p>
      <textarea className="msg-text mono" aria-label="条件スクリプト" value={source} onChange={e => setSource(e.target.value)} />
      <button onClick={() => { try {
        parseConditionScript(source);
        if (onScript) { onScript(source); setError(''); return; }
        // Copy-on-write: editing a shared condition does not silently change another event.
        const id = Math.max(0, ...session.conditionScripts.keys()) + 1;
        session.setConditionScript(id, source);
        try { session.codeIps(); onChange({ kind: 0x72, v1: id, v2: 0 }); session.edited(); setError(''); }
        catch (e) { session.conditionScripts.delete(id); throw e; }
      } catch (e) { setError((e as Error).message); } }}>この条件式を使う</button>
      <p className="muted small">MOD に条件判定のコードを組み込みます。Update v17408 が必要です。CRO が判定を上書きするイベントでは、その結果が優先されます。</p>
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  </div>;
}
