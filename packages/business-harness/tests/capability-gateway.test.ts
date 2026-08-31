import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityProvider, CapabilitySession } from '../src/capabilities/types.js';
import { CapabilityGateway } from '../src/capabilities/gateway.js';
import type { CredentialResolver } from '../src/credentials/types.js';
import { HarnessError } from '../src/errors.js';
import { makeConfig } from './helpers.js';

test('gateway exposes only allowlisted tools and injects hidden session arguments', async () => {
  let received: unknown;
  const session: CapabilitySession = {
    async listTools() {
      return [
        {
          name: 'orders.get',
          description: 'Read one order',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, _sessionToken: { type: 'string' } },
            required: ['id', '_sessionToken'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: 'orders.delete',
          inputSchema: { type: 'object', properties: {} },
          annotations: { destructiveHint: true },
        },
      ];
    },
    async callTool(_name, input) {
      received = input;
      return { ok: true };
    },
    async close() {},
  };
  const provider: CapabilityProvider = { async open() { return session; } };
  const credentials: CredentialResolver = {
    async resolve() {
      return {
        leaseId: 'lease-1',
        type: 'api-key',
        value: 'api-key',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        metadata: { sessionToken: 'session-secret' },
      };
    },
  };
  const config = makeConfig({
    connectors: {
      om: {
        driver: 'mcp-http',
        url: 'http://localhost:3000/mcp',
        credentialAudience: 'om:mcp',
        credentialBindingId: 'om-default',
        hiddenArguments: {
          _sessionToken: { source: 'credential-metadata', key: 'sessionToken' },
        },
      },
    },
  });
  const gateway = new CapabilityGateway(config, credentials, {
    providers: { 'mcp-http': provider },
  });
  const bound = await gateway.bind({
    runId: 'run-1',
    runGrant: 'run-grant',
    timeoutMs: 30_000,
    maxToolCalls: 2,
    bindings: [{ connectorId: 'om', allowedTools: ['orders.get'], access: 'read' }],
  });
  assert.equal(bound.catalog.length, 1);
  assert.equal(bound.catalog[0]?.toolName, 'orders.get');
  const tool = bound.tools[bound.catalog[0]!.modelName] as any;
  await tool.execute({ id: 'order-1' });
  assert.deepEqual(received, { id: 'order-1', _sessionToken: 'session-secret' });
  assert.equal(bound.getToolCallCount(), 1);
  await assert.rejects(() => tool.execute({ id: 12 }), HarnessError);
  await bound.close();
});

test('read binding rejects a tool without an explicit read-only annotation', async () => {
  const session: CapabilitySession = {
    async listTools() {
      return [{ name: 'orders.update', inputSchema: { type: 'object', properties: {} } }];
    },
    async callTool() {},
    async close() {},
  };
  const credentials: CredentialResolver = {
    async resolve() {
      return {
        leaseId: 'lease-1',
        type: 'api-key',
        value: 'secret',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        metadata: {},
      };
    },
  };
  const config = makeConfig({
    connectors: {
      om: {
        driver: 'mcp-http',
        url: 'http://localhost:3000/mcp',
        credentialAudience: 'om:mcp',
        credentialBindingId: 'om-default',
      },
    },
  });
  const gateway = new CapabilityGateway(config, credentials, {
    providers: { 'mcp-http': { async open() { return session; } } },
  });
  await assert.rejects(
    () =>
      gateway.bind({
        runId: 'run-1',
        runGrant: 'run-grant',
        timeoutMs: 30_000,
        maxToolCalls: 2,
        bindings: [{ connectorId: 'om', allowedTools: ['orders.update'], access: 'read' }],
      }),
    /not declared read-only/,
  );
});

