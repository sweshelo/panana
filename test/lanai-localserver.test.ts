// The editor's side of the executable's server (src/lanai/localServer.ts): on the web the status is null; from the
// executable it reads the status, switches the distribution and registers a stage (the server: server/app.ts).
import { afterEach, describe, expect, test } from 'bun:test';
import { localStatus, pushToLocal, setDistribution } from '../src/lanai/localServer';
import { masterBaseline } from '../server/uwapo/panana-zip';
import { setup, stagePackage } from '../server/uwapo/test-fixtures';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The page's same-origin requests (/api/…) sent to the server, as the browser would. */
function sameOrigin(port: number): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    realFetch(
      typeof input === 'string' && input.startsWith('/') ? `http://127.0.0.1:${port}${input}` : input,
      init,
    )) as typeof fetch;
}

describe('the local server from the editor', () => {
  test('on the web there is no status', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('no server'))) as unknown as typeof fetch;
    expect(await localStatus(true)).toBeNull();
  });

  test('from the executable: the status, the switch and registering a stage', async () => {
    const env = await setup();
    await Bun.write(env.baselinePath, JSON.stringify(masterBaseline(stagePackage({ name: '', added: false }), 17408)));
    sameOrigin(env.server.ui.port!);
    const s = await localStatus(true);
    expect(s).toMatchObject({ app: 'panana', distribution: { enabled: false } });
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = probe.port!;
    await probe.stop(true);
    expect((await setDistribution({ enabled: true, port })).distribution).toMatchObject({ running: true, port });
    expect((await localStatus())!.distribution.running).toBe(true);
    await setDistribution({ enabled: false });
    await expect(setDistribution({ port: 0 })).rejects.toThrow('port');
    const r = await pushToLocal(stagePackage({ name: 'A', script: false, ips: false }));
    expect(r.revision).toBe(1);
    expect(r.stages).toHaveLength(1);
    await expect(pushToLocal(new Uint8Array())).rejects.toThrow('ZIP');
  });
});
