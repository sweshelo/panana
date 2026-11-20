// Sending the distribution zip to uwapo (lanai-custom-stages web/dev-push.ts): request shape and error messages.
import { describe, expect, test } from 'bun:test';
import { pushToUwapo, UwapoPushError } from '../src/lanai/uwapoPush';

const ok = {
  revision: 3,
  package: 'abcdef0123456789',
  replaced: ['0123456789abcdef'],
  stages: [{ id: 'F00DCAFE', name: '島テスト', content: 127, pushed: true }],
  warnings: [],
  mirrored: 'C:/Azahar/sdmc/lanai-cs',
  mirrorError: null,
};

function fake(response: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('pushToUwapo', () => {
  test('POSTs the zip to /api/dev/push and returns the result', async () => {
    const { f, calls } = fake(() => Response.json(ok, { status: 201 }));
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    const result = await pushToUwapo(zip, { url: 'http://pc:8787/', name: 'a.zip', clearConditions: true, fetch: f });
    expect(result).toEqual(ok);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://pc:8787/api/dev/push?name=a.zip&clearConditions=1');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe(zip);
  });

  test('reports the server error with its conflicts', async () => {
    const conflicts = [{ kind: 'script', value: '1' }];
    const { f } = fake(() => Response.json({ error: '衝突しています', conflicts }, { status: 409 }));
    const e = await pushToUwapo(new Uint8Array(1), { url: 'http://pc:8787', fetch: f }).catch((x) => x);
    expect(e).toBeInstanceOf(UwapoPushError);
    expect(e.message).toBe('衝突しています');
    expect(e.conflicts).toEqual(conflicts);
  });

  test('explains a server that is not running or too old', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const e1 = await pushToUwapo(new Uint8Array(1), { url: 'http://pc:8787', fetch: down }).catch((x) => x);
    expect(e1.message).toContain('接続できません');
    const { f } = fake(() => new Response('Not found', { status: 404 }));
    const e2 = await pushToUwapo(new Uint8Array(1), { url: 'http://pc:8787', fetch: f }).catch((x) => x);
    expect(e2.message).toContain('/api/dev/push に応えません');
  });
});
