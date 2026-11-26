// The local server of Panana's executable (server/app.ts), seen from the editor: on the same origin when the editor
// runs from the executable, absent on the web (the status request fails, and nothing of it is shown).
import { useEffect, useState } from 'react';
import type { LocalStatus } from '../../server/app';
import type { PushResult } from '../../server/uwapo/push';

export type { LocalStatus };

let cached: Promise<LocalStatus | null> | null = null;

/** The executable's status, or null on the web (asked once; refresh: true asks again). */
export function localStatus(refresh = false): Promise<LocalStatus | null> {
  if (!cached || refresh)
    cached = fetch('/api/local/status', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return null;
        const s = (await r.json()) as Partial<LocalStatus>;
        return s.app === 'panana' ? (s as LocalStatus) : null;
      })
      .catch(() => null);
  return cached;
}

/** The status while the editor runs from the executable; null on the web and until it is known. */
export function useLocalStatus(): [LocalStatus | null, (s: LocalStatus) => void] {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  useEffect(() => {
    let live = true;
    void localStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return [status, setStatus];
}

async function answer<T>(r: Response, fallback: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    // not JSON
  }
  if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `${fallback} (HTTP ${r.status})`);
  return body as T;
}

/** Turns the distribution on or off, or moves it to another port. */
export async function setDistribution(change: { enabled?: boolean; port?: number }): Promise<LocalStatus> {
  const s = await answer<LocalStatus>(
    await fetch('/api/local/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ distribution: change }),
    }),
    '配信の設定を変えられませんでした',
  );
  cached = Promise.resolve(s);
  return s;
}

/** Registers the distribution ZIP and publishes it in place of the same stage (server/uwapo/push.ts). */
export async function pushToLocal(
  zip: Uint8Array,
  options: { name?: string; clearConditions?: boolean } = {},
): Promise<PushResult> {
  const query = new URLSearchParams({ name: options.name ?? 'panana-push.zip' });
  if (options.clearConditions) query.set('clearConditions', '1');
  return answer<PushResult>(
    await fetch(`/api/local/push?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip as Uint8Array<ArrayBuffer>,
    }),
    '配信に登録できませんでした',
  );
}
