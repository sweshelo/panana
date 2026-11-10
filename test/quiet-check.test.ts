import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let fixture: string;
const runner = resolve(import.meta.dir, '../scripts/quiet-check.ts');

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'panana-quiet-check-'));
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({ scripts: { pass: 'bun pass.js', fail: 'bun fail.js' } }),
  );
  writeFileSync(join(fixture, 'pass.js'), 'console.log("success stdout"); console.error("success stderr");');
  writeFileSync(
    join(fixture, 'fail.js'),
    'console.log("failure stdout"); console.error("failure stderr"); process.exit(23);',
  );
});

afterAll(() => {
  if (!fixture || !resolve(fixture).startsWith(join(resolve(tmpdir()), 'panana-quiet-check-'))) {
    throw new Error('Unexpected fixture path');
  }
  rmSync(fixture, { recursive: true, force: true });
});

async function run(task: string) {
  const child = Bun.spawn([process.execPath, runner, task], { cwd: fixture, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test('successful checks discard stdout AND stderr', async () => {
  expect(await run('pass')).toEqual({ code: 0, stdout: '', stderr: '' });
});

test('failed checks retain both diagnostic streams and the nonzero exit code', async () => {
  const result = await run('fail');
  expect(result.code).toBe(23);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('[fail] failed (exit 23)');
  expect(result.stderr).toContain('failure stdout');
  expect(result.stderr).toContain('failure stderr');
});
