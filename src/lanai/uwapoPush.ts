// Sends the distribution zip (LanaiSession.distributionZip) to a running uwapo server (lanai-custom-stages web/), which
// publishes it in place of the same stage and writes it into Azahar's SD (web/dev-push.ts, POST /api/dev/push). The
// game reads the SD's lanai-cs/stages.bin again whenever the stage select opens, so no harbor download is needed.

export const UWAPO_URL_KEY = 'lanai/uwapo-url';
export const UWAPO_DEFAULT_URL = 'http://localhost:8787';

export interface UwapoPushResult {
  revision: number;
  package: string;
  /** Packages taken out of the publication because they were the same stage. */
  replaced: string[];
  stages: { id: string; name: string; content: number; pushed: boolean }[];
  warnings: string[];
  /** The SD folder written (…/lanai-cs), or null when the server does not mirror. */
  mirrored: string | null;
  mirrorError: string | null;
}

export class UwapoPushError extends Error {
  constructor(
    message: string,
    readonly conflicts?: unknown,
  ) {
    super(message);
  }
}

export function uwapoUrl(): string {
  try {
    return globalThis.localStorage?.getItem(UWAPO_URL_KEY) || UWAPO_DEFAULT_URL;
  } catch {
    return UWAPO_DEFAULT_URL;
  }
}

export function setUwapoUrl(url: string): void {
  try {
    if (url && url !== UWAPO_DEFAULT_URL) globalThis.localStorage?.setItem(UWAPO_URL_KEY, url);
    else globalThis.localStorage?.removeItem(UWAPO_URL_KEY);
  } catch {
    // the URL is only a convenience
  }
}

export async function pushToUwapo(
  zip: Uint8Array,
  options: { url?: string; name?: string; clearConditions?: boolean; fetch?: typeof fetch } = {},
): Promise<UwapoPushResult> {
  const base = (options.url ?? uwapoUrl()).replace(/\/+$/, '');
  const query = new URLSearchParams({ name: options.name ?? 'panana-push.zip' });
  if (options.clearConditions) query.set('clearConditions', '1');
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${base}/api/dev/push?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip as Uint8Array<ArrayBuffer>,
    });
  } catch (e) {
    throw new UwapoPushError(
      `uwapo (${base}) に接続できません。lanai-custom-stages の web/ で \`bun run start\` を実行しているか確かめてください。(${(e as Error).message})`,
    );
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON: an older server without /api/dev/push, or something else on the port
  }
  if (!response.ok || !body) {
    const b = body as { error?: string; conflicts?: unknown } | null;
    if (response.status === 404 || !b)
      throw new UwapoPushError(
        `uwapo (${base}) が /api/dev/push に応えません (HTTP ${response.status})。サーバーが古くないか確かめてください。`,
      );
    throw new UwapoPushError(b.error ?? `HTTP ${response.status}`, b.conflicts);
  }
  return body as UwapoPushResult;
}
