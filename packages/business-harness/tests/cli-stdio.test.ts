import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CliStdioCapabilityProvider } from '../src/capabilities/cli-stdio.js';

test('CLI adapter uses NDJSON stdio and passes credential outside argv', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/fake-om-cli.mjs', import.meta.url));
  const provider = new CliStdioCapabilityProvider();
  const session = await provider.open({
    connectorId: 'om-cli',
    runId: 'run-cli',
    config: {
      driver: 'cli-stdio',
      command: process.execPath,
      args: [fixture],
      credentialAudience: 'om:cli',
      credentialBindingId: 'om-default',
      credentialEnv: { OM_TEST_TOKEN: { source: 'credential-value' } },
      startupTimeoutMs: 5000,
      requestTimeoutMs: 5000,
      maxLineBytes: 1_048_576,
    },
    credential: {
      leaseId: 'lease-cli',
      type: 'bearer',
      value: 'cli-secret',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {},
    },
  });
  const tools = await session.listTools();
  assert.equal(tools[0]?.name, 'customers.get');
  const result = await session.callTool('customers.get', { id: 'customer-1' });
  assert.deepEqual(result, { toolResult: { id: 'customer-1', credential: 'cli-secret' } });
  await session.close();
});

