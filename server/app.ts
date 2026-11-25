// Panana as one executable: the editor's pages on 127.0.0.1, and the custom-stage distribution (uwapo's HTTP side,
// ported into server/uwapo) for the 3DS on the LAN when the setting turns it on.
//
// - The UI listener (127.0.0.1:<uiPort>) serves the built editor, the management APIs (/api/packages, /api/publish,
//   /api/stages) and /api/local/* (status, the setting, registering a stage from the editor, the game's patch).
// - The distribution listener (0.0.0.0:<port>) answers only what the game fetches (/api/stages.bin and the stages'
//   files) and /health. It runs while the setting is on; the management APIs never leave the loopback.
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createPackageStore } from './uwapo/packages';
import { createPublisher } from './uwapo/publish';
import { pushPackage, PushError } from './uwapo/push';

/** A file of the built editor (dist/…, by its URL path without the leading /), or null. */
export type AssetSource = (path: string) => Blob | null | Promise<Blob | null>;

export interface DistributionConfig {
  enabled: boolean;
  port: number;
}
export interface PananaConfig {
  distribution: DistributionConfig;
}
export const DEFAULT_DISTRIBUTION_PORT = 8787;
export const DEFAULT_CONFIG: PananaConfig = { distribution: { enabled: false, port: DEFAULT_DISTRIBUTION_PORT } };

export interface PananaServerOptions {
  /** Where the packages, the publications and config.json are kept. */
  dataDir: string;
  /** The editor's pages. */
  assets: AssetSource;
  /** 0 for any free port (the tests). */
  uiPort: number;
  /** The ROM's master row hashes (no ROM data) the imported ZIPs are compared with; null: none. */
  baselinePath: string | null;
  /** The game's patch (code.ips with the custom stages), null when not built in. */
  patchPath?: string | null;
  /** The address the distribution listens on (tests: 127.0.0.1). */
  distributionHostname?: string;
}

export interface LocalStatus {
  app: 'panana';
  distribution: DistributionConfig & {
    running: boolean;
    /** Why it is not running although it is on (the port is taken …). */
    error: string | null;
    /** The addresses to enter in the game's せってい「カスタムステージサーバ」. */
    urls: string[];
  };
  patch: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};
export const mimeOf = (path: string): string => MIME[/\.[^./]*$/u.exec(path)?.[0] ?? ''] ?? 'application/octet-stream';

/** The LAN addresses of this PC, as the game's server URL. */
export function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  return out;
}

/** What the distribution listener answers: the game's fetches only. */
export const isDistributionPath = (path: string): boolean =>
  path === '/health' || path === '/api/stages.bin' || /^\/api\/stages\/[0-9A-Fa-f]{8}\/(archive|crr|rows)$/u.test(path);

const validPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536;

export async function readConfig(path: string): Promise<PananaConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) return structuredClone(DEFAULT_CONFIG);
  try {
    const c = (await file.json()) as Partial<PananaConfig>;
    const d = c.distribution;
    return {
      distribution: {
        enabled: d?.enabled === true,
        port: validPort(d?.port) ? d.port : DEFAULT_DISTRIBUTION_PORT,
      },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function createPananaServer(options: PananaServerOptions) {
  await mkdir(options.dataDir, { recursive: true });
  const configPath = join(options.dataDir, 'config.json');
  let config = await readConfig(configPath);
  const packages = createPackageStore(join(options.dataDir, 'packages'), options.baselinePath ?? undefined);
  const publisher = createPublisher(join(options.dataDir, 'published'), packages);

  const json = (value: unknown, status = 200): Response =>
    Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

  // ---- the distribution listener, while the setting is on
  let distribution: ReturnType<typeof Bun.serve> | null = null;
  let distributionError: string | null = null;
  function stopDistribution(): void {
    void distribution?.stop(true);
    distribution = null;
  }
  function startDistribution(): void {
    stopDistribution();
    distributionError = null;
    if (!config.distribution.enabled) return;
    try {
      distribution = Bun.serve({
        hostname: options.distributionHostname ?? '0.0.0.0',
        port: config.distribution.port,
        async fetch(request): Promise<Response> {
          const url = new URL(request.url);
          if (!isDistributionPath(url.pathname)) return new Response('Not found', { status: 404 });
          if (url.pathname === '/health')
            return new Response('OK', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
          return (await publisher.handle(request, url)) ?? new Response('Not found', { status: 404 });
        },
      });
    } catch (error) {
      distributionError = `ポート ${config.distribution.port} で配信を始められません: ${(error as Error).message}`;
    }
  }

  function status(): LocalStatus {
    const port = distribution?.port ?? config.distribution.port;
    return {
      app: 'panana',
      distribution: {
        ...config.distribution,
        running: !!distribution,
        error: distributionError,
        urls: lanUrls(port),
      },
      patch: !!options.patchPath,
    };
  }

  async function setConfig(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON形式の本文を送ってください。' }, 400);
    }
    const d = (body as { distribution?: { enabled?: unknown; port?: unknown } } | null)?.distribution;
    if (!d || typeof d !== 'object') return json({ error: 'distribution を送ってください。' }, 400);
    if (d.enabled !== undefined && typeof d.enabled !== 'boolean')
      return json({ error: 'enabled は true か false にしてください。' }, 400);
    if (d.port !== undefined && !validPort(d.port))
      return json({ error: 'port は 1〜65535 の整数にしてください。' }, 400);
    config = {
      distribution: {
        enabled: (d.enabled as boolean | undefined) ?? config.distribution.enabled,
        port: (d.port as number | undefined) ?? config.distribution.port,
      },
    };
    await Bun.write(configPath, JSON.stringify(config, null, 2));
    startDistribution();
    return json(status());
  }

  async function push(request: Request, url: URL): Promise<Response> {
    try {
      const result = await pushPackage(packages, publisher, new Uint8Array(await request.arrayBuffer()), {
        name: url.searchParams.get('name') ?? undefined,
        clearConditions: url.searchParams.get('clearConditions') === '1',
      });
      return json(result, 201);
    } catch (error) {
      if (error instanceof PushError)
        return json({ error: error.message, ...(error.details ? { conflicts: error.details } : {}) }, error.status);
      throw error;
    }
  }

  async function local(request: Request, url: URL): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/local/status':
      case 'GET /api/local/config':
        return json(status());
      case 'PUT /api/local/config':
        return setConfig(request);
      case 'POST /api/local/push':
        return push(request, url);
      case 'GET /api/local/patch': {
        const file = options.patchPath ? Bun.file(options.patchPath) : null;
        if (!file || !(await file.exists())) return json({ error: 'パッチは同梱されていません。' }, 404);
        return new Response(file, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="code.ips"',
            'cache-control': 'no-store',
          },
        });
      }
    }
    return json({ error: 'Not found' }, 404);
  }

  /**
   * The APIs answer the editor's own pages only: a page of another site in the same browser may send requests to
   * 127.0.0.1 (a form's POST needs no preflight), and DNS rebinding can make another host name point here.
   */
  function sameOrigin(request: Request, url: URL): boolean {
    const host = url.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') return false;
    const origin = request.headers.get('origin');
    return !origin || origin === url.origin;
  }

  async function asset(path: string): Promise<Response> {
    const name = path === '/' || path === '' ? 'index.html' : decodeURIComponent(path.slice(1));
    if (name.split('/').includes('..')) return new Response('Not found', { status: 404 });
    const blob = await options.assets(name);
    if (!blob) return new Response('Not found', { status: 404 });
    return new Response(blob, { headers: { 'content-type': mimeOf(name) } });
  }

  const ui = Bun.serve({
    hostname: '127.0.0.1',
    port: options.uiPort,
    maxRequestBodySize: 64 * 1024 * 1024,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      try {
        if (path.startsWith('/api/')) {
          if (!sameOrigin(request, url)) return json({ error: 'Forbidden' }, 403);
          if (path.startsWith('/api/local/')) return await local(request, url);
          if (path === '/api/packages' || path.startsWith('/api/packages/')) return await packages.handle(request, url);
          return (await publisher.handle(request, url)) ?? json({ error: 'Not found' }, 404);
        }
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
        return await asset(path);
      } catch (error) {
        console.error('Panana request failed:', error);
        return json({ error: '処理に失敗しました。Panana のログを確認してください。' }, 500);
      }
    },
  });
  startDistribution();

  return {
    ui,
    status,
    packages,
    publisher,
    async stop(): Promise<void> {
      stopDistribution();
      await ui.stop(true);
    },
  };
}
