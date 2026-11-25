// Starts Panana as a local app: `bun server/main.ts` (the built editor from dist/) or the executable that
// scripts/build-exe.ts makes (the editor, the baseline and the patch built in). Options:
//   --data <dir>   where the packages, publications and config.json are kept (default %APPDATA%\Panana / ~/.panana)
//   --port <n>     the editor's port on 127.0.0.1 (default 8786; the browser keeps the loaded ROM per address)
//   --no-open      do not open the browser
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPananaServer, type AssetSource, type LocalStatus } from './app';

export const DEFAULT_UI_PORT = 8786;

export interface RunOptions {
  argv: string[];
  assets: AssetSource;
  baselinePath: string | null;
  patchPath: string | null;
}

/** The default data folder: %APPDATA%\Panana on Windows, ~/.panana elsewhere. */
export function defaultDataDir(env: Record<string, string | undefined> = process.env): string {
  return env.APPDATA ? join(env.APPDATA, 'Panana') : join(homedir(), '.panana');
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url];
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    // the address is printed anyway
  }
}

/** Whether a Panana already answers on the port (then this one only opens the browser). */
async function running(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/local/status`, { signal: AbortSignal.timeout(1500) });
    return ((await r.json()) as Partial<LocalStatus>).app === 'panana';
  } catch {
    return false;
  }
}

export async function run(options: RunOptions): Promise<void> {
  const { argv } = options;
  const port = Number(arg(argv, 'port') ?? DEFAULT_UI_PORT);
  const url = `http://127.0.0.1:${port}`;
  const open = !argv.includes('--no-open');
  if (await running(url)) {
    console.log(`Panana はもう起動しています: ${url}`);
    if (open) openBrowser(url);
    return;
  }
  const dataDir = resolve(arg(argv, 'data') ?? defaultDataDir());
  const server = await createPananaServer({
    dataDir,
    assets: options.assets,
    uiPort: port,
    baselinePath: options.baselinePath,
    patchPath: options.patchPath,
  });
  const s = server.status();
  console.log(`Panana: ${url}`);
  console.log(`データ: ${dataDir}`);
  console.log(
    s.distribution.enabled
      ? s.distribution.running
        ? `カスタムステージの配信: ${s.distribution.urls.join(' / ') || `ポート ${s.distribution.port}`}`
        : `カスタムステージの配信: 停止 (${s.distribution.error})`
      : 'カスタムステージの配信: オフ (Panana の「配信」ページで切り替え)',
  );
  if (open) openBrowser(url);
}

// `bun server/main.ts`: the editor from dist/ (bun run build first), the baseline and the patch from server/assets/
if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const dist = join(root, 'dist');
  const assetsDir = join(root, 'server', 'assets');
  const existing = async (path: string): Promise<string | null> => ((await Bun.file(path).exists()) ? path : null);
  await run({
    argv: process.argv.slice(2),
    assets: async (path) => {
      const file = Bun.file(join(dist, path));
      return (await file.exists()) ? file : null;
    },
    baselinePath: await existing(join(assetsDir, 'master-baseline.json')),
    patchPath: await existing(join(assetsDir, 'lanai-cs.ips')),
  });
}
