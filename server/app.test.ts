// Panana's local server (server/app.ts): the editor's pages, the setting that starts and stops the distribution for
// the 3DS, what the distribution answers, the APIs refusing other origins, and registering a stage from the editor.
import { describe, expect, test } from 'bun:test';
import { isDistributionPath, readConfig } from './app';
import { masterBaseline } from './uwapo/panana-zip';
import { setup, stagePackage } from './uwapo/test-fixtures';

const KEY_A = 'c42bfd09-dfe2-41a7-8610-38bd99f27f27';
const KEY_B = 'c9e15302-0405-4415-9c6c-797130808689';
const plain = (name: string, stageKey?: string) => stagePackage({ script: false, ips: false, name, stageKey });

async function local() {
  const env = await setup();
  await Bun.write(env.baselinePath, JSON.stringify(masterBaseline(stagePackage({ name: '', added: false }), 17408)));
  const config = (distribution: Record<string, unknown>) =>
    env.request('/api/local/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ distribution }),
    });
  const push = (zip: Uint8Array) =>
    env.request('/api/local/push?name=panana.zip', { method: 'POST', body: zip as Uint8Array<ArrayBuffer> });
  return { ...env, config, push };
}

describe('Panana local server', () => {
  test('the distribution answers only the game, and runs while the setting is on', async () => {
    const { config, request, server, directory } = await local();
    expect((await (await request('/api/local/status')).json()).distribution).toMatchObject({
      enabled: false,
      running: false,
    });
    // a free port for the test: start on 0 is not allowed, so take one from a throwaway listener
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = probe.port!;
    await probe.stop(true);
    const on = await (await config({ enabled: true, port })).json();
    expect(on.distribution).toMatchObject({ enabled: true, running: true, port, error: null });
    expect(await readConfig(`${directory}/config.json`)).toEqual({ distribution: { enabled: true, port } });
    const lan = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
    expect(await (await lan('/health')).text()).toBe('OK');
    expect((await lan('/api/stages.bin')).status).toBe(200);
    // the management APIs and the editor stay on the loopback listener
    for (const path of ['/api/packages', '/api/stages', '/api/local/status', '/'])
      expect((await lan(path)).status).toBe(404);
    expect(server.status().distribution.running).toBe(true);
    await config({ enabled: false });
    await expect(lan('/health')).rejects.toThrow();
    expect((await config({ port: 70000 })).status).toBe(400);
  });

  test('a port already taken leaves the distribution stopped with the reason', async () => {
    const { config } = await local();
    const taken = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    try {
      const s = await (await config({ enabled: true, port: taken.port })).json();
      expect(s.distribution).toMatchObject({ enabled: true, running: false });
      expect(s.distribution.error).toContain(`ポート ${taken.port}`);
    } finally {
      await taken.stop(true);
    }
  });

  test('the APIs refuse requests from other origins and host names', async () => {
    const { request, server } = await local();
    const evil = { origin: 'https://example.com' };
    expect((await request('/api/local/status', { headers: evil })).status).toBe(403);
    expect((await request('/api/packages', { method: 'POST', headers: evil, body: 'x' })).status).toBe(403);
    expect(
      (await request('/api/local/status', { headers: { origin: `http://127.0.0.1:${server.ui.port}` } })).status,
    ).toBe(200);
    // DNS rebinding: another host name pointing at 127.0.0.1
    const rebound = await fetch(`http://127.0.0.1:${server.ui.port}/api/local/status`, {
      headers: { host: `evil.example:${server.ui.port}` },
    });
    expect(rebound.status).toBe(403);
  });

  test('registering from the editor publishes in place of the same stage and keeps the others', async () => {
    const { push, request } = await local();
    const a1 = await (await push(plain('A1', KEY_A))).json();
    expect(a1.revision).toBe(1);
    const b = await (await push(plain('B', KEY_B))).json();
    expect(b.replaced).toEqual([]);
    const res = await push(plain('A2', KEY_A));
    expect(res.status).toBe(201);
    const a2 = await res.json();
    expect(a2.replaced).toEqual([a1.package]);
    expect(a2.stages.map((s: { name: string }) => s.name.replace(/^島/u, '')).sort()).toEqual(['A2', 'B']);
    expect(a2).not.toHaveProperty('mirrored');
    const manifest = await (await request('/api/stages')).json();
    expect(manifest.revision).toBe(3);
    expect((await push(new Uint8Array())).status).toBe(400);
  });

  test('the pages come from the assets; the patch is answered only when built in', async () => {
    const { request } = await local();
    expect((await request('/')).status).toBe(404);
    expect((await request('/api/local/patch')).status).toBe(404);
    expect((await request('/../x')).status).toBe(404);
  });

  test('the distribution paths', () => {
    expect(isDistributionPath('/api/stages.bin')).toBe(true);
    expect(isDistributionPath('/api/stages/F0000001/rows')).toBe(true);
    expect(isDistributionPath('/api/stages/F0000001/other')).toBe(false);
    expect(isDistributionPath('/api/stages')).toBe(false);
    expect(isDistributionPath('/api/publish')).toBe(false);
  });
});
