// Asking Claude about an event from the browser, with the user's own API key (kept in this browser only and sent
// straight to Anthropic). docs/event-list.md §5.
import Anthropic from '@anthropic-ai/sdk';

const KEY_STORE = 'panana.anthropicApiKey';
const MODEL_STORE = 'panana.anthropicModel';

export const DEFAULT_MODEL = 'claude-opus-5';
export const MODELS = [
  ['claude-opus-5', 'Claude Opus 5 (標準)'],
  ['claude-sonnet-5', 'Claude Sonnet 5 (安い・速い)'],
  ['claude-fable-5-1', 'Claude Fable 5.1 (最も賢い・高い)'],
] as const;

const read = (k: string): string => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string): void => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // storage blocked: the key lasts until the page is closed
  }
};

let sessionKey = '';
export const getApiKey = (): string => sessionKey || read(KEY_STORE);
export function setApiKey(key: string, remember: boolean): void {
  sessionKey = key.trim();
  write(KEY_STORE, remember ? sessionKey : '');
}
export const getModel = (): string => read(MODEL_STORE) || DEFAULT_MODEL;
export const setModel = (m: string): void => write(MODEL_STORE, m === DEFAULT_MODEL ? '' : m);

export interface AskOptions {
  /** Stable context (the game and how events work): the cached system prompt. */
  system: string;
  /** The event and the question. */
  prompt: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
  /** For tests. */
  fetch?: typeof fetch;
}

export interface AskResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  refused: boolean;
}

const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);

const INSTRUCTIONS = `あなたはニンテンドー3DSのゲームの解析とMOD作りを手伝うリバースエンジニアです。
渡される注釈つき ARM アセンブラとイベントの情報を読み、日本語で答えてください。
- 注釈 (; の後ろ) はツールが付けたもので、「推定」とあるものは確かではありません。
- コードから確かに言えることと、推測を分けて書いてください。関数やアドレスを根拠として挙げてください。
- 分からない関数は FUN_xxxxxxxx のまま扱い、名前を作らないでください。`;

/** Ask Claude (streaming); throws Anthropic.APIError subclasses on API errors. */
export async function askClaude({ system, prompt, onText, signal, fetch: fetchFn }: AskOptions): Promise<AskResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API キーが設定されていません');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...(fetchFn ? { fetch: fetchFn } : {}) });
  const model = getModel();
  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // Opus 5 / Fable 5.1: a declined request is re-run on a fallback model chosen by the server
      ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: [
        { type: 'text', text: INSTRUCTIONS },
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: prompt }],
    },
    { signal },
  );
  stream.on('text', (delta) => onText(delta));
  const msg = await stream.finalMessage();
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return {
    text,
    model: msg.model,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cachedTokens: msg.usage.cache_read_input_tokens ?? 0,
    refused: msg.stop_reason === 'refusal',
  };
}

/** A message for the user from an API error. */
export function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API キーが正しくありません (401)';
  if (e instanceof Anthropic.PermissionDeniedError) return 'この API キーではこのモデルを使えません (403)';
  if (e instanceof Anthropic.RateLimitError) return '利用の上限に達しました。少し待ってからもう一度試してください (429)';
  if (e instanceof Anthropic.BadRequestError) return `リクエストが受け付けられませんでした: ${e.message}`;
  if (e instanceof Anthropic.APIUserAbortError) return '中止しました';
  if (e instanceof Anthropic.APIConnectionError) return 'Anthropic に接続できませんでした';
  if (e instanceof Anthropic.APIError) return `API のエラー (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
