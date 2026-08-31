import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelBinding } from '../src/contracts.js';
import type { CredentialResolver } from '../src/credentials/types.js';
import { DefaultModelResolver } from '../src/models/resolver.js';

const credentials: CredentialResolver = {
  async resolve() {
    return {
      leaseId: 'lease-openai',
      type: 'api-key',
      value: 'test-key',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {},
    };
  },
};

test('OpenAI model binding relaxes provider schema strictness while retaining harness validation', async () => {
  const binding: ModelBinding = {
    bindingId: 'openai-primary',
    bindingRevision: '1',
    driver: 'openai',
    modelId: 'gpt-5-mini',
    credentialBindingId: 'openai-primary',
  };
  const resolved = await new DefaultModelResolver(credentials).resolve(binding, {
    runId: 'run-openai',
    runGrant: 'signed-run-grant',
    timeoutMs: 30_000,
  });

  assert.deepEqual(resolved.providerOptions, {
    openai: { strictJsonSchema: false },
  });
});
