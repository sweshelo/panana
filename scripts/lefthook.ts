// A Windows Lefthook binary needs Git for Windows paths, not MSYS2 /home/... paths.
// Select a native Git already on PATH without changing the user's global environment.
import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const env = { ...process.env };
if (process.platform === 'win32') {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const entries = (env[pathKey] ?? '').split(delimiter);
  const nativeGit = entries.find((dir) => {
    const executable = join(dir, 'git.exe');
    if (!existsSync(executable)) return false;
    const result = Bun.spawnSync([executable, '--version'], { stdout: 'pipe', stderr: 'pipe' });
    return result.exitCode === 0 && result.stdout.toString().includes('.windows.');
  });
  if (!nativeGit) {
    console.error('Lefthook requires Git for Windows on PATH (MSYS2 Git is not sufficient).');
    process.exit(1);
  }
  env[pathKey] = [nativeGit, ...entries].join(delimiter);
}

const child = Bun.spawn(
  [process.execPath, resolve(import.meta.dir, '../node_modules/lefthook/bin/index.js'), ...process.argv.slice(2)],
  { env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
);
process.exit(await child.exited);
