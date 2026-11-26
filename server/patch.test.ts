// The game's patch and its version (server/patch.ts) and how the distribution answers the game's update check.
import { describe, expect, test } from 'bun:test';
import { isDistributionPath } from './app';
import { fnv1a32, patchInfo, patchManifest, sha256Hex } from './patch';
import { setup } from './uwapo/test-fixtures';

const IPS = new Uint8Array([
  ...new TextEncoder().encode('PATCH'),
  0x10,
  0x00,
  0x00,
  0x00,
  0x01,
  0xaa,
  0x45,
  0x4f,
  0x46,
]);
const INFO = { buildId: '3DD3168A', sha256: sha256Hex(IPS), source: 'lanai-custom-stages 3dd3168' };

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

async function distributing(options: Parameters<typeof setup>[0]) {
  const env = await setup(options);
  const port = await freePort();
  await env.request('/api/local/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ distribution: { enabled: true, port } }),
  });
  return { ...env, lan: (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init) };
}

describe('the game patch', () => {
  test('FNV-1a 32', () => {
    expect(fnv1a32(new Uint8Array())).toBe(0x811c9dc5);
    expect(fnv1a32(new TextEncoder().encode('a'))).toBe(0xe40c292c);
    expect(fnv1a32(new TextEncoder().encode('foobar'))).toBe(0xbf9cf968);
  });

  test('the version comes from the JSON only when its sha256 is the IPS', () => {
    const r = patchInfo(IPS, INFO);
    expect(r).toEqual({
      info: { buildId: '3dd3168a', size: IPS.length, fnv1a: fnv1a32(IPS), sha256: INFO.sha256, source: INFO.source },
    });
    expect(patchInfo(IPS, { ...INFO, sha256: '0'.repeat(64) })).toHaveProperty('error');
    expect(patchInfo(IPS, { ...INFO, buildId: 'xyz' })).toHaveProperty('error');
    expect(patchInfo(IPS, null)).toHaveProperty('error');
  });

  test('patch.bin is 16 bytes: LCSP, build ID, size, FNV-1a', () => {
    const r = patchInfo(IPS, INFO);
    if (!('info' in r)) throw new Error(r.error);
    const bin = patchManifest(r.info);
    const view = new DataView(bin.buffer);
    expect(bin.length).toBe(16);
    expect(new TextDecoder().decode(bin.subarray(0, 4))).toBe('LCSP');
    expect(view.getUint32(4, true)).toBe(0x3dd3168a);
    expect(view.getUint32(8, true)).toBe(IPS.length);
    expect(view.getUint32(12, true)).toBe(fnv1a32(IPS));
  });

  test('the distribution answers the update check and the patch', async () => {
    const { lan, request } = await distributing({ patch: IPS, patchInfo: INFO });
    const bin = new Uint8Array(await (await lan('/api/patch.bin')).arrayBuffer());
    expect(new DataView(bin.buffer).getUint32(4, true)).toBe(0x3dd3168a);
    const ips = await lan('/api/patch/code.ips');
    expect(ips.status).toBe(200);
    expect(ips.headers.get('content-disposition')).toBeNull();
    expect(new Uint8Array(await ips.arrayBuffer())).toEqual(IPS);
    expect((await lan('/api/patch.bin', { method: 'POST' })).status).toBe(405);
    const status = await (await request('/api/local/status')).json();
    expect(status).toMatchObject({ patch: true, patchBuildId: '3dd3168a', patchError: null });
    const download = await request('/api/local/patch');
    expect(download.headers.get('content-disposition')).toContain('code.ips');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(IPS);
  });

  test('without a known version the game is told nothing; the editor still offers the patch', async () => {
    const { lan, request } = await distributing({ patch: IPS, patchInfo: { ...INFO, sha256: '0'.repeat(64) } });
    expect((await lan('/api/patch.bin')).status).toBe(404);
    expect((await lan('/api/patch/code.ips')).status).toBe(404);
    expect((await request('/api/local/patch')).status).toBe(200);
    const status = await (await request('/api/local/status')).json();
    expect(status).toMatchObject({ patch: true, patchBuildId: null });
    expect(status.patchError).toContain('sha256');
  });

  test('without the patch', async () => {
    const { lan, request } = await distributing({});
    expect((await lan('/api/patch.bin')).status).toBe(404);
    await expect((await request('/api/local/status')).json()).resolves.toMatchObject({
      patch: false,
      patchBuildId: null,
    });
  });

  test('the distribution paths', () => {
    expect(isDistributionPath('/api/patch.bin')).toBe(true);
    expect(isDistributionPath('/api/patch/code.ips')).toBe(true);
    expect(isDistributionPath('/api/patch')).toBe(false);
    expect(isDistributionPath('/api/local/patch')).toBe(false);
  });
});
