import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createHarnessHttpServer } from '../src/server.js';
import type { BusinessAgentRuntime } from '../src/runtime/runtime.js';

test('HTTP server exposes health and protects run execution with service auth', async (t) => {
  const runtime = {
    async run(_input: unknown, options?: { onEvent?: (event: unknown) => unknown }) {
      await options?.onEvent?.({ type: 'run.started', runId: 'run-http', timestamp: new Date().toISOString() });
      return { protocolVersion: '1', status: 'completed', output: 'ok' };
    },
  } as unknown as BusinessAgentRuntime;
  const server = createHarnessHttpServer({
    runtime,
    serviceToken: 'service-token-with-24-characters',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);

  const unauthorized = await fetch(`${base}/v1/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${base}/v1/runs`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer service-token-with-24-characters',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json() as { output: string }).output, 'ok');

  const streamed = await fetch(`${base}/v1/runs`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer service-token-with-24-characters',
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: '{}',
  });
  assert.equal(streamed.status, 200);
  const records = (await streamed.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(records[0].kind, 'event');
  assert.equal(records[1].kind, 'result');
});

