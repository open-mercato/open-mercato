import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const tsxCli = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const runtimeCli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const configFile = fileURLToPath(new URL('../harness.config.host.json', import.meta.url));

test('run --stdio emits protocol errors on stdout and needs no service token', async () => {
  const result = await runCli(['run', '--stdio'], '{invalid', {
    HARNESS_CONFIG_FILE: configFile,
    HARNESS_CREDENTIAL_MODE: 'env',
  });

  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    kind: 'error',
    error: { code: 'INVALID_REQUEST', message: 'stdin must contain one valid JSON request' },
  });
});

test('CLI help documents both process transports without loading configuration', async () => {
  const result = await runCli(['--help'], '', {});

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /run --stdio/);
  assert.match(result.stdout, /serve/);
});

async function runCli(
  args: string[],
  input: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [tsxCli, runtimeCli, ...args], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...env,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}
