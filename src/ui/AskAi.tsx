// "Ask the AI" panel: a question about the shown event, answered by Claude with the user's own API key.
import { useRef, useState, type ReactNode } from 'react';
import { askClaude, errorText, getApiKey, getModel, MODELS, setApiKey, setModel, type AskResult } from '../ai/claude';

export const QUESTIONS = [
  'このイベントが何をするのか、流れを順に説明してください。',
  'このイベントが読み書きするセーブ変数・フラグと、それぞれの意味を推測してください。',
  'このイベントを改造するなら、どこを変えると何ができそうか挙げてください。',
];

/** The API key and model: stored in this browser only. */
export function AiSettings({ onClose }: { onClose: () => void }): ReactNode {
  const [key, setKey] = useState(getApiKey());
  const [remember, setRemember] = useState(true);
  const [model, setM] = useState(getModel());
  return (
    <div className="ai-settings">
      <div className="small">
        Anthropic の API キーを入れると、ブラウザから直接 Claude に聞けます。キーはこのブラウザにだけ保存され、Anthropic 以外には送られません。
        質問には、この行の情報と注釈つきのアセンブラ (ROM のコード) が含まれます。料金はキーの持ち主にかかります。
      </div>
      <div className="row">
        <input type="password" placeholder="sk-ant-..." size={40} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <select value={model} onChange={(e) => setM(e.target.value)}>
          {MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <label className="small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> このブラウザに保存する</label>
      </div>
      <div className="row">
        <button className="primary" onClick={() => { setApiKey(key, remember); setModel(model); onClose(); }}>保存</button>
        <button onClick={() => { setApiKey('', false); setKey(''); onClose(); }}>キーを消す</button>
        <button onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

/** Ask about one event. `system` = the stable context, `context()` = the event as text (built when asked). */
export function AskAi({ system, context }: { system: string; context: () => string }): ReactNode {
  const [question, setQuestion] = useState(QUESTIONS[0]!);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const ask = async (): Promise<void> => {
    if (!getApiKey()) {
      setSettings(true);
      return;
    }
    setBusy(true);
    setAnswer('');
    setResult(null);
    setError('');
    abort.current = new AbortController();
    try {
      const r = await askClaude({
        system,
        prompt: `${context()}\n\n# 質問\n${question}`,
        onText: (d) => setAnswer((a) => a + d),
        signal: abort.current.signal,
      });
      setResult(r);
      setAnswer(r.text);
      if (r.refused) setError('モデルが回答を断りました');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-box">
      <div className="row">
        <select value={QUESTIONS.includes(question) ? question : ''} onChange={(e) => e.target.value && setQuestion(e.target.value)}>
          {QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
          <option value="">(自由に書く)</option>
        </select>
        <button onClick={() => setSettings(!settings)}>{getApiKey() ? `設定 (${getModel()})` : 'API キーを設定'}</button>
      </div>
      <textarea className="ai-question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <div className="row">
        {busy
          ? <button onClick={() => abort.current?.abort()}>止める</button>
          : <button className="primary" disabled={!question.trim()} onClick={ask}>AI に聞く</button>}
        {busy && <span className="muted small">考えています…</span>}
        {result && <span className="muted small">{`${result.model}、入力 ${result.inputTokens + result.cachedTokens} トークン (うちキャッシュ ${result.cachedTokens})、出力 ${result.outputTokens} トークン`}</span>}
      </div>
      {settings && <AiSettings onClose={() => setSettings(false)} />}
      {error && <div className="error">{error}</div>}
      {answer && <div className="ai-answer">{answer}</div>}
    </div>
  );
}
