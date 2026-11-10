// Bun writes passing tests to stderr, so shell stdout redirection alone is insufficient.
// Buffer both streams, then replay diagnostics only when the check fails.
const [task, ...args] = process.argv.slice(2);
if (!task) {
  console.error('Usage: bun scripts/quiet-check.ts <package-script> [args...]');
  process.exit(64);
}

const child = Bun.spawn([process.execPath, 'run', '--silent', task, ...args], {
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
});
const [code, stdout, stderr] = await Promise.all([
  child.exited,
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]);
if (code !== 0) {
  console.error(`[${task}] failed (exit ${code})`);
  process.stderr.write(stdout);
  process.stderr.write(stderr);
}
process.exit(code);
