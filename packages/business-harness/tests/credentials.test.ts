import assert from 'node:assert/strict';
import test from 'node:test';
import { BrokerCredentialResolver } from '../src/credentials/lease-client.js';
import { HarnessError } from '../src/errors.js';

const request = {
  runId: 'run-1',
  runGrant: 'signed-one-time-run-grant',
  purpose: 'model' as const,
  audience: 'model:openai',
  bindingId: 'primary',
  minimumTtlMs: 30_000,
};

test('credential broker receives a run grant and returns a short-lived lease', async () => {
  let received: { authorization?: string; body?: unknown } = {};
  const resolver = new BrokerCredentialResolver('http://om.internal/credentials/exchange', async (_url, init) => {
    received = {
      authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      body: JSON.parse(String(init?.body)),
    };
    return Response.json({
      leaseId: 'lease-1',
      type: 'api-key',
      value: 'provider-secret',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {},
    });
  });
  const lease = await resolver.resolve(request);
  assert.equal(received.authorization, 'Bearer signed-one-time-run-grant');
  assert.deepEqual(received.body, {
    protocolVersion: '1',
    runId: 'run-1',
    purpose: 'model',
    audience: 'model:openai',
    bindingId: 'primary',
    minimumTtlMs: 30_000,
  });
  assert.equal(lease.value, 'provider-secret');
});

test('credential broker rejects a lease that expires before the run deadline', async () => {
  const resolver = new BrokerCredentialResolver('http://om.internal/credentials/exchange', async () =>
    Response.json({
      leaseId: 'lease-short',
      type: 'api-key',
      value: 'provider-secret',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      metadata: {},
    }),
  );
  await assert.rejects(() => resolver.resolve(request), HarnessError);
});

